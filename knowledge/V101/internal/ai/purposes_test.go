package ai

import "testing"

func TestPurposeCompatibility(t *testing.T) {
	purposes := []string{"text", "outline", "embedding", "vision", "asr", "rerank", "multimodal_embedding"}
	for _, model := range purposes {
		for _, target := range purposes {
			want := model == target || model == "text" && target == "outline" || model == "outline" && target == "text"
			if got := SupportsPurpose(model, target); got != want {
				t.Errorf("model %s -> binding %s: got %v, want %v", model, target, got, want)
			}
		}
	}
}
