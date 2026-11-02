package api

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"io"
	"mime"
	"nebulaekno/internal/defaults"
	"nebulaekno/internal/ingest"
	"nebulaekno/internal/jobs"
	"nebulaekno/internal/taskcontrol"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
)

var formats = func() []string {
	out := []string{}
	for _, f := range defaults.ParserFormats {
		out = append(out, f.Extensions...)
	}
	return out
}()

func supported(ext string) bool {
	for _, f := range formats {
		if ext == f {
			return true
		}
	}
	return false
}
func (s *Server) documentRoutes() {
	for _, kind := range []string{"transcript", "frames"} {
		s.handle("GET /api/v1/knowledge/{id}/"+kind, func(w http.ResponseWriter, r *http.Request) {
			r.URL.Path = "/api/v1/knowledge/" + r.PathValue("id") + "/media/" + kind
			s.mux.ServeHTTP(w, r)
		})
	}
	s.handle("POST /api/v1/knowledge-bases/{id}/knowledge/file", s.upload)
	s.handle("POST /api/v1/knowledge-bases/{id}/knowledge/files", s.upload)
	s.handle("POST /api/v1/knowledge-bases/{id}/knowledge/manual", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var in struct {
			Name    string `json:"name"`
			Content string `json:"content"`
		}
		if !decode(w, r, &in) {
			return
		}
		if !validName(in.Name) || in.Content == "" {
			Failure(w, 400, "INVALID_ARGUMENT", "标题和内容必填")
			return
		}
		out, e := s.storeFile(r.Context(), id, in.Name+".md", strings.NewReader(in.Content), r.Header.Get("Idempotency-Key"))
		if e != nil {
			Failure(w, 400, "UPLOAD_FAILED", e.Error())
			return
		}
		JSON(w, 202, out)
	})
	s.handle("GET /api/v1/knowledge-bases/{id}/knowledge", s.processingDocuments)
	s.handle("GET /api/v1/knowledge-bases/{id}/processing", s.documentProcessingSummary)
	s.handle("GET /api/v1/knowledge/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.one(w, r, "SELECT row_to_json(k) FROM knowledge k WHERE id=$1", id)
	})
	s.handle("PUT /api/v1/knowledge/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var in struct {
			Name string `json:"name"`
		}
		if !decode(w, r, &in) {
			return
		}
		if !validName(in.Name) {
			Failure(w, 400, "INVALID_ARGUMENT", "名称无效")
			return
		}
		s.one(w, r, "WITH updated AS (UPDATE knowledge SET name=$2,updated_at=now() WHERE id=$1 RETURNING *) SELECT row_to_json(updated) FROM updated", id, in.Name)
	})
	s.handle("GET /api/v1/knowledge/{id}/versions", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.list(w, r, "SELECT row_to_json(v) FROM (SELECT id,hash,size,mime_type,created_at FROM file_versions WHERE knowledge_id=$1 ORDER BY created_at DESC) v", id)
	})
	s.handle("GET /api/v1/knowledge/{id}/content", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		version, ok := s.selectedParse(w, r, id)
		if !ok {
			return
		}
		displays, e := s.ocrDisplays(r.Context(), []string{version})
		if e != nil {
			dbFailure(w, e)
			return
		}
		s.oneView(w, r, func(value map[string]any) {
			applyOCRField(value, "content", "display_content", displays[version].cleanup)
		}, "SELECT json_build_object('parse_version_id',p.id,'file_version_id',p.file_version_id,'content',p.content,'engine',p.engine,'conversion',p.metadata->'conversion','visual_layout_version',coalesce(p.metadata->'visual_layout_version','0'::jsonb),'warnings',coalesce(p.metadata->'warnings','[]'::jsonb),'image_occurrences',"+contentImageOccurrences+",'requires_image_reparse',k.file_type='pdf' AND p.engine='paddleocr_vl' AND coalesce(p.metadata->>'visual_layout_version','0')<>'2') FROM parse_versions p JOIN knowledge k ON k.id=p.knowledge_id WHERE p.id=$1", version)
	})
	s.handle("GET /api/v1/knowledge/{id}/chunks", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		version, ok := s.selectedParse(w, r, id)
		if !ok {
			return
		}
		displays, e := s.ocrDisplays(r.Context(), []string{version})
		if e != nil {
			dbFailure(w, e)
			return
		}
		s.pageView(w, r, func(value map[string]any) {
			origin, _ := value["content_origin"].(string)
			if strings.Contains(origin, "ocr") {
				displays[version].project(value, "content", "display_content")
			}
		}, chunkVisualQuery, "SELECT count(*) FROM chunks c JOIN source_refs s ON s.id=c.source_ref_id WHERE c.parse_version_id=$1 AND "+jobs.SemanticSourceSQL, version)
	})
	s.handle("GET /api/v1/knowledge/{id}/stages", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.list(w, r, "SELECT "+taskcontrol.ProjectionSQL+" FROM tasks t WHERE knowledge_id=$1 ORDER BY created_at DESC", id)
	})
	s.handle("GET /api/v1/knowledge/{id}/outline", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		version, ok := s.selectedParse(w, r, id)
		if !ok {
			return
		}
		s.one(w, r, "SELECT row_to_json(o) FROM outlines o WHERE o.parse_version_id=$1 ORDER BY o.created_at DESC LIMIT 1", version)
	})
	s.handle("GET /api/v1/knowledge/{id}/download", s.download)
	s.handle("GET /api/v1/knowledge/{id}/preview", s.preview)
	s.handle("GET /api/v1/knowledge/{id}/preview/manifest", s.previewManifest)
	s.handle("GET /api/v1/knowledge/{id}/media", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.one(w, r, "SELECT row_to_json(m) FROM media m JOIN knowledge k ON k.id=$1 WHERE m.file_version_id=coalesce(nullif($2,'')::uuid,k.current_file_version_id) AND EXISTS(SELECT 1 FROM file_versions f WHERE f.id=m.file_version_id AND f.knowledge_id=k.id)", id, r.URL.Query().Get("file_version_id"))
	})
	s.handle("GET /api/v1/knowledge/{id}/media/transcript", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		version, ok := s.selectedParse(w, r, id)
		if !ok {
			return
		}
		page, size := paging(r)
		s.list(w, r, "SELECT row_to_json(s) FROM source_refs s WHERE s.parse_version_id=$1 AND s.precision='time_segment' ORDER BY (s.locators->0->>'start_ms')::bigint LIMIT $2 OFFSET $3", version, size, (page-1)*size)
	})
	s.handle("GET /api/v1/knowledge/{id}/media/frames", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		version, ok := s.selectedParse(w, r, id)
		if !ok {
			return
		}
		page, size := paging(r)
		s.list(w, r, `SELECT json_build_object('id',a.id,'metadata',a.metadata-'path','url','/api/v1/preview-assets/'||a.id,'source_refs',coalesce((SELECT jsonb_agg(jsonb_build_object('source_ref_id',s.id,'quote',s.quote,'origin',s.origin,'locators',s.locators)) FROM source_refs s WHERE s.parse_version_id=$2 AND s.metadata->>'image_path'=a.path),'[]')) FROM assets a JOIN parse_versions p ON p.id=$2 WHERE a.knowledge_id=$1 AND a.file_version_id=p.file_version_id AND a.kind='video_frame' AND (a.metadata->>'parse_version_id'=$2::text OR NOT a.metadata ? 'parse_version_id') ORDER BY (a.metadata->>'time_ms')::bigint LIMIT $3 OFFSET $4`, id, version, size, (page-1)*size)
	})
	s.handle("GET /api/v1/preview-assets/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var path string
		if e := s.Services.DB.QueryRow(r.Context(), "SELECT path FROM assets WHERE id=$1", id).Scan(&path); e != nil {
			dbFailure(w, e)
			return
		}
		s.serveStored(w, r, path, false, filepath.Base(path))
	})
	s.handle("GET /api/v1/file-formats", func(w http.ResponseWriter, r *http.Request) {
		out := []any{}
		for _, f := range formats {
			out = append(out, map[string]any{"extension": f, "upload": true, "parse": true, "media": jobs.IsMedia(f), "outline": "source_verified", "preview": "auto"})
		}
		out = append(out, map[string]any{"extension": "zip", "upload": true, "parse": false, "extract": true, "preview": "download"})
		JSON(w, 200, out)
	})
}

