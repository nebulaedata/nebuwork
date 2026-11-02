package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
	"nebulaekno/internal/taskcontrol"
)

func TestKnowledgeTaskPauseResume(t *testing.T) {
	db := taskTestDatabase(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := db.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	number := func(sql string, args ...any) int {
		t.Helper()
		var n int
		if e := db.QueryRow(ctx, sql, args...).Scan(&n); e != nil {
			t.Fatal(e)
		}
		return n
	}
	for _, file := range []string{"010_upload_sources.sql", "018_document_processing.sql"} {
		raw, e := os.ReadFile(filepath.Join("..", "bootstrap", "sql", file))
		if e != nil {
			t.Fatal(e)
		}
		exec(string(raw))
	}
	kb, other := uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO knowledge_bases(id,name) VALUES($1,'Current'),($2,'Other')`, kb, other)
	exec(`INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status) SELECT gen_random_uuid(),$1,'queued-'||n,'txt','queued' FROM generate_series(1,2005)n`, kb)
	exec(`INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,state,idempotency_key,checkpoint) SELECT gen_random_uuid(),$1,id,'ingest','queued',id::text,'{"keep":"saved-result"}' FROM knowledge WHERE knowledge_base_id=$1`, kb)
	doc, running, extraction, foreign, fallback := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status) VALUES($1,$2,'running','txt','processing')`, doc, kb)
	exec(`INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,state,stage,idempotency_key,checkpoint,attempts,owner,lease_until) VALUES($1::uuid,$2,$3,'rebuild','running','wiki',$1::text,'{"parse":"succeeded","embedding":"succeeded","wiki":"running"}',2,'worker',now()+interval '1 hour')`, running, kb, doc)
	exec(`INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,state,idempotency_key,owner,lease_until) VALUES($1::uuid,$2,$3,'clause_extraction','running',$1::text,'extractor',now()+interval '1 hour')`, extraction, kb, doc)
	exec(`INSERT INTO tasks(id,knowledge_base_id,type,idempotency_key) VALUES($1::uuid,$2,'ingest',$1::text)`, foreign, other)
	exec(`INSERT INTO tasks(id,type,idempotency_key,config) VALUES($1::uuid,'delete_knowledge',$1::text,jsonb_build_object('knowledge_base_id',$2::text))`, fallback, kb)
	for _, state := range []string{"failed", "partially_failed", "cancelled", "waiting_configuration", "succeeded"} {
		exec(`INSERT INTO tasks(id,knowledge_base_id,type,state,idempotency_key) VALUES(gen_random_uuid(),$1,'ingest',$2,$2)`, kb, state)
	}
	state := bootstrap.NewState()
	state.Set("ready", true, nil)
	s := New(config.Config{}, state)
	s.Services = &bootstrap.Services{DB: db}
	request := func(method, path, body, key string) (int, map[string]any) {
		r := httptest.NewRequest(method, "/api/v1/"+path, strings.NewReader(body))
		r.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		var root map[string]any
		if e := json.Unmarshal(w.Body.Bytes(), &root); e != nil {
			t.Fatal(w.Body.String())
		}
		return w.Code, root
	}
	root := "knowledge-bases/" + kb
	data := func(v map[string]any) map[string]any { return v["data"].(map[string]any) }
	code, res := request("POST", root+"/tasks/pause", "{}", "pause-a")
	if code != 202 || data(res)["paused"] != true || data(res)["pause_generation"] != float64(1) {
		t.Fatal(code, res)
	}
	code, res = request("GET", root+"/tasks/stats", "", "")
	if code != 200 || data(res)["library_paused"] != true || data(res)["paused"] != float64(2006) || data(res)["pausing"] != float64(2) {
		t.Fatal(code, res)
	}
	if number(`SELECT count(*) FROM tasks WHERE knowledge_base_id=$1 AND type='ingest' AND state='queued' AND checkpoint='{"keep":"saved-result"}'`, kb) != 2005 || number(`SELECT count(*) FROM tasks WHERE id=$1 AND state='running' AND attempts=2 AND owner='worker' AND checkpoint->>'embedding'='succeeded'`, running) != 1 {
		t.Fatal("pause rewrote task progress")
	}
	code, res = request("GET", root+"/tasks?state=paused&page=2&page_size=20", "", "")
	if code != 200 || res["meta"].(map[string]any)["total"] != float64(2006) || len(res["data"].([]any)) != 20 {
		t.Fatal(code, res)
	}
	code, res = request("GET", "tasks/"+extraction, "", "")
	if code != 200 || data(res)["state"] != "pausing" || data(res)["stored_state"] != "running" {
		t.Fatal(code, res)
	}
	code, res = request("GET", root+"/processing", "", "")
	if code != 200 || data(res)["counts"].(map[string]any)["paused"] != float64(2005) || data(res)["counts"].(map[string]any)["pausing"] != float64(1) {
		t.Fatal(code, res)
	}
	code, res = request("GET", root+"/knowledge?status=paused&page_size=1", "", "")
	if code != 200 || res["meta"].(map[string]any)["total"] != float64(2005) {
		t.Fatal(code, res)
	}
	// Both consumers use this claim guard, even for stale Redis messages and
	// tasks created after the pause. Other libraries remain runnable.
	fresh := uuid.NewString()
	exec(`INSERT INTO tasks(id,knowledge_base_id,type,idempotency_key) VALUES($1::uuid,$2,'ingest',$1::text)`, fresh, kb)
	tx, e := db.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = taskcontrol.Claim(ctx, tx, fresh); !errors.Is(e, taskcontrol.ErrPaused) {
		t.Fatal("new task escaped pause", e)
	}
	_ = tx.Rollback(ctx)
	tx, e = db.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = taskcontrol.Claim(ctx, tx, foreign); e != nil {
		t.Fatal("other library blocked", e)
	}
	_ = tx.Rollback(ctx)
	request("POST", root+"/tasks/pause", "{}", "pause-again")
	if number(`SELECT tasks_pause_generation FROM knowledge_bases WHERE id=$1`, kb) != 1 {
		t.Fatal("duplicate pause advanced generation")
	}
	code, res = request("POST", root+"/tasks/resume", "{}", "resume-a")
	if code != 202 || data(res)["paused"] != false {
		t.Fatal(code, res)
	}
	// Fast resume cannot revive a lease belonging to the previous generation.
	if number(`SELECT count(*) FROM tasks t WHERE id=$1 AND (`+taskcontrol.UninterruptedSQL+`)`, running) != 0 {
		t.Fatal("old lease revived after resume")
	}
	code, res = request("POST", root+"/tasks/pause", "{}", "pause-a")
	if code != 202 || data(res)["paused"] != true || number(`SELECT count(*) FROM knowledge_bases WHERE id=$1 AND tasks_paused`, kb) != 0 {
		t.Fatal("receipt replay paused the library again")
	}
	tx, e = db.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	generation, e := taskcontrol.Claim(ctx, tx, fresh)
	if e != nil || generation != 1 {
		t.Fatal(generation, e)
	}
	_ = tx.Rollback(ctx)
	if number(`SELECT count(*) FROM tasks WHERE knowledge_base_id=$1 AND state IN ('failed','partially_failed','cancelled','waiting_configuration','succeeded')`, kb) != 5 {
		t.Fatal("resume retried terminal or unconfigured tasks")
	}
	// Starting twice with the same receipt cannot undo a later pause.
	request("POST", root+"/tasks/pause", "{}", "pause-b")
	request("POST", root+"/tasks/resume", "{}", "resume-a")
	if number(`SELECT count(*) FROM knowledge_bases WHERE id=$1 AND tasks_paused AND tasks_pause_generation=2`, kb) != 1 {
		t.Fatal("resume replay changed later control state")
	}
	// A receipt failure must roll the library flag back with the operation.
	exec(`CREATE FUNCTION reject_control_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture receipt failure'; END $$; CREATE TRIGGER reject_control_receipt BEFORE INSERT ON request_keys FOR EACH ROW EXECUTE FUNCTION reject_control_receipt()`)
	code, _ = request("POST", root+"/tasks/resume", "{}", "rollback")
	if code < 500 || number(`SELECT count(*) FROM knowledge_bases WHERE id=$1 AND tasks_paused`, kb) != 1 {
		t.Fatal("control partially committed", code)
	}
	if code, _ = request("POST", root+"/tasks/pause", `{"knowledge_base_id":"`+other+`"}`, "wrong-body"); code != 400 {
		t.Fatal("body changed scope", code)
	}
}
