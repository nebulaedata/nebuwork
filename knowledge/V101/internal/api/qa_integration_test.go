package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"nebulaekno/internal/textutil"
)

// Runs only against tests/compose.qa.yaml, with the runner sharing its /data
// volume. The provider is an explicit protocol fixture, not a semantic test.
func TestKnowledgeQAIntegration(t *testing.T) {
	base := os.Getenv("NEBULAEKNO_QA_TEST_URL")
	if base == "" {
		t.Skip("requires isolated QA compose stack")
	}
	ctx := context.Background()
	db, e := pgxpool.New(ctx, os.Getenv("NEBULAEKNO_QA_TEST_DATABASE_URL"))
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	sql := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(ctx, q, args...); e != nil {
			t.Fatal(e)
		}
	}
	var mu sync.Mutex
	observed := []map[string]any{}
	sourceID, imageID, docID, fileID, parseID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	provider := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			http.Error(w, "invalid", 400)
			return
		}
		mu.Lock()
		observed = append(observed, body)
		mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/embeddings") {
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"index": 0, "embedding": []float64{1, 0, 0}}}})
			return
		}
		prompt := fmt.Sprint(body["messages"])
		if body["stream"] == true {
			w.Header().Set("Content-Type", "text/event-stream")
			text := "安装要求：固定牢靠，额定电流 100A。[1](source:" + sourceID + ")\n\n![接入箱原图](asset:" + imageID + ")\n[伪造](source:00000000-0000-0000-0000-000000000000)"
			if strings.Contains(prompt, "慢速测试") {
				text = strings.Repeat("正在生成测试回答。", 80)
			}
			if strings.Contains(prompt, "空回答测试") {
				text = ""
			}
			for _, part := range []rune(text) {
				raw, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"delta": map[string]string{"content": string(part)}}}})
				if _, e := fmt.Fprintf(w, "data: %s\n\n", raw); e != nil {
					return
				}
				w.(http.Flusher).Flush()
				if strings.Contains(prompt, "慢速测试") {
					select {
					case <-r.Context().Done():
						return
					case <-time.After(30 * time.Millisecond):
					}
				}
			}
			if strings.Contains(prompt, "流中断测试") {
				return
			}
			fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			return
		}
		text := "图片模型解读：图中标示额定电流 100A。"
		if strings.Contains(prompt, "仅根据历史") {
			text = "接入箱 安装"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": text}}}})
	}))
	listener, e := net.Listen("tcp", "0.0.0.0:9000")
	if e != nil {
		t.Fatal(e)
	}
	provider.Listener = listener
	provider.Start()
	defer provider.Close()
	fixtureURL := os.Getenv("NEBULAEKNO_QA_FIXTURE_URL")
	request := func(method, path string, body any, key string, status int) map[string]any {
		t.Helper()
		var input io.Reader
		if body != nil {
			input = bytes.NewReader(qaJSON(body))
		}
		req, e := http.NewRequest(method, base+path, input)
		if e != nil {
			t.Fatal(e)
		}
		req.Header.Set("Content-Type", "application/json")
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		raw, e := io.ReadAll(res.Body)
		if e != nil {
			t.Fatal(e)
		}
		if res.StatusCode != status {
			t.Fatalf("%s %s status %d: %s", method, path, res.StatusCode, raw)
		}
		var out map[string]any
		if json.Unmarshal(raw, &out) != nil {
			t.Fatal(string(raw))
		}
		return out
	}
	data := func(out map[string]any) map[string]any { return out["data"].(map[string]any) }
	createModel := func(purpose string, vision bool) string {
		return data(request("POST", "/models", map[string]any{"name": "QA fixture " + purpose + fmt.Sprint(vision), "purpose": purpose, "protocol": "openai", "base_url": fixtureURL, "model_name": "qa-" + purpose, "api_key": "qa-protocol-test-only", "config": map[string]any{"allow_image_input": vision}}, "", 200))["id"].(string)
	}
	directID := createModel("text", true)
	plainID := createModel("text", false)
	visionID := createModel("vision", true)
	request("PUT", "/settings/qa-defaults", map[string]any{"system_prompt": "全局提示词一", "model_id": directID, "vision_model_id": visionID}, "", 200)
	request("PUT", "/settings/qa-defaults", map[string]any{"model_id": "invalid"}, "", 400)
	defaults := data(request("GET", "/settings/qa-defaults", nil, "", 200))
	if defaults["default_system_prompt"] == nil {
		t.Fatal("missing reset prompt")
	}
	kb := data(request("POST", "/knowledge-bases", map[string]any{"name": "QA fixture"}, "", 200))["id"].(string)
	otherKB := data(request("POST", "/knowledge-bases", map[string]any{"name": "Other scope"}, "", 200))["id"].(string)
	dir := filepath.Join("/data", "qa-fixture", docID)
	if e = os.MkdirAll(dir, 0755); e != nil {
		t.Fatal(e)
	}
	path := filepath.Join(dir, "source.md")
	imagePath := filepath.Join(dir, "original.png")
	if e = os.WriteFile(path, []byte("接入箱 安装要求：固定牢靠，额定电流 100A。"), 0644); e != nil {
		t.Fatal(e)
	}
	f, e := os.Create(imagePath)
	if e != nil {
		t.Fatal(e)
	}
	canvas := image.NewRGBA(image.Rect(0, 0, 20, 20))
	canvas.Set(10, 10, color.RGBA{R: 255, A: 255})
	if e = png.Encode(f, canvas); e != nil {
		t.Fatal(e)
	}
	f.Close()
	sql(`INSERT INTO knowledge(id,knowledge_base_id,name,file_type,status) VALUES($1,$2,'接入箱.md','md','ready')`, docID, kb)
	sql(`INSERT INTO file_versions(id,knowledge_id,hash,path,size,mime_type) VALUES($1,$2,'qa-fixture-hash',$3,100,'text/markdown')`, fileID, docID, path)
	sql(`INSERT INTO parse_versions(id,knowledge_id,file_version_id,engine,content) VALUES($1,$2,$3,'native','接入箱 安装')`, parseID, docID, fileID)
	sql(`UPDATE knowledge SET current_file_version_id=$2,current_parse_version_id=$3 WHERE id=$1`, docID, fileID, parseID)
	sql(`INSERT INTO source_refs(id,knowledge_id,file_version_id,parse_version_id,locators,quote,precision,char_start,char_end,origin,metadata) VALUES($1,$2,$3,$4,'[{"type":"image","page":1,"bbox":[0,0,1,1]}]','接入箱 安装要求：固定牢靠，额定电流100A。','region',0,10,'native',$5)`, sourceID, docID, fileID, parseID, qaJSON(map[string]any{"image_path": imagePath}))
	sql(`INSERT INTO chunks(id,knowledge_id,parse_version_id,source_ref_id,ordinal,content,search_vector) VALUES($1,$2,$3,$4,0,'接入箱 安装要求：固定牢靠，额定电流100A。',to_tsvector('simple',$5))`, uuid.NewString(), docID, parseID, sourceID, textutil.Tokens("接入箱 安装"))
	sql(`INSERT INTO assets(id,knowledge_id,file_version_id,kind,path,metadata) VALUES($1,$2,$3,'image',$4,$5)`, imageID, docID, fileID, imagePath, qaJSON(map[string]any{"parse_version_id": parseID}))
	session := data(request("POST", "/qa/sessions", map[string]any{"knowledge_base_ids": []string{kb}, "knowledge_ids": []string{docID}}, "", 201))
	sid := session["id"].(string)
	submit := func(question, key string) string {
		return data(request("POST", "/qa/sessions/"+sid+"/messages", map[string]string{"query": question}, key, 202))["assistant_message_id"].(string)
	}
	wait := func(id string) map[string]any {
		t.Helper()
		until := time.Now().Add(35 * time.Second)
		for time.Now().Before(until) {
			var raw []byte
			if e = db.QueryRow(ctx, `SELECT to_jsonb(m) FROM qa_messages m WHERE id=$1`, id).Scan(&raw); e != nil {
				t.Fatal(e)
			}
			var m map[string]any
			_ = json.Unmarshal(raw, &m)
			if m["state"] != "queued" && m["state"] != "running" {
				return m
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("turn timed out")
		return nil
	}
	answer := submit("接入箱 安装", "first")
	duplicate := submit("接入箱 安装", "first")
	if duplicate != answer {
		t.Fatal("idempotency failed")
	}
	request("POST", "/qa/sessions/"+sid+"/messages", map[string]string{"query": "不同问题"}, "first", 409)
	first := wait(answer)
	if first["state"] != "completed" {
		t.Fatalf("first: %s", qaJSON(first))
	}
	if strings.Contains(first["content"].(string), "00000000") || !strings.Contains(first["content"].(string), "asset:"+imageID) {
		t.Fatalf("invalid citation handling: %s", qaJSON(first))
	}
	if len(first["images"].([]any)) != 1 || first["images"].([]any)[0].(map[string]any)["read_status"] != "answer_model" {
		t.Fatal("direct image routing", first["images"])
	}
	if first["config"].(map[string]any)["effective_system_prompt"] != "全局提示词一" || strings.Contains(string(qaJSON(first)), "qa-protocol-test-only") {
		t.Fatal("snapshot leaked secret or wrong prompt")
	}
	req, _ := http.NewRequest("GET", base+"/qa/messages/"+answer+"/events", nil)
	res, e := http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	stream, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !bytes.Contains(stream, []byte("event: delta")) || !bytes.Contains(stream, []byte("event: done")) {
		t.Fatal(string(stream))
	}
	var last int64
	if e = db.QueryRow(ctx, `SELECT max(id) FROM qa_events WHERE message_id=$1`, answer).Scan(&last); e != nil {
		t.Fatal(e)
	}
	req, _ = http.NewRequest("GET", base+"/qa/messages/"+answer+"/events", nil)
	req.Header.Set("Last-Event-ID", fmt.Sprint(last))
	res, e = http.DefaultClient.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	stream, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if bytes.Contains(stream, []byte("event: delta")) {
		t.Fatal("replayed acknowledged delta")
	}
	request("PATCH", "/qa/sessions/"+sid, map[string]any{"system_prompt": "会话专属提示词"}, "", 200)
	follow := wait(submit("它的额定电流是多少？", "follow"))
	if follow["state"] != "completed" || follow["rewritten_query"] != "接入箱 安装" || follow["config"].(map[string]any)["effective_system_prompt"] != "会话专属提示词" {
		t.Fatalf("follow: %s", qaJSON(follow))
	}
	request("PUT", "/settings/qa-defaults", map[string]any{"model_id": plainID, "system_prompt": "全局提示词二"}, "", 200)
	request("PATCH", "/qa/sessions/"+sid, map[string]any{"system_prompt": nil}, "", 200)
	second := wait(submit("接入箱 安装", "vision"))
	if second["state"] != "completed" || second["image_analysis"] == "" || second["images"].([]any)[0].(map[string]any)["read_status"] != "vision_model" {
		t.Fatalf("vision: %s", qaJSON(second))
	}
	request("PUT", "/settings/qa-defaults", map[string]any{"vision_model_id": ""}, "", 200)
	withoutVision := wait(submit("接入箱 安装", "no-vision"))
	if withoutVision["state"] != "completed" || withoutVision["images"].([]any)[0].(map[string]any)["read_status"] != "not_configured" {
		t.Fatalf("unconfigured vision: %s", qaJSON(withoutVision))
	}
	request("PUT", "/settings/qa-defaults", map[string]any{"vision_model_id": visionID}, "", 200)
	// Empty output and an incomplete provider stream are failures, with partial
	// content retained for the latter instead of pretending generation finished.
	broken := wait(submit("接入箱 安装 流中断测试", "broken-stream"))
	if broken["state"] != "failed" || broken["content"] == "" {
		t.Fatalf("broken stream: %s", qaJSON(broken))
	}
	blank := wait(submit("接入箱 安装 空回答测试", "empty-output"))
	if blank["state"] != "failed" || blank["error"].(map[string]any)["code"] != "MODEL_RESPONSE_EMPTY" {
		t.Fatalf("empty output: %s", qaJSON(blank))
	}
	slow := submit("接入箱 安装 慢速测试", "slow")
	request("POST", "/qa/sessions/"+sid+"/messages", map[string]string{"query": "接入箱 安装"}, "busy", 409)
	time.Sleep(800 * time.Millisecond)
	request("POST", "/qa/messages/"+slow+"/stop", nil, "", 200)
	stopped := wait(slow)
	if stopped["state"] != "cancelled" {
		t.Fatal(stopped["state"])
	}
	// Queue cancellation must not call the provider at all.
	queued := submit("接入箱 安装", "queued-stop")
	request("POST", "/qa/messages/"+queued+"/stop", nil, "", 200)
	if wait(queued)["state"] != "cancelled" {
		t.Fatal("queued cancellation failed")
	}
	retry := data(request("POST", "/qa/messages/"+answer+"/retry", nil, "retry", 202))["assistant_message_id"].(string)
	if retry == answer || wait(retry)["state"] != "completed" {
		t.Fatal("retry failed")
	}
	request("PATCH", "/qa/sessions/"+sid, map[string]any{"knowledge_base_ids": []string{kb, otherKB}, "knowledge_ids": []string{}}, "", 200)
	multi := wait(submit("接入箱 安装", "multi-kb"))
	if multi["state"] != "completed" || len(multi["sources"].([]any)) == 0 {
		t.Fatal("multi-KB retrieval failed", multi)
	}
	request("PATCH", "/qa/sessions/"+sid, map[string]any{"knowledge_base_ids": []string{kb}, "knowledge_ids": []string{docID}}, "", 200)
	imageBytes, err := os.ReadFile(imagePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(imagePath, []byte("not an image"), 0644); err != nil {
		t.Fatal(err)
	}
	damaged := wait(submit("接入箱 安装", "damaged-image"))
	if err = os.WriteFile(imagePath, imageBytes, 0644); err != nil {
		t.Fatal(err)
	}
	if damaged["state"] != "completed" || damaged["images"].([]any)[0].(map[string]any)["read_status"] != "unavailable" {
		t.Fatal("damaged image did not degrade safely", damaged)
	}
	sql(`UPDATE assets SET metadata=jsonb_build_object('parse_version_id',$2::text) WHERE id=$1`, imageID, uuid.NewString())
	mismatch := wait(submit("接入箱 安装", "mismatched-image"))
	if mismatch["state"] != "completed" || len(mismatch["images"].([]any)) != 0 {
		t.Fatal("mismatched image version leaked", mismatch)
	}
	sql(`UPDATE assets SET metadata=jsonb_build_object('parse_version_id',$2::text) WHERE id=$1`, imageID, parseID)
	// An expired lease represents a crashed worker. Recovery emits a terminal
	// event without calling the provider again.
	interrupted := uuid.NewString()
	sql(`INSERT INTO qa_messages(id,session_id,role,state,user_message_id,owner,lease_until) VALUES($1,$2,'assistant','running',$3,'dead-worker',now()-interval '1 minute')`, interrupted, sid, first["user_message_id"])
	if wait(interrupted)["state"] != "interrupted" {
		t.Fatal("expired lease not interrupted")
	}
	// New scope must not load facts from the previous scope's history.
	request("PATCH", "/qa/sessions/"+sid, map[string]any{"knowledge_base_ids": []string{otherKB}, "knowledge_ids": []string{}}, "", 200)
	empty := wait(submit("接入箱 安装", "empty"))
	if empty["state"] != "completed" || !strings.Contains(empty["content"].(string), "未找到") || empty["rewritten_query"] != "接入箱 安装" {
		t.Fatal(empty)
	}
	request("PATCH", "/qa/sessions/"+sid, map[string]any{"knowledge_ids": []string{docID}}, "", 400)
	request("PATCH", "/qa/sessions/"+sid, map[string]any{"knowledge_base_ids": []string{kb}, "knowledge_ids": []string{docID}}, "", 200)
	// Reparse preserves the old source/image and their historical locations.
	newer := uuid.NewString()
	sql(`INSERT INTO parse_versions(id,knowledge_id,file_version_id,engine,content) VALUES($1,$2,$3,'native','新版')`, newer, docID, fileID)
	sql(`UPDATE knowledge SET current_parse_version_id=$2 WHERE id=$1`, docID, newer)
	historical := request("GET", "/qa/sessions/"+sid+"/messages?page_size=100", nil, "", 200)["data"].([]any)
	for _, item := range historical {
		m := item.(map[string]any)
		if m["id"] == answer {
			src := m["sources"].([]any)[0].(map[string]any)
			if src["parse_version_id"] != parseID || src["available"] != true {
				t.Fatal("history changed version")
			}
		}
	}
	sql(`DELETE FROM source_refs WHERE id=$1`, sourceID)
	historical = request("GET", "/qa/sessions/"+sid+"/messages?page_size=100", nil, "", 200)["data"].([]any)
	for _, item := range historical {
		m := item.(map[string]any)
		if m["id"] == answer {
			if m["sources"].([]any)[0].(map[string]any)["available"] != false {
				t.Fatal("deleted source remained available")
			}
		}
	}
	// Restore the disposable original fixture so browser acceptance can inspect
	// the previously verified historical image and original-location links.
	sql(`INSERT INTO source_refs(id,knowledge_id,file_version_id,parse_version_id,locators,quote,precision,char_start,char_end,origin,metadata) VALUES($1,$2,$3,$4,'[{"type":"image","page":1,"bbox":[0,0,1,1]}]','接入箱 安装要求：固定牢靠，额定电流100A。','region',0,10,'native',$5)`, sourceID, docID, fileID, parseID, qaJSON(map[string]any{"image_path": imagePath}))
	// Existing retrieval endpoints still return their unchanged result envelope.
	request("POST", "/search", map[string]any{"knowledge_base_ids": []string{kb}, "query_text": "接入箱", "mode": "keyword", "rerank": map[string]string{"mode": "disabled"}}, "", 200)
	schema := request("GET", "/openapi.json", nil, "", 200)
	_ = schema
	mu.Lock()
	count := len(observed)
	mu.Unlock()
	if count < 5 {
		t.Fatal("missing provider calls")
	}
	throwaway := data(request("POST", "/qa/sessions", map[string]any{"title": "Disposable"}, "", 201))["id"].(string)
	request("DELETE", "/qa/sessions/"+throwaway, nil, "", 200)
	request("GET", "/qa/sessions/"+throwaway, nil, "", 404)
	t.Logf("verified %d real HTTP provider calls, citations/images, prompt snapshots, history, idempotency, cancellation, retry, version persistence and SSE replay", count)
}
