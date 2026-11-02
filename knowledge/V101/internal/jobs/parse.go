package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"io"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/defaults"
	"nebulaekno/internal/ocrclean"
	"nebulaekno/internal/textutil"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

type Block struct {
	ContextText      string           `json:"context_text,omitempty"`
	ContextSources   []TableContext   `json:"context_sources,omitempty"`
	BlockType        string           `json:"block_type,omitempty"`
	VisualRole       string           `json:"visual_role,omitempty"`
	PreviewImagePath string           `json:"preview_image_path,omitempty"`
	Layout           map[string]any   `json:"layout,omitempty"`
	Warning          string           `json:"warning,omitempty"`
	OCRCleanup       *ocrclean.Result `json:"ocr_cleanup,omitempty"`
	DisplayText      *string          `json:"display_text,omitempty"`
	Text             string           `json:"text"`
	Method           string           `json:"method"`
	Locator          map[string]any   `json:"locator"`
	Precision        string           `json:"precision"`
	Level            int              `json:"level"`
	Title            *string          `json:"title"`
	ImagePath        string           `json:"image_path"`
	Cells            []any            `json:"cells,omitempty"`
}
type Parsed struct {
	Conversion          map[string]any   `json:"conversion,omitempty"`
	Spreadsheet         map[string]any   `json:"spreadsheet,omitempty"`
	VisualLayoutVersion int              `json:"visual_layout_version,omitempty"`
	Warnings            []map[string]any `json:"warnings,omitempty"`
	Blocks              []Block          `json:"blocks"`
	Outline             []map[string]any `json:"outline"`
	Assets              []map[string]any `json:"assets"`
	Media               map[string]any   `json:"media"`
	PreviewPath         *string          `json:"preview_path"`
	Engine              string           `json:"engine"`
	Error               string           `json:"error"`
}

