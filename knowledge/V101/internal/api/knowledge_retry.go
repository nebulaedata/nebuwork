package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"nebulaekno/internal/jobs"
)

// Keep successful stages, accepted Wiki pages, graph records and batch history.
// The worker skips successful/skipped stages and resumes necessary downstream
// work when an earlier failed stage prevented it from starting.
func retryFailedCheckpoint(checkpoint map[string]any) error {
	if checkpoint["wiki"] != "succeeded" && checkpoint["wiki"] != "skipped" {
		if e := jobs.ResetWikiFailures(checkpoint); e != nil {
			return e
		}
	}
	if checkpoint["graph"] != "succeeded" && checkpoint["graph"] != "skipped" {
		if e := jobs.ResetGraphFailures(checkpoint); e != nil {
			return e
		}
	}
	// A previous stage-specific retry must not hide other failed stages now.
	delete(checkpoint, "wiki_retry_only")
	delete(checkpoint, "graph_retry_only")
	return nil
}

func (s *Server) retryKnowledgeTasks(w http.ResponseWriter, r *http.Request) {
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
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	scope := "kb-retry-failed:" + kb
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
	var deleting bool
	if e = tx.QueryRow(r.Context(), "SELECT coalesce((config->>'deleting')::boolean,false) FROM knowledge_bases WHERE id=$1 FOR SHARE", kb).Scan(&deleting); e != nil {
		dbFailure(w, e)
		return
	}
	if deleting {
		Failure(w, 409, "KNOWLEDGE_BASE_DELETING", "知识库正在删除")
		return
	}
	// Freeze the candidate set. Do not include failures arriving after submission
	// or limit it to the visible page. Lock only affected documents, not the whole
	// library, before terminal task rows (the single-document enqueue order).
	ids := []string{}
	rows, e := tx.Query(r.Context(), "SELECT t.id::text FROM tasks t WHERE "+knowledgeTaskScope+" AND t.state IN ('failed','partially_failed')", kb)
	if e != nil {
		dbFailure(w, e)
		return
	}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			break
		}
		ids = append(ids, id)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		dbFailure(w, e)
		return
	}
	rows, e = tx.Query(r.Context(), "SELECT k.id FROM knowledge k WHERE k.knowledge_base_id=$1 AND k.id IN (SELECT knowledge_id FROM tasks WHERE id=ANY($2::uuid[])) ORDER BY k.id FOR UPDATE", kb, ids)
	if e != nil {
		dbFailure(w, e)
		return
	}
	for rows.Next() {
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		dbFailure(w, e)
		return
	}
	rows, e = tx.Query(r.Context(), `SELECT t.id::text,t.type,t.state,t.checkpoint,
 coalesce(k.id::text,''),coalesce((k.config->>'deleting')::boolean,false),
 coalesce(t.checkpoint->>'parse_version_id','')<>'' AND
   (k.current_parse_version_id IS DISTINCT FROM nullif(t.checkpoint->>'parse_version_id','')::uuid
    OR NOT EXISTS(SELECT 1 FROM parse_versions p WHERE p.id=k.current_parse_version_id AND p.file_version_id=k.current_file_version_id)),
 EXISTS(SELECT 1 FROM tasks a WHERE a.knowledge_id=t.knowledge_id AND a.id<>t.id
   AND a.state IN ('queued','running','waiting_configuration')
   AND (a.type='clause_extraction')=(t.type='clause_extraction')),
 EXISTS(SELECT 1 FROM tasks n WHERE n.knowledge_id=t.knowledge_id AND (n.created_at,n.id)>(t.created_at,t.id)
   AND CASE WHEN t.type='clause_extraction' THEN n.type='clause_extraction'
     WHEN t.type='preview' THEN n.type='preview' OR (n.type IN ('ingest','rebuild') AND coalesce((n.config->>'partial_rebuild')::boolean,false)=false)
     ELSE n.type IN ('ingest','rebuild','extract_archive') END),
 t.type='clause_extraction' AND NOT EXISTS(SELECT 1 FROM extraction_runs x WHERE x.task_id=t.id
   AND x.knowledge_id=k.id AND x.parse_version_id=k.current_parse_version_id AND x.file_version_id=k.current_file_version_id)
 FROM tasks t LEFT JOIN knowledge k ON k.id=t.knowledge_id AND k.knowledge_base_id=$1
 WHERE t.id=ANY($2::uuid[]) AND t.state IN ('failed','partially_failed') ORDER BY t.id FOR UPDATE OF t`, kb, ids)
	if e != nil {
		dbFailure(w, e)
		return
	}
	type retry struct {
		id         string
		checkpoint []byte
	}
	accepted := []retry{}
	reasons := map[string]int{}
	items := []any{}
	seen := 0
	for rows.Next() {
		var id, kind, state, doc string
		var cp map[string]any
		var removing, stale, active, superseded, staleExtraction bool
		if e = rows.Scan(&id, &kind, &state, &cp, &doc, &removing, &stale, &active, &superseded, &staleExtraction); e != nil {
			break
		}
		seen++
		reason := ""
		switch {
		case state != "failed" && state != "partially_failed":
			reason = "STATE_CHANGED"
		case kind != "ingest" && kind != "rebuild" && kind != "extract_archive" && kind != "preview" && kind != "clause_extraction":
			reason = "TASK_TYPE_UNSUPPORTED"
		case doc == "":
			reason = "DOCUMENT_UNAVAILABLE"
		case removing:
			reason = "DOCUMENT_DELETING"
		case stale || staleExtraction:
			reason = "STALE_VERSION"
		case active:
			reason = "TASK_ACTIVE"
		case superseded:
			reason = "TASK_SUPERSEDED"
		case (kind == "ingest" || kind == "rebuild") && cp["parse"] == "succeeded" && (cp["transcription"] == "failed" || cp["transcription"] == "waiting_configuration"):
			// ASR currently republishes the parse version and invalidates every
			// downstream checkpoint. That requires explicit document reprocessing,
			// not this operation's promise to keep successful stages unchanged.
			reason = "TRANSCRIPTION_REPARSE_REQUIRED"
		default:
			if cp == nil {
				cp = map[string]any{}
			}
			if kind != "clause_extraction" && retryFailedCheckpoint(cp) != nil {
				reason = "CHECKPOINT_INVALID"
			}
		}
		if reason != "" {
			reasons[reason]++
		} else {
			raw, _ := json.Marshal(cp)
			accepted = append(accepted, retry{id, raw})
		}
		if len(items) < 100 {
			items = append(items, map[string]any{"task_id": id, "accepted": reason == "", "reason": reason})
		}
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		dbFailure(w, e)
		return
	}
	batch := &pgx.Batch{}
	if seen < len(ids) {
		reasons["STATE_CHANGED"] += len(ids) - seen
	}
	acceptedIDs := []string{}
	for _, task := range accepted {
		acceptedIDs = append(acceptedIDs, task.id)
		batch.Queue("UPDATE tasks SET state='queued',checkpoint=$2,cancel_requested=false,attempts=0,error=NULL,owner=NULL,lease_until=NULL,next_run_at=now(),updated_at=now() WHERE id=$1", task.id, task.checkpoint)
	}
	if e = tx.SendBatch(r.Context(), batch).Close(); e != nil {
		dbFailure(w, e)
		return
	}
	if len(acceptedIDs) > 0 {
		if _, e = tx.Exec(r.Context(), `UPDATE knowledge k SET status='queued',updated_at=now() FROM tasks t WHERE t.id=ANY($1::uuid[]) AND k.id=t.knowledge_id AND t.type IN ('ingest','rebuild','extract_archive') AND coalesce((t.config->>'partial_rebuild')::boolean,false)=false`, acceptedIDs); e != nil {
			dbFailure(w, e)
			return
		}
		if _, e = tx.Exec(r.Context(), `INSERT INTO task_events(task_id,event) SELECT id,jsonb_build_object('state','queued','retry_mode','failed_stages','request_id',$2::text) FROM tasks WHERE id=ANY($1::uuid[])`, acceptedIDs, key); e != nil {
			dbFailure(w, e)
			return
		}
		if _, e = tx.Exec(r.Context(), "INSERT INTO outbox(task_id,kind,payload) SELECT id,'dispatch','{}'::jsonb FROM tasks WHERE id=ANY($1::uuid[])", acceptedIDs); e != nil {
			dbFailure(w, e)
			return
		}
	}
	response := map[string]any{"request_id": key, "total": len(ids), "accepted": len(accepted), "skipped": len(ids) - len(accepted), "reasons": reasons, "items": items, "items_truncated": len(items) < len(ids)}
	saved, _ = json.Marshal(response)
	if _, e = tx.Exec(r.Context(), "INSERT INTO request_keys(scope,key,request_hash,response) VALUES($1,$2,'retry-failed-v1',$3)", scope, key, saved); e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 202, response)
}
