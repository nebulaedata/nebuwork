package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"log/slog"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
	"nebulaekno/internal/taskcontrol"
	"nebulaekno/internal/textutil"
	"strings"
	"sync"
	"time"
)

type Worker struct {
	Services *bootstrap.Services
	Config   config.Config
	State    *bootstrap.State
	owner    string
	wg       sync.WaitGroup
	cancel   context.CancelFunc
}
type Task struct {
	ID, KBID, KnowledgeID, Type, Owner string
	Config, Checkpoint                 map[string]any
	Attempts                           int
	Pipeline                           *Pipeline
	CurrentStage, ReaderSnapshot       string
	ProgressSaved                      time.Time
}

func Start(ctx context.Context, s *bootstrap.Services, c config.Config, state *bootstrap.State) *Worker {
	ctx, cancel := context.WithCancel(ctx)
	w := &Worker{s, c, state, uuid.NewString(), sync.WaitGroup{}, cancel}
	w.wg.Add(1)
	go w.dispatch(ctx)
	for i := 0; i < c.DocumentWorkers; i++ {
		w.wg.Add(1)
		go w.consume(ctx, "documents")
	}
	for i := 0; i < c.ImageWorkers; i++ {
		w.wg.Add(1)
		go w.consume(ctx, "images")
	}
	for i := 0; i < c.MediaWorkers; i++ {
		w.wg.Add(1)
		go w.consume(ctx, "media")
	}
	return w
}
func (w *Worker) Stop() { w.cancel(); w.wg.Wait() }
func (w *Worker) dispatch(ctx context.Context) {
	defer w.wg.Done()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !w.State.Get().Ready {
				continue
			}
			w.dispatchOnce(ctx)
		}
	}
}
func (w *Worker) dispatchOnce(ctx context.Context) {
	w.cleanupTemporary(ctx)
	// PostgreSQL remains authoritative even after Redis or an outbox acknowledgement is lost.
	_, _ = w.Services.DB.Exec(ctx, "UPDATE tasks SET state=CASE WHEN cancel_requested THEN 'cancelled' ELSE 'queued' END,owner=NULL,lease_until=NULL WHERE state='running' AND lease_until<now()")
	rows, e := w.Services.DB.Query(ctx, `WITH pending AS (
 (SELECT id,knowledge_id,type,created_at FROM tasks t WHERE state='queued' AND NOT cancel_requested AND next_run_at<=now() AND `+taskcontrol.ReadySQL+` AND type<>'clause_extraction' ORDER BY created_at LIMIT 100)
 UNION ALL
 (SELECT id,knowledge_id,type,created_at FROM tasks t WHERE state='queued' AND NOT cancel_requested AND next_run_at<=now() AND `+taskcontrol.ReadySQL+` AND type='clause_extraction' ORDER BY created_at LIMIT 20)
 ) SELECT t.id::text,coalesce(k.file_type,''),t.type FROM pending t LEFT JOIN knowledge k ON k.id=t.knowledge_id ORDER BY t.created_at`)
	if e != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id, ext, kind string
		if rows.Scan(&id, &ext, &kind) != nil {
			return
		}
		queue := "documents"
		if kind == "clause_extraction" {
			queue = "clause-extraction"
		} else if IsMedia(ext) {
			queue = "media"
		} else if strings.Contains("|png|jpg|jpeg|webp|tif|tiff|bmp|", "|"+ext+"|") {
			queue = "images"
		}
		key := w.Services.Prefix + "dispatch:" + id
		_, e = w.Services.Redis.Eval(ctx, `if redis.call('SET',KEYS[1],'1','NX','EX',15) then redis.call('LPUSH',KEYS[2],ARGV[1]); return 1 else return 0 end`, []string{key, w.Services.Prefix + "queue:" + queue}, id).Result()
		if e != nil {
			return
		}
		_, _ = w.Services.DB.Exec(ctx, "UPDATE outbox SET delivered_at=now() WHERE task_id=$1 AND delivered_at IS NULL", id)
	}
}
func (w *Worker) consume(ctx context.Context, queue string) {
	defer w.wg.Done()
	for {
		if ctx.Err() != nil {
			return
		}
		if !w.State.Get().Ready {
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
				continue
			}
		}
		item, e := w.Services.Redis.BRPop(ctx, time.Second, w.Services.Prefix+"queue:"+queue).Result()
		if e != nil {
			if e != redis.Nil {
				select {
				case <-ctx.Done():
					return
				case <-time.After(time.Second):
				}
			}
			continue
		}
		if len(item) != 2 {
			continue
		}
		w.process(ctx, item[1])
	}
}
func (w *Worker) process(ctx context.Context, id string) {
	var t Task
	t.Owner = w.owner + ":" + uuid.NewString()
	var raw, checkpoint []byte
	tx, e := w.Services.DB.Begin(ctx)
	if e != nil {
		return
	}
	defer tx.Rollback(context.Background())
	generation, e := taskcontrol.Claim(ctx, tx, id)
	if e != nil {
		return
	}
	var document string
	if e = tx.QueryRow(ctx, "SELECT coalesce(knowledge_id::text,'') FROM tasks WHERE id=$1", id).Scan(&document); e != nil {
		return
	}
	if document != "" {
		var locked bool
		if e = tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0))", "document-task:"+document).Scan(&locked); e != nil || !locked {
			return
		}
		var active bool
		if e = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM tasks WHERE knowledge_id::text=$1 AND type<>'clause_extraction' AND state='running' AND lease_until>now())", document).Scan(&active); e != nil || active {
			return
		}
	}
	e = tx.QueryRow(ctx, `UPDATE tasks SET state='running',owner=$2,pause_generation=$3,lease_until=now()+interval '30 seconds',attempts=attempts+1,updated_at=now() WHERE id=$1 AND state='queued' AND NOT cancel_requested AND next_run_at<=now() RETURNING id::text,coalesce(knowledge_base_id::text,''),coalesce(knowledge_id::text,''),type,config,checkpoint,attempts`, id, t.Owner, generation).Scan(&t.ID, &t.KBID, &t.KnowledgeID, &t.Type, &raw, &checkpoint, &t.Attempts)
	if e != nil {
		return
	}
	if _, e = tx.Exec(ctx, `UPDATE knowledge k SET status='processing',updated_at=now() FROM tasks t WHERE t.id=$1 AND k.id=t.knowledge_id AND t.type IN ('ingest','rebuild') AND coalesce((t.config->>'partial_rebuild')::boolean,false)=false`, t.ID); e != nil {
		return
	}
	if e = tx.Commit(ctx); e != nil {
		return
	}
	json.Unmarshal(raw, &t.Config)
	json.Unmarshal(checkpoint, &t.Checkpoint)
	if t.Checkpoint == nil {
		t.Checkpoint = map[string]any{}
	}
	t.startPipeline()
	jobctx, cancel := context.WithCancel(ctx)
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		tick := time.NewTicker(3 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-jobctx.Done():
				return
			case <-tick.C:
				var requested, uninterrupted bool
				e := w.Services.DB.QueryRow(jobctx, "UPDATE tasks t SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND owner=$2 AND state='running' RETURNING cancel_requested,"+taskcontrol.UninterruptedSQL, t.ID, t.Owner).Scan(&requested, &uninterrupted)
				if e != nil || requested || !uninterrupted || !w.State.Get().Ready {
					cancel()
					return
				}
			}
		}
	}()
	w.event(jobctx, t.ID, map[string]any{"state": "running", "attempt": t.Attempts})
	e = w.saveProgress(jobctx, &t, true)
	if e == nil {
		e = w.execute(jobctx, &t)
	}
	interrupted := jobctx.Err() != nil
	cancel()
	<-heartbeatDone
	finish, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	state := "succeeded"
	var failure any
	retryAt := time.Now()
	if e != nil {
		state = "failed"
		failure = map[string]any{"code": "PROCESSING_FAILED", "message": "处理失败", "retryable": false}
		var a *ai.Error
		if errors.As(e, &a) {
			failure = map[string]any{"code": a.Code, "message": a.Message, "retryable": a.Retryable}
			if a.Code == "MODEL_NOT_CONFIGURED" || a.Code == "PARSER_NOT_CONFIGURED" {
				state = "waiting_configuration"
			} else if a.Code == "ARCHIVE_PARTIAL" {
				state = "partially_failed"
			} else if a.Retryable && t.Attempts < 3 {
				state = "queued"
				retryAt = time.Now().Add(time.Duration(t.Attempts*t.Attempts) * 5 * time.Second)
			}
		} else {
			failure = map[string]any{"code": "PROCESSING_FAILED", "message": e.Error(), "retryable": false}
		}
	}
	var requested, uninterrupted bool
	var savedCheckpoint map[string]any
	_ = w.Services.DB.QueryRow(finish, "SELECT cancel_requested,"+taskcontrol.UninterruptedSQL+",checkpoint FROM tasks t WHERE id=$1", t.ID).Scan(&requested, &uninterrupted, &savedCheckpoint)
	interrupted = interrupted || e != nil && !uninterrupted
	if requested {
		state = "cancelled"
	} else if interrupted {
		state = "queued"
		failure = nil
	}
	b, _ := json.Marshal(failure)
	if state == "failed" && t.Checkpoint["parse"] == "succeeded" {
		state = "partially_failed"
	}
	t.finishPipeline(state)
	ledgerUpdates := map[string]any{}
	if interrupted && !uninterrupted && !requested {
		ledgerUpdates = suspendedLedgers(savedCheckpoint)
	}
	ledgerJSON, _ := json.Marshal(ledgerUpdates)
	finalCheckpoint, _ := json.Marshal(t.Pipeline)
	tag, updateErr := w.Services.DB.Exec(finish, `UPDATE tasks SET state=$3,error=$4,checkpoint=jsonb_set(checkpoint||$8::jsonb,'{pipeline}',$7::jsonb),owner=NULL,lease_until=NULL,next_run_at=$5,updated_at=now(),attempts=attempts-CASE WHEN $6 THEN 1 ELSE 0 END WHERE id=$1 AND owner=$2`, t.ID, t.Owner, state, b, retryAt, interrupted, finalCheckpoint, ledgerJSON)
	if updateErr != nil || tag.RowsAffected() == 0 {
		return
	}
	w.event(finish, t.ID, map[string]any{"state": state, "error": failure})
	if t.Type == "extract_archive" {
		docState := state
		if state == "succeeded" {
			docState = "extracted"
		}
		if state == "partially_failed" {
			docState = "partially_extracted"
		}
		_, _ = w.Services.DB.Exec(finish, "UPDATE knowledge SET status=$2,updated_at=now() WHERE id=$1", t.KnowledgeID, docState)
	}
	if t.KnowledgeID != "" && (t.Type == "ingest" || t.Type == "rebuild") && t.Config["partial_rebuild"] != true {
		_, _ = w.Services.DB.Exec(finish, "UPDATE knowledge SET status=$2,updated_at=now() WHERE id=$1", t.KnowledgeID, state)
	}
}
func (w *Worker) event(ctx context.Context, id string, event any) {
	b, _ := json.Marshal(event)
	_, _ = w.Services.DB.Exec(ctx, "INSERT INTO task_events(task_id,event) VALUES($1,$2)", id, b)
}
func (w *Worker) stage(ctx context.Context, t *Task, name, status string) error {
	t.traceStage(name, status)
	t.Checkpoint[name] = status
	b, _ := json.Marshal(t.Checkpoint)
	tag, e := w.Services.DB.Exec(ctx, "UPDATE tasks SET stage=$3,checkpoint=$4::jsonb || CASE WHEN checkpoint ? 'wiki_batches' THEN jsonb_build_object('wiki_batches',checkpoint->'wiki_batches') ELSE '{}'::jsonb END || CASE WHEN checkpoint ? 'graph_batches' THEN jsonb_build_object('graph_batches',checkpoint->'graph_batches') ELSE '{}'::jsonb END,updated_at=now() WHERE id=$1 AND owner=$2 AND state='running' AND NOT cancel_requested", t.ID, t.Owner, name, b)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return context.Canceled
	}
	w.event(ctx, t.ID, map[string]any{"stage": name, "status": status})
	return nil
}
func IsMedia(ext string) bool {
	switch ext {
	case "mp3", "wav", "ogg", "flac", "m4a", "aac", "mp4", "mkv", "mov", "webm", "avi", "m4v":
		return true
	}
	return false
}
func Bool(m map[string]any, key string, fallback bool) bool {
	if b, ok := m[key].(bool); ok {
		return b
	}
	return fallback
}
func Number(m map[string]any, key string, fallback int) int {
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return fallback
}
func (w *Worker) execute(ctx context.Context, t *Task) error {
	if t.Type == "extract_archive" {
		return w.extractArchive(ctx, t)
	}
	if t.Type == "preview" {
		return w.preview(ctx, t)
	}
	if t.Type == "delete_knowledge" || t.Type == "delete_kb" {
		return w.remove(ctx, t)
	}
	var bindings map[string]any
	if e := w.Services.DB.QueryRow(ctx, "SELECT value FROM settings WHERE key='model-bindings'").Scan(&bindings); e != nil {
		return e
	}
	frozen, _ := t.Config["model_bindings"].(map[string]any)
	if frozen == nil {
		frozen = map[string]any{}
	}
	// A model may have changed purpose after this task's configuration was frozen.
	// Remove stale bindings before filling current defaults; Bound also verifies every call.
	for purpose, rawID := range frozen {
		if id, ok := rawID.(string); ok && id != "" {
			var currentPurpose string
			err := w.Services.DB.QueryRow(ctx, "SELECT purpose FROM models WHERE id::text=$1", id).Scan(&currentPurpose)
			if err == pgx.ErrNoRows || err == nil && !ai.SupportsPurpose(currentPurpose, purpose) {
				delete(frozen, purpose)
			} else if err != nil {
				return err
			}
		}
	}
	for k, v := range bindings {
		if old, exists := frozen[k]; !exists || old == nil || old == "" {
			frozen[k] = v
		}
	}
	t.Config["model_bindings"] = frozen
	b, _ := json.Marshal(t.Config)
	if _, e := w.Services.DB.Exec(ctx, "UPDATE tasks SET config=$3 WHERE id=$1 AND owner=$2", t.ID, t.Owner, b); e != nil {
		return e
	}
	if t.Type != "ingest" && t.Type != "rebuild" {
		return fmt.Errorf("不支持的任务类型")
	}
	wikiOnly := t.Checkpoint["wiki_retry_only"] == true
	graphOnly := t.Checkpoint["graph_retry_only"] == true
	partialOnly := wikiOnly || graphOnly
	if partialOnly && t.Checkpoint["parse"] != "succeeded" {
		return fmt.Errorf("Wiki 补跑缺少解析检查点")
	}
	if !partialOnly && t.Checkpoint["parse"] != "succeeded" {
		if e := w.parse(ctx, t); e != nil {
			return e
		}
	} else if !partialOnly && (t.Checkpoint["transcription"] == "waiting_configuration" || t.Checkpoint["transcription"] == "failed") {
		if _, e := ai.Bound(ctx, w.Services, "asr", t.Config); e == nil {
			if e = w.parse(ctx, t); e != nil {
				return e
			}
		}
	}
	var first error
	if !partialOnly && t.Checkpoint["transcription"] == "waiting_configuration" {
		first = ai.Missing("asr")
	}
	if !partialOnly && t.Checkpoint["transcription"] == "failed" {
		first = &ai.Error{Code: "TRANSCRIPTION_FAILED", Message: "语音转写失败，已保留画面和媒体检查点", Retryable: true}
	}
	for _, stage := range []struct {
		name    string
		enabled bool
		run     func(context.Context, *Task) error
	}{
		{"keyword", true, w.keyword},
		{"images", Bool(t.Config, "image_caption", true), w.captionImages},
		{"image_embedding", Bool(t.Config, "image_embedding", true), w.embedImages},
		{"outline", Bool(t.Config, "outline_enabled", true), w.outline},
		{"embedding", true, w.embed},
		{"wiki", Bool(t.Config, "wiki_enabled", true), w.wiki},
		{"graph", Bool(t.Config, "graph_enabled", true), w.graph},
	} {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if (wikiOnly && stage.name != "wiki") || (graphOnly && stage.name != "graph") {
			continue
		}
		if !stage.enabled {
			if e := w.stage(ctx, t, stage.name, "disabled"); e != nil {
				return e
			}
			continue
		}
		if t.Checkpoint[stage.name] == "succeeded" || t.Checkpoint[stage.name] == "skipped" {
			continue
		}
		if e := w.stage(ctx, t, stage.name, "running"); e != nil {
			return e
		}
		e := stage.run(ctx, t)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if e != nil {
			status := "failed"
			var a *ai.Error
			if errors.As(e, &a) && a.Code == "MODEL_NOT_CONFIGURED" {
				status = "waiting_configuration"
			}
			failure := map[string]any{"code": "PROCESSING_FAILED", "message": "处理阶段失败"}
			if a != nil {
				failure = map[string]any{"code": a.Code, "message": a.Message, "retryable": a.Retryable}
			}
			t.Checkpoint[stage.name+"_error"] = failure
			w.stage(ctx, t, stage.name, status)
			var previous *ai.Error
			errors.As(first, &previous)
			if first == nil || previous != nil && previous.Code == "MODEL_NOT_CONFIGURED" && status != "waiting_configuration" {
				first = e
			}
			slog.Info("处理阶段未完成", "task_id", t.ID, "stage", stage.name, "status", status)
		} else {
			delete(t.Checkpoint, stage.name+"_error")
			if e = w.stage(ctx, t, stage.name, "succeeded"); e != nil {
				return e
			}
		}
	}
	if partialOnly && first == nil {
		// Other stages were deliberately not rerun; retain their outstanding state.
		for _, name := range []string{"parse", "images", "image_embedding", "outline", "embedding", "wiki", "graph", "transcription"} {
			if t.Checkpoint[name] == "failed" {
				return &ai.Error{Code: "OTHER_STAGE_FAILED", Message: "补跑阶段已完成；其他阶段仍有失败，请查看对应阶段"}
			}
		}
		for _, name := range []string{"images", "image_embedding", "outline", "embedding", "wiki", "graph", "transcription"} {
			if t.Checkpoint[name] == "waiting_configuration" {
				return &ai.Error{Code: "MODEL_NOT_CONFIGURED", Message: "补跑阶段已完成；其他阶段仍待配置"}
			}
		}
	}
	return first
}
func Owned(ctx context.Context, tx pgx.Tx, t *Task) error {
	var valid bool
	e := tx.QueryRow(ctx, "SELECT owner=$2 AND state='running' AND NOT cancel_requested AND lease_until>now() AND ("+taskcontrol.UninterruptedSQL+") FROM tasks t WHERE id=$1 FOR UPDATE", t.ID, t.Owner).Scan(&valid)
	if e != nil {
		return e
	}
	if !valid {
		return context.Canceled
	}
	return nil
}

func (w *Worker) keyword(ctx context.Context, t *Task) error {
	chunks, e := w.chunks(ctx, t)
	if e != nil {
		return e
	}
	for _, c := range chunks {
		if _, e = w.Services.DB.Exec(ctx, "UPDATE chunks SET search_vector=to_tsvector('simple',$2) WHERE id=$1", c.ID, textutil.Tokens(c.Content)); e != nil {
			return e
		}
	}
	return nil
}