func (w *Worker) parse(ctx context.Context, t *Task) error {
	reuseParsed := t.Checkpoint["parse"] == "succeeded"
	if e := w.stage(ctx, t, "parse", "running"); e != nil {
		return e
	}
	var path, fileID string
	if e := w.Services.DB.QueryRow(ctx, "SELECT f.path,f.id::text FROM knowledge k JOIN file_versions f ON f.id=k.current_file_version_id WHERE k.id=$1", t.KnowledgeID).Scan(&path, &fileID); e != nil {
		return fmt.Errorf("源文件记录不存在")
	}
	version := uuid.NewString()
	output := filepath.Join(w.Config.DataDir, "derived", t.KnowledgeID, version)
	options := map[string]any{}
	for k, v := range t.Config {
		options[k] = v
	}
	options["max_duration_seconds"] = w.Config.MediaMaxDuration
	var subtitlePath string
	_ = w.Services.DB.QueryRow(ctx, "SELECT path FROM media_subtitles WHERE file_version_id=$1 AND ($2='' OR id::text=$2) ORDER BY created_at DESC LIMIT 1", fileID, func() string { v, _ := t.Config["subtitle_track_id"].(string); return v }()).Scan(&subtitlePath)
	if subtitlePath != "" {
		options["subtitle_path"] = subtitlePath
	}
	var parsed Parsed
	if reuseParsed {
		var previous []byte
		if e := w.Services.DB.QueryRow(ctx, "SELECT metadata FROM parse_versions WHERE knowledge_id=$1 AND id=$2", t.KnowledgeID, t.Checkpoint["parse_version_id"]).Scan(&previous); e != nil {
			return e
		}
		if json.Unmarshal(previous, &parsed) != nil {
			return fmt.Errorf("已保存解析检查点无效")
		}
	} else {
		engines, _ := options["parser_engines"].(map[string]any)
		_, engine := defaults.ParserForExtension(filepath.Ext(path), engines)
		if engine == "paddleocr_vl" {
			var connections map[string]any
			if e := w.Services.DB.QueryRow(ctx, "SELECT value FROM settings WHERE key='parser-engines'").Scan(&connections); e != nil {
				return e
			}
			paddle, _ := connections["paddleocr_vl"].(map[string]any)
			if endpoint, _ := paddle["endpoint"].(string); endpoint == "" {
				if e := w.stage(ctx, t, "parse", "waiting_configuration"); e != nil {
					return e
				}
				return &ai.Error{Code: "PARSER_NOT_CONFIGURED", Message: "请在设置 → 解析引擎填写 PaddleOCR-VL 服务地址，或为此知识库选择本地解析引擎"}
			}
			options["paddleocr_vl"] = paddle
		}
		body, _ := json.Marshal(map[string]any{"job_id": t.Owner, "path": path, "output": output, "options": options})
		req, _ := http.NewRequestWithContext(ctx, "POST", "http://127.0.0.1:8091/parse", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		client := http.Client{Timeout: 31 * time.Minute}
		type result struct {
			response *http.Response
			err      error
		}
		results := make(chan result, 1)
		requestCtx, stopRequest := context.WithCancel(ctx)
		defer stopRequest()
		stopCancel := context.AfterFunc(requestCtx, func() {
			b, _ := json.Marshal(map[string]string{"job_id": t.Owner})
			client := http.Client{Timeout: 3 * time.Second}
			r, e := client.Post("http://127.0.0.1:8091/cancel", "application/json", bytes.NewReader(b))
			if e == nil {
				r.Body.Close()
			}
		})
		defer stopCancel()
		req = req.WithContext(requestCtx)
		go func() { r, e := client.Do(req); results <- result{r, e} }()
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		var response *http.Response
		var e error
		var progressError error
	waiting:
		for {
			select {
			case got := <-results:
				response, e = got.response, got.err
				break waiting
			case <-tick.C:
				if pe := w.readerProgress(ctx, t, output); pe != nil {
					progressError = pe
					stopRequest()
				}
			}
		}
		if response != nil {
			defer response.Body.Close()
		}
		if progressError != nil {
			return progressError
		}
		if pe := w.readerProgress(ctx, t, output); pe != nil {
			return pe
		}
		if e != nil {
			return fmt.Errorf("解析进程请求失败")
		}
		if response.StatusCode != 200 || json.NewDecoder(io.LimitReader(response.Body, 128<<20)).Decode(&parsed) != nil {
			return fmt.Errorf("解析结果无效")
		}
		if parsed.Error != "" {
			if strings.HasPrefix(parsed.Error, "WPS_") {
				return &ai.Error{Code: parsed.Error, Message: WPSErrorMessage(parsed.Error)}
			}
			if strings.HasPrefix(parsed.Error, "SPREADSHEET_") {
				message := "工作表读取失败，请检查文件是否损坏、格式与扩展名是否一致；未切换解析引擎"
				switch parsed.Error {
				case "SPREADSHEET_ENCRYPTED", "SPREADSHEET_ENCRYPTED_OR_MISNAMED":
					message = "工作簿已加密或格式与扩展名不符，请提供未加密且扩展名正确的 XLS/XLSX 文件"
				case "SPREADSHEET_CELL_LIMIT_EXCEEDED":
					message = "工作表超过读取限制：每表最多 200000 行、工作簿行列范围合计最多 2000000 个单元格；请拆分文件，未截断后入库"
				case "SPREADSHEET_MEMORY_LIMIT_EXCEEDED":
					message = "工作表读取超过解析内存限制，请拆分文件或调整解析内存配置；未保存不完整结果"
				}
				return &ai.Error{Code: parsed.Error, Message: message}
			}
			if strings.HasPrefix(parsed.Error, "OFD_") {
				return fmt.Errorf("OFD 页面渲染失败（%s），未切换为碎片文本解析；请检查文件是否加密、损坏或包含不支持的页面结构", parsed.Error)
			}
			if parsed.Error == "PADDLE_REQUEST_FAILED" {
				return &ai.Error{Code: "PARSER_REQUEST_FAILED", Message: "PaddleOCR-VL 解析请求失败，请检查服务地址和 Pipeline 状态", Retryable: true}
			}
			if parsed.Error == "PADDLE_LAYOUT_REQUIRED" {
				return fmt.Errorf("PaddleOCR 未返回版面区域，请启用版面检测后重新处理；整页图不会用于图片理解")
			}
			if parsed.Error == "PADDLE_IMAGE_BBOX_INVALID" {
				return fmt.Errorf("PaddleOCR 图片区域坐标缺失或越界，无法可靠裁剪；请检查解析服务后重试")
			}
			return fmt.Errorf("解析失败: %s", parsed.Error)
		}
	}
	if parsed.Media != nil {
		if e := w.transcribe(ctx, t, &parsed); e != nil {
			if t.Pipeline != nil {
				for _, s := range t.Pipeline.Stages {
					if s.Name == "parse" {
						for _, c := range s.Children {
							closeSpan(c, "failed", time.Now().UTC())
						}
					}
				}
			}
			t.Checkpoint["transcription"] = "failed"
			t.Checkpoint["transcription_error"] = map[string]any{"code": "TRANSCRIPTION_FAILED", "message": e.Error(), "retryable": true}
		}
	}
	text := strings.Builder{}
	for _, b := range parsed.Blocks {
		text.WriteString(b.Text)
		text.WriteByte('\n')
	}
	if e := w.progress(ctx, t, "save_chunks", "", 0, 0, 0); e != nil {
		return e
	}
	inspectParsedOCR(&parsed)
	registerVisualAssets(&parsed)
	metadata, _ := json.Marshal(parsed)
	tx, e := w.Services.DB.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(context.Background())
	if e = Owned(ctx, tx, t); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO parse_versions(id,knowledge_id,file_version_id,engine,content,metadata) VALUES($1,$2,$3,$4,$5,$6)", version, t.KnowledgeID, fileID, parsed.Engine, text.String(), metadata)
	if e != nil {
		return e
	}
	size := Number(t.Config, "chunk_size", 512)
	overlap := Number(t.Config, "chunk_overlap", 80)
	offset, ordinal := 0, 0
	for _, b := range parsed.Blocks {
		loc, _ := json.Marshal([]any{b.Locator})
		spans := blockSpans(b, size, overlap)
		if len(spans) == 0 && b.ImagePath != "" {
			spans = textutil.Split(" ", size, overlap)
		}
		for _, span := range spans {
			if strings.TrimSpace(span.Text) == "" && b.ImagePath == "" {
				continue
			}
			source, chunk := uuid.NewString(), uuid.NewString()
			precision := b.Precision
			if precision == "" {
				precision = "document"
			}
			origin := b.Method
			if origin == "" {
				origin = "native"
			}
			contextIDs, err := saveTableContext(ctx, tx, t.KnowledgeID, fileID, version, b)
			if err != nil {
				return err
			}
			meta, _ := json.Marshal(map[string]any{"image_path": b.ImagePath, "cells": b.Cells, "block_type": b.BlockType, "layout": b.Layout, "visual_role": b.VisualRole, "warning": b.Warning, "context_source_ref_ids": contextIDs, "context_text": b.ContextText})
			end := offset + span.End
			if end > offset+len([]rune(b.Text)) {
				end = offset + len([]rune(b.Text))
			}
			_, e = tx.Exec(ctx, "INSERT INTO source_refs(id,knowledge_id,file_version_id,parse_version_id,locators,quote,precision,char_start,char_end,origin,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", source, t.KnowledgeID, fileID, version, loc, strings.TrimSpace(span.Text), precision, offset+span.Start, end, origin, meta)
			if e != nil {
				return e
			}
			chunkText := b.ContextText + span.Text
			indexText := textutil.Tokens(chunkText)
			if b.OCRCleanup != nil {
				indexText = ""
			}
			_, e = tx.Exec(ctx, "INSERT INTO chunks(id,knowledge_id,parse_version_id,source_ref_id,ordinal,content,search_vector) VALUES($1,$2,$3,$4,$5,$6,to_tsvector('simple',$7))", chunk, t.KnowledgeID, version, source, ordinal, chunkText, indexText)
			if e != nil {
				return e
			}
			ordinal++
		}
		offset += len([]rune(b.Text)) + 1
	}
	for _, asset := range parsed.Assets {
		asset["parse_version_id"] = version
		b, _ := json.Marshal(asset)
		_, e = tx.Exec(ctx, "INSERT INTO assets(id,knowledge_id,file_version_id,kind,path,metadata) VALUES($1,$2,$3,$4,$5,$6)", uuid.NewString(), t.KnowledgeID, fileID, asset["kind"], asset["path"], b)
		if e != nil {
			return e
		}
	}
	if parsed.Media != nil {
		b, _ := json.Marshal(parsed.Media)
		_, e = tx.Exec(ctx, "INSERT INTO media(file_version_id,duration_ms,metadata) VALUES($1,$2,$3) ON CONFLICT(file_version_id) DO UPDATE SET duration_ms=excluded.duration_ms,metadata=excluded.metadata", fileID, parsed.Media["duration_ms"], b)
		if e != nil {
			return e
		}
	}
	_, e = tx.Exec(ctx, `UPDATE wiki_pages SET state='stale',search_vector=''::tsvector WHERE source_ids ?| ARRAY(SELECT id::text FROM source_refs WHERE knowledge_id=$1 AND parse_version_id<>$2)`, t.KnowledgeID, version)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "UPDATE knowledge SET current_parse_version_id=$2,status='processing',updated_at=now() WHERE id=$1", t.KnowledgeID, version)
	if e != nil {
		return e
	}
	for _, stage := range []string{"images", "image_embedding", "outline", "embedding", "wiki", "graph"} {
		delete(t.Checkpoint, stage)
	}
	delete(t.Checkpoint, "wiki_batches")
	delete(t.Checkpoint, "wiki_retry_only")
	delete(t.Checkpoint, "graph_batches")
	delete(t.Checkpoint, "graph_retry_only")
	t.traceStage("parse", "succeeded")
	t.traceStage("keyword", "succeeded")
	t.Checkpoint["parse"] = "succeeded"
	t.Checkpoint["keyword"] = "succeeded"
	t.Checkpoint["parse_version_id"] = version
	checkpoint, _ := json.Marshal(t.Checkpoint)
	_, e = tx.Exec(ctx, "UPDATE tasks SET checkpoint=$2,stage='keyword' WHERE id=$1", t.ID, checkpoint)
	if e != nil {
		return e
	}
	if e = tx.Commit(ctx); e != nil {
		t.Checkpoint["parse"] = "failed"
		return e
	}
	return nil
}

