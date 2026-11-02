package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Server) controlKnowledgeTasks(w http.ResponseWriter, r *http.Request) {
	kb, ok := s.taskLibrary(w, r)
	if !ok {
		return
	}
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" {
		key = uuid.NewString()
	}
	if len(key) > 200 {
		Failure(w, 400, "INVALID_ARGUMENT", "操作标识过长")
		return
	}
	paused := strings.HasSuffix(r.URL.Path, "/pause")
	operation := "resume"
	if paused {
		operation = "pause"
	}
	scope := "kb-tasks-" + operation + ":" + kb
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", scope+":"+key); e != nil {
		dbFailure(w, e)
		return
	}
	var saved json.RawMessage
	e = tx.QueryRow(r.Context(), "SELECT response FROM request_keys WHERE scope=$1 AND key=$2", scope, key).Scan(&saved)
	if e == nil {
		JSON(w, 202, saved)
		return
	}
	if e != pgx.ErrNoRows {
		dbFailure(w, e)
		return
	}
	var old bool
	var generation int64
	if e = tx.QueryRow(r.Context(), "SELECT tasks_paused,tasks_pause_generation FROM knowledge_bases WHERE id=$1 FOR UPDATE", kb).Scan(&old, &generation); e != nil {
		dbFailure(w, e)
		return
	}
	if old != paused {
		if paused {
			generation++
		}
		if _, e = tx.Exec(r.Context(), "UPDATE knowledge_bases SET tasks_paused=$2,tasks_pause_generation=$3,updated_at=now() WHERE id=$1", kb, paused, generation); e != nil {
			dbFailure(w, e)
			return
		}
	}
	// Task rows, results and checkpoints are not rewritten. Running leases observe
	// this generation at heartbeat/commit; queued and future tasks stay blocked.
	response := map[string]any{"request_id": key, "paused": paused, "changed": old != paused, "pause_generation": generation}
	saved, _ = json.Marshal(response)
	if _, e = tx.Exec(r.Context(), "INSERT INTO request_keys(scope,key,request_hash,response) VALUES($1,$2,$3,$4)", scope, key, "task-control-v1", saved); e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 202, response)
}
