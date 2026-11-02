package jobs

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/taskcontrol"
)

func TestPauseRefundsOnlyUnfinishedBatchAttempt(t *testing.T) {
	finished := time.Now().UTC()
	plan := WikiPlan{Version: 1, Batches: []WikiBatch{
		{Status: "succeeded", Attempts: 1, Accepted: []string{"saved"}},
		{Status: "failed", Attempts: 3},
		{Status: "running", Attempts: 3, Accepted: []string{"partial"}, History: []WikiAttempt{{Number: 2, FinishedAt: &finished}, {Number: 3}}},
	}}
	cp := map[string]any{"wiki_batches": plan, "graph_batches": GraphPlan{Version: 1, Batches: []GraphChunk{{WikiBatch: plan.Batches[2], RecordID: "saved-record", Generated: true, AcceptedEntities: 2}}}}
	updates := suspendedLedgers(cp)
	wiki, _ := LoadWikiPlan(updates["wiki_batches"])
	graph, _ := LoadGraphPlan(updates["graph_batches"])
	if wiki.Batches[0].Status != "succeeded" || wiki.Batches[1].Status != "failed" || wiki.Batches[1].Attempts != 3 || wiki.Batches[2].Status != "pending" || wiki.Batches[2].Attempts != 2 || len(wiki.Batches[2].Accepted) != 1 || wiki.Batches[2].History[1].Error.Code != "TASK_PAUSED" {
		t.Fatal(wiki)
	}
	if graph.Batches[0].RecordID != "saved-record" || !graph.Batches[0].Generated || graph.Batches[0].AcceptedEntities != 2 || graph.Batches[0].Attempts != 2 {
		t.Fatal(graph)
	}
	if len(suspendedLedgers(map[string]any{"wiki_batches": wiki, "graph_batches": graph})) != 0 {
		t.Fatal("repeated suspension refunded twice")
	}
}

