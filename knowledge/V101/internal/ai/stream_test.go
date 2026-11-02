package ai

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCompletionStreamFrames(t *testing.T) {
	cases := []struct {
		name, body string
		want       string
		fail       bool
	}{
		{"unicode and heartbeat", ": heartbeat\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"中文😀\"}}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"答案\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", "中文😀答案", false},
		{"truncated", "data: {\"choices\":[{\"delta\":{\"content\":\"部分\"}}]}\n\n", "部分", true},
		{"length", "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\n", "", true},
		{"upstream error", "data: {\"error\":{\"message\":\"private\"}}\n\n", "", true},
		{"malformed", "data: invalid\n\n", "", true},
		{"missing finish", "data: [DONE]\n\n", "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var out strings.Builder
			e := readCompletionStream(strings.NewReader(c.body), func(s string) error { out.WriteString(s); return nil })
			if (e != nil) != c.fail || out.String() != c.want {
				t.Fatalf("content=%q error=%v", out.String(), e)
			}
		})
	}
}
func TestStreamCompletionProtocolAndCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-secret" || r.URL.Path != "/chat/completions" {
			t.Error("missing credentials/path")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"已开始\"}}]}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	e := StreamCompletion(ctx, Model{BaseURL: server.URL, ModelName: "fixture", APIKey: "test-secret"}, []any{map[string]string{"role": "user", "content": "问题"}}, func(string) error { cancel(); return ctx.Err() })
	if e == nil {
		t.Fatal("expected cancellation")
	}
}
