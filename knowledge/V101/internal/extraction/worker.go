package extraction

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
	"nebulaekno/internal/taskcontrol"
)

type Worker struct {
	service *Service
	state   *bootstrap.State
	cancel  context.CancelFunc
	wg      sync.WaitGroup
}

func Start(ctx context.Context, services *bootstrap.Services, c config.Config, state *bootstrap.State) *Worker {
	ctx, cancel := context.WithCancel(ctx)
	w := &Worker{service: New(services, c), state: state, cancel: cancel}
	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		for ctx.Err() == nil {
			if !state.Get().Ready {
				select {
				case <-ctx.Done():
					return
				case <-time.After(time.Second):
				}
				continue
			}
			item, err := services.Redis.BRPop(ctx, time.Second, services.Prefix+"queue:"+Queue).Result()
			if err == nil && len(item) == 2 {
				w.process(ctx, item[1])
			}
		}
	}()
	return w
}
func (w *Worker) Stop() { w.cancel(); w.wg.Wait() }

func (w *Worker) process(ctx context.Context, id string) {
	db := w.service.Services.DB
	owner := uuid.NewString()
	var runID, document string
	var input, cfg map[string]any
	var attempts int
	claim, err := db.Begin(ctx)
	if err != nil {
		return
	}
	defer claim.Rollback(context.Background())
	generation, err := taskcontrol.Claim(ctx, claim, id)
	if err != nil {
		return
	}
	err = claim.QueryRow(ctx, `UPDATE tasks t SET state='running',owner=$2,pause_generation=$3,lease_until=now()+interval '30 seconds',attempts=attempts+1,updated_at=now()
 FROM extraction_runs r WHERE t.id=$1 AND t.type='clause_extraction' AND r.task_id=t.id
 AND t.state='queued' AND NOT t.cancel_requested AND t.next_run_at<=now()
 AND NOT EXISTS(SELECT 1 FROM knowledge k JOIN knowledge_bases b ON b.id=k.knowledge_base_id WHERE k.id=t.knowledge_id
 AND (coalesce((k.config->>'deleting')::boolean,false) OR coalesce((b.config->>'deleting')::boolean,false)))
 RETURNING r.id::text,r.knowledge_id::text,r.input,r.config,t.attempts`, id, owner, generation).Scan(&runID, &document, &input, &cfg, &attempts)
	if err != nil {
		return
	}
	if err = claim.Commit(ctx); err != nil {
		return
	}
	workctx, cancel := context.WithTimeout(ctx, 305*time.Minute)
	defer cancel()
	heartbeatDone := make(chan struct{})
	go func() {
		defer close(heartbeatDone)
		tick := time.NewTicker(3 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-workctx.Done():
				return
			case <-tick.C:
				var requested, uninterrupted bool
				e := db.QueryRow(workctx, "UPDATE tasks t SET lease_until=now()+interval '30 seconds' WHERE id=$1 AND owner=$2 AND state='running' RETURNING cancel_requested,"+taskcontrol.UninterruptedSQL, id, owner).Scan(&requested, &uninterrupted)
				if e != nil || requested || !uninterrupted || !w.state.Get().Ready {
					cancel()
					return
				}
			}
		}
	}()
	trace := newExtractionTrace(owner, attempts)
	finalState, summary, err := w.execute(workctx, id, owner, runID, document, input, cfg, trace)
	interrupted := workctx.Err() != nil
	cancel()
	<-heartbeatDone
	finish, stop := context.WithTimeout(context.Background(), 10*time.Second)
	defer stop()
	var requested, uninterrupted bool
	_ = db.QueryRow(finish, "SELECT cancel_requested,"+taskcontrol.UninterruptedSQL+" FROM tasks t WHERE id=$1", id).Scan(&requested, &uninterrupted)
	interrupted = interrupted || err != nil && !uninterrupted
	var failure any
	if requested {
		finalState = "cancelled"
	} else if interrupted && !errors.Is(workctx.Err(), context.DeadlineExceeded) {
		finalState = "queued"
	} else if err != nil {
		finalState = "failed"
		failure = map[string]any{"code": "EXTRACTION_FAILED", "message": err.Error(), "retryable": false}
		var upstream *ai.Error
		if errors.As(err, &upstream) {
			failure = map[string]any{"code": upstream.Code, "message": upstream.Message, "retryable": upstream.Retryable}
			if upstream.Code == "MODEL_NOT_CONFIGURED" {
				finalState = "waiting_configuration"
			} else if upstream.Retryable && attempts < 3 {
				finalState = "queued"
			}
		}
	}
	if finalState == "" {
		finalState = "failed"
	}
	trace.finish(finalState, time.Now().UTC())
	traceRaw := mustJSON(map[string]any{"pipeline": trace.Pipeline, "extraction": trace.Progress})
	raw, _ := json.Marshal(failure)
	summaryRaw, _ := json.Marshal(summary)
	tx, e := db.Begin(finish)
	if e != nil {
		return
	}
	defer tx.Rollback(context.Background())
	tag, e := tx.Exec(finish, `UPDATE tasks SET state=$3,error=$4,owner=NULL,lease_until=NULL,next_run_at=now()+interval '5 seconds',
	 updated_at=now(),attempts=greatest(0,attempts-CASE WHEN $6 THEN 1 ELSE 0 END),checkpoint=checkpoint||$5::jsonb WHERE id=$1 AND owner=$2 AND state='running'`, id, owner, finalState, raw, traceRaw, interrupted)
	if e != nil || tag.RowsAffected() != 1 {
		return
	}
	if summary != nil {
		if _, e = tx.Exec(finish, "UPDATE extraction_runs SET summary=$2 WHERE id=$1", runID, summaryRaw); e != nil {
			return
		}
	}
	if _, e = tx.Exec(finish, "INSERT INTO task_events(task_id,event) VALUES($1,jsonb_build_object('state',$2::text))", id, finalState); e != nil {
		return
	}
	_ = tx.Commit(finish)
}