type Chunk struct {
	ID       string `json:"chunk_id"`
	SourceID string `json:"source_ref_id"`
	Content  string `json:"content"`
}

func (w *Worker) chunks(ctx context.Context, t *Task) ([]Chunk, error) {
	rows, e := w.Services.DB.Query(ctx, "SELECT c.id::text,c.source_ref_id::text,c.content FROM chunks c JOIN source_refs s ON s.id=c.source_ref_id WHERE c.knowledge_id=$1 AND c.parse_version_id::text=$2 AND "+SemanticSourceSQL+" ORDER BY c.ordinal", t.KnowledgeID, t.Checkpoint["parse_version_id"])
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []Chunk{}
	for rows.Next() {
		var c Chunk
		if e = rows.Scan(&c.ID, &c.SourceID, &c.Content); e != nil {
			return nil, e
		}
		// Image anchors can have an empty OCR body. Keep their source/chunk for
		// display, but only feed real text or the separately saved caption to AI.
		if strings.TrimSpace(c.Content) != "" {
			out = append(out, c)
		}
	}
	return out, rows.Err()
}

// Layout tables and images are semantic units. Splitting HTML by character count
// corrupts merged cells and loses the relationship to the detected region.
func blockSpans(b Block, size, overlap int) []textutil.Span {
	if (b.BlockType == "table" || b.BlockType == "image" || b.BlockType == "spreadsheet") && b.Text != "" {
		return []textutil.Span{{Text: b.Text, Start: 0, End: len([]rune(b.Text))}}
	}
	return textutil.Split(b.Text, size, overlap)
}
