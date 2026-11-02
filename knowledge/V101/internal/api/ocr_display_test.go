package api

import (
	"nebulaekno/internal/ocrclean"
	"strings"
	"testing"
)

func TestOCRSourceProjectionPreservesQuotesAndOffsets(t *testing.T) {
	raw := " 标题😀\n" + strings.Repeat("智能体 职业化能力\n", 100) + "后文 "
	d := ocrDisplay{raw, ocrclean.Detect(raw, "paddleocr_vl", "image")}
	quote := strings.TrimSpace(raw)
	value := map[string]any{"quote": quote, "char_start": 0, "char_end": len([]rune(raw)), "locators": []any{"unchanged"}}
	d.project(value, "quote", "display_quote")
	if value["quote"] != quote || value["char_start"] != 0 || value["char_end"] != len([]rune(raw)) || value["ocr_cleanup"] == nil || value["display_quote"] != strings.TrimSpace(ocrclean.Apply(raw, d.cleanup)) {
		t.Fatal(value)
	}
	value["quote"] = "different source"
	d.project(value, "quote", "display_quote")
	if value["display_quote"] != "different source" {
		t.Fatal("projected across mismatched source")
	}
}

func TestImageViewDoesNotDeduplicateAcrossRegions(t *testing.T) {
	one := strings.Repeat("智能体 职业化能力\n", 4)
	blocks := []map[string]any{{"text": one, "method": "paddleocr_vl", "block_type": "image"}, {"text": one, "method": "paddleocr_vl", "block_type": "image"}}
	value := map[string]any{"recognized_text": one + "\n" + one, "_ocr_blocks": blocks}
	imageOCRView(value)
	if value["display_recognized_text"] != value["recognized_text"] {
		t.Fatal("cross-block dedup")
	}
	if _, exists := value["_ocr_blocks"]; exists {
		t.Fatal("private parser paths exposed")
	}
}
