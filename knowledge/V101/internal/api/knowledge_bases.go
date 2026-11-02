package api

import (
	"encoding/json"
	"github.com/google/uuid"
	"nebulaekno/internal/jobs"
	"net/http"
	"strings"
)

type kbInput struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Config      map[string]any `json:"config"`
}

func (s *Server) kbRoutes() {
	s.handle("GET /api/v1/knowledge-bases", func(w http.ResponseWriter, r *http.Request) {
		s.page(w, r, "SELECT row_to_json(k) FROM (SELECT b.*, (SELECT count(*) FROM knowledge d WHERE d.knowledge_base_id=b.id) AS document_count FROM knowledge_bases b WHERE name ILIKE $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3) k", "SELECT count(*) FROM knowledge_bases WHERE name ILIKE $1", "%"+r.URL.Query().Get("q")+"%")
	})
	s.handle("POST /api/v1/knowledge-bases", func(w http.ResponseWriter, r *http.Request) {
		var in kbInput
		if !decode(w, r, &in) {
			return
		}
		if !validName(in.Name) {
			Failure(w, 400, "INVALID_ARGUMENT", "知识库名称必填，最多 256 个字符")
			return
		}
		defaults, e := s.newKnowledgeDefaults(r)
		if e != nil {
			dbFailure(w, e)
			return
		}
		effective := merge(defaults, in.Config)
		if e := validateParser(effective); e != "" {
			Failure(w, 400, "INVALID_ARGUMENT", e)
			return
		}
		b, _ := json.Marshal(effective)
		id := uuid.NewString()
		if _, e := s.Services.DB.Exec(r.Context(), "INSERT INTO knowledge_bases(id,name,description,config) VALUES($1,$2,$3,$4)", id, strings.TrimSpace(in.Name), in.Description, b); e != nil {
			dbFailure(w, e)
			return
		}
		s.one(w, r, "SELECT row_to_json(k) FROM knowledge_bases k WHERE id=$1", id)
	})
	s.handle("GET /api/v1/knowledge-bases/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.one(w, r, "SELECT row_to_json(k) FROM knowledge_bases k WHERE id=$1", id)
	})
	s.handle("PUT /api/v1/knowledge-bases/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var in kbInput
		if !decode(w, r, &in) {
			return
		}
		if !validName(in.Name) {
			Failure(w, 400, "INVALID_ARGUMENT", "知识库名称必填，最多 256 个字符")
			return
		}
		var old map[string]any
		if e := s.Services.DB.QueryRow(r.Context(), "SELECT config FROM knowledge_bases WHERE id=$1", id).Scan(&old); e != nil {
			dbFailure(w, e)
			return
		}
		v := merge(old, in.Config)
		if e := validateParser(v); e != "" {
			Failure(w, 400, "INVALID_ARGUMENT", e)
			return
		}
		b, _ := json.Marshal(v)
		s.one(w, r, "WITH updated AS (UPDATE knowledge_bases SET name=$2,description=$3,config=$4,updated_at=now() WHERE id=$1 RETURNING *) SELECT row_to_json(updated) FROM updated", id, strings.TrimSpace(in.Name), in.Description, b)
	})
	s.handle("GET /api/v1/knowledge-bases/{id}/stats", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.one(w, r, `SELECT json_build_object('documents',(SELECT count(*) FROM knowledge WHERE knowledge_base_id=b.id),'chunks',(SELECT count(*) FROM chunks c JOIN source_refs s ON s.id=c.source_ref_id JOIN knowledge k ON k.current_parse_version_id=c.parse_version_id WHERE k.knowledge_base_id=b.id AND `+jobs.SemanticSourceSQL+`),'wiki_pages',(SELECT count(*) FROM wiki_pages WHERE knowledge_base_id=b.id AND state='ready'),'graph_records',(SELECT count(*) FROM graph_records g JOIN source_refs s ON s.id=g.source_ref_id JOIN knowledge k ON k.current_parse_version_id=s.parse_version_id WHERE k.knowledge_base_id=b.id AND g.synced_at IS NOT NULL)) FROM knowledge_bases b WHERE id=$1`, id)
	})
	s.handle("POST /api/v1/knowledge-bases/{id}/duplicate", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.one(w, r, `WITH copied AS (INSERT INTO knowledge_bases(id,name,description,config) SELECT $2,name||' 副本',description,config FROM knowledge_bases WHERE id=$1 RETURNING *) SELECT row_to_json(copied) FROM copied`, id, uuid.NewString())
	})
}

// Snapshot defaults once; later global edits do not silently change existing libraries.
func (s *Server) newKnowledgeDefaults(r *http.Request) (map[string]any, error) {
	rows, e := s.Services.DB.Query(r.Context(), "SELECT key,value FROM settings WHERE key IN ('parser-defaults','media-defaults','preview-defaults','wiki-defaults','retrieval-defaults','model-bindings')")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	values := map[string]map[string]any{}
	for rows.Next() {
		var key string
		var value map[string]any
		if e = rows.Scan(&key, &value); e != nil {
			return nil, e
		}
		values[key] = value
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	cfg := merge(values["media-defaults"], values["parser-defaults"])
	delete(cfg, "enabled")
	cfg["media_enabled"] = values["media-defaults"]["enabled"]
	cfg["preview_enabled"] = values["preview-defaults"]["enabled"]
	cfg["wiki_config"] = values["wiki-defaults"]
	if values["wiki-defaults"]["enabled"] == false {
		cfg["wiki_enabled"] = false
	}
	cfg["retrieval_config"] = values["retrieval-defaults"]
	cfg["model_bindings"] = values["model-bindings"]
	return cfg, nil
}
