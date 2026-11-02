package textutil

import (
	"strings"
	"testing"
)

func TestUnicodeSpans(t *testing.T) {
	s := "知识库😀原文定位"
	r := []rune(s)
	parts := Split(s, 4, 1)
	for _, p := range parts {
		if string(r[p.Start:p.End]) != p.Text {
			t.Fatal("offset is not Unicode code point")
		}
	}
	if parts[len(parts)-1].End != len(r) {
		t.Fatal("lost tail")
	}
	if !strings.Contains(Tokens("知识库"), "知识") {
		t.Fatal("CJK indexing missing")
	}
}
