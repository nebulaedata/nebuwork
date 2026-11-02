package api

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func (s *Server) imageRoutes() {
	s.visualRoutes()
	// Metadata for the authenticated NebuWork bridge, including preview-only assets.
	s.handle("GET /api/v1/assets/{id}/metadata", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.one(w, r, `SELECT json_build_object('id',a.id,'knowledge_id',a.knowledge_id,'knowledge_base_id',k.knowledge_base_id,'file_version_id',a.file_version_id,'parse_version_id',a.metadata->>'parse_version_id') FROM assets a JOIN knowledge k ON k.id=a.knowledge_id WHERE a.id=$1`, id)
	})
	s.handle("GET /api/v1/images/{id}/content", func(w http.ResponseWriter, r *http.Request) {
		r.URL.Path = "/api/v1/preview-assets/" + r.PathValue("id")
		s.mux.ServeHTTP(w, r)
	})
	s.handle("GET /api/v1/images/{id}/derivatives", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.list(w, r, `SELECT json_build_object('asset_id',id,'file_version_id',file_version_id,'metadata',metadata-'path','content_url','/api/v1/images/'||id||'/content') FROM assets WHERE id=$1`, id)
	})
	s.handle("POST /api/v1/images/{id}/preprocess", func(w http.ResponseWriter, r *http.Request) {
		Failure(w, 422, "CAPABILITY_NOT_READY", "当前仅支持入库时的方向归一化和缩放，透视矫正引擎尚未启用")
	})
	s.handle("POST /api/v1/images/{id}/reprocess", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var document string
		if e := s.Services.DB.QueryRow(r.Context(), "SELECT knowledge_id::text FROM assets WHERE id=$1", id).Scan(&document); e != nil {
			dbFailure(w, e)
			return
		}
		r.SetPathValue("id", document)
		s.reprocess(w, r)
	})
	s.handle("POST /api/v1/knowledge-bases/{id}/knowledge/url", s.importURL)
}
func (s *Server) importURL(w http.ResponseWriter, r *http.Request) {
	kb, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var in struct {
		URL  string `json:"url"`
		Name string `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	u, e := url.Parse(in.URL)
	if e != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		Failure(w, 400, "INVALID_ARGUMENT", "网页 URL 无效")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	transport := &http.Transport{Proxy: nil, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, e := net.SplitHostPort(address)
		if e != nil {
			return nil, e
		}
		ips, e := net.DefaultResolver.LookupIPAddr(ctx, host)
		if e != nil {
			return nil, e
		}
		// The configured URL may resolve to a LAN, local or proxy Fake-IP address.
		for _, a := range ips {
			conn, e := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, network, net.JoinHostPort(a.IP.String(), port))
			if e == nil {
				return conn, nil
			}
		}
		return nil, fmt.Errorf("网页连接失败")
	}}
	defer transport.CloseIdleConnections()
	client := http.Client{Transport: transport, Timeout: 45 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 || req.URL.User != nil || (req.URL.Scheme != "http" && req.URL.Scheme != "https") {
			return fmt.Errorf("网页跳转受限")
		}
		return nil
	}}
	req, _ := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	req.Header.Set("User-Agent", "NebulaeKno/"+Version)
	response, e := client.Do(req)
	if e != nil {
		Failure(w, 502, "URL_FETCH_FAILED", "网页获取失败，请确认 URL 可从知识库服务所在网络访问")
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		Failure(w, 502, "URL_FETCH_FAILED", "网页返回非成功状态")
		return
	}
	kind := response.Header.Get("Content-Type")
	if !strings.Contains(kind, "text/html") && !strings.Contains(kind, "text/plain") {
		Failure(w, 400, "UNSUPPORTED_FORMAT", "网页导入仅接收 HTML 或纯文本")
		return
	}
	name := in.Name
	if name == "" {
		name = u.Hostname() + "-" + uuid.NewString()[:8]
	}
	name += ".html"
	if strings.Contains(kind, "text/plain") {
		name = strings.TrimSuffix(name, ".html") + ".txt"
	}
	result, e := s.storeFile(ctx, kb, name, response.Body, r.Header.Get("Idempotency-Key"))
	if e != nil {
		Failure(w, 400, "UPLOAD_FAILED", e.Error())
		return
	}
	if _, e = s.Services.DB.Exec(ctx, "UPDATE knowledge SET config=config||jsonb_build_object('source_url',$2::text) WHERE id=$1", result["knowledge_id"], u.String()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 202, result)
}
