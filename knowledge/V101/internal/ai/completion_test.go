package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestExtractionCompletionUsesBoundModelAndCompatibilityFallback(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "Bearer stored-secret" {
			t.Error("bound credential missing")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["model"] != "saved-model" || body["stream"] != false {
			t.Error("model must be server-bound and non-streaming")
		}
		if body["response_format"] != nil {
			w.WriteHeader(400)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"{}\"}}],\"usage\":{\"total_tokens\":42}}"))
	}))
	defer server.Close()
	result, err := Completion(context.Background(), Model{ID: "extraction-test", ModelName: "saved-model", BaseURL: server.URL, APIKey: "stored-secret"}, map[string]any{
		"model": "untrusted", "messages": []any{map[string]any{"role": "user", "content": "test"}}, "response_format": map[string]any{"type": "json_object"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 {
		t.Fatalf("expected bounded compatibility fallback, got %d requests", calls)
	}
	var response map[string]any
	if err = json.Unmarshal(result, &response); err != nil {
		t.Fatal(err)
	}
	if response["usage"].(map[string]any)["total_tokens"] != float64(42) {
		t.Fatal("completion envelope lost usage")
	}
}
