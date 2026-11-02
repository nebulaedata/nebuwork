package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
	"nebulaekno/internal/jobs"
)

func TestFailedRetryKeepsSuccessfulCheckpoints(t *testing.T) {
	cp := map[string]any{
		"parse": "succeeded", "parse_version_id": "original", "embedding": "succeeded", "outline": "skipped",
		"wiki": "failed", "graph": "failed", "wiki_retry_only": true,
		"wiki_batches": jobs.WikiPlan{Version: 1, ParseID: "original", Batches: []jobs.WikiBatch{
			{Index: 0, Status: "succeeded", Attempts: 2, Accepted: []string{"saved-page"}},
			{Index: 1, Status: "failed", Attempts: 3, Accepted: []string{"accepted-before-failure"}, History: []jobs.WikiAttempt{{Number: 1}}},
		}},
		"graph_batches": jobs.GraphPlan{Version: 1, Batches: []jobs.GraphChunk{
			{WikiBatch: jobs.WikiBatch{Status: "succeeded", Attempts: 2}, RecordID: "saved-record", AcceptedEntities: 3},
			{WikiBatch: jobs.WikiBatch{Status: "failed", Attempts: 3}, RecordID: "partial-record", Generated: true, AcceptedEntities: 2},
		}},
	}
	if e := retryFailedCheckpoint(cp); e != nil {
		t.Fatal(e)
	}
	wiki, _ := jobs.LoadWikiPlan(cp["wiki_batches"])
	graph, _ := jobs.LoadGraphPlan(cp["graph_batches"])
	if cp["parse"] != "succeeded" || cp["parse_version_id"] != "original" || cp["embedding"] != "succeeded" || cp["outline"] != "skipped" || cp["wiki_retry_only"] != nil {
		t.Fatal("successful stages were reset", cp)
	}
	if wiki.Batches[0].Status != "succeeded" || wiki.Batches[0].Attempts != 2 || wiki.Batches[1].Status != "pending" || wiki.Batches[1].Attempts != 0 || len(wiki.Batches[1].Accepted) != 1 || len(wiki.Batches[1].History) != 1 {
		t.Fatal("Wiki success or audit lost", wiki)
	}
	if graph.Batches[0].Status != "succeeded" || graph.Batches[0].AcceptedEntities != 3 || graph.Batches[1].Status != "pending" || !graph.Batches[1].Generated || graph.Batches[1].RecordID != "partial-record" || graph.Batches[1].AcceptedEntities != 2 {
		t.Fatal("graph success or partial result lost", graph)
	}
	// A completed stage need not reopen an older/malformed batch ledger.
	cp = map[string]any{"wiki": "succeeded", "wiki_batches": "legacy", "graph": "skipped", "graph_batches": "legacy"}
	if e := retryFailedCheckpoint(cp); e != nil || cp["wiki_batches"] != "legacy" {
		t.Fatal("completed ledger touched", e, cp)
	}
}

