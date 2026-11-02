package api

import "testing"

func TestWikiPageGraphUsesRealPageLinks(t *testing.T) {
	pages := []wikiGraphPage{
		{ID: "a", Title: "页面甲", Content: "[[页面乙]] [[页面乙]] [[页面甲]]\n## 关联页面\n- [页面丙](#)\n- **页面丁**\n- 未生成页面\n- [远程](https://example.com)\n## 来源\n- 页面戊\n[引用](wiki:e)\n"},
		{ID: "b", Title: "页面乙"}, {ID: "c", Title: "页面丙"}, {ID: "d", Title: "页面丁"}, {ID: "e", Title: "页面戊"}, {ID: "f", Title: "孤立页面"},
	}
	g := buildWikiPageGraph(pages)
	if len(g.Nodes) != 6 || len(g.Edges) != 4 || g.Unresolved != 1 {
		t.Fatalf("unexpected graph: %+v", g)
	}
	if g.Edges[0].Kind != "reference" || g.Edges[1].Kind != "related" {
		t.Fatalf("relationship semantics lost: %+v", g.Edges)
	}
	// A title in a normal list or an external URL is not a Wiki relationship.
	pages[0].Content = "## 正文\n- 页面乙\n[页面丙](https://example.com)\n人物、组织、概念 页面丁"
	if got := buildWikiPageGraph(pages); len(got.Edges) != 0 {
		t.Fatal(got)
	}
}

func TestWikiPageGraphExcludesCodeAndComments(t *testing.T) {
	text := "<!-- [[目标]] -->\n`[[目标]]`\n    [[目标]]\n```md\n[[目标]]\n~~~\n[[目标]]\n```\n## 关联页面\n- `目标`\n<!--\n- 目标\n-->\n## 正文\n- 目标"
	g := buildWikiPageGraph([]wikiGraphPage{{ID: "a", Title: "起点", Content: text}, {ID: "b", Title: "目标"}})
	if len(g.Edges) != 0 {
		t.Fatalf("code/example became relation: %+v", g)
	}
}

func TestWikiPageGraphResolvesOnlyCurrentKnowledgeBase(t *testing.T) {
	p := wikiGraphPage{ID: "a", Title: "起点", Content: "[[目标]] [跨库](wiki:outside)\n## 相关页面\n- 目标"}
	g := buildWikiPageGraph([]wikiGraphPage{p})
	if len(g.Edges) != 0 || g.Unresolved != 2 {
		t.Fatal(g)
	}
	g = buildWikiPageGraph([]wikiGraphPage{p, {ID: "b", Title: "目标"}})
	if len(g.Edges) != 1 || g.Unresolved != 1 {
		t.Fatal(g)
	}
	g = buildWikiPageGraph([]wikiGraphPage{p, {ID: "b", Title: "新标题"}})
	if len(g.Edges) != 0 {
		t.Fatal("renamed/deleted target remained linked")
	}
}
