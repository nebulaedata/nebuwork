package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"nebulaekno/internal/jobs"
	"nebulaekno/internal/taskcontrol"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s *Server) taskRoutes() {
	s.knowledgeTaskRoutes()
	s.handle("GET /api/v1/tasks", func(w http.ResponseWriter, r *http.Request) {
		s.page(w, r, "SELECT "+taskcontrol.ProjectionSQL+"||jsonb_build_object('document_name',k.name) FROM tasks t LEFT JOIN knowledge k ON k.id=t.knowledge_id WHERE ($1='' OR ("+taskcontrol.StateSQL+")=$1) ORDER BY t.created_at DESC LIMIT $2 OFFSET $3", "SELECT count(*) FROM tasks t WHERE ($1='' OR ("+taskcontrol.StateSQL+")=$1)", r.URL.Query().Get("state"))
	})
	s.handle("GET /api/v1/tasks/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, ok := identifier(w, r, "id")
		if !ok {
			return
		}
		s.one(w, r, "SELECT "+taskcontrol.ProjectionSQL+"||jsonb_build_object('server_time',now(),'last_event_id',coalesce((SELECT max(id) FROM task_events WHERE task_id=t.id),0)) FROM tasks t WHERE t.id=$1", id)
	})
	s.handle("GET /api/v1/tasks/stats", func(w http.ResponseWriter, r *http.Request) {
		s.list(w, r, "SELECT row_to_json(n) FROM (SELECT "+taskcontrol.StateSQL+" AS state,count(*) AS count FROM tasks t GROUP BY 1)n")
	})
	s.handle("POST /api/v1/tasks/{id}/cancel", s.cancelTask)
	s.handle("POST /api/v1/tasks/{id}/retry", s.retryTask)
	s.handle("POST /api/v1/tasks/{id}/wiki/retry-failed", s.retryTask)
	s.handle("POST /api/v1/tasks/{id}/graph/retry-failed", s.retryTask)
	s.handle("GET /api/v1/tasks/{id}/events", s.taskEvents)
	s.handle("POST /api/v1/knowledge/{id}/reparse", s.reprocess)
	s.handle("POST /api/v1/knowledge/{id}/outline/rebuild", s.reprocess)
	s.handle("POST /api/v1/knowledge/{id}/preview/rebuild", s.reprocess)
	s.handle("POST /api/v1/knowledge/{id}/images/rebuild", s.reprocess)
	s.handle("DELETE /api/v1/knowledge/{id}", func(w http.ResponseWriter, r *http.Request) { s.deleteResource(w, r, "delete_knowledge") })
	s.handle("DELETE /api/v1/knowledge-bases/{id}", func(w http.ResponseWriter, r *http.Request) { s.deleteResource(w, r, "delete_kb") })
}
func (s *Server) cancelTask(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	s.one(w, r, `WITH updated AS(UPDATE tasks SET cancel_requested=true,state=CASE WHEN state='running' THEN state ELSE 'cancelled' END,updated_at=now() WHERE id=$1 AND state IN ('queued','running','waiting_configuration') RETURNING *), documents AS(UPDATE knowledge k SET status='cancelled',updated_at=now() FROM updated t WHERE k.id=t.knowledge_id AND t.state='cancelled' AND t.type IN ('ingest','rebuild','extract_archive') AND coalesce((t.config->>'partial_rebuild')::boolean,false)=false RETURNING k.id), events AS(INSERT INTO task_events(task_id,event) SELECT id,jsonb_build_object('state',state,'cancel_requested',true) FROM updated) SELECT row_to_json(updated) FROM updated`, id)
}
func (s *Server) taskEvents(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var exists bool
	if e := s.Services.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM tasks WHERE id=$1)", id).Scan(&exists); e != nil {
		dbFailure(w, e)
		return
	}
	if !exists {
		Failure(w, 404, "NOT_FOUND", "任务不存在")
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		Failure(w, 500, "STREAM_UNAVAILABLE", "事件流不可用")
		return
	}
	last, _ := strconv.ParseInt(r.Header.Get("Last-Event-ID"), 10, 64)
	if last == 0 {
		last, _ = strconv.ParseInt(r.URL.Query().Get("last_event_id"), 10, 64)
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		if !s.State.Get().Ready {
			return
		}
		rows, e := s.Services.DB.Query(r.Context(), "SELECT id,event FROM task_events WHERE task_id=$1 AND id>$2 ORDER BY id LIMIT 100", id, last)
		if e != nil {
			return
		}
		for rows.Next() {
			var event json.RawMessage
			if rows.Scan(&last, &event) != nil {
				rows.Close()
				return
			}
			fmt.Fprintf(w, "id: %d\nevent: task\ndata: %s\n\n", last, event)
		}
		rows.Close()
		fmt.Fprint(w, ": heartbeat\n\n")
		flusher.Flush()
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
		}
	}
}
func (s *Server) reprocess(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var kb, ext string
	var cfg map[string]any
	var parseID *string
	if e := s.Services.DB.QueryRow(r.Context(), "SELECT k.knowledge_base_id::text,b.config||k.config,k.current_parse_version_id::text,k.file_type FROM knowledge k JOIN knowledge_bases b ON b.id=k.knowledge_base_id WHERE k.id=$1", id).Scan(&kb, &cfg, &parseID, &ext); e != nil {
		dbFailure(w, e)
		return
	}
	if ext == "zip" {
		Failure(w, 409, "ARCHIVE_TASK_REQUIRED", "ZIP 请在任务中心重试原解压任务，已解压文件可单独重新处理")
		return
	}
	if !supported(ext) {
		Failure(w, 409, "FORMAT_NOT_SUPPORTED", "原文件已保存，当前格式暂不支持解析")
		return
	}
	checkpoint := map[string]any{}
	if strings.Contains(r.URL.Path, "/outline/") && parseID != nil {
		cfg["partial_rebuild"] = true
		checkpoint = map[string]any{"parse": "succeeded", "parse_version_id": *parseID, "keyword": "succeeded", "embedding": "skipped", "wiki": "skipped", "graph": "skipped", "images": "skipped", "image_embedding": "skipped"}
	}
	if strings.Contains(r.URL.Path, "/images/") {
		if parseID == nil {
			Failure(w, 409, "PARSE_REQUIRED", "请先完成文件解析")
			return
		}
		cfg["partial_rebuild"] = true
		checkpoint = map[string]any{"parse": "succeeded", "parse_version_id": *parseID, "keyword": "skipped", "embedding": "skipped", "wiki": "skipped", "graph": "skipped", "outline": "skipped", "image_embedding": "skipped"}
	}
	kind := "rebuild"
	if strings.Contains(r.URL.Path, "/preview/") {
		if cfg["preview_enabled"] == false {
			Failure(w, 409, "PREVIEW_DISABLED", "该知识库已关闭文件预览")
			return
		}
		kind = "preview"
		cfg["partial_rebuild"] = true
	}
	taskID, e := s.enqueue(r.Context(), kb, id, kind, cfg, checkpoint)
	if e != nil {
		Failure(w, 409, "TASK_CONFLICT", e.Error())
		return
	}
	JSON(w, 202, map[string]string{"task_id": taskID})
}
func (s *Server) enqueue(ctx context.Context, kb, id, kind string, cfg, checkpoint map[string]any) (string, error) {
	tx, e := s.Services.DB.Begin(ctx)
	if e != nil {
		return "", fmt.Errorf("数据库不可用")
	}
	defer tx.Rollback(context.Background())
	if id != "" {
		var exists bool
		e = tx.QueryRow(ctx, "SELECT true FROM knowledge WHERE id=$1 FOR UPDATE", id).Scan(&exists)
		if e != nil {
			return "", fmt.Errorf("文档不存在")
		}
		var active bool
		_ = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM tasks WHERE knowledge_id=$1 AND type<>'clause_extraction' AND state IN ('queued','running'))", id).Scan(&active)
		if active {
			return "", fmt.Errorf("文档已有处理中的任务")
		}
	}
	if id != "" && cfg["partial_rebuild"] != true {
		if _, e = tx.Exec(ctx, "UPDATE tasks SET state='cancelled',cancel_requested=true,updated_at=now() WHERE knowledge_id=$1 AND type<>'clause_extraction' AND state='waiting_configuration'", id); e != nil {
			return "", e
		}
	}
	taskID := uuid.NewString()
	b, _ := json.Marshal(cfg)
	ch, _ := json.Marshal(checkpoint)
	_, e = tx.Exec(ctx, "INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,config,checkpoint,idempotency_key) VALUES($1,nullif($2,'')::uuid,nullif($3,'')::uuid,$4,$5,$6,$7)", taskID, kb, id, kind, b, ch, taskID)
	if e != nil {
		return "", fmt.Errorf("创建任务失败")
	}
	_, e = tx.Exec(ctx, "INSERT INTO outbox(task_id,kind,payload) VALUES($1,'dispatch','{}')", taskID)
	if e != nil {
		return "", e
	}
	if id != "" && (kind == "ingest" || kind == "rebuild" || kind == "extract_archive") && cfg["partial_rebuild"] != true {
		if _, e = tx.Exec(ctx, "UPDATE knowledge SET status='queued',updated_at=now() WHERE id=$1", id); e != nil {
			return "", e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return "", e
	}
	return taskID, nil
}
func (s *Server) deleteResource(w http.ResponseWriter, r *http.Request, kind string) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	kb, knowledge := id, ""
	if kind == "delete_knowledge" {
		knowledge = id
		if e := s.Services.DB.QueryRow(r.Context(), "SELECT knowledge_base_id::text FROM knowledge WHERE id=$1", id).Scan(&kb); e != nil {
			dbFailure(w, e)
			return
		}
	}
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	var exists bool
	e = tx.QueryRow(r.Context(), "SELECT true FROM knowledge_bases WHERE id=$1 FOR UPDATE", kb).Scan(&exists)
	if e != nil {
		dbFailure(w, e)
		return
	}
	if kind == "delete_kb" {
		_, e = tx.Exec(r.Context(), "UPDATE knowledge_bases SET config=config||'{\"deleting\":true}'::jsonb WHERE id=$1", kb)
	} else {
		_, e = tx.Exec(r.Context(), "UPDATE knowledge SET config=config||'{\"deleting\":true}'::jsonb WHERE id=$1", knowledge)
	}
	if e != nil {
		dbFailure(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), "UPDATE tasks SET cancel_requested=true,state=CASE WHEN state='running' THEN state ELSE 'cancelled' END WHERE knowledge_base_id=$1 AND ($2='' OR knowledge_id::text=$2) AND state IN ('queued','running','waiting_configuration')", kb, knowledge)
	if e != nil {
		dbFailure(w, e)
		return
	}
	taskID := uuid.NewString()
	cfg, _ := json.Marshal(map[string]string{"target_id": id, "knowledge_base_id": kb})
	_, e = tx.Exec(r.Context(), "INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,config,idempotency_key) VALUES($1,$2,nullif($3,'')::uuid,$4,$5,$6)", taskID, kb, knowledge, kind, cfg, taskID)
	if e != nil {
		dbFailure(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO outbox(task_id,kind,payload) VALUES($1,'dispatch','{}')", taskID)
	if e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 202, map[string]string{"task_id": taskID})
}

