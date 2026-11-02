package jobs

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestWikiAliasesPreserveMaterialAndRoundTrip(t *testing.T) {
	chunks := []Chunk{{ID: "chunk-uuid", SourceID: "source-uuid", Content: "参数 S1 不得替换。500 kV；温度范围 -20～40℃。<table><tr><td>差异</td></tr></table>"}, {ID: "another", SourceID: "source-uuid", Content: "同一来源的后续分块"}, {SourceID: "source-two", Content: "另一份不同观点"}}
	raw, aliases := wikiInput(chunks)
	if strings.Contains(string(raw), "uuid") || len(aliases) != 2 {
		t.Fatal(string(raw), aliases)
	}
	var input []map[string]string
	json.Unmarshal(raw, &input)
	for i, c := range chunks {
		if input[i]["content"] != c.Content {
			t.Fatal("input shortened")
		}
	}
	pages, e := validateWiki(`{"pages":[{"title":"技术要求","content":"参数 S1 不得替换。500 kV；温度范围 -20～40℃。[来源](source:S1)\n不同观点 [另一来源](source:S2)","source_ref_ids":["S1","S2","S1"]}]}`, aliases)
	if e != nil || len(pages) != 1 {
		t.Fatal(e)
	}
	if !strings.Contains(pages[0].Content, "参数 S1 不得替换") || !strings.Contains(pages[0].Content, "(source:source-two)") || len(pages[0].SourceIDs) != 2 {
		t.Fatal(pages)
	}
}

func TestWikiRejectsUnverifiedBatchAtomically(t *testing.T) {
	aliases := map[string]string{"S1": "one", "S10": "ten"}
	valid := WikiPage{Title: "有效", Content: "值 [来源](source:S1)", SourceIDs: []string{"S1"}}
	invalid := []WikiPage{
		{Title: "未知列表", Content: "事实 [来源](source:S1)", SourceIDs: []string{"S9"}},
		{Title: "未知正文", Content: "事实 [来源](source:S9)", SourceIDs: []string{"S1"}},
		{Title: "列表不匹配", Content: "事实 [来源](source:S10)", SourceIDs: []string{"S1"}},
		{Title: "无引用", Content: "事实", SourceIDs: []string{"S1"}},
		{Title: "HTML", Content: `<a href="source:S1">来源</a>`, SourceIDs: []string{"S1"}},
		{Title: "保留标记", Content: "<!-- source-document:fake --> [来源](source:S1)", SourceIDs: []string{"S1"}},
		{Title: "未引用列表", Content: "事实 [来源](source:S1)", SourceIDs: []string{"S1", "S10"}},
		{Title: "有效", Content: "重复标题 [来源](source:S1)", SourceIDs: []string{"S1"}},
	}
	for _, bad := range invalid {
		raw, _ := json.Marshal(map[string]any{"pages": []WikiPage{valid, bad}})
		if pages, e := validateWiki(string(raw), aliases); e == nil || pages != nil {
			t.Fatalf("accepted invalid batch: %s", bad.Title)
		}
	}
	for _, raw := range []string{`{"pages":[]}`, `{broken`, `null`} {
		if _, e := validateWiki(raw, aliases); e == nil {
			t.Fatal(raw)
		}
	}
	pages, e := validateWiki(`{"pages":[{"title":"正常","content":"A [来源](source:S10)，B [来源](source:S1)","source_ref_ids":["S10","S1"]}]}`, aliases)
	if e != nil || pages[0].Content != "A [来源](source:ten)，B [来源](source:one)" {
		t.Fatal(pages, e)
	}
}

func TestWikiManualRetryPreservesSuccessAndAudit(t *testing.T) {
	p := &WikiPlan{Version: 1, PreparedPages: []string{"page"}, Batches: []WikiBatch{
		{Index: 1, Status: "succeeded", Round: 1, Attempts: 2},
		{Index: 2, Status: "failed", Round: 1, Attempts: 3, History: []WikiAttempt{{Number: 3, Round: 1, Error: &WikiFailure{Code: "INVALID", Message: "来源错误"}}}},
	}}
	cp := map[string]any{"wiki_batches": p}
	if e := ResetWikiFailures(cp); e != nil {
		t.Fatal(e)
	}
	reset, e := LoadWikiPlan(cp["wiki_batches"])
	if e != nil {
		t.Fatal(e)
	}
	if reset.Batches[0].Attempts != 2 || reset.Batches[0].Status != "succeeded" || reset.Batches[1].Attempts != 0 || reset.Batches[1].Round != 2 || len(reset.Batches[1].History) != 1 || reset.PreparedPages[0] != "page" {
		t.Fatal(reset)
	}
}