func TestKnowledgeFailedRetry(t *testing.T) {
	db := taskTestDatabase(t)
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, e := db.Exec(ctx, query, args...); e != nil {
			t.Fatal(e)
		}
	}
	number := func(query string, args ...any) int {
		t.Helper()
		var n int
		if e := db.QueryRow(ctx, query, args...).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	migration, e := os.ReadFile(filepath.Join("..", "bootstrap", "sql", "016_clause_extraction.sql"))
	if e != nil {
		t.Fatal(e)
	}
	exec(string(migration))
	kb, other := uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO knowledge_bases(id,name) VALUES($1,'Retry library'),($2,'Other library')`, kb, other)
	document := func(library string) string {
		id := uuid.NewString()
		exec(`INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status) VALUES($1,$2,'fixture','txt','partially_failed')`, id, library)
		return id
	}
	add := func(library, doc, kind, state string, cp, cfg any) string {
		id := uuid.NewString()
		checkpoint, _ := json.Marshal(cp)
		frozen, _ := json.Marshal(cfg)
		exec(`INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,state,checkpoint,config,idempotency_key,attempts,error,owner,lease_until) VALUES($1::uuid,nullif($2,'')::uuid,nullif($3,'')::uuid,$4,$5,$6,$7,$1::text,3,'{"message":"fixture"}','expired',now()-interval '1 hour')`, id, library, doc, kind, state, checkpoint, frozen)
		return id
	}
	// More than one page and the old 1000-row ceiling, with no worker/model.
	exec(`INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status) SELECT gen_random_uuid(),$1,'bulk-'||n,'txt','failed' FROM generate_series(1,2005)n`, kb)
	exec(`INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,state,idempotency_key) SELECT gen_random_uuid(),$1,id,'ingest','failed',id::text FROM knowledge WHERE knowledge_base_id=$1`, kb)
	parsed := document(kb)
	file, version := uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO file_versions(id,knowledge_id,hash,path,size,mime_type) VALUES($1::uuid,$2,'hash',$1::text,1,'text/plain')`, file, parsed)
	exec(`INSERT INTO parse_versions(id,knowledge_id,file_version_id,engine,content) VALUES($1,$2,$3,'plain','saved original text')`, version, parsed, file)
	exec(`UPDATE knowledge SET current_file_version_id=$2,current_parse_version_id=$3 WHERE id=$1`, parsed, file, version)
	checkpoint := map[string]any{"parse": "succeeded", "parse_version_id": version, "embedding": "succeeded", "wiki": "failed", "graph": "succeeded", "wiki_batches": jobs.WikiPlan{Version: 1, ParseID: version, Batches: []jobs.WikiBatch{{Status: "succeeded", Accepted: []string{"saved-page"}}, {Status: "failed", Attempts: 3}}}}
	partial := add(kb, parsed, "rebuild", "partially_failed", checkpoint, map[string]any{"partial_rebuild": true})
	// Unrelated states are never requeued, even if cancel_requested is set.
	for _, state := range []string{"succeeded", "cancelled", "queued", "running", "waiting_configuration"} {
		add(kb, document(kb), "ingest", state, map[string]any{}, map[string]any{})
	}
	foreign := add(other, document(other), "ingest", "failed", map[string]any{}, map[string]any{})
	activeDoc := document(kb)
	add(kb, activeDoc, "ingest", "failed", map[string]any{}, map[string]any{})
	add(kb, activeDoc, "rebuild", "waiting_configuration", map[string]any{}, map[string]any{})
	deleting := document(kb)
	exec(`UPDATE knowledge SET config='{"deleting":true}' WHERE id=$1`, deleting)
	add(kb, deleting, "ingest", "failed", map[string]any{}, map[string]any{})
	add(kb, "", "delete_kb", "failed", map[string]any{}, map[string]any{})
	oldDoc := document(kb)
	old := add(kb, oldDoc, "ingest", "failed", map[string]any{}, map[string]any{})
	exec(`UPDATE tasks SET created_at=now()-interval '1 day' WHERE id=$1`, old)
	add(kb, oldDoc, "rebuild", "succeeded", map[string]any{}, map[string]any{})
	add(kb, document(kb), "rebuild", "partially_failed", map[string]any{"parse": "succeeded", "parse_version_id": uuid.NewString()}, map[string]any{})
	add(kb, document(kb), "rebuild", "partially_failed", map[string]any{"wiki": "failed", "wiki_batches": "invalid"}, map[string]any{})
	add(kb, "", "preview", "failed", map[string]any{}, map[string]any{})
	add(kb, document(kb), "ingest", "partially_failed", map[string]any{"parse": "succeeded", "transcription": "failed", "wiki": "succeeded"}, map[string]any{})
	// Extraction retries retain the same frozen run and all stored block rows.
	extractTask := add(kb, parsed, "clause_extraction", "partially_failed", map[string]any{"extraction": map[string]any{"completed_blocks": 1}}, map[string]any{})
	run := uuid.NewString()
	exec(`INSERT INTO extraction_runs(id,task_id,knowledge_id,file_version_id,parse_version_id,config,input,input_hash) VALUES($1,$2,$3,$4,$5,'{}','{}','hash')`, run, extractTask, parsed, file, version)
	exec(`INSERT INTO extraction_blocks(run_id,block_id,ordinal,state,data) VALUES($1,'ok',0,'succeeded','{"saved":true}'),($1,'fail',1,'failed','{}')`, run)
	state := bootstrap.NewState()
	state.Set("ready", true, nil)
	s := New(config.Config{}, state)
	s.Services = &bootstrap.Services{DB: db}
	request := func(method, library, body, key string) (int, map[string]any) {
		r := httptest.NewRequest(method, "/api/v1/knowledge-bases/"+library+"/tasks/retry-failed", strings.NewReader(body))
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		var root map[string]any
		if json.Unmarshal(w.Body.Bytes(), &root) != nil {
			t.Fatal(w.Body.String())
		}
		return w.Code, root
	}
	data := func(root map[string]any) map[string]any { return root["data"].(map[string]any) }
	code, root := request("POST", kb, "{}", "retry-current")
	if code != 202 {
		t.Fatal(code, root)
	}
	result := data(root)
	if result["accepted"] != float64(2007) || result["skipped"] != float64(8) || result["items_truncated"] != true {
		t.Fatal("incomplete submission", result)
	}
	for _, reason := range []string{"TASK_ACTIVE", "DOCUMENT_DELETING", "TASK_TYPE_UNSUPPORTED", "TASK_SUPERSEDED", "STALE_VERSION", "CHECKPOINT_INVALID", "DOCUMENT_UNAVAILABLE", "TRANSCRIPTION_REPARSE_REQUIRED"} {
		if result["reasons"].(map[string]any)[reason] != float64(1) {
			t.Fatal(reason, result)
		}
	}
	if number(`SELECT count(*) FROM outbox`) != 2007 || number(`SELECT count(*) FROM task_events`) != 2007 || number(`SELECT count(*) FROM tasks WHERE id=$1 AND state='failed'`, foreign) != 1 {
		t.Fatal("scope, events or outbox incorrect")
	}
	if number(`SELECT count(*) FROM tasks WHERE id=$1 AND state='queued' AND attempts=0 AND error IS NULL AND owner IS NULL AND lease_until IS NULL`, partial) != 1 || number(`SELECT count(*) FROM tasks WHERE id=$1 AND checkpoint->>'parse_version_id'=$2 AND checkpoint->>'parse'='succeeded' AND checkpoint->>'embedding'='succeeded' AND checkpoint->>'graph'='succeeded' AND checkpoint->'wiki_batches'->'batches'->0->>'status'='succeeded' AND checkpoint->'wiki_batches'->'batches'->1->>'status'='pending'`, partial, version) != 1 {
		t.Fatal("successful checkpoint lost")
	}
	if number(`SELECT count(*) FROM knowledge WHERE id=$1 AND status='partially_failed' AND current_parse_version_id=$2`, parsed, version) != 1 || number(`SELECT count(*) FROM parse_versions WHERE id=$1 AND content='saved original text'`, version) != 1 || number(`SELECT count(*) FROM extraction_blocks WHERE run_id=$1 AND block_id='ok' AND state='succeeded' AND data='{"saved":true}'`, run) != 1 {
		t.Fatal("saved results changed")
	}
	// Replaying an acknowledged request must not pick up a subsequent failure.
	fresh := add(kb, document(kb), "ingest", "failed", map[string]any{}, map[string]any{})
	code, replay := request("POST", kb, "{}", "retry-current")
	if code != 202 || data(replay)["accepted"] != result["accepted"] || number(`SELECT count(*) FROM tasks WHERE id=$1 AND state='failed'`, fresh) != 1 || number(`SELECT count(*) FROM outbox`) != 2007 {
		t.Fatal("receipt replay submitted new work", replay)
	}
	// Independent concurrent requests serialize on document locks.
	var wg sync.WaitGroup
	for _, key := range []string{"concurrent-a", "concurrent-b"} {
		wg.Add(1)
		go func(key string) {
			defer wg.Done()
			c, res := request("POST", kb, "{}", key)
			if c != 202 {
				t.Errorf("concurrent retry: %d %v", c, res)
			}
		}(key)
	}
	wg.Wait()
	if number(`SELECT count(*) FROM outbox`) != 2008 {
		t.Fatal("concurrent duplicate dispatch")
	}
	// Force a late failure and prove the batch and its receipt roll back.
	rollbackTask := add(kb, document(kb), "ingest", "failed", map[string]any{}, map[string]any{})
	exec(`CREATE FUNCTION reject_retry_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture event failure'; END $$; CREATE TRIGGER reject_retry_event BEFORE INSERT ON task_events FOR EACH ROW EXECUTE FUNCTION reject_retry_event()`)
	code, _ = request("POST", kb, "{}", "rollback")
	if code < 500 || number(`SELECT count(*) FROM tasks WHERE id=$1 AND state='failed'`, rollbackTask) != 1 || number(`SELECT count(*) FROM request_keys WHERE key='rollback'`) != 0 {
		t.Fatal("partial retry committed", code)
	}
	if code, _ = request("POST", kb, `{"knowledge_base_id":"`+other+`"}`, "invalid-body"); code != 400 {
		t.Fatal("body changed scope", code)
	}
	if code, _ = request("POST", uuid.NewString(), "{}", "missing"); code != 404 {
		t.Fatal(code)
	}
	empty := uuid.NewString()
	exec(`INSERT INTO knowledge_bases(id,name) VALUES($1,'Empty library')`, empty)
	code, root = request("POST", empty, "{}", "empty")
	if code != 202 || data(root)["accepted"] != float64(0) || data(root)["total"] != float64(0) {
		t.Fatal("empty library", code, root)
	}
}