func (s *Server) retryTask(w http.ResponseWriter, r *http.Request) {
	id, ok := identifier(w, r, "id")
	if !ok {
		return
	}
	var extractionTask bool
	if e := s.Services.DB.QueryRow(r.Context(), "SELECT type='clause_extraction' FROM tasks WHERE id=$1", id).Scan(&extractionTask); e != nil {
		dbFailure(w, e)
		return
	}
	if extractionTask {
		if strings.Contains(r.URL.Path, "/wiki/") || strings.Contains(r.URL.Path, "/graph/") {
			Failure(w, 409, "STAGE_RETRY_UNAVAILABLE", "提取任务没有 Wiki 或图谱阶段")
			return
		}
		s.proxyExtraction(w, r)
		return
	}
	tx, e := s.Services.DB.Begin(r.Context())
	if e != nil {
		dbFailure(w, e)
		return
	}
	defer tx.Rollback(context.Background())
	var document, kind string
	if e = tx.QueryRow(r.Context(), "SELECT coalesce(knowledge_id::text,''),type FROM tasks WHERE id=$1", id).Scan(&document, &kind); e != nil {
		dbFailure(w, e)
		return
	}
	if document != "" && (kind == "ingest" || kind == "rebuild" || kind == "extract_archive" || kind == "preview") {
		var current *string
		var deleting bool
		if e = tx.QueryRow(r.Context(), "SELECT current_parse_version_id::text,coalesce((config->>'deleting')::boolean,false) FROM knowledge WHERE id=$1 FOR UPDATE", document).Scan(&current, &deleting); e != nil {
			dbFailure(w, e)
			return
		}
		if deleting {
			Failure(w, 409, "TASK_CONFLICT", "文档正在删除")
			return
		}
		var active bool
		if e = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM tasks WHERE knowledge_id=$1 AND id<>$2 AND type<>'clause_extraction' AND state IN ('queued','running'))", document, id).Scan(&active); e != nil {
			dbFailure(w, e)
			return
		}
		if active {
			Failure(w, 409, "TASK_CONFLICT", "文档已有处理中的任务")
			return
		}
		var parsed *string
		if e = tx.QueryRow(r.Context(), "SELECT checkpoint->>'parse_version_id' FROM tasks WHERE id=$1", id).Scan(&parsed); e != nil {
			dbFailure(w, e)
			return
		}
		if parsed != nil && (current == nil || *parsed != *current) {
			Failure(w, 409, "STALE_TASK", "文档已有新的解析版本，请对当前文档重新处理")
			return
		}
	}
	var checkpoint map[string]any
	var state string
	if e = tx.QueryRow(r.Context(), "SELECT checkpoint,state FROM tasks WHERE id=$1 FOR UPDATE", id).Scan(&checkpoint, &state); e != nil {
		dbFailure(w, e)
		return
	}
	if state != "failed" && state != "partially_failed" && state != "cancelled" && state != "waiting_configuration" {
		Failure(w, 409, "TASK_CONFLICT", "任务正在运行或已完成")
		return
	}
	wikiOnly := strings.HasSuffix(r.URL.Path, "/wiki/retry-failed")
	graphOnly := strings.HasSuffix(r.URL.Path, "/graph/retry-failed")
	stage := "wiki"
	if graphOnly {
		stage = "graph"
	}
	if (wikiOnly || graphOnly) && (checkpoint[stage] != "failed" || checkpoint["parse"] != "succeeded" || (kind != "ingest" && kind != "rebuild")) {
		Failure(w, 409, "STAGE_RETRY_UNAVAILABLE", "当前任务没有可补跑的失败阶段")
		return
	}
	if !graphOnly {
		if e = jobs.ResetWikiFailures(checkpoint); e != nil {
			Failure(w, 409, "WIKI_CHECKPOINT_INVALID", e.Error())
			return
		}
	}
	if !wikiOnly {
		if e = jobs.ResetGraphFailures(checkpoint); e != nil {
			Failure(w, 409, "GRAPH_CHECKPOINT_INVALID", e.Error())
			return
		}
	}
	delete(checkpoint, "wiki_retry_only")
	delete(checkpoint, "graph_retry_only")
	if wikiOnly || graphOnly {
		checkpoint[stage+"_retry_only"] = true
		checkpoint[stage] = "pending"
		delete(checkpoint, stage+"_error")
	}
	saved, _ := json.Marshal(checkpoint)
	if _, e = tx.Exec(r.Context(), "UPDATE tasks SET checkpoint=$2 WHERE id=$1", id, saved); e != nil {
		dbFailure(w, e)
		return
	}
	var result json.RawMessage
	e = tx.QueryRow(r.Context(), "WITH updated AS(UPDATE tasks SET state='queued',cancel_requested=false,attempts=0,error=NULL,next_run_at=now(),updated_at=now() WHERE id=$1 AND state IN ('failed','partially_failed','cancelled','waiting_configuration') RETURNING *) SELECT row_to_json(updated) FROM updated", id).Scan(&result)
	if e != nil {
		dbFailure(w, e)
		return
	}
	if _, e = tx.Exec(r.Context(), "UPDATE knowledge k SET status='queued',updated_at=now() FROM tasks t WHERE t.id=$1 AND k.id=t.knowledge_id AND t.type IN ('ingest','rebuild','extract_archive') AND coalesce((t.config->>'partial_rebuild')::boolean,false)=false", id); e != nil {
		dbFailure(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		dbFailure(w, e)
		return
	}
	JSON(w, 200, result)
}
