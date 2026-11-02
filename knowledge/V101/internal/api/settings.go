package api

import (
	"encoding/hex"
	"encoding/json"
	"github.com/google/uuid"
	"math"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/defaults"
	"net/http"
)

func validateParser(v map[string]any) string {
	if msg := validateExcel(v); msg != "" {
		return msg
	}
	if message := validateProcessing(v); message != "" {
		return message
	}
	if pipeline, exists := v["image_pipeline"]; exists && pipeline != "smartocr" {
		return "当前构建支持 smartocr 图片流水线"
	}
	if mode, exists := v["preprocess_mode"]; exists && mode != "off" {
		return "当前构建未启用透视矫正引擎，preprocess_mode 仅支持 off"
	}
	for _, key := range []string{"chunk_size", "chunk_overlap"} {
		if value, exists := v[key]; exists {
			if _, ok := value.(float64); !ok {
				return key + " 必须为数值"
			}
		}
	}
	number := func(k string, fallback float64) float64 {
		if n, ok := v[k].(float64); ok {
			return n
		}
		return fallback
	}
	size := number("chunk_size", 512)
	overlap := number("chunk_overlap", 80)
	if size < 64 || size > 8192 || size != float64(int(size)) || overlap < 0 || overlap >= size || overlap != float64(int(overlap)) {
		return "分块长度须为 64–8192 的整数，重叠须为小于分块长度的非负整数"
	}
	for _, key := range []string{"graph_enabled", "wiki_enabled", "outline_enabled", "html_main_content", "excel_preserve_percentage", "preview_enabled", "media_enabled", "image_caption", "image_embedding", "transcription", "frame_ocr", "frame_caption"} {
		if val, ok := v[key]; ok {
			if _, ok = val.(bool); !ok {
				return key + " 必须为布尔值"
			}
		}
	}
	return ""
}
func (s *Server) settingsRoutes() {
	s.handle("GET /api/v1/settings/{key}", func(w http.ResponseWriter, r *http.Request) {
		key := r.PathValue("key")
		if _, ok := defaults.Settings[key]; !ok {
			Failure(w, 404, "NOT_FOUND", "设置项不存在")
			return
		}
		if key == "parser-defaults" {
			s.one(w, r, `SELECT (m.value-'enabled') || jsonb_build_object('media_enabled',m.value->'enabled') || p.value FROM settings p CROSS JOIN settings m WHERE p.key='parser-defaults' AND m.key='media-defaults'`)
			return
		}
		if key == "qa-defaults" {
			s.one(w, r, "SELECT value || jsonb_build_object('default_system_prompt',$1::text) FROM settings WHERE key='qa-defaults'", defaults.QASystemPrompt)
			return
		}
		s.one(w, r, "SELECT value FROM settings WHERE key=$1", key)
	})
	s.handle("PUT /api/v1/settings/{key}", func(w http.ResponseWriter, r *http.Request) {
		key := r.PathValue("key")
		if _, ok := defaults.Settings[key]; !ok {
			Failure(w, 404, "NOT_FOUND", "设置项不存在")
			return
		}
		var v map[string]any
		if !decode(w, r, &v) {
			return
		}
		if v == nil {
			Failure(w, 400, "INVALID_ARGUMENT", "设置须为对象")
			return
		}
		var old map[string]any
		if e := s.Services.DB.QueryRow(r.Context(), "SELECT value FROM settings WHERE key=$1", key).Scan(&old); e != nil {
			dbFailure(w, e)
			return
		}
		v = merge(old, v)
		if key == "qa-defaults" {
			for _, name := range []string{"model_id", "vision_model_id"} {
				if id, ok := v[name].(string); ok && id != "" {
					model, err := ai.Load(r.Context(), s.Services, id)
					if err != nil || (name == "model_id" && !ai.SupportsPurpose(model.Purpose, "text")) || (name == "vision_model_id" && !ai.AllowsImageInput(model)) {
						Failure(w, 400, "INVALID_MODEL", "请选择兼容的回答或图片理解模型")
						return
					}
				}
			}
		}
		if key == "extraction-defaults" {
			if id, _ := v["model_id"].(string); id != "" {
				model, err := ai.Load(r.Context(), s.Services, id)
				if err != nil || !ai.SupportsPurpose(model.Purpose, "text") {
					Failure(w, 400, "INVALID_MODEL", "请选择已保存的文本生成模型")
					return
				}
			}
		}
		if msg := validateSetting(key, v); msg != "" {
			Failure(w, 400, "INVALID_ARGUMENT", msg)
			return
		}
		if key == "parser-defaults" {
			if e := validateParser(v); e != "" {
				Failure(w, 400, "INVALID_ARGUMENT", e)
				return
			}
		}
		if key == "storage" {
			for k := range v {
				if k != "type" && k != "temporary_retention_hours" {
					Failure(w, 400, "INVALID_ARGUMENT", "存储连接和基础路径只能通过环境变量设置")
					return
				}
			}
			if v["type"] != "local" {
				Failure(w, 400, "INVALID_ARGUMENT", "文件存储固定为 local")
				return
			}
		}
		if key == "model-bindings" {
			for purpose, model := range v {
				if !modelPurposes[purpose] {
					Failure(w, 400, "INVALID_ARGUMENT", "未知模型用途")
					return
				}
				if model == nil || model == "" {
					continue
				}
				id, ok := model.(string)
				if !ok {
					Failure(w, 400, "INVALID_ARGUMENT", "模型绑定应为模型 ID")
					return
				}
				var actualPurpose string
				if e := s.Services.DB.QueryRow(r.Context(), "SELECT coalesce((SELECT purpose FROM models WHERE id::text=$1),'')", id).Scan(&actualPurpose); e != nil {
					dbFailure(w, e)
					return
				}
				if !ai.SupportsPurpose(actualPurpose, purpose) {
					Failure(w, 400, "INVALID_ARGUMENT", "绑定模型不存在或用途不匹配")
					return
				}
			}
		}
		tx, e := s.Services.DB.Begin(r.Context())
		if e != nil {
			dbFailure(w, e)
			return
		}
		defer tx.Rollback(r.Context())
		stored := merge(nil, v)
		if key == "parser-defaults" {
			media := map[string]any{}
			for _, k := range []string{"media_enabled", "transcription", "frame_interval_seconds", "frame_ocr", "frame_caption", "max_frames"} {
				if val, ok := stored[k]; ok {
					delete(stored, k)
					name := k
					if k == "media_enabled" {
						name = "enabled"
					}
					media[name] = val
				}
			}
			b, _ := json.Marshal(media)
			if _, e = tx.Exec(r.Context(), "UPDATE settings SET value=value || $1::jsonb,updated_at=now() WHERE key='media-defaults'", b); e != nil {
				dbFailure(w, e)
				return
			}
		}
		b, _ := json.Marshal(stored)
		if _, e = tx.Exec(r.Context(), "UPDATE settings SET value=$2,updated_at=now() WHERE key=$1", key, b); e != nil {
			dbFailure(w, e)
			return
		}
		if key == "model-bindings" || key == "parser-engines" || key == "extraction-defaults" {
			if _, e = tx.Exec(r.Context(), "UPDATE tasks SET state='queued',next_run_at=now(),updated_at=now() WHERE state='waiting_configuration' AND NOT cancel_requested AND ($1<>'extraction-defaults' OR type='clause_extraction')", key); e != nil {
				dbFailure(w, e)
				return
			}
		}
		if e = tx.Commit(r.Context()); e != nil {
			dbFailure(w, e)
			return
		}
		JSON(w, 200, v)
	})
	s.handle("GET /api/v1/graph-templates", func(w http.ResponseWriter, r *http.Request) { JSON(w, 200, []any{defaults.Graph}) })
}