func (w *Worker) execute(ctx context.Context, taskID, owner, runID, document string, input, cfg map[string]any, trace *extractionTrace) (string, map[string]any, error) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	services := w.service.Services
	if err := w.saveEvent(ctx, taskID, owner, runID, map[string]any{"event": "trace_start"}, trace); err != nil {
		return "", nil, err
	}
	var model ai.Model
	var err error
	modelID, _ := cfg["model_id"].(string)
	if modelID == "" {
		var defaults map[string]any
		if e := services.DB.QueryRow(ctx, "SELECT value FROM settings WHERE key='extraction-defaults'").Scan(&defaults); e != nil {
			return "", nil, e
		}
		modelID, _ = defaults["model_id"].(string)
	}
	if modelID != "" {
		model, err = ai.Load(ctx, services, modelID)
	} else {
		model, err = ai.Bound(ctx, services, "text", nil)
	}
	if err != nil {
		return "", nil, err
	}
	if !ai.SupportsPurpose(model.Purpose, "text") {
		return "", nil, ai.Missing("条款参数提取的文本生成")
	}
	modelSnapshot, _ := json.Marshal(map[string]any{"id": model.ID, "name": model.ModelName, "url": model.BaseURL, "protocol": model.Protocol, "config": model.Config})
	modelDigest := sha256.Sum256(modelSnapshot)
	fingerprint := hex.EncodeToString(modelDigest[:])
	if old, _ := cfg["model_fingerprint"].(string); old != "" && old != fingerprint {
		return "", nil, &ai.Error{Code: "EXTRACTION_MODEL_CHANGED", Message: "本次运行使用的模型配置已变化，请重新提取；旧结果已保留"}
	}
	cfg["model_fingerprint"] = fingerprint
	cfg["model_id"] = model.ID
	cfg["model_name"] = model.ModelName
	cfg["model_display_name"] = model.Name
	frozen, _ := json.Marshal(cfg)
	if _, err = services.DB.Exec(ctx, "UPDATE extraction_runs r SET model_id=$2,config=$3 FROM tasks t WHERE r.id=$1 AND t.id=r.task_id AND t.owner=$4 AND t.state='running' AND NOT t.cancel_requested", runID, model.ID, frozen, owner); err != nil {
		return "", nil, err
	}
	directory := filepath.Join(w.service.Config.DataDir, "extractions", document, runID)
	if err = os.MkdirAll(directory, 0700); err != nil {
		return "", nil, err
	}
	inputPath := filepath.Join(directory, "input.json")
	raw, _ := json.Marshal(input)
	if err = os.WriteFile(inputPath, raw, 0600); err != nil {
		return "", nil, err
	}
	cmd := command(ctx, "run", inputPath, directory)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", nil, err
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return "", nil, err
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err = cmd.Start(); err != nil {
		return "", nil, fmt.Errorf("提取引擎启动失败：%w", err)
	}
	var writeLock sync.Mutex
	var calls sync.WaitGroup
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 65536), 64<<20)
	state := ""
	var summary map[string]any
	var eventError error
	for scanner.Scan() {
		var event map[string]any
		if err = json.Unmarshal(scanner.Bytes(), &event); err != nil {
			eventError = fmt.Errorf("提取引擎返回无效事件")
			break
		}
		if event["event"] == "model_request" {
			calls.Add(1)
			go func(event map[string]any) {
				defer calls.Done()
				body, _ := event["body"].(map[string]any)
				response, e := mainCompletion(ctx, services.Identity, w.service.Config.MainAPIURL, ModelRequest{TaskID: taskID, RunID: runID, Owner: owner, Body: body})
				reply := map[string]any{"id": event["id"], "response": response}
				if e != nil {
					var upstream *ai.Error
					code := "MODEL_REQUEST_FAILED"
					if errors.As(e, &upstream) {
						code = upstream.Code
					}
					reply["error"] = map[string]any{"code": code, "message": e.Error()}
				}
				writeLock.Lock()
				_ = json.NewEncoder(stdin).Encode(reply)
				writeLock.Unlock()
			}(event)
			continue
		}
		if event["event"] == "complete" {
			state, _ = event["state"].(string)
			summary, _ = event["summary"].(map[string]any)
		}
		if event["event"] == "error" {
			eventError = fmt.Errorf("%v", event["message"])
		}
		if err = w.saveEvent(ctx, taskID, owner, runID, event, trace); err != nil {
			eventError = err
			break
		}
	}
	if eventError != nil || scanner.Err() != nil {
		cancel()
		_ = cmd.Process.Kill()
	}
	waitErr := cmd.Wait()
	cancel()
	stdin.Close()
	calls.Wait()
	if eventError != nil {
		return "", summary, eventError
	}
	if scanner.Err() != nil {
		return "", summary, scanner.Err()
	}
	if waitErr != nil {
		slog.Warn("提取进程退出", "run_id", runID, "stderr", strings.TrimSpace(stderr.String()))
		return "", summary, fmt.Errorf("提取引擎异常退出，请查看运行问题")
	}
	if state == "" {
		return "", summary, fmt.Errorf("提取引擎未报告完成状态")
	}
	return state, summary, nil
}

