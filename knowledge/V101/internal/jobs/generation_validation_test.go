package jobs

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestStructuredWikiLocalRepair(t *testing.T) {
	aliases := map[string]string{"S1": "real-source-1", "S2": "real-source-2"}
	batch := WikiBatch{}
	response := `{"pages":[{"title":"已通过","blocks":[{"content":"500 kV；-20～40℃；不得省略条件。","source_ref_ids":["S1"]}]},{"title":"需修复","blocks":[{"content":"<table><tr><td>30</td></tr></table>","source_ref_ids":["S999"]}]}]}`
	pages, pending, issues, e := validateWikiDraft(response, aliases, &batch)
	if e == nil || len(pages) != 1 || len(pending) != 1 || len(issues) == 0 {
		t.Fatal(pages, pending, issues, e)
	}
	if pages[0].Content != "500 kV；-20～40℃；不得省略条件。\n\n[来源](source:real-source-1)" {
		t.Fatal(pages)
	}
	batch.Accepted = []string{pages[0].Title}
	batch.Pending = pending
	repaired := `{"pages":[{"title":"需修复","blocks":[{"content":"<table><tr><td>30</td></tr></table>","source_ref_ids":["S2","S2"]}]}]}`
	pages, pending, _, e = validateWikiDraft(repaired, aliases, &batch)
	if e != nil || len(pending) != 0 || len(pages) != 1 || len(pages[0].SourceIDs) != 1 || !strings.Contains(pages[0].Content, "<td>30</td>") {
		t.Fatal(pages, e)
	}
	for _, bad := range []string{`{"pages":[]}`, `{"pages":[{"title":"替换主题","blocks":[]}]}`, `{"pages":[{"title":"需修复","blocks":[]},{"title":"新增","blocks":[]}]}`} {
		if good, _, _, err := validateWikiDraft(bad, aliases, &batch); err == nil || len(good) > 0 {
			t.Fatal("repair dropped/replaced facts", bad)
		}
	}
}

func TestStructuredWikiRejectsCitationInjectionAndDuplicateTitles(t *testing.T) {
	for _, body := range []string{`[来源](source:S1)`, `<!-- source-document:bad -->`, `raw source:UUID`} {
		raw, _ := json.Marshal(map[string]any{"pages": []StructuredWikiPage{{Title: "正文", Blocks: []WikiBlock{{Content: body, SourceIDs: []string{"S1"}}}}}})
		if good, _, _, e := validateWikiDraft(string(raw), map[string]string{"S1": "id"}, &WikiBatch{}); e == nil || len(good) > 0 {
			t.Fatal(body)
		}
	}
	raw := `{"pages":[{"title":"重复","blocks":[{"content":"完整事实","source_ref_ids":["S1"]}]},{"title":"重复","blocks":[{"content":"不同事实","source_ref_ids":["S1"]}]}]}`
	if good, _, _, e := validateWikiDraft(raw, map[string]string{"S1": "id"}, &WikiBatch{}); e == nil || len(good) > 0 {
		t.Fatal("accepted duplicate themes")
	}
}

func TestGraphEvidenceWhitespaceOnlyAndPartialValidation(t *testing.T) {
	chunk := Chunk{SourceID: "real-source", Content: "NebulaeKno\n使用 数据库。电压 500 kV，不得超过 40℃。"}
	payload := GraphPayload{Entities: []Entity{{Name: "NebulaeKno", Type: "产品", Quote: "NebulaeKno使用数据库。"}}, Relations: []Relation{{Source: "NebulaeKno", Target: "数据库", Relation: "使用", Quote: "NebulaeKno不使用数据库。"}}}
	good, bad, issues := validateGraph(payload, chunk)
	if len(good.Entities) != 1 || good.Entities[0].SourceID != chunk.SourceID || good.Entities[0].Quote != "NebulaeKno\n使用 数据库。" || len(bad.Relations) != 1 || len(issues) != 1 {
		t.Fatal(good, bad, issues)
	}
	for _, quote := range []string{"电压 500 V", "电压 50 kV", "可超过 40℃", "NebulaeKno不使用数据库"} {
		if _, ok := originalQuote(chunk.Content, quote); ok {
			t.Fatal("changed evidence accepted", quote)
		}
	}
	if graphRepairShape(bad, GraphPayload{}) {
		t.Fatal("silently dropped failed relation")
	}
	corrected := bad
	corrected.Relations = append([]Relation{}, bad.Relations...)
	corrected.Relations[0].Quote = chunk.Content
	if !graphRepairShape(bad, corrected) {
		t.Fatal("quote repair rejected")
	}
	good, _, issues = validateGraph(corrected, chunk)
	if len(issues) > 0 || len(good.Relations) != 1 {
		t.Fatal(issues)
	}
}

func TestGraphRetryPreservesSuccessfulChunksAndPendingEvidence(t *testing.T) {
	plan := GraphPlan{Version: 1, Batches: []GraphChunk{{WikiBatch: WikiBatch{Status: "succeeded", Attempts: 1}}, {WikiBatch: WikiBatch{Status: "failed", Attempts: 3, Round: 1}, Generated: true, Pending: &GraphPayload{Relations: []Relation{{Source: "甲", Target: "乙"}}}, AcceptedEntities: 2}}}
	cp := map[string]any{"graph_batches": plan}
	if e := ResetGraphFailures(cp); e != nil {
		t.Fatal(e)
	}
	p, e := LoadGraphPlan(cp["graph_batches"])
	if e != nil || p.Batches[0].Attempts != 1 || p.Batches[1].Attempts != 0 || p.Batches[1].Round != 2 || p.Batches[1].AcceptedEntities != 2 || p.Batches[1].Pending == nil {
		t.Fatal(p, e)
	}
}

func TestOCRAnomalyRetainsRawAndAvoidsTableFalsePositive(t *testing.T) {
	raw := strings.Repeat("30 40 50 60 70 ", 130)
	if ocrAnomaly(raw, "paddleocr_vl", "image") == "" {
		t.Fatal("numeric hallucination missed")
	}
	if ocrAnomaly(raw, "paddleocr_vl", "table") != "" || ocrAnomaly(raw, "native", "image") != "" || ocrAnomaly("30 40 50 50 30 6×φ18", "paddleocr_vl", "image") != "" {
		t.Fatal("false positive")
	}
	p := Parsed{Blocks: []Block{{Text: raw, Method: "paddleocr_vl", BlockType: "image", Locator: map[string]any{"page": 17, "bbox": []float64{.1, .2, .3, .4}}}}}
	inspectParsedOCR(&p)
	if p.Blocks[0].Text != raw || p.Blocks[0].Warning != "OCR_QUALITY_SUSPECT" || len(p.Warnings) != 1 || p.Blocks[0].Locator["page"] != 17 {
		t.Fatal(p)
	}
}
