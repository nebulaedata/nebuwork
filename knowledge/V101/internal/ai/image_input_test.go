package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestChatImagePermissionAndPayload(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var body struct {
			Messages []struct {
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Messages) != 1 {
			t.Error("invalid chat request")
		}
		if len(body.Messages) == 1 && len(body.Messages[0].Content) > 0 && body.Messages[0].Content[0] == '[' {
			var parts []struct {
				Type     string `json:"type"`
				ImageURL struct {
					URL string `json:"url"`
				} `json:"image_url"`
			}
			if json.Unmarshal(body.Messages[0].Content, &parts) != nil || len(parts) != 2 || parts[0].Type != "text" || parts[1].Type != "image_url" || parts[1].ImageURL.URL != "data:image/png;base64,aGVsbG8=" {
				t.Error("image payload was not preserved")
			}
		}
		fmt.Fprint(w, `{"choices":[{"message":{"content":"ok"}}]}`)
	}))
	defer server.Close()
	for _, tc := range []struct {
		name, purpose string
		config        map[string]any
		images        bool
		allowed       bool
	}{
		{"legacy text without flag", "text", nil, true, false},
		{"disabled text", "text", map[string]any{"allow_image_input": false}, true, false},
		{"enabled text", "text", map[string]any{"allow_image_input": true}, true, true},
		{"vision keeps image support", "vision", nil, true, true},
		{"other purposes cannot opt in", "outline", map[string]any{"allow_image_input": true}, true, false},
		{"text without images still works", "text", nil, false, true},
		{"enabled text still accepts text", "text", map[string]any{"allow_image_input": true}, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := calls.Load()
			var images []string
			if tc.images {
				images = []string{"data:image/png;base64,aGVsbG8="}
			}
			result, err := Chat(context.Background(), Model{Purpose: tc.purpose, BaseURL: server.URL, ModelName: "fixture", Config: tc.config}, "describe", images)
			if tc.allowed {
				if err != nil || result != "ok" || calls.Load() != before+1 {
					t.Fatalf("allowed input failed: %s %v", result, err)
				}
			} else {
				failure, ok := err.(*Error)
				if !ok || failure.Code != "IMAGE_INPUT_DISABLED" || calls.Load() != before {
					t.Fatalf("disabled image input reached upstream or wrong error: %v", err)
				}
			}
		})
	}
}

func TestValidateImageInputFlag(t *testing.T) {
	for _, value := range []any{"true", 1, nil, []any{true}} {
		m := Model{Name: "test", Purpose: "text", Protocol: "openai", BaseURL: "http://localhost/v1", ModelName: "fixture", Config: map[string]any{"allow_image_input": value}}
		if Validate(m) != "allow_image_input 必须为布尔值" {
			t.Fatalf("accepted invalid image flag: %v", value)
		}
	}
}
