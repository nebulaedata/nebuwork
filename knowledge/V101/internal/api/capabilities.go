package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/defaults"
	"nebulaekno/internal/jobs"
	"nebulaekno/internal/textutil"
	"net/http"
	"strings"
	"time"
)

func (s *Server) capabilityRoutes() {
	s.handle("GET /api/v1/capabilities", func(w http.ResponseWriter, r *http.Request) {
		JSON(w, 200, map[string]any{"product": "NebulaeKno", "parser": map[string]any{"supported": true, "ready": s.State.Get().Ready, "engines": []string{"excel", "anydoc", "simple", "native", "tesseract", "libreoffice", "ffmpeg", "paddleocr_vl"}}, "search_modes": searchModes, "source_location": []string{"page", "paragraph", "range", "region", "frame", "time_segment"}, "image_preprocess": map[string]any{"supported": []string{"exif_orientation", "resize"}, "perspective_correction": false, "mapping_precision": "image"}, "media": map[string]any{"supported": true, "timestamp_unit": "ms", "asr_requires_segment_timestamps": true, "word_alignment": false, "speaker_diarization": false}, "authentication": "none"})
	})
	s.handle("GET /api/v1/knowledge-bases/{id}/capabilities", s.kbCapabilities)
	s.handle("POST /api/v1/processing-config/suggest", s.suggestProcessing)
	s.handle("GET /api/v1/parser-engines", s.parserEngines)
	s.handle("POST /api/v1/parser-engines/check", s.parserEngines)
	s.handle("GET /api/v1/image-pipelines", func(w http.ResponseWriter, r *http.Request) {
		JSON(w, 200, []any{map[string]any{"id": "smartocr", "name": "本地 OCR 与可选视觉理解", "ocr": "按 parser_engines.image 选择", "ocr_engines": []string{"tesseract", "paddleocr_vl"}, "caption_purpose": "vision", "image_vector_purpose": "multimodal_embedding", "preprocess_modes": []string{"off"}, "supported": true}})
	})
	s.handle("POST /api/v1/image-pipelines/validate", func(w http.ResponseWriter, r *http.Request) {
		var cfg map[string]any
		if !decode(w, r, &cfg) {
			return
		}
		message := validateParser(cfg)
		JSON(w, 200, map[string]any{"valid": message == "", "error": message})
	})
	s.handle("POST /api/v1/processing-config/resolve", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			KB       string         `json:"knowledge_base_id"`
			Config   map[string]any `json:"overrides"`
			FileType string         `json:"file_type"`
		}
		if !decode(w, r, &in) {
			return
		}
		var cfg map[string]any
		if e := s.Services.DB.QueryRow(r.Context(), "SELECT config FROM knowledge_bases WHERE id::text=$1", in.KB).Scan(&cfg); e != nil {
			dbFailure(w, e)
			return
		}
		cfg = merge(cfg, in.Config)
		if msg := validateParser(cfg); msg != "" {
			Failure(w, 400, "INVALID_ARGUMENT", msg)
			return
		}
		selections, _ := cfg["parser_engines"].(map[string]any)
		category, engine := defaults.ParserForExtension(in.FileType, selections)
		JSON(w, 200, map[string]any{"effective_config": cfg, "file_type": in.FileType, "supported": supported(in.FileType), "media": jobs.IsMedia(in.FileType), "parser_key": category, "parser_engine": engine})
	})
	s.handle("POST /api/v1/chunker/preview", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Text    string `json:"text"`
			Size    int    `json:"chunk_size"`
			Overlap *int   `json:"chunk_overlap"`
		}
		if !decode(w, r, &in) {
			return
		}
		if in.Size == 0 {
			in.Size = 512
		}
		overlap := 80
		if in.Overlap != nil {
			overlap = *in.Overlap
		}
		if msg := validateParser(map[string]any{"chunk_size": float64(in.Size), "chunk_overlap": float64(overlap)}); msg != "" {
			Failure(w, 400, "INVALID_ARGUMENT", msg)
			return
		}
		JSON(w, 200, textutil.Split(in.Text, in.Size, overlap))
	})
	s.handle("GET /api/v1/tasks/{id}/logs", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.list(w, r, "SELECT row_to_json(e) FROM task_events e WHERE task_id=$1 ORDER BY id DESC LIMIT 100", id)
	})
	s.handle("GET /api/v1/settings/workers", func(w http.ResponseWriter, r *http.Request) {
		JSON(w, 200, map[string]any{"documents": s.Config.DocumentWorkers, "images": s.Config.ImageWorkers, "media": s.Config.MediaWorkers, "model_max_concurrency": s.Config.ModelConcurrency, "source": "environment", "update_requires_restart": true})
	})
	s.handle("PUT /api/v1/settings/workers", func(w http.ResponseWriter, r *http.Request) {
		Failure(w, 409, "RESTART_REQUIRED", "当前工作进程预算由环境变量配置，修改后重启生效")
	})
}
func (s *Server) parserEngines(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", "http://127.0.0.1:8091/health", nil)
	response, e := http.DefaultClient.Do(req)
	if e != nil {
		Failure(w, 503, "READER_UNAVAILABLE", "解析服务不可用")
		return
	}
	defer response.Body.Close()
	var data map[string]any
	if e = json.NewDecoder(response.Body).Decode(&data); e != nil {
		Failure(w, 503, "READER_UNAVAILABLE", "解析服务状态无效")
		return
	}
	var settings map[string]any
	if e = s.Services.DB.QueryRow(ctx, "SELECT value FROM settings WHERE key='parser-engines'").Scan(&settings); e != nil {
		dbFailure(w, e)
		return
	}
	if r.Method == "POST" {
		var input map[string]any
		if !decode(w, r, &input) {
			return
		}
		settings = merge(settings, input)
		if message := validateEngineSettings(settings); message != "" {
			Failure(w, 400, "INVALID_ARGUMENT", message)
			return
		}
	}
	paddle, _ := settings["paddleocr_vl"].(map[string]any)
	endpoint, _ := paddle["endpoint"].(string)
	data["defaults"] = defaults.ParserEngines
	data["choices"] = defaults.ParserChoices
	data["formats"] = defaults.ParserFormats
	data["paddleocr_vl"] = map[string]any{"configured": endpoint != "", "requires": "完整 Pipeline 服务 /layout-parsing"}
	if r.Method == "POST" {
		if endpoint == "" {
			Failure(w, 422, "PARSER_NOT_CONFIGURED", "请先填写 PaddleOCR-VL 服务地址")
			return
		}
		request, _ := http.NewRequestWithContext(ctx, "GET", strings.TrimSuffix(strings.TrimRight(endpoint, "/"), "/layout-parsing")+"/health", nil)
		client := http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		resp, err := client.Do(request)
		if err != nil {
			Failure(w, 502, "PARSER_UNAVAILABLE", "PaddleOCR-VL 健康检查连接失败或超时")
			return
		}
		resp.Body.Close()
		if resp.StatusCode != 200 {
			Failure(w, 502, "PARSER_UNAVAILABLE", fmt.Sprintf("PaddleOCR-VL 健康检查返回 HTTP %d", resp.StatusCode))
			return
		}
		data["connection_checked"] = true
		data["message"] = "服务健康检查通过；实际解析效果需上传文件验证"
	}
	JSON(w, 200, data)
}
func (s *Server) kbCapabilities(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var cfg map[string]any
	if e := s.Services.DB.QueryRow(r.Context(), "SELECT config FROM knowledge_bases WHERE id=$1", id).Scan(&cfg); e != nil {
		dbFailure(w, e)
		return
	}
	var chunks, images, wiki, graph int
	e := s.Services.DB.QueryRow(r.Context(), `SELECT (SELECT count(*) FROM chunks c JOIN knowledge k ON k.current_parse_version_id=c.parse_version_id WHERE k.knowledge_base_id=$1),(SELECT count(*) FROM source_refs s JOIN knowledge k ON k.current_parse_version_id=s.parse_version_id WHERE k.knowledge_base_id=$1 AND s.locators->0->>'type' IN ('image','frame')),(SELECT count(*) FROM wiki_pages WHERE knowledge_base_id=$1 AND state='ready' AND jsonb_array_length(source_ids)>0),(SELECT count(*) FROM graph_records g JOIN source_refs sr ON sr.id=g.source_ref_id JOIN knowledge k ON k.current_parse_version_id=sr.parse_version_id WHERE k.knowledge_base_id=$1 AND g.synced_at IS NOT NULL)`, id).Scan(&chunks, &images, &wiki, &graph)
	if e != nil {
		dbFailure(w, e)
		return
	}
	result := map[string]any{}
	for mode, count := range map[string]int{"keyword": chunks, "image_text": images, "wiki": wiki, "graph": graph} {
		reason := ""
		if count == 0 {
			reason = "INDEX_NOT_READY"
		}
		result[mode] = map[string]any{"supported": true, "configured": true, "ready": count > 0, "indexed_count": count, "reason": reason}
	}
	for _, pair := range [][3]string{{"vector", "embedding", "text"}, {"image_vector", "multimodal_embedding", "image"}} {
		m, e := ai.Bound(r.Context(), s.Services, pair[1], cfg)
		entry := map[string]any{"supported": true, "configured": e == nil, "ready": false, "reason": "MODEL_NOT_CONFIGURED"}
		if e == nil {
			var count int
			rows, err := s.Services.DB.Query(r.Context(), `SELECT es.dimension,es.config_hash,count(*) FROM embeddings e JOIN embedding_spaces es ON es.id=e.space_id JOIN source_refs s ON s.id=e.source_ref_id JOIN knowledge k ON k.current_parse_version_id=s.parse_version_id WHERE k.knowledge_base_id=$1 AND es.model_id=$2 AND es.kind=$3 GROUP BY es.dimension,es.config_hash`, id, m.ID, pair[2])
			if err != nil {
				dbFailure(w, err)
				return
			}
			for rows.Next() {
				var dimension, indexed int
				var signature string
				if err = rows.Scan(&dimension, &signature, &indexed); err != nil {
					rows.Close()
					dbFailure(w, err)
					return
				}
				expected := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%d", m.BaseURL, m.ModelName, dimension)))
				if signature == hex.EncodeToString(expected[:]) && (m.Dimension == nil || *m.Dimension == dimension) {
					count += indexed
				}
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				dbFailure(w, err)
				return
			}

			entry["model_id"] = m.ID
			entry["indexed_count"] = count
			entry["ready"] = count > 0
			entry["reason"] = ""
			if count == 0 {
				entry["reason"] = "INDEX_NOT_READY"
			}
		}
		result[pair[0]] = entry
	}
	vector := result["vector"].(map[string]any)
	result["hybrid"] = map[string]any{"supported": true, "configured": vector["configured"], "ready": vector["ready"] == true && chunks > 0}
	result["multi"] = map[string]any{"supported": true, "configured": true, "ready": chunks+wiki+graph > 0, "allow_partial": true}
	JSON(w, 200, result)
}
