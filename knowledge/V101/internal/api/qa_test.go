package api

import (
	"nebulaekno/internal/defaults"
	"strings"
	"testing"
)

func TestQAReferenceAllowlist(t *testing.T) {
	sources := []map[string]any{{"source_ref_id": "source-1"}}
	images := []map[string]any{{"id": "image-1"}}
	input := "结论[1](source:source-1) ![原图](asset:image-1) [伪造](source:other) ![越界](asset:other) ![错类型](source:source-1) [错类型](asset:image-1)"
	out, invalid := qaValidateAnswer(input, sources, images)
	if !invalid || !strings.Contains(out, "[1](source:source-1)") || !strings.Contains(out, "![原图](asset:image-1)") || strings.Contains(out, "other") || strings.Contains(out, "错类型") {
		t.Fatal(out)
	}
}
func TestQAScopeAndSettings(t *testing.T) {
	scope := qaSession{KBIDs: []string{"kb"}, IDs: []string{"doc"}}
	if !qaInScope(map[string]any{"knowledge_base_id": "kb", "knowledge_id": "doc"}, scope) || qaInScope(map[string]any{"knowledge_base_id": "other", "knowledge_id": "doc"}, scope) || qaInScope(map[string]any{"knowledge_base_id": "kb", "knowledge_id": "other"}, scope) {
		t.Fatal("scope leak")
	}
	if msg := validateSetting("qa-defaults", map[string]any{"system_prompt": defaults.QASystemPrompt, "model_id": "", "vision_model_id": ""}); msg != "" {
		t.Fatal(msg)
	}
	for _, v := range []map[string]any{{"system_prompt": "", "model_id": "", "vision_model_id": ""}, {"system_prompt": "valid", "model_id": "not-an-id", "vision_model_id": ""}, {"system_prompt": "valid", "model_id": "", "vision_model_id": "", "extra": true}} {
		if validateSetting("qa-defaults", v) == "" {
			t.Fatal("accepted invalid settings")
		}
	}
}
