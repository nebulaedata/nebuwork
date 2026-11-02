package api

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSuggestionFields(t *testing.T) {
	for _, tc := range []struct {
		name, kind, data string
		generated, valid bool
	}{
		{"image", "image", `{"image_instructions":"只描述可见内容"}`, true, true},
		{"blank output", "image", `{"image_instructions":" "}`, true, false},
		{"null output", "image", `null`, true, false},
		{"wrong type", "image", `{"image_instructions":7}`, true, false},
		{"no silent settings change", "image", `{"image_instructions":"描述", "graph_enabled":false}`, true, false},
		{"cross kind", "graph", `{"image_instructions":"描述"}`, true, false},
		{"partial current", "graph", `{"extract_config":{"tags":[],"text":""}}`, false, true},
		{"missing fields", "graph", `{"extract_config":{"tags":["组织"]}}`, true, false},
		{"invalid list", "graph", `{"extract_config":{"tags":[23]}}`, false, false},
		{"unknown graph field", "graph", `{"extract_config":{"enabled":false}}`, false, false},
		{"empty current", "image", `{}`, false, true},
		{"blank current", "image", `{"image_instructions":""}`, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var raw map[string]any
			if err := json.Unmarshal([]byte(tc.data), &raw); err != nil {
				t.Fatal(err)
			}
			_, msg := suggestionFields(tc.kind, raw, tc.generated)
			if (msg == "") != tc.valid {
				t.Fatalf("valid=%v message=%q", tc.valid, msg)
			}
		})
	}
	valid := map[string]any{"extract_config": map[string]any{
		"tags": []any{" 组织 ", "组织", "项目"}, "relations": []any{"负责"},
		"custom_instructions": " 保留原文证据。 ", "text": "示例公司负责示例项目。",
	}}
	out, msg := suggestionFields("graph", valid, true)
	if msg != "" {
		t.Fatal(msg)
	}
	cfg := out["extract_config"].(map[string]any)
	if len(cfg["tags"].([]any)) != 2 || cfg["custom_instructions"] != "保留原文证据。" || !strings.HasPrefix(cfg["text"].(string), "【虚构示例") {
		t.Fatal(cfg)
	}
	for _, size := range []int{12000, 12001} {
		_, msg = suggestionFields("image", map[string]any{"image_instructions": strings.Repeat("中", size)}, true)
		if (msg == "") != (size == 12000) {
			t.Fatalf("Unicode length %d: %s", size, msg)
		}
	}
}
