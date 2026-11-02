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
	"github.com/jackc/pgx/v5/pgxpool"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
)

func TestRebuildValidation(t *testing.T) {
	for _, body := range []string{`{"mode":"invalid"}`, `{"mode":"reparse","stages":["wiki"]}`, `{"stages":["parse"]}`, `{"stages":["preview","wiki"]}`, `{"knowledge_ids":["invalid"]}`} {
		var in rebuildInput
		if json.Unmarshal([]byte(body), &in) != nil || in.validate() == nil {
			t.Fatal("invalid rebuild accepted", body)
		}
	}
}

func TestRebuildPlans(t *testing.T) {
	file, parsed := uuid.NewString(), uuid.NewString()
	library := map[string]any{"wiki_enabled": false, "graph_enabled": false, "image_caption": false, "image_embedding": false, "outline_enabled": false, "parser_engines": map[string]any{"pdf": "pdf-engine", "docx": "old"}}
	doc := rebuildDocument{id: uuid.NewString(), ext: "docx", file: &file, parse: &parsed, config: map[string]any{"parser_engines": map[string]any{"docx": "new"}}}
	kind, cfg, checkpoint, reason := rebuildPlan(rebuildInput{Mode: "reparse"}, doc, library)
	if kind != "rebuild" || reason != "" || len(checkpoint) != 0 || cfg["partial_rebuild"] != false {
		t.Fatal(kind, cfg, checkpoint, reason)
	}
	engines := cfg["parser_engines"].(map[string]any)
	if engines["pdf"] != "pdf-engine" || engines["docx"] != "new" {
		t.Fatal("configuration overrides lost", engines)
	}
	_, cfg, checkpoint, reason = rebuildPlan(rebuildInput{Mode: "stages", Stages: rebuildStages}, doc, library)
	if reason != "" || checkpoint["parse_version_id"] != parsed || checkpoint["parse"] != "succeeded" || cfg["partial_rebuild"] != true {
		t.Fatal(cfg, checkpoint, reason)
	}
	for _, flag := range []string{"wiki_enabled", "graph_enabled", "image_caption", "image_embedding", "outline_enabled"} {
		if cfg[flag] != true || library[flag] != false {
			t.Fatal("stage override or frozen settings invalid", flag)
		}
	}
	doc.parse = nil
	_, _, _, reason = rebuildPlan(rebuildInput{Mode: "stages", Stages: []string{"wiki"}}, doc, library)
	if reason != "PARSE_NOT_READY" {
		t.Fatal(reason)
	}
	_, _, _, reason = rebuildPlan(rebuildInput{Mode: "reparse"}, doc, library)
	if reason != "" {
		t.Fatal("full reparse must accept unparsed files", reason)
	}
	doc.parse = &parsed
	kind, _, _, reason = rebuildPlan(rebuildInput{Mode: "stages", Stages: []string{"preview"}}, doc, library)
	if kind != "preview" || reason != "" {
		t.Fatal(kind, reason)
	}
	doc.ext = "zip"
	_, _, _, reason = rebuildPlan(rebuildInput{Mode: "reparse"}, doc, library)
	if reason != "ARCHIVE_TASK_REQUIRED" {
		t.Fatal(reason)
	}
}

