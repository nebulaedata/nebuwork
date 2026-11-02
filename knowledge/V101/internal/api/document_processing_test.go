package api

import (
	"context"
	"encoding/json"
	"math"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
)

func TestDocumentProcessingSummaryAndFilters(t *testing.T) {
	db := taskTestDatabase(t)
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, e := db.Exec(ctx, query, args...); e != nil {
			t.Fatal(e)
		}
	}
	for _, file := range []string{"010_upload_sources.sql", "018_document_processing.sql"} {
		sql, e := os.ReadFile(filepath.Join("..", "bootstrap", "sql", file))
		if e != nil {
			t.Fatal(e)
		}
		exec(string(sql))
	}
	kb, other := uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO knowledge_bases(id,name) VALUES($1,'Progress fixture'),($2,'Other library')`, kb, other)
	exec(`INSERT INTO knowledge(id,knowledge_base_id,name,relative_path,file_type,status) SELECT gen_random_uuid(),$1,'queued-'||i,'bulk/'||i,'docx','queued' FROM generate_series(1,2005) i`, kb)
	exec(`INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status) VALUES($1,$2,'foreign-file','docx','processing')`, uuid.NewString(), other)
	type fixture struct {
		name, state, effective, kind, taskState, stage string
		parsed, partial, stopping                      bool
	}
	cases := []fixture{
		{"queued-parsed", "queued", "queued", "rebuild", "queued", "pending", true, false, false},
		{"parse-running", "processing", "processing", "ingest", "running", "parse", true, false, false},
		{"graph-running", "processing", "processing", "rebuild", "running", "graph", true, false, false},
		{"complete", "succeeded", "succeeded", "ingest", "succeeded", "graph", true, false, false},
		{"legacy-ready", "ready", "succeeded", "", "", "", true, false, false},
		{"partial-running", "succeeded", "processing", "rebuild", "running", "graph", true, true, false},
		{"partial-failed", "succeeded", "partially_failed", "rebuild", "failed", "graph", true, true, false},
		{"waiting", "waiting_configuration", "waiting_configuration", "ingest", "waiting_configuration", "embedding", true, false, false},
		{"cancelled", "cancelled", "cancelled", "ingest", "cancelled", "parse", false, false, false},
		{"failed", "failed", "failed", "ingest", "failed", "parse", false, false, false},
		{"stored", "stored", "stored", "", "", "", false, false, false},
		{"archive", "extracted", "extracted", "extract_archive", "succeeded", "extract_archive", false, false, false},
		{"clause-independent", "succeeded", "succeeded", "clause_extraction", "running", "extraction_blocks", true, false, false},
		{"stale-partial", "succeeded", "succeeded", "rebuild", "failed", "graph", true, true, false},
		{"preview-only-success", "failed", "failed", "preview", "succeeded", "preview", true, true, false},
		{"full-partial-failure", "partially_failed", "partially_failed", "ingest", "partially_failed", "graph", true, false, false},
		{"stopping", "processing", "stopping", "ingest", "running", "parse", true, false, true},
	}
	expected := map[string]int{"queued": 2005}
	ids := map[string]string{}
	parsedCount, eligible := 0, 2005
	for _, f := range cases {
		id := uuid.NewString()
		ids[f.name] = id
		var parse *string
		if f.parsed {
			p := uuid.NewString()
			parse = &p
		}
		ext := "docx"
		if f.name == "archive" {
			ext = "zip"
		}
		if f.name == "stored" {
			ext = "bin"
		}
		exec(`INSERT INTO knowledge(id,knowledge_base_id,name,relative_path,file_type,status,current_parse_version_id) VALUES($1,$2,$3,$4,$5,$6,$7::uuid)`, id, kb, f.name, "fixture/"+f.name, ext, f.state, parse)
		expected[f.effective]++
		if ext != "zip" && f.state != "stored" {
			eligible++
			if f.parsed {
				parsedCount++
			}
		}
		if f.kind != "" {
			cfg := map[string]any{"partial_rebuild": f.partial}
			cp := map[string]any{}
			if parse != nil {
				cp["parse_version_id"] = *parse
			}
			if f.name == "stale-partial" {
				cp["parse_version_id"] = uuid.NewString()
			}
			cp["pipeline"] = map[string]any{"stages": []any{map[string]any{"name": f.stage, "status": f.taskState, "children": []any{map[string]any{"name": "extract_graph", "status": f.taskState, "progress": map[string]any{"completed": 58, "total": 82, "batches": 82, "batch": 64, "unit": "chunk"}}}}}}
			cp["graph_batches"] = map[string]any{"private_fixture": "do-not-return-full-checkpoints"}
			cfgJSON, _ := json.Marshal(cfg)
			cpJSON, _ := json.Marshal(cp)
			task := uuid.NewString()
			exec(`INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,state,stage,config,checkpoint,cancel_requested,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, task, kb, id, f.kind, f.taskState, f.stage, cfgJSON, cpJSON, f.stopping, task)
		}
	}
	state := bootstrap.NewState()
	state.Set("ready", true, nil)
	server := New(config.Config{}, state)
	server.Services = &bootstrap.Services{DB: db}
	request := func(path string) (int, map[string]any, string) {
		w := httptest.NewRecorder()
		server.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/knowledge-bases/"+path, nil))
		var root map[string]any
		_ = json.Unmarshal(w.Body.Bytes(), &root)
		return w.Code, root, w.Body.String()
	}
	code, root, _ := request(kb + "/processing")
	summary, _ := root["data"].(map[string]any)
	total := 2005 + len(cases)
	if code != 200 || summary["total_documents"] != float64(total) || summary["processable_documents"] != float64(eligible) || summary["parsed_documents"] != float64(parsedCount) || summary["excluded_documents"] != float64(2) {
		t.Fatal(code, root)
	}
	counts := summary["counts"].(map[string]any)
	for status, count := range expected {
		if counts[status] != float64(count) {
			t.Fatal("wrong current-document count", status, count, counts)
		}
	}
	percentage := math.Round(float64(expected["succeeded"])*10000/float64(eligible)) / 100
	if summary["completed_documents"] != float64(expected["succeeded"]) || summary["completion_percent"] != percentage || summary["parsing_documents"] != float64(1) {
		t.Fatal("completion mixed with parsing or stopping", summary)
	}
	if summary["parse_availability_percent"] != math.Round(float64(parsedCount)*10000/float64(eligible))/100 {
		t.Fatal("incorrect parse availability", summary)
	}
	if summary["running_stages"].(map[string]any)["graph"] != float64(2) {
		t.Fatal("running stages lost", summary)
	}
	for status, count := range expected {
		code, root, _ = request(kb + "/knowledge?status=" + status + "&page_size=100")
		if code != 200 || root["meta"].(map[string]any)["total"] != float64(count) {
			t.Fatal("status total did not cover whole library", status, code, root)
		}
		for _, raw := range root["data"].([]any) {
			if raw.(map[string]any)["processing_status"] != status {
				t.Fatal("mixed statuses in filtered page", status, raw)
			}
		}
	}
	code, root, _ = request(kb + "/knowledge?status=queued&page=2&page_size=20")
	if code != 200 || len(root["data"].([]any)) != 20 || root["meta"].(map[string]any)["total"] != float64(2006) {
		t.Fatal("filtered pagination truncated", code, root)
	}
	code, root, _ = request(kb + "/knowledge?status=parsing")
	if code != 200 || root["meta"].(map[string]any)["total"] != float64(1) || root["data"].([]any)[0].(map[string]any)["id"] != ids["parse-running"] {
		t.Fatal("parsing filter included graph or stopping", code, root)
	}
	code, root, _ = request(kb + "/knowledge?status=processing&parse_status=parsed&q=partial")
	if code != 200 || root["meta"].(map[string]any)["total"] != float64(1) || root["data"].([]any)[0].(map[string]any)["id"] != ids["partial-running"] {
		t.Fatal("combined filters failed", code, root)
	}
	code, root, _ = request(kb + "/knowledge?parse_status=parsed")
	if code != 200 || root["meta"].(map[string]any)["total"] != float64(parsedCount) {
		t.Fatal("parse availability is not whole-pipeline completion", code, root)
	}
	code, root, raw := request(kb + "/knowledge?q=graph-running")
	if code != 200 || strings.Contains(raw, "do-not-return-full-checkpoints") {
		t.Fatal("full checkpoint leaked into list", code, raw)
	}
	graph := root["data"].([]any)[0].(map[string]any)["processing_task"].(map[string]any)
	if graph["stage"] != "graph" || graph["checkpoint"].(map[string]any)["pipeline"] == nil {
		t.Fatal("current progress missing", graph)
	}
	code, root, _ = request(kb + "/knowledge?q=stale-partial")
	if code != 200 || root["data"].([]any)[0].(map[string]any)["processing_task"] != nil {
		t.Fatal("superseded parse task selected", code, root)
	}
	code, root, _ = request(kb + "/knowledge?q=foreign-file")
	if code != 200 || root["meta"].(map[string]any)["total"] != float64(0) {
		t.Fatal("cross-library search leaked documents", code, root)
	}
	for _, path := range []string{kb + "/knowledge?status=invalid", kb + "/knowledge?parse_status=invalid"} {
		if code, _, _ = request(path); code != 400 {
			t.Fatal("invalid filter accepted", path, code)
		}
	}
	if code, _, _ = request(uuid.NewString() + "/processing"); code != 404 {
		t.Fatal("unknown library accepted", code)
	}
	empty := uuid.NewString()
	exec(`INSERT INTO knowledge_bases(id,name) VALUES($1,'Empty')`, empty)
	code, root, _ = request(empty + "/processing")
	if code != 200 || root["data"].(map[string]any)["completion_percent"] != nil {
		t.Fatal("empty library reported fabricated completion", code, root)
	}
}
