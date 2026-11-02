package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"github.com/google/uuid"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/extraction"
	"nebulaekno/internal/taskcontrol"
)

var extractionProxyTransport = &http.Transport{Proxy: http.ProxyFromEnvironment, ResponseHeaderTimeout: 90 * time.Second, MaxIdleConns: 32, MaxIdleConnsPerHost: 8, IdleConnTimeout: 60 * time.Second}

func (s *Server) extractionProxyRoutes() {
	for _, pattern := range []string{
		"GET /api/v1/extractions/documents", "POST /api/v1/knowledge/{id}/extractions",
		"GET /api/v1/knowledge/{id}/extractions/sections", "GET /api/v1/knowledge/{id}/extractions",
		"GET /api/v1/extractions/{id}", "GET /api/v1/extractions/{id}/records",
		"GET /api/v1/extractions/{id}/coverage", "GET /api/v1/extractions/{id}/export.xlsx",
		"GET /api/v1/settings/extraction-defaults", "PUT /api/v1/settings/extraction-defaults",
	} {
		s.handle(pattern, s.proxyExtraction)
	}
}

func (s *Server) proxyExtraction(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-NebulaeKno-Extraction-Proxy") != "" {
		Failure(w, 503, "EXTRACTION_UNAVAILABLE", "提取服务转发配置形成循环，请检查服务地址")
		return
	}
	raw := s.Config.ExtractionURL
	if raw == "" {
		raw = "http://extraction:8082"
	}
	target, err := url.Parse(raw)
	if err != nil || target.Host == "" {
		Failure(w, 503, "EXTRACTION_UNAVAILABLE", "提取服务地址未配置")
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.Transport = extractionProxyTransport
	proxy.ModifyResponse = func(response *http.Response) error {
		// The original server already owns the browser's CORS headers.
		response.Header.Del("Access-Control-Allow-Origin")
		response.Header.Del("Access-Control-Allow-Headers")
		response.Header.Del("Access-Control-Allow-Methods")
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		Failure(w, 503, "EXTRACTION_UNAVAILABLE", "参数提取服务暂不可用，其他功能可继续使用")
	}
	r.Header.Set("X-NebulaeKno-Extraction-Proxy", "1")
	proxy.ServeHTTP(w, r)
}

// Only the extraction service can call this route. Provider credentials and
// URLs are loaded by the main app from the task's frozen model reference.
func (s *Server) extractionModelGateway() {
	s.mux.HandleFunc("POST "+extraction.ModelGatewayPath, func(w http.ResponseWriter, r *http.Request) {
		expected := s.Services.Identity.InternalToken(extraction.InternalPurpose)
		if len(s.Services.Identity.Key) != 32 || !hmac.Equal([]byte(r.Header.Get(extraction.InternalTokenHeader)), []byte(expected)) {
			Failure(w, 403, "INTERNAL_AUTH_REQUIRED", "内部服务认证失败")
			return
		}
		var input extraction.ModelRequest
		if !decode(w, r, &input) {
			return
		}
		if uuid.Validate(input.TaskID) != nil || uuid.Validate(input.RunID) != nil || input.Owner == "" || len(input.Owner) > 200 {
			Failure(w, 400, "INVALID_ARGUMENT", "任务标识或租约无效")
			return
		}
		allowed := map[string]bool{"messages": true, "temperature": true, "stream": true, "max_tokens": true, "response_format": true}
		for key := range input.Body {
			if !allowed[key] {
				Failure(w, 400, "INVALID_ARGUMENT", "不接受模型地址、凭证或其他调用选项")
				return
			}
		}
		messages, ok := input.Body["messages"].([]any)
		if !ok || len(messages) == 0 {
			Failure(w, 400, "INVALID_ARGUMENT", "模型消息不能为空")
			return
		}
		for _, raw := range messages {
			message, ok := raw.(map[string]any)
			if !ok {
				Failure(w, 400, "INVALID_ARGUMENT", "模型消息格式无效")
				return
			}
			if _, ok = message["content"].(string); !ok {
				Failure(w, 400, "INVALID_ARGUMENT", "提取仅接受文本消息")
				return
			}
		}
		var modelID string
		var cfg map[string]any
		err := s.Services.DB.QueryRow(r.Context(), `SELECT r.model_id::text,r.config FROM extraction_runs r JOIN tasks t ON t.id=r.task_id
   WHERE r.id=$1 AND t.id=$2 AND t.type='clause_extraction' AND t.owner=$3
   AND t.state='running' AND NOT t.cancel_requested AND t.lease_until>now() AND (`+taskcontrol.UninterruptedSQL+`)`, input.RunID, input.TaskID, input.Owner).Scan(&modelID, &cfg)
		if err != nil {
			Failure(w, 409, "TASK_LEASE_LOST", "提取任务租约已失效")
			return
		}
		model, err := ai.Load(r.Context(), s.Services, modelID)
		if err != nil {
			modelGatewayFailure(w, err)
			return
		}
		snapshot, _ := json.Marshal(map[string]any{"id": model.ID, "name": model.ModelName, "url": model.BaseURL, "protocol": model.Protocol, "config": model.Config})
		digest := sha256.Sum256(snapshot)
		fingerprint, _ := cfg["model_fingerprint"].(string)
		if fingerprint == "" || fingerprint != hex.EncodeToString(digest[:]) || !ai.SupportsPurpose(model.Purpose, "text") {
			Failure(w, 409, "EXTRACTION_MODEL_CHANGED", "冻结模型配置已变化，请重新提取")
			return
		}
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		go func() {
			tick := time.NewTicker(3 * time.Second)
			defer tick.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-tick.C:
					var valid bool
					e := s.Services.DB.QueryRow(ctx, "SELECT owner=$2 AND state='running' AND NOT cancel_requested AND lease_until>now() AND ("+taskcontrol.UninterruptedSQL+") FROM tasks t WHERE id=$1", input.TaskID, input.Owner).Scan(&valid)
					if e != nil || !valid {
						cancel()
						return
					}
				}
			}
		}()
		response, err := ai.Completion(ctx, model, input.Body)
		if err != nil {
			modelGatewayFailure(w, err)
			return
		}
		JSON(w, 200, response)
	})
}
func modelGatewayFailure(w http.ResponseWriter, err error) {
	var upstream *ai.Error
	if !errors.As(err, &upstream) {
		upstream = &ai.Error{Code: "MODEL_REQUEST_FAILED", Message: "主系统模型调用失败", Retryable: true}
	}
	status := 502
	if upstream.Retryable {
		status = 503
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	writeJSON(w, map[string]any{"success": false, "error": map[string]any{"code": upstream.Code, "message": upstream.Message, "retryable": upstream.Retryable}})
}
