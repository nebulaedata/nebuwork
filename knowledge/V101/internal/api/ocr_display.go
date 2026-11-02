package api

import (
	"context"
	"encoding/json"
	"nebulaekno/internal/jobs"
	"nebulaekno/internal/ocrclean"
	"strings"
	"unicode"
)

type ocrDisplay struct {
	raw     string
	cleanup *ocrclean.Result
}

func (s *Server) ocrDisplays(ctx context.Context, ids []string) (map[string]ocrDisplay, error) {
	out := map[string]ocrDisplay{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, e := s.Services.DB.Query(ctx, "SELECT id::text,content,metadata FROM parse_versions WHERE id=ANY($1::uuid[])", ids)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var id, raw string
		var metadata []byte
		var parsed jobs.Parsed
		if e = rows.Scan(&id, &raw, &metadata); e != nil {
			return nil, e
		}
		if e = json.Unmarshal(metadata, &parsed); e != nil {
			return nil, e
		}
		out[id] = ocrDisplay{raw, jobs.OCRDisplay(parsed, raw)}
	}
	return out, rows.Err()
}

func numberOffset(value any) int {
	switch n := value.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return -1
}

func applyOCRField(value map[string]any, rawKey, displayKey string, result *ocrclean.Result) {
	raw, _ := value[rawKey].(string)
	value[displayKey] = ocrclean.Apply(raw, result)
	value["ocr_cleanup"] = result
}

func (display ocrDisplay) project(value map[string]any, rawKey, displayKey string) {
	raw, _ := value[rawKey].(string)
	start, end := numberOffset(value["char_start"]), numberOffset(value["char_end"])
	runes := []rune(display.raw)
	var result *ocrclean.Result
	if start >= 0 && end >= start && end <= len(runes) {
		segment := string(runes[start:end])
		// source_refs.quote is trimmed, whereas chunks.content retains whitespace.
		if segment != raw && strings.TrimSpace(segment) == raw {
			start += len([]rune(segment)) - len([]rune(strings.TrimLeftFunc(segment, unicode.IsSpace)))
			end = start + len([]rune(raw))
			segment = string(runes[start:end])
		}
		if segment == raw {
			result = ocrclean.Slice(display.cleanup, start, end)
		}
	}
	applyOCRField(value, rawKey, displayKey, result)
}

func imageOCRView(value map[string]any) {
	var blocks []jobs.Block
	data, _ := json.Marshal(value["_ocr_blocks"])
	_ = json.Unmarshal(data, &blocks)
	delete(value, "_ocr_blocks")
	raw, _ := value["recognized_text"].(string)
	applyOCRField(value, "recognized_text", "display_recognized_text", jobs.OCRDisplay(jobs.Parsed{Blocks: blocks}, raw))
}