func (s *Server) upload(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, max(s.Config.MaxUpload, s.Config.MediaMaxUpload, s.Config.ArchiveMaxUpload)+(2<<20))
	reader, e := r.MultipartReader()
	if e != nil {
		Failure(w, 400, "INVALID_ARGUMENT", "需要 multipart/form-data 文件上传")
		return
	}
	out := []any{}
	relativeOverride := r.URL.Query().Get("relative_path")
	for {
		part, e := reader.NextPart()
		if e == io.EOF {
			break
		}
		if e != nil {
			Failure(w, 413, "UPLOAD_TOO_LARGE", "上传超限或请求中断")
			return
		}
		if part.FileName() == "" {
			if part.FormName() == "relative_path" {
				data, _ := io.ReadAll(io.LimitReader(part, 4097))
				relativeOverride = string(data)
			}
			part.Close()
			continue
		}
		_, disposition, _ := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
		relative := strings.ReplaceAll(disposition["filename"], "\\", "/")
		name := path.Base(relative)
		if relativeOverride != "" {
			relative = relativeOverride
			relativeOverride = ""
		}
		key := r.Header.Get("Idempotency-Key")
		if key != "" && strings.HasSuffix(r.URL.Path, "/files") {
			key = key + ":" + strconv.Itoa(len(out))
		}
		if len(out) >= 1000 {
			part.Close()
			Failure(w, 413, "BATCH_TOO_LARGE", "单次最多上传 1000 个文件，已接收的文件已保留")
			return
		}
		result, e := (ingest.Store{Services: s.Services, Config: s.Config}).Save(r.Context(), id, name, part, key, ingest.Options{RelativePath: relative})
		part.Close()
		if e != nil {
			if !strings.HasSuffix(r.URL.Path, "/files") {
				Failure(w, 400, "UPLOAD_FAILED", e.Error())
				return
			}
			out = append(out, map[string]any{"name": name, "success": false, "error": e.Error()})
		} else {
			out = append(out, map[string]any{"name": name, "success": true, "data": result})
		}
		if !strings.HasSuffix(r.URL.Path, "/files") {
			status := http.StatusAccepted
			if result["state"] == "skipped" {
				status = http.StatusOK
			}
			JSON(w, status, result)
			return
		}
	}
	if len(out) == 0 {
		Failure(w, 400, "INVALID_ARGUMENT", "未提供文件")
		return
	}
	JSON(w, 202, out)
}
func (s *Server) storeFile(ctx context.Context, kb, name string, input io.Reader, key string) (map[string]any, error) {
	return (ingest.Store{Services: s.Services, Config: s.Config}).Save(ctx, kb, name, input, key, ingest.Options{})
}
func (s *Server) download(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var path, name string
	e := s.Services.DB.QueryRow(r.Context(), "SELECT f.path,k.name FROM knowledge k JOIN file_versions f ON f.knowledge_id=k.id WHERE k.id=$1 AND f.id=coalesce(nullif($2,'')::uuid,k.current_file_version_id)", id, r.URL.Query().Get("file_version_id")).Scan(&path, &name)
	if e != nil {
		dbFailure(w, e)
		return
	}
	s.serveStored(w, r, path, true, name)
}
func (s *Server) serveStored(w http.ResponseWriter, r *http.Request, path string, attachment bool, name string) {
	root, _ := filepath.Abs(s.Config.DataDir)
	absolute, e := filepath.Abs(path)
	if e != nil || !strings.HasPrefix(absolute, root+string(filepath.Separator)) {
		Failure(w, 404, "NOT_FOUND", "文件不可访问")
		return
	}
	if _, e = os.Stat(absolute); e != nil {
		Failure(w, 404, "SOURCE_MISSING", "源文件或预览产物丢失")
		return
	}
	if attachment {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	}
	http.ServeFile(w, r, absolute)
}
func (s *Server) previewPath(r *http.Request, id string) (string, string, error) {
	var path, ext string
	var config map[string]any
	var raw []byte
	e := s.Services.DB.QueryRow(r.Context(), "SELECT f.path,k.file_type,p.metadata,b.config||k.config FROM knowledge k JOIN knowledge_bases b ON b.id=k.knowledge_base_id JOIN file_versions f ON f.knowledge_id=k.id LEFT JOIN LATERAL(SELECT metadata FROM parse_versions WHERE file_version_id=f.id AND ($3='' OR id=nullif($3,'')::uuid) ORDER BY created_at DESC LIMIT 1)p ON true WHERE k.id=$1 AND f.id=coalesce(nullif($2,'')::uuid,k.current_file_version_id)", id, r.URL.Query().Get("file_version_id"), r.URL.Query().Get("parse_version_id")).Scan(&path, &ext, &raw, &config)
	if e != nil {
		return "", "", e
	}
	if config["preview_enabled"] == false {
		return "", "disabled", nil
	}
	var parsed jobs.Parsed
	if len(raw) > 0 {
		json.Unmarshal(raw, &parsed)
	}
	if parsed.PreviewPath != nil && *parsed.PreviewPath != "" {
		path = *parsed.PreviewPath
		ext = strings.TrimPrefix(filepath.Ext(path), ".")
	} else {
		switch ext {
		case "pdf", "png", "jpg", "jpeg", "webp", "mp3", "wav", "ogg":
		default:
			return "", "content", nil
		}
	}
	return path, ext, nil
}
func (s *Server) preview(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	path, _, e := s.previewPath(r, id)
	if e != nil {
		dbFailure(w, e)
		return
	}
	if path == "" {
		Failure(w, 409, "PREVIEW_NOT_READY", "当前提供解析内容预览，原版式预览尚不可用")
		return
	}
	s.serveStored(w, r, path, false, filepath.Base(path))
}
func (s *Server) previewManifest(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var fileType string
	var previewEnabled bool
	if e := s.Services.DB.QueryRow(r.Context(), "SELECT k.file_type,coalesce((b.config||k.config)->'preview_enabled','true')<>'false'::jsonb FROM knowledge k JOIN knowledge_bases b ON b.id=k.knowledge_base_id WHERE k.id=$1", id).Scan(&fileType, &previewEnabled); e != nil {
		dbFailure(w, e)
		return
	}
	if isSpreadsheet(fileType) {
		if !previewEnabled {
			JSON(w, 200, map[string]any{"state": "disabled", "type": "disabled"})
			return
		}
		data, e := s.workbook(r)
		if e != nil {
			Failure(w, 422, "SPREADSHEET_UNAVAILABLE", e.Error())
			return
		}
		query := r.URL.Query()
		query.Set("file_version_id", data.FileVersion)
		query.Set("parse_version_id", data.ParseVersion)
		JSON(w, 200, map[string]any{"state": "ready", "type": "spreadsheet", "sheets_url": "/api/v1/knowledge/" + id + "/sheets?" + query.Encode(), "file_version_id": data.FileVersion, "parse_version_id": data.ParseVersion, "mapping": map[string]string{"document_layout": "source_cells", "granularity": "cell_or_row"}})
		return
	}
	path, ext, e := s.previewPath(r, id)
	if e != nil {
		dbFailure(w, e)
		return
	}
	var fileID string
	if e = s.Services.DB.QueryRow(r.Context(), "SELECT f.id::text FROM file_versions f JOIN knowledge k ON k.id=f.knowledge_id WHERE k.id=$1 AND f.id=coalesce(nullif($2,'')::uuid,k.current_file_version_id)", id, r.URL.Query().Get("file_version_id")).Scan(&fileID); e != nil {
		dbFailure(w, e)
		return
	}
	query := r.URL.Query()
	query.Set("file_version_id", fileID)
	r.URL.RawQuery = query.Encode()
	state := "ready"
	if path != "" {
		if _, e = os.Stat(path); e != nil {
			state = "missing"
		}
	}
	if path == "" {
		state = "content_only"
	}
	if ext == "disabled" {
		state = "disabled"
	}
	JSON(w, 200, map[string]any{"state": state, "type": ext, "content_url": "/api/v1/knowledge/" + id + "/preview?" + r.URL.RawQuery, "viewer_url": "/documents/" + id, "file_version_id": r.URL.Query().Get("file_version_id"), "supports_range": true, "mapping": map[string]any{"document_layout": "original_or_converted", "text_offsets": "unicode_code_points_in_parse_version", "page_alignment": "source_pages_only", "media_time_unit": "ms"}})
}

func (s *Server) selectedParse(w http.ResponseWriter, r *http.Request, id string) (string, bool) {
	parse, file := r.URL.Query().Get("parse_version_id"), r.URL.Query().Get("file_version_id")
	if parse != "" && uuid.Validate(parse) != nil || file != "" && uuid.Validate(file) != nil {
		Failure(w, 400, "INVALID_ARGUMENT", "文件或解析版本无效")
		return "", false
	}
	var version string
	e := s.Services.DB.QueryRow(r.Context(), `SELECT p.id::text FROM parse_versions p JOIN knowledge k ON k.id=p.knowledge_id WHERE k.id=$1 AND ($2='' OR p.id=nullif($2,'')::uuid) AND ($3='' OR p.file_version_id=nullif($3,'')::uuid) AND ($2<>'' OR $3<>'' OR p.id=k.current_parse_version_id) ORDER BY p.created_at DESC LIMIT 1`, id, parse, file).Scan(&version)
	if e != nil {
		dbFailure(w, e)
		return "", false
	}
	return version, true
}
