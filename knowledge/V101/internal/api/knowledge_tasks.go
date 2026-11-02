package api

import (
	"context"
	"encoding/json"
	"log/slog"
	"nebulaekno/internal/taskcontrol"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Historical tasks can retain their scope in config after resource deletion.
const knowledgeTaskScope = `coalesce(t.knowledge_base_id::text,(SELECT k.knowledge_base_id::text FROM knowledge k WHERE k.id=t.knowledge_id),t.config->>'knowledge_base_id')=$1`

func (s *Server) knowledgeTaskRoutes() {
	s.handle("GET /api/v1/knowledge-bases/{id}/tasks", func(w http.ResponseWriter, r *http.Request) {
		kb, ok := s.taskLibrary(w, r)
		if !ok {
			return
		}
		s.page(w, r, `SELECT `+taskcontrol.ProjectionSQL+`||jsonb_build_object('document_name',k.name) FROM tasks t LEFT JOIN knowledge k ON k.id=t.knowledge_id WHERE `+knowledgeTaskScope+` AND ($2='' OR (`+taskcontrol.StateSQL+`)=$2) ORDER BY t.created_at DESC,t.id DESC LIMIT $3 OFFSET $4`, `SELECT count(*) FROM tasks t WHERE `+knowledgeTaskScope+` AND ($2='' OR (`+taskcontrol.StateSQL+`)=$2)`, kb, r.URL.Query().Get("state"))
	})
	s.handle("GET /api/v1/knowledge-bases/{id}/tasks/stats", func(w http.ResponseWriter, r *http.Request) {
		kb, ok := s.taskLibrary(w, r)
		if !ok {
			return
		}
		s.one(w, r, knowledgeTaskStatsSQL, kb)
	})
	s.handle("POST /api/v1/knowledge-bases/{id}/tasks/cancel", s.cancelKnowledgeTasks)
	s.handle("POST /api/v1/knowledge-bases/{id}/tasks/retry-failed", s.retryKnowledgeTasks)
	s.handle("POST /api/v1/knowledge-bases/{id}/tasks/pause", s.controlKnowledgeTasks)
	s.handle("POST /api/v1/knowledge-bases/{id}/tasks/resume", s.controlKnowledgeTasks)
}

const knowledgeTaskStatsSQL = `SELECT jsonb_build_object('library_paused',b.tasks_paused,'pause_generation',b.tasks_pause_generation)||
 (SELECT jsonb_build_object('queued',count(*) FILTER(WHERE state='queued'),'running',count(*) FILTER(WHERE state='running' AND NOT cancel_requested),'waiting_configuration',count(*) FILTER(WHERE state='waiting_configuration'),'stopping',count(*) FILTER(WHERE state='running' AND cancel_requested),'active',count(*) FILTER(WHERE state IN ('queued','running','waiting_configuration')),'failed',count(*) FILTER(WHERE state='failed'),'partially_failed',count(*) FILTER(WHERE state='partially_failed'),
 'paused',count(*) FILTER(WHERE state='queued' AND NOT cancel_requested AND NOT (` + taskcontrol.ReadySQL + `)),
 'pausing',count(*) FILTER(WHERE state='running' AND NOT cancel_requested AND NOT (` + taskcontrol.UninterruptedSQL + `)))
 FROM tasks t WHERE ` + knowledgeTaskScope + `) FROM knowledge_bases b WHERE b.id::text=$1`

func (s *Server) taskLibrary(w http.ResponseWriter, r *http.Request) (string, bool) {
	kb, ok := identifier(w, r, "id")
	if !ok {
		return "", false
	}
	var exists bool
	if e := s.Services.DB.QueryRow(r.Context(), "SELECT true FROM knowledge_bases WHERE id=$1", kb).Scan(&exists); e != nil {
		dbFailure(w, e)
		return "", false
	}
	return kb, true
}

type cancelKnowledgeReceipt struct {
	RequestID     string   `json:"request_id"`
	Cancelled     int      `json:"cancelled"`
	StopRequested int      `json:"stop_requested"`
	Stopping      int      `json:"stopping"`
	Documents     []string `json:"documents"`
}

func (s *Server) cancelKnowledgeTasks(w http.ResponseWriter, r *http.Request) {
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
	scope := "kb-cancel-tasks:" + kb
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
	receipt := cancelKnowledgeReceipt{RequestID: key, Documents: []string{}}
	e = tx.QueryRow(r.Context(), "SELECT response FROM request_keys WHERE scope=$1 AND key=$2", scope, key).Scan(&saved)
	if e == nil {
		if e = json.Unmarshal(saved, &receipt); e != nil {
			dbFailure(w, e)
			return
		}
		_ = tx.Rollback(r.Context())
		s.cancelKnowledgeResult(w, receipt)
		return
	}
	if e != pgx.ErrNoRows {
		dbFailure(w, e)
		return
	}
	taskIDs, documents := []string{}, map[string]bool{}
	// A second statement also sees archive children committed while the first
	// statement waited for the parent task's ownership lock. Once locked and
	// flagged, that parent can no longer create further children through Owned.
	for pass := 0; pass < 2; pass++ {
		rows, err := tx.Query(r.Context(), `UPDATE tasks t SET cancel_requested=true,state=CASE WHEN state='running' THEN state ELSE 'cancelled' END,updated_at=now() WHERE `+knowledgeTaskScope+` AND state IN ('queued','running','waiting_configuration') AND (NOT cancel_requested OR state<>'running') RETURNING id::text,coalesce(knowledge_id::text,''),type,state,coalesce((config->>'partial_rebuild')::boolean,false)`, kb)
		if err != nil {
			dbFailure(w, err)
			return
		}
		for rows.Next() {
			var id, doc, kind, state string
			var partial bool
			if e = rows.Scan(&id, &doc, &kind, &state, &partial); e != nil {
				rows.Close()
				dbFailure(w, e)
				return
			}
			taskIDs = append(taskIDs, id)
			if state == "running" {
				receipt.StopRequested++
			} else {
				receipt.Cancelled++
				if doc != "" && !partial && (kind == "ingest" || kind == "rebuild" || kind == "extract_archive") {
					documents[doc] = true
				}
			}
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			dbFailure(w, e)
			return
		}
	}
	if len(taskIDs) > 0 {
		if _, e = tx.Exec(r.Context(), `INSERT INTO task_events(task_id,event) SELECT id,jsonb_build_object('state',state,'cancel_requested',true) FROM tasks WHERE id=ANY($1::uuid[])`, taskIDs); e != nil {
			dbFailure(w, e)
			return
		}
	}
	if e = tx.QueryRow(r.Context(), `SELECT count(*) FROM tasks t WHERE `+knowledgeTaskScope+` AND state='running' AND cancel_requested`, kb).Scan(&receipt.Stopping); e != nil {
		dbFailure(w, e)
		return
	}
	for doc := range documents {
		receipt.Documents = append(receipt.Documents, doc)
	}
	saved, _ = json.Marshal(receipt)
	if _, e = tx.Exec(r.Context(), "INSERT INTO request_keys(scope,key,request_hash,response) VALUES($1,$2,'cancel-tasks-v1',$3)", scope, key, saved); e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	s.cancelKnowledgeResult(w, receipt)
}

func (s *Server) cancelKnowledgeResult(w http.ResponseWriter, receipt cancelKnowledgeReceipt) {
	// Release task locks before taking document locks: parser transactions own
	// their task before publishing a new parse version. A retry of this receipt
	// can reconcile document status without cancelling any newer tasks.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pending := false
	if e := s.cancelledDocumentStatus(ctx, receipt.Documents); e != nil {
		pending = true
		slog.Warn("终止任务后文档状态未刷新", "error", e)
	}
	JSON(w, 202, map[string]any{"request_id": receipt.RequestID, "cancelled": receipt.Cancelled, "stop_requested": receipt.StopRequested, "stopping": receipt.Stopping, "document_status_pending": pending})
}

func (s *Server) cancelledDocumentStatus(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	tx, e := s.Services.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(context.Background())
	rows, e := tx.Query(ctx, "SELECT id FROM knowledge WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", ids)
	if e != nil {
		return e
	}
	for rows.Next() {
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `UPDATE knowledge k SET status='cancelled',updated_at=now() WHERE id=ANY($1::uuid[]) AND status IN ('queued','processing','waiting_configuration') AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.knowledge_id=k.id AND t.type IN ('ingest','rebuild','extract_archive') AND coalesce((t.config->>'partial_rebuild')::boolean,false)=false AND t.state IN ('queued','running','waiting_configuration'))`, ids)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}
