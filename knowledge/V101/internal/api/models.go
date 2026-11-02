package api

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nebulaekno/internal/ai"
	"net/http"
	"strings"
)

var modelPurposes = map[string]bool{"text": true, "embedding": true, "vision": true, "asr": true, "rerank": true, "multimodal_embedding": true, "outline": true}

const publicModelQuery = `SELECT m.id,m.name,m.purpose,m.protocol,coalesce(c.base_url,m.base_url) AS base_url,m.model_name,m.dimension,m.config,
 (CASE WHEN m.connection_id IS NOT NULL THEN c.secret ELSE m.secret END IS NOT NULL) AS has_api_key,
 m.connection_id,c.name AS connection_name,m.created_at,m.updated_at FROM models m LEFT JOIN model_connections c ON c.id=m.connection_id`

func (s *Server) modelRoutes() {
	s.handle("POST /api/v1/models/discover", s.discoverModels)
	s.handle("GET /api/v1/models", func(w http.ResponseWriter, r *http.Request) {
		s.list(w, r, "SELECT row_to_json(m) FROM ("+publicModelQuery+" ORDER BY m.created_at DESC) m")
	})
	s.handle("GET /api/v1/models/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.one(w, r, "SELECT row_to_json(m) FROM ("+publicModelQuery+" WHERE m.id=$1) m", id)
	})
	s.handle("POST /api/v1/models", s.saveModel)
	s.handle("PUT /api/v1/models/{id}", s.saveModel)
	s.handle("DELETE /api/v1/models/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var used bool
		e := s.Services.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM settings WHERE value::text LIKE '%'||$1||'%') OR EXISTS(SELECT 1 FROM knowledge_bases WHERE config::text LIKE '%'||$1||'%') OR EXISTS(SELECT 1 FROM embedding_spaces WHERE model_id::text=$1)", id).Scan(&used)
		if e != nil {
			dbFailure(w, e)
			return
		}
		if used {
			Failure(w, 409, "MODEL_IN_USE", "模型仍被默认绑定、知识库或向量索引引用，请先解除引用")
			return
		}
		tag, e := s.Services.DB.Exec(r.Context(), "DELETE FROM models WHERE id=$1", id)
		if e != nil {
			dbFailure(w, e)
			return
		}
		if tag.RowsAffected() == 0 {
			Failure(w, 404, "NOT_FOUND", "模型不存在")
			return
		}
		JSON(w, 200, map[string]bool{"deleted": true})
	})
	s.handle("POST /api/v1/models/{id}/test-file", s.testModelSample)
	s.handle("POST /api/v1/models/test", s.testModel)
	s.handle("POST /api/v1/models/{id}/test", s.testModel)
}
func (s *Server) saveModel(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ai.Model
		ConnectionID *string `json:"connection_id"`
	}
	if !decode(w, r, &input) {
		return
	}
	m := input.Model
	if input.ConnectionID != nil {
		m.ConnectionID = *input.ConnectionID
	}
	if m.Protocol == "" {
		m.Protocol = "openai"
	}
	if !modelPurposes[m.Purpose] {
		Failure(w, 400, "INVALID_ARGUMENT", "模型用途无效")
		return
	}
	if m.APIKey != "" && m.ClearAPIKey {
		Failure(w, 400, "INVALID_ARGUMENT", "新 Key 与清除 Key 不能同时提交")
		return
	}
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	id := r.PathValue("id")
	var oldPurpose, oldBase, oldConnection string
	var previousSecret []byte
	changed := false
	if id != "" {
		if uuid.Validate(id) != nil {
			Failure(w, 400, "INVALID_ARGUMENT", "模型 ID 无效")
			return
		}
		e = tx.QueryRow(r.Context(), `SELECT m.purpose,coalesce(c.base_url,m.base_url),coalesce(m.connection_id::text,''),
    CASE WHEN m.connection_id IS NOT NULL THEN c.secret ELSE m.secret END
    FROM models m LEFT JOIN model_connections c ON c.id=m.connection_id WHERE m.id=$1 FOR UPDATE OF m`, id).Scan(&oldPurpose, &oldBase, &oldConnection, &previousSecret)
		if e != nil {
			dbFailure(w, e)
			return
		}
		if input.ConnectionID == nil {
			m.ConnectionID = oldConnection
		}
		changed = oldPurpose != m.Purpose
	}
	if m.ConnectionID != "" {
		if uuid.Validate(m.ConnectionID) != nil {
			Failure(w, 400, "INVALID_ARGUMENT", "服务连接 ID 无效")
			return
		}
		if e = ai.ApplyConnection(r.Context(), s.Services, tx, &m); e != nil {
			a := e.(*ai.Error)
			Failure(w, 400, a.Code, a.Message)
			return
		}
	} else {
		normalized, err := ai.DiscoveryBase(m.BaseURL)
		if err != nil {
			Failure(w, 400, "INVALID_ARGUMENT", err.(*ai.Error).Message)
			return
		}
		if oldBase != "" && strings.TrimRight(m.BaseURL, "/") == strings.TrimRight(oldBase, "/") {
			normalized = oldBase
		}
		m.BaseURL = normalized
		if oldBase != "" && oldBase != m.BaseURL && len(previousSecret) > 0 && m.APIKey == "" && !m.ClearAPIKey {
			Failure(w, 400, "CREDENTIAL_REQUIRED", "地址已变更，请重新填写 API Key 或清除旧 Key")
			return
		}
	}
	if msg := ai.Validate(m); msg != "" {
		Failure(w, 400, "INVALID_ARGUMENT", msg)
		return
	}
	if m.Config == nil {
		m.Config = map[string]any{}
	}
	if m.Purpose == "text" {
		m.Config["allow_image_input"] = ai.AllowsImageInput(m)
	} else {
		delete(m.Config, "allow_image_input")
	}
	if m.Purpose != "embedding" && m.Purpose != "multimodal_embedding" {
		m.Dimension = nil
	}
	b, _ := json.Marshal(m.Config)
	var encrypted []byte
	if m.ConnectionID == "" && !m.ClearAPIKey {
		encrypted = previousSecret
		if m.APIKey != "" {
			encrypted, e = s.Services.Identity.Encrypt(m.APIKey)
			if e != nil {
				Failure(w, 500, "ENCRYPTION_FAILED", "凭证加密失败")
				return
			}
		}
	}
	if id == "" {
		id = uuid.NewString()
		_, e = tx.Exec(r.Context(), `INSERT INTO models(id,name,purpose,protocol,base_url,model_name,secret,dimension,config,connection_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,nullif($10,'')::uuid)`, id, m.Name, m.Purpose, m.Protocol, m.BaseURL, m.ModelName, encrypted, m.Dimension, b, m.ConnectionID)
	} else {
		_, e = tx.Exec(r.Context(), `UPDATE models SET name=$2,purpose=$3,protocol=$4,base_url=$5,model_name=$6,secret=$7,
   dimension=$8,config=$9,connection_id=nullif($10,'')::uuid,updated_at=now() WHERE id=$1`, id, m.Name, m.Purpose, m.Protocol, m.BaseURL, m.ModelName, encrypted, m.Dimension, b, m.ConnectionID)
	}
	if e != nil {
		dbFailure(w, e)
		return
	}
	if changed {
		if e = clearIncompatibleBindings(r.Context(), tx, id, m.Purpose); e != nil {
			dbFailure(w, e)
			return
		}
	}
	if _, e = tx.Exec(r.Context(), "UPDATE tasks SET state='queued',next_run_at=now(),updated_at=now() WHERE state='waiting_configuration' AND NOT cancel_requested"); e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	s.one(w, r, "SELECT row_to_json(m)::jsonb || jsonb_build_object('purpose_changed',$2::boolean) FROM ("+publicModelQuery+" WHERE m.id=$1) m", id, changed)
}

