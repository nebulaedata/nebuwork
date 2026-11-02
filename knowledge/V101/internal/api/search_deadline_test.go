package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"nebulaekno/internal/bootstrap"
	"nebulaekno/internal/config"
)

func TestPartialSearchKeepsSourcesAfterChannelDeadline(t *testing.T) {
	db := taskTestDatabase(t)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := db.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	files, e := os.ReadDir(filepath.Join("..", "bootstrap", "sql"))
	if e != nil {
		t.Fatal(e)
	}
	for _, file := range files {
		if !strings.HasSuffix(file.Name(), ".sql") || strings.HasPrefix(file.Name(), "001_") || strings.HasPrefix(file.Name(), "019_") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join("..", "bootstrap", "sql", file.Name()))
		if err != nil {
			t.Fatal(err)
		}
		exec(string(raw))
	}
	started := make(chan struct{}, 1)
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		started <- struct{}{}
		<-r.Context().Done()
	}))
	defer model.Close()
	kb, doc, file, parse, source, chunk, modelID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	path := filepath.Join(t.TempDir(), "source.txt")
	if e = os.WriteFile(path, []byte("needle original"), 0600); e != nil {
		t.Fatal(e)
	}
	exec(`INSERT INTO knowledge_bases(id,name) VALUES($1,'Search fixture')`, kb)
	exec(`INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status) VALUES($1,$2,'source.txt','txt','succeeded')`, doc, kb)
	exec(`INSERT INTO file_versions(id,knowledge_id,hash,path,size,mime_type) VALUES($1,$2,'fixed-hash',$3,15,'text/plain')`, file, doc, path)
	exec(`INSERT INTO parse_versions(id,knowledge_id,file_version_id,engine,content,metadata) VALUES($1,$2,$3,'plain','needle original','{}')`, parse, doc, file)
	exec(`UPDATE knowledge SET current_file_version_id=$2,current_parse_version_id=$3 WHERE id=$1`, doc, file, parse)
	exec(`INSERT INTO source_refs(id,knowledge_id,file_version_id,parse_version_id,locators,quote,precision,char_start,char_end) VALUES($1,$2,$3,$4,'[]','needle original','document',0,15)`, source, doc, file, parse)
	exec(`INSERT INTO chunks(id,knowledge_id,parse_version_id,source_ref_id,ordinal,content,search_vector) VALUES($1,$2,$3,$4,0,'needle original',to_tsvector('simple','needle original'))`, chunk, doc, parse, source)
	exec(`INSERT INTO models(id,name,purpose,base_url,model_name,dimension,config) VALUES($1,'local fake','embedding',$2,'fake',3,'{}')`, modelID, model.URL)
	exec(`INSERT INTO settings(key,value) VALUES('model-bindings',jsonb_build_object('embedding',$1::text))`, modelID)
	state := bootstrap.NewState()
	state.Set("ready", true, nil)
	s := New(config.Config{}, state)
	s.Services = &bootstrap.Services{DB: db}
	partial, include := true, true
	in := SearchInput{Query: "needle", Mode: "hybrid", KBIDs: []string{kb}, TopK: 3, Candidates: 5, AllowPartial: &partial, IncludeSources: &include, IncludeContext: &include}
	in.Rerank.Mode = "disabled"
	result, e := s.executeSearchWithin(ctx, in, 250*time.Millisecond)
	if e != nil {
		t.Fatal("optional channel deadline discarded successful recall", e)
	}
	select {
	case <-started:
	default:
		t.Fatal("slow vector channel was not exercised")
	}
	raw, _ := json.Marshal(result)
	var out map[string]any
	if e = json.Unmarshal(raw, &out); e != nil {
		t.Fatal(e)
	}
	hits := out["results"].([]any)
	if len(hits) != 1 {
		t.Fatal("keyword recall lost", string(raw))
	}
	hit := hits[0].(map[string]any)
	refs := hit["source_refs"].([]any)
	if len(refs) != 1 {
		t.Fatal("citations lost after timeout", string(raw))
	}
	ref := refs[0].(map[string]any)
	if ref["source_ref_id"] != source || ref["file_version_id"] != file || ref["parse_version_id"] != parse || ref["knowledge_base_id"] != kb {
		t.Fatal("immutable source changed", ref)
	}
	if len(out["meta"].(map[string]any)["warnings"].([]any)) == 0 {
		t.Fatal("partial retrieval not disclosed", string(raw))
	}
}
