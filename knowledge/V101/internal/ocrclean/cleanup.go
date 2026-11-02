// Package ocrclean derives a display projection. It never rewrites source text.
package ocrclean

import (
	"strings"
	"unicode"
)

const Algorithm = "region-loop-v1"
const Message = "检测到同一区域的循环重复，已清理展示；原始 OCR 和定位已保留，内容仍需核验。"

// Range uses Unicode code point offsets in the original, immutable text.
type Range struct {
	Start int `json:"char_start"`
	End   int `json:"char_end"`
}
type Result struct {
	Algorithm         string  `json:"algorithm"`
	Message           string  `json:"message"`
	NeedsReview       bool    `json:"needs_review"`
	RemovedCharacters int     `json:"removed_characters"`
	Removals          []Range `json:"removals"`
}

// Detect only high-volume, adjacent, exact loops. Do not clean tables, numeric
// runs, generated descriptions or native text, and never compare separate blocks.
func Detect(text, origin, kind string) *Result {
	if !strings.Contains(origin, "ocr") || (kind != "image" && kind != "text") || strings.ContainsAny(text, "<>|") {
		return nil
	}
	runes := []rune(text)
	type token struct {
		start, end int
		value      string
	}
	tokens := []token{}
	for i := 0; i < len(runes); {
		if unicode.IsSpace(runes[i]) {
			i++
			continue
		}
		start := i
		for i < len(runes) && !unicode.IsSpace(runes[i]) {
			i++
		}
		tokens = append(tokens, token{start, i, string(runes[start:i])})
	}
	if len(tokens) < 8 {
		return nil
	}
	ends := make([]int, len(tokens))
	// LCP at each token distance bounds work to O(12*n), including huge loops.
	for width := 1; width <= 12 && width*8 <= len(tokens); width++ {
		matches := make([]int, len(tokens)+1)
		for i := len(tokens) - width - 1; i >= 0; i-- {
			if tokens[i].value == tokens[i+width].value {
				matches[i] = matches[i+1] + 1
			}
			repeats := 1 + matches[i]/width
			if repeats < 8 {
				continue
			}
			unitEnd := tokens[i+width-1].end
			if unitEnd-tokens[i].start > 160 {
				continue
			}
			letters := 0
			for _, r := range runes[tokens[i].start:unitEnd] {
				if unicode.IsLetter(r) {
					letters++
				}
			}
			if letters < 3 {
				continue
			}
			last := i + repeats*width - 1
			if tokens[last].end-unitEnd < 160 {
				continue
			}
			// The smallest period preserves one complete original phrase cycle.
			if ends[i] == 0 {
				ends[i] = width
			}
		}
	}
	removed := []Range{}
	for i := 0; i < len(tokens); i++ {
		width := ends[i]
		if width == 0 {
			continue
		}
		last := i + width
		for last+width <= len(tokens) {
			match := true
			for j := 0; j < width; j++ {
				if tokens[i+j].value != tokens[last+j].value {
					match = false
					break
				}
			}
			if !match {
				break
			}
			last += width
		}
		removed = append(removed, Range{tokens[i+width-1].end, tokens[last-1].end})
		i = last - 1
	}
	return New(removed)
}

func New(ranges []Range) *Result {
	if len(ranges) == 0 {
		return nil
	}
	n := 0
	for _, r := range ranges {
		n += r.End - r.Start
	}
	return &Result{Algorithm, Message, true, n, ranges}
}

func Apply(raw string, result *Result) string {
	if result == nil {
		return raw
	}
	runes := []rune(raw)
	var out strings.Builder
	cursor := 0
	for _, r := range result.Removals {
		if r.Start < cursor || r.End < r.Start || r.End > len(runes) {
			return raw
		}
		out.WriteString(string(runes[cursor:r.Start]))
		cursor = r.End
	}
	out.WriteString(string(runes[cursor:]))
	return out.String()
}

// Slice projects a raw substring without re-detecting loops at chunk boundaries.
func Slice(result *Result, start, end int) *Result {
	if result == nil {
		return nil
	}
	ranges := []Range{}
	for _, r := range result.Removals {
		a, b := max(start, r.Start), min(end, r.End)
		if b > a {
			ranges = append(ranges, Range{a - start, b - start})
		}
	}
	return New(ranges)
}
