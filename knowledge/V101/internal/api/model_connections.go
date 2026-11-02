package api

import (
	"github.com/google/uuid"
	"nebulaekno/internal/ai"
	"net/http"
	"strings"
)

const publicConnectionQuery = `SELECT c.id,c.name,c.base_url,(c.secret IS NOT NULL) AS has_api_key,c.created_at,c.updated_at,
 (SELECT count(*) FROM models m WHERE m.connection_id=c.id) AS model_count FROM model_connections c`

func (s *Server) connectionRoutes() {
	s.handle("GET /api/v1/model-connections", func(w http.ResponseWriter, r *http.Request) {
		s.list(w, r, "SELECT row_to_json(c) FROM ("+publicConnectionQuery+" ORDER BY c.created_at DESC) c")
	})
	s.handle("GET /api/v1/model-connections/{id}", func(w http.ResponseWriter, r *http.Request) {
		if id, ok := identifier(w, r, "id"); ok {
			s.one(w, r, "SELECT row_to_json(c) FROM ("+publicConnectionQuery+" WHERE c.id=$1) c", id)
		}
	})
	s.handle("POST /api/v1/model-connections", s.saveConnection)
	s.handle("PUT /api/v1/model-connections/{id}", s.saveConnection)
	s.handle("DELETE /api/v1/model-connections/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var count int
		if err := s.Services.DB.QueryRow(r.Context(), "SELECT count(*) FROM models WHERE connection_id=$1", id).Scan(&count); err != nil {
			dbFailure(w, err)
			return
		}
		if count > 0 {
			Failure(w, 409, "CONNECTION_IN_USE", "连接仍被模型引用，请先为这些模型更换连接")
			return
		}
		tag, err := s.Services.DB.Exec(r.Context(), "DELETE FROM model_connections WHERE id=$1", id)
		if err != nil {
			dbFailure(w, err)
			return
		}
		if tag.RowsAffected() == 0 {
			Failure(w, 404, "NOT_FOUND", "服务连接不存在")
			return
		}
		JSON(w, 200, map[string]bool{"deleted": true})
	})
}

func (s *Server) saveConnection(w http.ResponseWriter, r *http.Request) {
	var c ai.Connection
	if !decode(w, r, &c) {
		return
	}
	if !validName(c.Name) {
		Failure(w, 400, "INVALID_ARGUMENT", "连接名称必填，最多 256 个字符")
		return
	}
	normalized, err := ai.DiscoveryBase(c.BaseURL)
	if err != nil {
		Failure(w, 400, "INVALID_ARGUMENT", err.(*ai.Error).Message)
		return
	}
	if c.APIKey != "" && c.ClearAPIKey {
		Failure(w, 400, "INVALID_ARGUMENT", "新 Key 与清除 Key 不能同时提交")
		return
	}
	var encrypted []byte
	if c.APIKey != "" {
		encrypted, err = s.Services.Identity.Encrypt(c.APIKey)
		if err != nil {
			Failure(w, 500, "ENCRYPTION_FAILED", "凭证加密失败")
			return
		}
	}
	tx, err := s.Services.DB.Begin(r.Context())
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	id := r.PathValue("id")
	if id == "" {
		id = uuid.NewString()
		_, err = tx.Exec(r.Context(), "INSERT INTO model_connections(id,name,base_url,secret) VALUES($1,$2,$3,$4)", id, strings.TrimSpace(c.Name), normalized, encrypted)
	} else {
		if uuid.Validate(id) != nil {
			Failure(w, 400, "INVALID_ARGUMENT", "连接 ID 无效")
			return
		}
		var oldURL string
		var hasKey bool
		if err = tx.QueryRow(r.Context(), "SELECT base_url,secret IS NOT NULL FROM model_connections WHERE id=$1 FOR UPDATE", id).Scan(&oldURL, &hasKey); err != nil {
			dbFailure(w, err)
			return
		}
		// Name-only updates preserve legacy exact prefixes. Moving credentials requires
		// explicitly supplying a new key or clearing it, even for the same host.
		if strings.TrimRight(c.BaseURL, "/") == strings.TrimRight(oldURL, "/") {
			normalized = oldURL
		}
		if normalized != oldURL && hasKey && c.APIKey == "" && !c.ClearAPIKey {
			Failure(w, 400, "CREDENTIAL_REQUIRED", "地址已变更，请重新填写 API Key 或明确清除旧 Key")
			return
		}
		_, err = tx.Exec(r.Context(), "UPDATE model_connections SET name=$2,base_url=$3,secret=CASE WHEN $5 THEN NULL ELSE coalesce($4,secret) END,updated_at=now() WHERE id=$1", id, strings.TrimSpace(c.Name), normalized, encrypted, c.ClearAPIKey)
	}
	if err != nil {
		dbFailure(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), "UPDATE tasks SET state='queued',next_run_at=now(),updated_at=now() WHERE state='waiting_configuration' AND NOT cancel_requested"); err != nil {
		dbFailure(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		dbFailure(w, err)
		return
	}
	s.one(w, r, "SELECT row_to_json(c) FROM ("+publicConnectionQuery+" WHERE c.id=$1) c", id)
}