func (w *Worker) saveEvent(ctx context.Context, taskID, owner, runID string, event map[string]any, trace *extractionTrace) error {
	tx, err := w.service.Services.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	var owned bool
	if err = tx.QueryRow(ctx, "SELECT owner=$2 AND state='running' AND NOT cancel_requested AND lease_until>now() AND ("+taskcontrol.UninterruptedSQL+") FROM tasks t WHERE id=$1 FOR UPDATE", taskID, owner).Scan(&owned); err != nil {
		return err
	}
	if !owned {
		return context.Canceled
	}
	kind, _ := event["event"].(string)
	switch kind {
	case "units":
		units, _ := event["units"].([]any)
		for _, raw := range units {
			u := raw.(map[string]any)
			b, _ := json.Marshal(u)
			if _, err = tx.Exec(ctx, "INSERT INTO extraction_units(run_id,unit_id,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", runID, u["id"], b); err != nil {
				return err
			}
		}
	case "plan":
		if _, err = tx.Exec(ctx, "UPDATE extraction_runs SET config=config||jsonb_build_object('prompt_version',$2::text,'genre',$3::text,'scope',$4::jsonb) WHERE id=$1", runID, event["prompt_version"], event["genre"], mustJSON(event["scope"])); err != nil {
			return err
		}
		blocks, _ := event["blocks"].([]any)
		for _, raw := range blocks {
			b := raw.(map[string]any)
			data, _ := json.Marshal(b)
			if _, err = tx.Exec(ctx, "INSERT INTO extraction_blocks(run_id,block_id,ordinal,state,data) VALUES($1,$2,$3,'queued',$4) ON CONFLICT DO NOTHING", runID, b["id"], b["ordinal"], data); err != nil {
				return err
			}
		}
	case "block_result":
		blockID, _ := event["block_id"].(string)
		result := event["result"].(map[string]any)
		data, _ := json.Marshal(result)
		if _, err = tx.Exec(ctx, "INSERT INTO extraction_blocks(run_id,block_id,ordinal,state,data) VALUES($1,$2,100000,'succeeded',$3) ON CONFLICT(run_id,block_id) DO UPDATE SET state='succeeded',data=excluded.data,error=NULL", runID, blockID, data); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, "DELETE FROM extraction_records WHERE run_id=$1 AND block_id=$2", runID, blockID); err != nil {
			return err
		}
		records, _ := result["records"].([]any)
		for i, raw := range records {
			r := raw.(map[string]any)
			data, _ := json.Marshal(r)
			if _, err = tx.Exec(ctx, "INSERT INTO extraction_records(run_id,id,block_id,ordinal,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id,id) DO UPDATE SET data=excluded.data,block_id=excluded.block_id,ordinal=excluded.ordinal", runID, r["id"], blockID, i, data); err != nil {
				return err
			}
		}
		coverage, _ := result["coverage"].([]any)
		for _, raw := range coverage {
			c := raw.(map[string]any)
			data, _ := json.Marshal(c)
			if _, err = tx.Exec(ctx, "INSERT INTO extraction_coverage(run_id,unit_id,block_id,data) VALUES($1,$2,$3,$4) ON CONFLICT(run_id,unit_id) DO UPDATE SET data=excluded.data,block_id=excluded.block_id", runID, c["unit_id"], blockID, data); err != nil {
				return err
			}
		}
	case "block_error":
		if _, err = tx.Exec(ctx, "UPDATE extraction_blocks SET state='failed',error=$3 WHERE run_id=$1 AND block_id=$2", runID, event["block_id"], event["error"]); err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `INSERT INTO extraction_coverage(run_id,unit_id,block_id,data)
 SELECT $1,u.value,$2,jsonb_build_object('unit_id',u.value,'disposition','needs_review','reason',$3::text)
 FROM extraction_blocks b CROSS JOIN LATERAL jsonb_array_elements_text(b.data->'units') u
 WHERE b.run_id=$1 AND b.block_id=$2
 ON CONFLICT(run_id,unit_id) DO UPDATE SET data=excluded.data,block_id=excluded.block_id`, runID, event["block_id"], event["error"]); err != nil {
			return err
		}
	case "complete":
		records, _ := event["records"].([]any)
		for _, raw := range records {
			r := raw.(map[string]any)
			b, _ := json.Marshal(r)
			if _, err = tx.Exec(ctx, "UPDATE extraction_records SET data=$3 WHERE run_id=$1 AND id=$2", runID, r["id"], b); err != nil {
				return err
			}
		}
	}
	if kind != "units" {
		trace.apply(event, time.Now().UTC())
		if err = tx.QueryRow(ctx, `SELECT
 count(*) FILTER(WHERE block_id NOT LIKE '%:%'),
 count(*) FILTER(WHERE block_id NOT LIKE '%:%' AND state='succeeded'),
 count(*) FILTER(WHERE block_id NOT LIKE '%:%' AND state='failed')
 FROM extraction_blocks WHERE run_id=$1`, runID).Scan(&trace.Progress.TotalBlocks, &trace.Progress.CompletedBlocks, &trace.Progress.FailedBlocks); err != nil {
			return err
		}
		if err = tx.QueryRow(ctx, `SELECT count(*),count(*) FILTER(WHERE data->'validation'->>'status'='needs_review') FROM extraction_records WHERE run_id=$1`, runID).Scan(&trace.Progress.Records, &trace.Progress.NeedsReview); err != nil {
			return err
		}
		trace.counts()
		b := mustJSON(map[string]any{"pipeline": trace.Pipeline, "extraction": trace.Progress})
		if _, err = tx.Exec(ctx, "UPDATE tasks SET stage=$3,checkpoint=checkpoint||$4::jsonb,updated_at=now() WHERE id=$1 AND owner=$2", taskID, owner, trace.Progress.Stage, b); err != nil {
			return err
		}
		// Lightweight SSE event; clients fetch records/progress after notification.
		if _, err = tx.Exec(ctx, "INSERT INTO task_events(task_id,event) VALUES($1,jsonb_build_object('stage',$2::text,'progress',true))", taskID, trace.Progress.Stage); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func mustJSON(value any) []byte { b, _ := json.Marshal(value); return b }

func (s *Service) Export(ctx context.Context, runID string) ([]byte, error) {
	var run map[string]any
	if err := s.Services.DB.QueryRow(ctx, `SELECT jsonb_build_object('运行ID',r.id,'文档',k.name,'文件版本',r.file_version_id,
 '解析版本',r.parse_version_id,'模型',r.config->>'model_name','范围',r.config->'section_ids','生成时间',r.created_at,
 '状态',t.state,'问题',r.summary->'issues','说明','模型提取并经程序校验，请结合原文与待核验标记复核')
 FROM extraction_runs r JOIN knowledge k ON k.id=r.knowledge_id JOIN tasks t ON t.id=r.task_id WHERE r.id=$1`, runID).Scan(&run); err != nil {
		return nil, err
	}
	read := func(query string) ([]map[string]any, error) {
		rows, e := s.Services.DB.Query(ctx, query, runID)
		if e != nil {
			return nil, e
		}
		defer rows.Close()
		values := []map[string]any{}
		for rows.Next() {
			var row map[string]any
			if e = rows.Scan(&row); e != nil {
				return nil, e
			}
			values = append(values, row)
		}
		return values, rows.Err()
	}
	records, err := read("SELECT data FROM extraction_records WHERE run_id=$1 ORDER BY block_id,ordinal,id")
	if err != nil {
		return nil, err
	}
	coverage, err := read("SELECT data FROM extraction_coverage WHERE run_id=$1 ORDER BY unit_id")
	if err != nil {
		return nil, err
	}
	directory, err := os.MkdirTemp("", "nebulaekno-export-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(directory)
	input := filepath.Join(directory, "input.json")
	output := filepath.Join(directory, "clauses.xlsx")
	b, _ := json.Marshal(map[string]any{"run": run, "records": records, "coverage": coverage})
	if err = os.WriteFile(input, b, 0600); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	if err = command(ctx, "export", input, output).Run(); err != nil {
		return nil, fmt.Errorf("Excel 导出失败：%w", err)
	}
	return os.ReadFile(output)
}
