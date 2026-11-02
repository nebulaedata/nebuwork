package textutil

import (
	"strings"
	"unicode"
)

// Tokens uses Latin words plus CJK unigrams/bigrams identically at index and query time.
func Tokens(s string) string {
	out := []string{}
	word := []rune{}
	previous := rune(0)
	flush := func() {
		if len(word) > 0 {
			out = append(out, strings.ToLower(string(word)))
			word = nil
		}
	}
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			flush()
			out = append(out, string(r))
			if previous != 0 {
				out = append(out, string([]rune{previous, r}))
			}
			previous = r
		} else {
			previous = 0
			if unicode.IsLetter(r) || unicode.IsDigit(r) {
				word = append(word, r)
			} else {
				flush()
			}
		}
	}
	flush()
	return strings.Join(out, " ")
}

type Span struct {
	Text       string
	Start, End int
}

func Split(s string, size, overlap int) []Span {
	r := []rune(s)
	out := []Span{}
	if size < 1 || overlap < 0 || overlap >= size {
		return out
	}
	for start := 0; start < len(r); {
		end := start + size
		if end >= len(r) {
			end = len(r)
		}
		out = append(out, Span{string(r[start:end]), start, end})
		if end == len(r) {
			break
		}
		start = end - overlap
	}
	return out
}