// This opt-in suite uses an isolated schema and the real core migration. No
// worker runs here: the suite verifies durable task submission, never models.
func taskTestDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("NEBULAEKNO_REBUILD_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires isolated rebuild test database")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	schema := "rebuild_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS vector; CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") })
	pc, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	pc.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	db, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	core, err := os.ReadFile(filepath.Join("..", "bootstrap", "sql", "001_core.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, string(core)); err != nil {
		t.Fatal(err)
	}
	pause, err := os.ReadFile(filepath.Join("..", "bootstrap", "sql", "019_knowledge_task_pause.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(ctx, string(pause)); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestRebuildDatabase(t *testing.T) {
	db := taskTestDatabase(t)
	ctx := context.Background()
	var err error
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
	seed := func(n int) string {
		t.Helper()
		kb := uuid.NewString()
		exec(`INSERT INTO knowledge_bases(id,name,config) VALUES($1,'Rebuild fixture','{"wiki_enabled":false,"graph_enabled":false,"parser_engines":{"pdf":"pdf-engine","docx":"old"}}')`, kb)
		exec(`INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status,current_file_version_id,current_parse_version_id,config) SELECT gen_random_uuid(),$1,'doc-'||lpad(i::text,5,'0'),'docx','ready',gen_random_uuid(),CASE WHEN i=2 THEN NULL ELSE gen_random_uuid() END,'{"parser_engines":{"docx":"new"}}'::jsonb FROM generate_series(1,$2::int) i`, kb, n)
		exec(`INSERT INTO file_versions(id,knowledge_id,hash,path,size,mime_type) SELECT current_file_version_id,id,'fixture','/fixture/'||id,12,'application/octet-stream' FROM knowledge WHERE knowledge_base_id=$1`, kb)
		exec(`INSERT INTO parse_versions(id,knowledge_id,file_version_id,engine,content) SELECT current_parse_version_id,id,current_file_version_id,'fixture','fixture' FROM knowledge WHERE knowledge_base_id=$1 AND current_parse_version_id IS NOT NULL`, kb)
		return kb
	}
	state := bootstrap.NewState()
	state.Set("ready", true, nil)
	server := New(config.Config{}, state)
	server.Services = &bootstrap.Services{DB: db}
	request := func(kb, key, body string) (int, map[string]any) {
		req := httptest.NewRequest("POST", "/api/v1/knowledge-bases/"+kb+"/rebuild", strings.NewReader(body))
		req.Header.Set("Idempotency-Key", key)
		w := httptest.NewRecorder()
		server.ServeHTTP(w, req)
		var response struct {
			Data map[string]any `json:"data"`
		}
		_ = json.Unmarshal(w.Body.Bytes(), &response)
		return w.Code, response.Data
	}
	kb := seed(10005)
	var busy, unparsed, ready string
	if err = db.QueryRow(ctx, `SELECT id::text FROM knowledge WHERE knowledge_base_id=$1 AND name='doc-00001'`, kb).Scan(&busy); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(ctx, `SELECT id::text FROM knowledge WHERE knowledge_base_id=$1 AND name='doc-00002'`, kb).Scan(&unparsed); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(ctx, `SELECT id::text FROM knowledge WHERE knowledge_base_id=$1 AND name='doc-00003'`, kb).Scan(&ready); err != nil {
		t.Fatal(err)
	}
	activeTask, waitingTask := uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,state,idempotency_key) VALUES($1,$2,$3,'ingest','running',$6),($4,$2,$5,'ingest','waiting_configuration',$7)`, activeTask, kb, busy, waitingTask, ready, activeTask, waitingTask)
	code, result := request(kb, "all-files", `{"mode":"reparse"}`)
	if code != 202 || result["total"] != float64(10005) || result["accepted"] != float64(10004) || result["skipped"] != float64(1) || result["truncated"] != false {
		t.Fatal(code, result)
	}
	if number(`SELECT count(*) FROM tasks WHERE knowledge_base_id=$1 AND config->>'rebuild_batch_id'='all-files'`, kb) != 10004 || number(`SELECT count(*) FROM outbox`) != 10004 {
		t.Fatal("full library/outbox truncated")
	}
	if number(`SELECT count(*) FROM tasks WHERE id=$1 AND state='cancelled'`, waitingTask) != 1 {
		t.Fatal("old waiting task not superseded")
	}
	if number(`SELECT count(*) FROM tasks WHERE knowledge_id=$1 AND config->'parser_engines'->>'docx'='new' AND config->'parser_engines'->>'pdf'='pdf-engine' AND checkpoint='{}'`, unparsed) != 1 {
		t.Fatal("unparsed document or nested overrides lost")
	}
	exec(`UPDATE tasks SET state='succeeded' WHERE knowledge_base_id=$1 AND config->>'rebuild_batch_id'='all-files'`, kb)
	code, replay := request(kb, "all-files", `{"mode":"reparse"}`)
	if code != 202 || replay["accepted"] != float64(10004) || number(`SELECT count(*) FROM tasks WHERE knowledge_base_id=$1`, kb) != 10006 {
		t.Fatal("replay created new tasks", code, replay)
	}
	if code, _ = request(kb, "all-files", `{"stages":["wiki"]}`); code != 409 {
		t.Fatal("different request reused key", code)
	}
	body, _ := json.Marshal(map[string]any{"knowledge_ids": []string{busy, unparsed, ready}, "stages": []string{"wiki", "graph"}})
	code, result = request(kb, "partial", string(body))
	if code != 202 || result["accepted"] != float64(1) || result["skipped"] != float64(2) {
		t.Fatal("partial rebuild eligibility", code, result)
	}
	if number(`SELECT count(*) FROM tasks WHERE config->>'rebuild_batch_id'='partial' AND config->>'wiki_enabled'='true' AND config->>'graph_enabled'='true' AND checkpoint->>'parse'='succeeded' AND checkpoint->>'embedding'='skipped' AND NOT checkpoint ? 'wiki' AND NOT checkpoint ? 'graph'`) != 1 {
		t.Fatal("partial stages/configuration invalid")
	}
	foreign := seed(1)
	body, _ = json.Marshal(map[string]any{"knowledge_ids": []string{ready}, "mode": "reparse"})
	if code, _ = request(foreign, "cross-library", string(body)); code != 404 {
		t.Fatal("cross-library document accepted", code)
	}

	concurrent := seed(30)
	var wg sync.WaitGroup
	codes, accepted := make([]int, 2), make([]float64, 2)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			status, value := request(concurrent, uuid.NewString(), `{"mode":"reparse"}`)
			codes[i] = status
			if value != nil {
				accepted[i], _ = value["accepted"].(float64)
			}
		}(i)
	}
	wg.Wait()
	if codes[0] != 202 || codes[1] != 202 || accepted[0]+accepted[1] != 30 || number(`SELECT count(*) FROM tasks WHERE knowledge_base_id=$1`, concurrent) != 30 {
		t.Fatal("concurrent submissions duplicated work", codes, accepted)
	}

	rollback := seed(2)
	exec(`CREATE FUNCTION reject_rebuild_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.knowledge_base_id='` + rollback + `'::uuid THEN RAISE EXCEPTION 'fixture insert failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_rebuild_test BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION reject_rebuild_test()`)
	if code, _ = request(rollback, "rollback", `{"mode":"reparse"}`); code != 503 || number(`SELECT count(*) FROM tasks WHERE knowledge_base_id=$1`, rollback) != 0 || number(`SELECT count(*) FROM request_keys WHERE scope=$1`, "kb-rebuild:"+rollback) != 0 {
		t.Fatal("submission was not atomic", code)
	}
}
