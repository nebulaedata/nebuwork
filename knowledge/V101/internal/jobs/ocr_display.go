package jobs

import "nebulaekno/internal/ocrclean"

// OCRDisplay keeps full-region detection separate from chunking. In particular,
// a chunk in the middle of a repeated run must not retain another fake cycle.
func OCRDisplay(parsed Parsed, raw string) *ocrclean.Result {
	ranges := []ocrclean.Range{}
	runes := []rune(raw)
	offset := 0
	for _, b := range parsed.Blocks {
		end := offset + len([]rune(b.Text))
		if end > len(runes) || string(runes[offset:end]) != b.Text {
			return nil
		}
		if result := ocrclean.Detect(b.Text, b.Method, b.BlockType); result != nil {
			for _, r := range result.Removals {
				ranges = append(ranges, ocrclean.Range{Start: offset + r.Start, End: offset + r.End})
			}
		}
		offset = end + 1
	}
	return ocrclean.New(ranges)
}