func validateSetting(key string, v map[string]any) string {
	integer := func(name string, min, max float64) bool {
		n, ok := v[name].(float64)
		return ok && n >= min && n <= max && math.Trunc(n) == n
	}
	switch key {
	case "qa-defaults":
		prompt, ok := v["system_prompt"].(string)
		if !ok || len([]rune(prompt)) == 0 || len([]rune(prompt)) > 16000 || len(v) != 3 {
			return "问答设置仅接受 system_prompt、model_id、vision_model_id，提示词须为 1–16000 字"
		}
		for _, field := range []string{"model_id", "vision_model_id"} {
			id, ok := v[field].(string)
			if !ok || id != "" && uuid.Validate(id) != nil {
				return "模型 ID 无效"
			}
		}
	case "extraction-defaults":
		id, ok := v["model_id"].(string)
		if !ok || (id != "" && uuid.Validate(id) != nil) || len(v) != 1 {
			return "提取设置仅接受 model_id，留空沿用系统文本生成模型"
		}
	case "appearance":
		color, ok := v["brand_color"].(string)
		if !ok || len(color) != 7 || color[0] != '#' {
			return "主题色须为 #RRGGBB 格式"
		}
		if _, err := hex.DecodeString(color[1:]); err != nil {
			return "主题色须为 #RRGGBB 格式"
		}
		for field := range v {
			if field != "brand_color" {
				return "未知的外观设置项"
			}
		}
	case "parser-engines":
		return validateEngineSettings(v)
	case "media-defaults":
		if !integer("frame_interval_seconds", 1, 3600) || !integer("max_frames", 1, 240) {
			return "帧间隔须为 1–3600 秒，最大帧数为 1–240"
		}
		for _, name := range []string{"enabled", "transcription", "frame_ocr", "frame_caption"} {
			if _, ok := v[name].(bool); !ok {
				return name + " 必须为布尔值"
			}
		}
	case "retrieval-defaults":
		mode, _ := v["mode"].(string)
		if !searchModes[mode] || !integer("top_k", 1, 100) || !integer("candidate_k", 1, 500) || v["candidate_k"].(float64) < v["top_k"].(float64) || !integer("rrf_k", 1, 200) {
			return "检索模式、候选条数或 RRF 参数无效"
		}
		a, aok := v["vector_weight"].(float64)
		b, bok := v["keyword_weight"].(float64)
		if !aok || !bok || a < 0 || b < 0 || math.Abs(a+b-1) > 0.000001 {
			return "向量与关键词权重应为非负数，且相加等于 1"
		}
		if v["rerank"] != "auto" && v["rerank"] != "enabled" && v["rerank"] != "disabled" {
			return "重排模式无效"
		}
	case "storage":
		if !integer("temporary_retention_hours", 1, 168) {
			return "临时文件保留时间为 1–168 小时"
		}
	case "preview-defaults":
		if v["mode"] != "auto" {
			return "当前预览策略支持 auto"
		}
		if _, ok := v["enabled"].(bool); !ok {
			return "enabled 必须为布尔值"
		}
	case "wiki-defaults":
		if v["language"] != "zh-CN" {
			return "Wiki 当前默认语言为 zh-CN"
		}
	}
	return ""
}