func clearIncompatibleBindings(ctx context.Context, tx pgx.Tx, id, purpose string) error {
	// Use the same compatibility rules as binding validation and runtime resolution.
	compatible := []string{}
	for target := range modelPurposes {
		if ai.SupportsPurpose(purpose, target) {
			compatible = append(compatible, target)
		}
	}
	filter := `NOT (value=to_jsonb($1::text) AND NOT(key=ANY($2::text[])))`
	if _, e := tx.Exec(ctx, `UPDATE settings SET value=(SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM jsonb_each(settings.value) WHERE `+filter+`),updated_at=now() WHERE key='model-bindings'`, id, compatible); e != nil {
		return e
	}
	for _, table := range []string{"knowledge_bases", "knowledge", "tasks"} {
		extra := ""
		if table == "tasks" {
			extra = " AND state IN ('queued','running','waiting_configuration','retrying')"
		}
		_, e := tx.Exec(ctx, `UPDATE `+table+` SET config=jsonb_set(config,'{model_bindings}',(SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM jsonb_each(config->'model_bindings') WHERE `+filter+`)),updated_at=now() WHERE jsonb_typeof(config->'model_bindings')='object'`+extra, id, compatible)
		if e != nil {
			return e
		}
	}
	return nil
}

func (s *Server) testModel(w http.ResponseWriter, r *http.Request) {
	var m ai.Model
	var e error
	if id := r.PathValue("id"); id != "" {
		m, e = ai.Load(r.Context(), s.Services, id)
		if e != nil {
			Failure(w, 404, "NOT_FOUND", "模型不存在或凭证不可用")
			return
		}
	} else {
		if !decode(w, r, &m) {
			return
		}
		if m.Protocol == "" {
			m.Protocol = "openai"
		}
		if err := ai.ApplyConnection(r.Context(), s.Services, s.Services.DB, &m); err != nil {
			a := err.(*ai.Error)
			Failure(w, 400, a.Code, a.Message)
			return
		}
		if msg := ai.Validate(m); msg != "" {
			Failure(w, 400, "INVALID_ARGUMENT", msg)
			return
		}
	}
	var result any
	switch m.Purpose {
	case "embedding", "multimodal_embedding":
		var vectors [][]float64
		vectors, e = ai.Embeddings(r.Context(), m, []string{"NebulaeKno 模型连接测试"})
		if e == nil {
			result = map[string]any{"dimension": len(vectors[0]), "tested": "text_embedding"}
		}
	case "text", "outline":
		var text string
		text, e = ai.Chat(r.Context(), m, "请只回复：连接成功。", nil)
		result = map[string]any{"response": text, "tested": "text_generation"}
	case "vision":
		Failure(w, 422, "SAMPLE_REQUIRED", "视觉能力测试需要图片样本，请调用模型 test-file 接口")
		return
	case "asr":
		Failure(w, 422, "SAMPLE_REQUIRED", "ASR 能力测试需要音频样本，请调用模型 test-file 接口")
		return
	case "rerank":
		var ranks []ai.Rank
		ranks, e = ai.Rerank(r.Context(), m, "数据库初始化", []string{"首次启动创建数据库和表。", "晴天可以去公园散步。"})
		result = map[string]any{"tested": "rerank", "results": ranks}
	default:
		Failure(w, 400, "INVALID_ARGUMENT", "未知模型用途")
		return
	}
	if e != nil {
		if a, ok := e.(*ai.Error); ok {
			Failure(w, 502, a.Code, a.Message)
		} else {
			Failure(w, 502, "MODEL_REQUEST_FAILED", "模型测试失败")
		}
		return
	}
	JSON(w, 200, result)
}
