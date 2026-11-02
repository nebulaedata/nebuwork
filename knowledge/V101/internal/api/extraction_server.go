package api

import (
	"context"
	"encoding/json"
	"net/http"

	"nebulaekno/internal/ai"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
	"nebulaekno/internal/extraction"
	"nebulaekno/internal/taskcontrol"
)

// NewExtraction exposes only extraction-owned operations, without static UI,
// document ingestion, model management or infrastructure administration.
func NewExtraction(c config.Config, state *bootstrap.State) *Server {
	s := &Server{Config: c, State: state, mux: http.NewServeMux(), operations: []operation{{"GET", "/health/live"}, {"GET", "/health/ready"}}, ExtractionOnly: true}
	s.docsRoutes()
	s.extractionRoutes()
	s.extractionSettingsRoutes()
	s.handle("GET /api/v1/tasks/{id}", s.ownExtractionTask(func(w http.ResponseWriter, r *http.Request) {
		s.one(w, r, "SELECT "+taskcontrol.ProjectionSQL+"||jsonb_build_object('server_time',now(),'last_event_id',coalesce((SELECT max(id) FROM task_events WHERE task_id=t.id),0)) FROM tasks t WHERE t.id=$1", r.PathValue("id"))
	}))
	s.handle("GET /api/v1/tasks/{id}/events", s.ownExtractionTask(s.taskEvents))
	s.handle("POST /api/v1/tasks/{id}/cancel", s.ownExtractionTask(s.cancelTask))
	s.handle("POST /api/v1/tasks/{id}/retry", s.ownExtractionTask(func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if err := extraction.New(s.Services, s.Config).Retry(r.Context(), id); err != nil {
			extractionFailure(w, err)
			return
		}
		s.one(w, r, "SELECT row_to_json(t) FROM tasks t WHERE id=$1", id)
	}))
	return s
}
func (s *Server) ownExtractionTask(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		var own bool
		if err := s.Services.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM tasks WHERE id=$1 AND type='clause_extraction')", id).Scan(&own); err != nil {
			dbFailure(w, err)
			return
		}
		if !own {
			Failure(w, 404, "NOT_FOUND", "提取任务不存在")
			return
		}
		next(w, r)
	}
}
func (s *Server) extractionSettingsRoutes() {
	s.handle("GET /api/v1/settings/extraction-defaults", func(w http.ResponseWriter, r *http.Request) {
		s.one(w, r, "SELECT value FROM settings WHERE key='extraction-defaults'")
	})
	s.handle("PUT /api/v1/settings/extraction-defaults", func(w http.ResponseWriter, r *http.Request) {
		var value map[string]any
		if !decode(w, r, &value) {
			return
		}
		if value == nil {
			Failure(w, 400, "INVALID_ARGUMENT", "设置须为对象")
			return
		}
		var old map[string]any
		if err := s.Services.DB.QueryRow(r.Context(), "SELECT value FROM settings WHERE key='extraction-defaults'").Scan(&old); err != nil {
			dbFailure(w, err)
			return
		}
		value = merge(old, value)
		if message := validateSetting("extraction-defaults", value); message != "" {
			Failure(w, 400, "INVALID_ARGUMENT", message)
			return
		}
		id, _ := value["model_id"].(string)
		if id != "" {
			model, err := ai.Load(r.Context(), s.Services, id)
			if err != nil || !ai.SupportsPurpose(model.Purpose, "text") {
				Failure(w, 400, "INVALID_MODEL", "请选择已保存的文本生成模型")
				return
			}
		}
		tx, err := s.Services.DB.Begin(r.Context())
		if err != nil {
			dbFailure(w, err)
			return
		}
		defer tx.Rollback(context.Background())
		raw, _ := json.Marshal(value)
		if _, err = tx.Exec(r.Context(), "UPDATE settings SET value=$1,updated_at=now() WHERE key='extraction-defaults'", raw); err != nil {
			dbFailure(w, err)
			return
		}
		if _, err = tx.Exec(r.Context(), "UPDATE tasks SET state='queued',next_run_at=now(),updated_at=now() WHERE type='clause_extraction' AND state='waiting_configuration' AND NOT cancel_requested"); err != nil {
			dbFailure(w, err)
			return
		}
		if err = tx.Commit(r.Context()); err != nil {
			dbFailure(w, err)
			return
		}
		JSON(w, 200, value)
	})
}
