package extraction

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"nebulaekno/internal/ai"
	"nebulaekno/internal/bootstrap"
)

const InternalPurpose = "extraction-model"
const InternalTokenHeader = "X-NebulaeKno-Internal-Token"
const ModelGatewayPath = "/internal/extraction/model-completions"

type ModelRequest struct {
	TaskID string         `json:"task_id"`
	RunID  string         `json:"run_id"`
	Owner  string         `json:"owner"`
	Body   map[string]any `json:"body"`
}

func mainCompletion(ctx context.Context, id bootstrap.Identity, mainURL string, input ModelRequest) (json.RawMessage, error) {
	raw, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(mainURL, "/")+ModelGatewayPath, bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(InternalTokenHeader, id.InternalToken(InternalPurpose))
	client := http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return nil, &ai.Error{Code: "MAIN_UNAVAILABLE", Message: "主系统模型调用暂不可用", Retryable: true}
	}
	defer response.Body.Close()
	var result struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
		Error   struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			Retryable bool   `json:"retryable"`
		} `json:"error"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 40<<20)).Decode(&result); err != nil {
		return nil, &ai.Error{Code: "MAIN_RESPONSE_INVALID", Message: "主系统返回无效模型响应", Retryable: true}
	}
	if response.StatusCode != 200 || !result.Success {
		return nil, &ai.Error{Code: result.Error.Code, Message: result.Error.Message, Retryable: result.Error.Retryable}
	}
	return result.Data, nil
}