// Runs a real worker lease against an isolated database and a local fake model.
// Successful parse/keyword/outline stages must survive an interrupted embedding
// request, stale queue delivery during pause, fast resume and final completion.
func TestWorkerPauseResumePreservesResults(t *testing.T) {
	url := os.Getenv("NEBULAEKNO_REBUILD_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("requires isolated task database")
	}
	ctx := context.Background()
	admin, e := pgxpool.New(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(admin.Close)
	schema := "pause_worker_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = admin.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS vector; CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") })
	pc, e := pgxpool.ParseConfig(url)
	if e != nil {
		t.Fatal(e)
	}
	pc.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	db, e := pgxpool.NewWithConfig(ctx, pc)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(db.Close)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	files, e := os.ReadDir(filepath.Join("..", "bootstrap", "sql"))
	if e != nil {
		t.Fatal(e)
	}
	for _, file := range files {
		if !strings.HasSuffix(file.Name(), ".sql") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join("..", "bootstrap", "sql", file.Name()))
		if err != nil {
			t.Fatal(err)
		}
		exec(string(raw))
	}
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	var calls atomic.Int32
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		if calls.Add(1) == 1 {
			entered <- struct{}{}
			select {
			case <-r.Context().Done():
				return
			case <-release:
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"index":0,"embedding":[1,2,3]}]}`))
	}))
	defer func() { close(release); model.Close() }()
	kb, doc, file, parse, source, chunk, modelID, task := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	exec(`INSERT INTO knowledge_bases(id,name) VALUES($1,'worker fixture')`, kb)
	exec(`INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status) VALUES($1,$2,'fixture.txt','txt','queued')`, doc, kb)
	exec(`INSERT INTO file_versions(id,knowledge_id,hash,path,size,mime_type) VALUES($1,$2,'hash','fixture.txt',1,'text/plain')`, file, doc)
	exec(`INSERT INTO parse_versions(id,knowledge_id,file_version_id,engine,content,metadata) VALUES($1,$2,$3,'plain','saved original','{}')`, parse, doc, file)
	exec(`UPDATE knowledge SET current_file_version_id=$2,current_parse_version_id=$3 WHERE id=$1`, doc, file, parse)
	exec(`INSERT INTO source_refs(id,knowledge_id,file_version_id,parse_version_id,locators,quote,precision,char_start,char_end) VALUES($1,$2,$3,$4,'[]','saved original','document',0,14)`, source, doc, file, parse)
	exec(`INSERT INTO chunks(id,knowledge_id,parse_version_id,source_ref_id,ordinal,content,search_vector) VALUES($1,$2,$3,$4,0,'saved original',''::tsvector)`, chunk, doc, parse, source)
	exec(`INSERT INTO models(id,name,purpose,base_url,model_name,dimension,config) VALUES($1,'fake local','embedding',$2,'fake',3,'{}')`, modelID, model.URL)
	exec(`INSERT INTO settings(key,value) VALUES('model-bindings',jsonb_build_object('embedding',$1::text))`, modelID)
	checkpoint, _ := json.Marshal(map[string]any{"parse": "succeeded", "parse_version_id": parse, "keyword": "succeeded", "outline": "succeeded", "images": "skipped", "image_embedding": "skipped", "wiki": "skipped", "graph": "skipped"})
	exec(`INSERT INTO tasks(id,knowledge_base_id,knowledge_id,type,idempotency_key,checkpoint) VALUES($1::uuid,$2,$3,'ingest',$1::text,$4)`, task, kb, doc, checkpoint)
	state := bootstrap.NewState()
	state.Set("ready", true, nil)
	w := &Worker{Services: &bootstrap.Services{DB: db}, State: state, owner: "pause-fixture"}
	done := make(chan struct{})
	go func() { defer close(done); w.process(ctx, task) }()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("worker did not reach fake embedding model")
	}
	exec(`UPDATE knowledge_bases SET tasks_paused=true,tasks_pause_generation=1 WHERE id=$1`, kb)
	// Resume immediately. The epoch must still interrupt the old lease.
	exec(`UPDATE knowledge_bases SET tasks_paused=false WHERE id=$1`, kb)
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("running worker did not suspend")
	}
	var stored string
	var attempts int
	var cp map[string]any
	if e = db.QueryRow(ctx, "SELECT state,attempts,checkpoint FROM tasks WHERE id=$1", task).Scan(&stored, &attempts, &cp); e != nil {
		t.Fatal(e)
	}
	if stored != "queued" || attempts != 0 || cp["parse"] != "succeeded" || cp["outline"] != "succeeded" || cp["parse_version_id"] != parse {
		t.Fatal("pause destroyed successful stages", stored, attempts, cp)
	}
	exec(`UPDATE knowledge_bases SET tasks_paused=true,tasks_pause_generation=2 WHERE id=$1`, kb)
	w.process(ctx, task) // Represents a stale delivery already in Redis.
	if calls.Load() != 1 {
		t.Fatal("paused worker started another model request")
	}
	exec(`UPDATE knowledge_bases SET tasks_paused=false WHERE id=$1`, kb)
	w.process(ctx, task)
	if e = db.QueryRow(ctx, "SELECT state,attempts,checkpoint FROM tasks WHERE id=$1", task).Scan(&stored, &attempts, &cp); e != nil {
		t.Fatal(e)
	}
	if stored != "succeeded" || attempts != 1 || cp["parse_version_id"] != parse || cp["embedding"] != "succeeded" || calls.Load() != 2 {
		t.Fatal("resume failed", stored, attempts, cp, calls.Load())
	}
	var results int
	if e = db.QueryRow(ctx, `SELECT count(*) FROM embeddings WHERE source_ref_id=$1`, source).Scan(&results); e != nil || results != 1 {
		t.Fatal("resumed result missing", results, e)
	}
	if e = db.QueryRow(ctx, `SELECT count(*) FROM tasks t WHERE id=$1 AND (`+taskcontrol.UninterruptedSQL+`)`, task).Scan(&results); e != nil || results != 1 {
		t.Fatal("new lease generation invalid", e)
	}
}
