package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
)

func TestKnowledgeTaskCancellation(t *testing.T) {
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
	kb, other := uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO knowledge_bases(id,name) VALUES($1,'Current library'),($2,'Other library')`, kb, other)
	queued, waiting, partial, running := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	for i, id := range []string{queued, waiting, partial, running} {
		state := []string{"queued", "waiting_configuration", "ready", "processing"}[i]
		exec(`INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status) VALUES($1,$2,'fixture','docx',$3)`, id, kb, state)
	}
	add := func(library, document, kind, state string, cfg any, requested bool) string {
		t.Helper()
		id := uuid.NewString()
		raw, _ := json.Marshal(cfg)
		exec(`INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,state,config,cancel_requested,idempotency_key) VALUES($1,nullif($2,'')::uuid,nullif($3,'')::uuid,$4,$5,$6,$7,$8)`, id, library, document, kind, state, raw, requested, id)
		return id
	}
	add(kb, queued, "ingest", "queued", map[string]any{}, false)
	add(kb, waiting, "rebuild", "waiting_configuration", map[string]any{}, false)
	add(kb, partial, "rebuild", "queued", map[string]any{"partial_rebuild": true}, false)
	fullRunning := add(kb, running, "ingest", "running", map[string]any{}, false)
	add(kb, partial, "clause_extraction", "running", map[string]any{}, false)
	add(kb, "", "preview", "running", map[string]any{}, true)
	add("", "", "delete_knowledge", "queued", map[string]any{"knowledge_base_id": kb}, false)
	for _, state := range []string{"succeeded", "failed", "partially_failed", "cancelled"} {
		add(kb, "", "rebuild", state, map[string]any{}, false)
	}
	otherTask := add(other, "", "extract_archive", "queued", map[string]any{}, false)
	exec(`INSERT INTO tasks(id,knowledge_base_id,type,idempotency_key) SELECT id,$1,'preview',id::text FROM (SELECT gen_random_uuid() AS id FROM generate_series(1,2005)) n`, kb)
	state := bootstrap.NewState()
	state.Set("ready", true, nil)
	server := New(config.Config{}, state)
	server.Services = &bootstrap.Services{DB: db}
	request := func(method, path, body, key string) (int, map[string]any) {
		r := httptest.NewRequest(method, "/api/v1/knowledge-bases/"+path, strings.NewReader(body))
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		server.ServeHTTP(w, r)
		var root map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &root)
		return w.Code, root
	}
	data := func(root map[string]any) map[string]any { v, _ := root["data"].(map[string]any); return v }
	code, root := request("GET", kb+"/tasks/stats", "", "")
	stats := data(root)
	if code != 200 || stats["queued"] != float64(2008) || stats["running"] != float64(2) || stats["stopping"] != float64(1) || stats["waiting_configuration"] != float64(1) {
		t.Fatal(code, root)
	}
	code, root = request("GET", kb+"/tasks?page_size=20&page=2", "", "")
	if code != 200 || len(root["data"].([]any)) != 20 || root["meta"].(map[string]any)["total"] != float64(2016) {
		t.Fatal("scoped pagination", code, root)
	}
	code, root = request("POST", kb+"/tasks/cancel", "{}", "stop-current")
	result := data(root)
	if code != 202 || result["cancelled"] != float64(2009) || result["stop_requested"] != float64(2) || result["stopping"] != float64(3) || result["document_status_pending"] != false {
		t.Fatal(code, root)
	}
	if number(`SELECT count(*) FROM tasks WHERE knowledge_base_id=$1 AND state IN ('queued','waiting_configuration')`, kb) != 0 || number(`SELECT count(*) FROM tasks WHERE knowledge_base_id=$1 AND state='running' AND cancel_requested`, kb) != 3 {
		t.Fatal("tasks escaped cancellation")
	}
	if number(`SELECT count(*) FROM knowledge WHERE id=ANY($1::uuid[]) AND status='cancelled'`, []string{queued, waiting}) != 2 || number(`SELECT count(*) FROM knowledge WHERE id=$1 AND status='ready'`, partial) != 1 || number(`SELECT count(*) FROM knowledge WHERE id=$1 AND status='processing'`, running) != 1 {
		t.Fatal("document statuses invalid")
	}
	if number(`SELECT count(*) FROM tasks WHERE id=$1 AND state='queued' AND NOT cancel_requested`, otherTask) != 1 || number(`SELECT count(*) FROM tasks WHERE knowledge_base_id=$1 AND state IN ('succeeded','failed','partially_failed')`, kb) != 3 {
		t.Fatal("other library or history changed")
	}
	if number(`SELECT count(*) FROM task_events`) != 2011 {
		t.Fatal("missing cancellation events")
	}
	fresh := add(kb, queued, "rebuild", "queued", map[string]any{}, false)
	exec(`UPDATE knowledge SET status='queued' WHERE id=$1`, queued)
	code, root = request("POST", kb+"/tasks/cancel", "{}", "stop-current")
	if code != 202 || number(`SELECT count(*) FROM tasks WHERE id=$1 AND state='queued' AND NOT cancel_requested`, fresh) != 1 || number(`SELECT count(*) FROM knowledge WHERE id=$1 AND status='queued'`, queued) != 1 || number(`SELECT count(*) FROM task_events`) != 2011 {
		t.Fatal("replay affected newer work", code, root)
	}
	code, root = request("POST", kb+"/tasks/cancel", "{}", "stop-new")
	if code != 202 || data(root)["cancelled"] != float64(1) || data(root)["stop_requested"] != float64(0) {
		t.Fatal(code, root)
	}
	if code, _ = request("POST", kb+"/tasks/cancel", `{"knowledge_base_id":"`+other+`"}`, "wrong-scope"); code != 400 {
		t.Fatal("body changed target scope", code)
	}
	if code, _ = request("POST", uuid.NewString()+"/tasks/cancel", "{}", "missing"); code != 404 {
		t.Fatal("missing library accepted", code)
	}
	if code, _ = request("POST", "invalid/tasks/cancel", "{}", "invalid"); code != 400 {
		t.Fatal("invalid library accepted", code)
	}
	// Workers keep running tasks in that state until they have actually stopped.
	exec(`UPDATE tasks SET state='cancelled',owner=NULL,lease_until=NULL WHERE knowledge_base_id=$1 AND cancel_requested AND state='running'`, kb)
	code, root = request("GET", kb+"/tasks/stats", "", "")
	if code != 200 || data(root)["active"] != float64(0) || data(root)["stopping"] != float64(0) {
		t.Fatal(code, root)
	}
	if number(`SELECT count(*) FROM tasks WHERE id=$1 AND state='cancelled'`, fullRunning) != 1 {
		t.Fatal("running task disappeared")
	}

	// An archive can commit a child just before its parent ownership lock is
	// released. The second cancellation statement must include that child.
	archiveKB := uuid.NewString()
	exec(`INSERT INTO knowledge_bases(id,name) VALUES($1,'Archive race')`, archiveKB)
	parent := add(archiveKB, "", "extract_archive", "running", map[string]any{}, false)
	tx, e := db.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, `SELECT id FROM tasks WHERE id=$1 FOR UPDATE`, parent); e != nil {
		t.Fatal(e)
	}
	type response struct {
		code int
		root map[string]any
	}
	done := make(chan response, 1)
	go func() {
		c, r := request("POST", archiveKB+"/tasks/cancel", "{}", "archive-race")
		done <- response{c, r}
	}()
	deadline := time.Now().Add(3 * time.Second)
	for number(`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'UPDATE tasks t SET cancel_requested%'`) == 0 {
		if time.Now().After(deadline) {
			t.Fatal("cancel did not wait for archive ownership lock")
		}
		time.Sleep(5 * time.Millisecond)
	}
	child := uuid.NewString()
	if _, e = tx.Exec(ctx, `INSERT INTO tasks(id,knowledge_base_id,type,idempotency_key) VALUES($1,$2,'ingest',$3)`, child, archiveKB, child); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	reply := <-done
	if reply.code != 202 || data(reply.root)["cancelled"] != float64(1) || data(reply.root)["stop_requested"] != float64(1) || number(`SELECT count(*) FROM tasks WHERE id=$1 AND state='cancelled'`, child) != 1 {
		t.Fatal("archive child escaped", reply)
	}

	rollbackKB := uuid.NewString()
	exec(`INSERT INTO knowledge_bases(id,name) VALUES($1,'Rollback fixture')`, rollbackKB)
	rollbackTask := add(rollbackKB, "", "preview", "queued", map[string]any{}, false)
	exec(`CREATE FUNCTION reject_cancel_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.task_id='` + rollbackTask + `'::uuid THEN RAISE EXCEPTION 'fixture event failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_cancel_event BEFORE INSERT ON task_events FOR EACH ROW EXECUTE FUNCTION reject_cancel_event()`)
	if code, _ = request("POST", rollbackKB+"/tasks/cancel", "{}", "rollback"); code != 503 || number(`SELECT count(*) FROM tasks WHERE id=$1 AND state='queued' AND NOT cancel_requested`, rollbackTask) != 1 || number(`SELECT count(*) FROM request_keys WHERE scope=$1`, "kb-cancel-tasks:"+rollbackKB) != 0 {
		t.Fatal("cancellation was not atomic", code)
	}
}
