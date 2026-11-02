package jobs

import (
	"context"
	"encoding/json"
	"nebulaekno/internal/ocrclean"
	"strings"
	"unicode"
)

// Conservative anomaly signals, not a correctness score. Preserve the raw OCR.
// Numeric tables are deliberately excluded from the image-run heuristic.
func ocrAnomaly(text, origin, kind string) string {
	if !strings.Contains(origin, "ocr") {
		return ""
	}
	if ocrclean.Detect(text, origin, kind) != nil {
		return ocrclean.Message
	}
	tokens := strings.Fields(text)
	if len(tokens) < 128 {
		return ""
	}
	numeric, longest, run := 0, 0, 0
	counts := map[string]int{}
	maxCount := 0
	for _, token := range tokens {
		counts[token]++
		if counts[token] > maxCount {
			maxCount = counts[token]
		}
		digits, other := false, false
		for _, r := range token {
			if unicode.IsDigit(r) {
				digits = true
			} else if !strings.ContainsRune(".,+-−×φΦ/%°()", r) {
				other = true
			}
		}
		if digits && !other {
			numeric++
			run++
			if run > longest {
				longest = run
			}
		} else {
			run = 0
		}
	}
	if kind == "image" && longest >= 128 && numeric*100/len(tokens) >= 90 {
		return "图片区域 OCR 出现超过 128 个连续数字项，疑似识别循环；请核对裁剪图中的真实文字和数字"
	}
	if maxCount*100/len(tokens) >= 75 {
		return "OCR 出现大量重复词项，疑似重复识别；请核对原文区域"
	}
	return ""
}

func inspectParsedOCR(parsed *Parsed) {
	for i := range parsed.Blocks {
		b := &parsed.Blocks[i]
		b.OCRCleanup = ocrclean.Detect(b.Text, b.Method, b.BlockType)
		if b.OCRCleanup != nil {
			cleaned := ocrclean.Apply(b.Text, b.OCRCleanup)
			b.DisplayText = &cleaned
		}
		message := ocrAnomaly(b.Text, b.Method, b.BlockType)
		if message == "" {
			continue
		}
		b.Warning = "OCR_QUALITY_SUSPECT"
		parsed.Warnings = append(parsed.Warnings, map[string]any{"code": b.Warning, "message": message, "locator": b.Locator, "block_index": i})
	}
}

// Also scan old source records, so upgrading does not require reprocessing good OCR.
func (w *Worker) ocrIssues(ctx context.Context, t *Task) (map[string]GenerationIssue, error) {
	var raw []byte
	var parsed Parsed
	if e := w.Services.DB.QueryRow(ctx, "SELECT metadata FROM parse_versions WHERE knowledge_id=$1 AND id::text=$2", t.KnowledgeID, t.Checkpoint["parse_version_id"]).Scan(&raw); e != nil {
		return nil, e
	}
	if e := json.Unmarshal(raw, &parsed); e != nil {
		return nil, e
	}
	regions := []ocrclean.Range{}
	offset := 0
	for _, b := range parsed.Blocks {
		end := offset + len([]rune(b.Text))
		if ocrclean.Detect(b.Text, b.Method, b.BlockType) != nil {
			regions = append(regions, ocrclean.Range{Start: offset, End: end})
		}
		offset = end + 1
	}
	rows, e := w.Services.DB.Query(ctx, `SELECT id::text,quote,origin,coalesce(metadata->>'block_type',''),coalesce(metadata->>'warning',''),char_start,char_end FROM source_refs WHERE knowledge_id=$1 AND parse_version_id::text=$2`, t.KnowledgeID, t.Checkpoint["parse_version_id"])
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	issues := map[string]GenerationIssue{}
	for rows.Next() {
		var id, quote, origin, kind, warning string
		var start, end int
		if e = rows.Scan(&id, &quote, &origin, &kind, &warning, &start, &end); e != nil {
			return nil, e
		}
		message := ocrAnomaly(quote, origin, kind)
		if strings.Contains(origin, "ocr") {
			for _, region := range regions {
				if start < region.End && end > region.Start {
					message = ocrclean.Message
					break
				}
			}
		}
		if message == "" && warning == "OCR_QUALITY_SUSPECT" {
			message = "所属原文区域的 OCR 检测到异常，需核验后重新解析"
		}
		if message != "" {
			issues[id] = GenerationIssue{Field: "source.ocr", Message: message, SourceIDs: []string{id}, Excerpt: excerpt(quote)}
		}
	}
	return issues, rows.Err()
}
