package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChatRejectsTruncatedOrFilteredOutput(t *testing.T) {
	for _, reason := range []string{"length", "content_filter", "stop", ""} {
		t.Run(reason, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"finish_reason": reason, "message": map[string]string{"content": "{\"pages\":[]}"}}}})
			}))
			defer server.Close()
			text, e := Chat(context.Background(), Model{Purpose: "text", BaseURL: server.URL, ModelName: "fixture"}, "generate", nil)
			if text == "" {
				t.Fatal("diagnostic output lost")
			}
			if reason == "length" || reason == "content_filter" {
				err, ok := e.(*Error)
				if !ok {
					t.Fatal("incomplete output accepted", reason)
				}
				if reason == "length" && err.Code != "MODEL_OUTPUT_TRUNCATED" {
					t.Fatal(err)
				}
				if reason == "content_filter" && err.Code != "MODEL_OUTPUT_FILTERED" {
					t.Fatal(err)
				}
			} else if e != nil {
				t.Fatal(e)
			}
		})
	}
}
