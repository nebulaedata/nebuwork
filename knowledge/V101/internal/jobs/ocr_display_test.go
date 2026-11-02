package jobs

import (
	"encoding/json"
	"nebulaekno/internal/ocrclean"
	"strings"
	"testing"
)

func TestOCRDisplayBoundariesAndRawPreservation(t *testing.T) {
	normal := strings.Repeat("智能体\n职业化能力\n", 4)
	bad := strings.Repeat("智能体\n职业化能力\n", 100)
	p := Parsed{Blocks: []Block{
		{Text: normal, Method: "paddleocr_vl", BlockType: "image", Locator: map[string]any{"page": 1}},
		{Text: normal, Method: "paddleocr_vl", BlockType: "image", Locator: map[string]any{"page": 2}},
		{Text: bad, Method: "paddleocr_vl", BlockType: "image", Locator: map[string]any{"page": 3}},
	}}
	raw := normal + "\n" + normal + "\n" + bad + "\n"
	result := OCRDisplay(p, raw)
	if result == nil || len(result.Removals) != 1 || result.Removals[0].Start < 2*len([]rune(normal))+2 {
		t.Fatal("cross-region dedup", result)
	}
	inspectParsedOCR(&p)
	if p.Blocks[0].Warning != "" || p.Blocks[1].Warning != "" || p.Blocks[2].Text != bad || p.Blocks[2].Locator["page"] != 3 || p.Blocks[2].Warning != "OCR_QUALITY_SUSPECT" {
		t.Fatal("normal/raw data changed", p)
	}
	if p.Blocks[2].DisplayText == nil || *p.Blocks[2].DisplayText != ocrclean.Apply(bad, p.Blocks[2].OCRCleanup) {
		t.Fatal("display projection not persisted")
	}
	data, e := json.Marshal(p)
	var loaded Parsed
	if e != nil || json.Unmarshal(data, &loaded) != nil || loaded.Blocks[2].Text != bad {
		t.Fatal("raw roundtrip failed")
	}
	if OCRDisplay(p, "wrong offsets") != nil {
		t.Fatal("accepted wrong source mapping")
	}
}
