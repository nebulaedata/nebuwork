package api

import (
	"encoding/base64"
	"encoding/json"
	"nebulaekno/internal/jobs"
	"strings"
	"testing"
	"time"
)

func TestDocumentWikiContributionIsolation(t *testing.T) {
	doc := "11111111-1111-4111-8111-111111111111"
	other := "22222222-2222-4222-8222-222222222222"
	ref := "33333333-3333-4333-8333-333333333333"
	old := "44444444-4444-4444-8444-444444444444"
	section := func(owner, ref, text string) string {
		return "<!-- source-document:" + owner + ":0 -->\n" + text + " [来源](source:" + ref + ")\n<!-- /source-document -->"
	}
	raw := section(doc, ref, "本文件\n\n|数据|\n|-|\n|原表格|") + section(other, ref, "其他文件") + section(doc, old, "旧版内容")
	content, state, _ := documentWikiContent(raw, doc, nil, map[string]bool{ref: true})
	if state != "partial" || !strings.Contains(content, "|原表格|") || strings.Contains(content, "其他文件") || strings.Contains(content, "旧版内容") {
		t.Fatal(content, state)
	}
	for _, unverifiable := range []string{"手工合并 [来源](source:" + ref + ")", section(doc, old, "旧版本"), "<!-- source-document:" + doc + ":0 -->无结束标记"} {
		body, status, reason := documentWikiContent(unverifiable, doc, nil, map[string]bool{ref: true})
		if body != "" || status != "unavailable" || reason == "" {
			t.Fatal(body, status, reason)
		}
	}
	legacy := strings.ReplaceAll(strings.ReplaceAll(section(other, ref, "历史任务贡献"), "source-document:", "source-task:"), "/source-document", "/source-task")
	body, status, _ := documentWikiContent(legacy, doc, map[string]bool{other: true}, map[string]bool{ref: true})
	if status != "ready" || !strings.Contains(body, "历史任务贡献") {
		t.Fatal(body, status)
	}
}
func TestDocumentGraphEvidenceIsolation(t *testing.T) {
	records := []documentGraphRecord{
		{ID: "record1", Synced: true, Payload: jobs.GraphPayload{Entities: []jobs.Entity{{Name: "共享实体", Type: "组织", Description: "描述甲", SourceID: "source1"}, {Name: "独立实体", Type: "概念", SourceID: "source1"}, {Name: "其他文件", SourceID: "foreign"}}, Relations: []jobs.Relation{{Source: "共享实体", Target: "独立实体", Relation: "关联", SourceID: "source1", Quote: "证据"}, {Source: "共享实体", Target: "其他文件", Relation: "关联", SourceID: "foreign"}}}},
		{ID: "record2", Payload: jobs.GraphPayload{Entities: []jobs.Entity{{Name: "共享实体", Type: "产品", Description: "描述乙", SourceID: "source2"}}}},
	}
	result := aggregateDocumentGraph(records, map[string]bool{"source1": true, "source2": true})
	if len(result.Nodes) != 2 || len(result.Relations) != 1 {
		t.Fatal(result)
	}
	for _, n := range result.Nodes {
		if n.Name == "共享实体" && (len(n.Descriptions) != 2 || len(n.SourceIDs) != 2 || len(n.Types) != 2) {
			t.Fatal(n)
		}
	}
	r := result.Relations[0]
	if r.EvidenceID != "record1" || r.SourceID != "source1" || !r.Synced || r.Quote != "证据" {
		t.Fatal(r)
	}
	again := aggregateDocumentGraph(records, map[string]bool{"source1": true, "source2": true})
	if again.Relations[0].ID != r.ID {
		t.Fatal("unstable relation identity")
	}
}
func TestDocumentGraphCursorVersion(t *testing.T) {
	c := documentGraphCursor{Parse: "v1", ID: "11111111-1111-4111-8111-111111111111", Created: time.Now().UTC()}
	raw, _ := json.Marshal(c)
	token := base64.RawURLEncoding.EncodeToString(raw)
	if _, err := parseDocumentGraphCursor(token, "v1"); err != nil {
		t.Fatal(err)
	}
	if _, err := parseDocumentGraphCursor(token, "v2"); err == nil {
		t.Fatal("accepted cross-version cursor")
	}
	if _, err := parseDocumentGraphCursor("invalid", "v1"); err == nil {
		t.Fatal("accepted malformed cursor")
	}
}
