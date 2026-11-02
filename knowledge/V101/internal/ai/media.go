package ai

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
)

type Transcript struct {
	Text     string `json:"text"`
	Segments []struct {
		Start float64 `json:"start"`
		End   float64 `json:"end"`
		Text  string  `json:"text"`
	} `json:"segments"`
}

func Transcribe(ctx context.Context, m Model, path string) (Transcript, error) {
	var out Transcript
	file, e := os.Open(path)
	if e != nil {
		return out, e
	}
	defer file.Close()
	var b bytes.Buffer
	writer := multipart.NewWriter(&b)
	part, e := writer.CreateFormFile("file", filepath.Base(path))
	if e != nil {
		return out, e
	}
	if _, e = io.Copy(part, file); e != nil {
		return out, e
	}
	writer.WriteField("model", m.ModelName)
	writer.WriteField("response_format", "verbose_json")
	writer.WriteField("timestamp_granularities[]", "segment")
	writer.Close()
	e = rawRequest(ctx, m, "/audio/transcriptions", writer.FormDataContentType(), &b, &out)
	return out, e
}

type Rank struct {
	Index int     `json:"index"`
	Score float64 `json:"relevance_score"`
}

func Rerank(ctx context.Context, m Model, query string, documents []string) ([]Rank, error) {
	var out struct {
		Results []Rank `json:"results"`
	}
	e := request(ctx, m, "/rerank", map[string]any{"model": m.ModelName, "query": query, "documents": documents, "top_n": len(documents)}, &out)
	if e != nil {
		return nil, e
	}
	if len(out.Results) != len(documents) {
		return nil, &Error{Code: "MODEL_RESPONSE_INVALID", Message: "重排结果数量不完整"}
	}
	seen := map[int]bool{}
	for _, rank := range out.Results {
		if rank.Index < 0 || rank.Index >= len(documents) || seen[rank.Index] {
			return nil, &Error{Code: "MODEL_RESPONSE_INVALID", Message: "重排结果索引无效"}
		}
		seen[rank.Index] = true
	}
	return out.Results, nil
}
