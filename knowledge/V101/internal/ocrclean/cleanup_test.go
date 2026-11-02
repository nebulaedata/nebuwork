package ocrclean

import (
	"strings"
	"testing"
)

func TestLoopsPreserveSurroundingTextAndUnicodeOffsets(t *testing.T) {
	for _, phrase := range []string{"智能体\n职业化能力\n\n", "无头集成\n垂控能力与性能\n无需产品界面参与\n", "业务能力 · ", "中文系统\r\n"} {
		raw := "原图😀标题\n" + strings.Repeat(phrase, 240) + "\n另外一段正常内容。"
		result := Detect(raw, "paddleocr_vl", "image")
		if result == nil {
			t.Fatal("loop missed", phrase)
		}
		cleaned := Apply(raw, result)
		if !strings.HasPrefix(cleaned, "原图😀标题\n") || !strings.HasSuffix(cleaned, "\n另外一段正常内容。") || strings.Count(cleaned, strings.Fields(phrase)[0]) != 1 {
			t.Fatal(cleaned)
		}
		if len([]rune(raw))-len([]rune(cleaned)) != result.RemovedCharacters {
			t.Fatal("wrong Unicode offsets")
		}
		if Detect(cleaned, "paddleocr_vl", "image") != nil {
			t.Fatal("not idempotent")
		}
		// Every chunk is projected against the original region, never re-detected.
		runes := []rune(raw)
		var joined strings.Builder
		for start := 0; start < len(runes); start += 37 {
			end := min(start+37, len(runes))
			joined.WriteString(Apply(string(runes[start:end]), Slice(result, start, end)))
		}
		if joined.String() != cleaned {
			t.Fatal("chunk projection changed retained text")
		}
	}
}

func TestDoNotTouchNormalTablesNumbersOrOtherOrigins(t *testing.T) {
	for _, example := range []struct{ text, origin, kind string }{
		{strings.Repeat("智能体\n职业化能力\n", 5), "paddleocr_vl", "image"},
		{strings.Repeat("0 1 0 1 ", 200), "paddleocr_vl", "image"},
		{strings.Repeat("智能体\n职业化能力\n", 200), "native", "image"},
		{strings.Repeat("智能体\n职业化能力\n", 200), "image_caption", "image"},
		{strings.Repeat("项目管理 正常内容 ", 200), "paddleocr_vl", "table"},
		{strings.Repeat("| 项目管理 | 正常内容 |\n", 200), "paddleocr_vl", "image"},
		{"<table>" + strings.Repeat("正常内容 ", 200) + "</table>", "paddleocr_vl", "text"},
	} {
		if Detect(example.text, example.origin, example.kind) != nil {
			t.Fatalf("false positive: %+v", example)
		}
	}
	var normal strings.Builder
	for i := 0; i < 200; i++ {
		normal.WriteRune(rune(0x4e00 + i))
		normal.WriteString(" 智能体 职业化能力\n")
	}
	if Detect(normal.String(), "paddleocr_vl", "image") != nil {
		t.Fatal("nonadjacent labels were deduplicated")
	}
}
