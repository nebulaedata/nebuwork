package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// StreamCompletion calls the provider's real SSE endpoint. It shares the same
// credentials, timeout and concurrency limits as non-streaming completions.
func StreamCompletion(ctx context.Context, m Model, messages []any, emit func(string) error) error {
	release, err := acquire(ctx, m)
	if err != nil {
		return err
	}
	defer release()
	timeout := 300 * time.Second
	if n, ok := m.Config["timeout_seconds"].(float64); ok && n >= 5 && n <= 600 {
		timeout = time.Duration(n) * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	body, err := json.Marshal(map[string]any{"model": m.ModelName, "messages": messages, "temperature": 0, "stream": true})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(m.BaseURL, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	if m.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+m.APIKey)
	}
	client := &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return &Error{Code: "UPSTREAM_UNAVAILABLE", Message: "模型流式请求失败或超时", Retryable: true}
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return &Error{Code: "MODEL_REQUEST_FAILED", Message: fmt.Sprintf("模型返回 HTTP %d", res.StatusCode), Retryable: res.StatusCode == 429 || res.StatusCode >= 500}
	}
	if !strings.Contains(res.Header.Get("Content-Type"), "text/event-stream") {
		return &Error{Code: "MODEL_STREAM_UNSUPPORTED", Message: "模型未返回 SSE 流，请选择支持流式回答的模型"}
	}
	return readCompletionStream(res.Body, emit)
}

func readCompletionStream(reader io.Reader, emit func(string) error) error {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 8192), 2<<20)
	var data []string
	finished := false
	flush := func() (bool, error) {
		if len(data) == 0 {
			return false, nil
		}
		raw := strings.Join(data, "\n")
		data = nil
		if strings.TrimSpace(raw) == "[DONE]" {
			return true, nil
		}
		var event struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Error json.RawMessage `json:"error"`
		}
		if json.Unmarshal([]byte(raw), &event) != nil {
			return false, &Error{Code: "MODEL_RESPONSE_INVALID", Message: "模型流包含无效 JSON"}
		}
		if len(event.Error) > 0 && string(event.Error) != "null" {
			return false, &Error{Code: "MODEL_STREAM_FAILED", Message: "模型在生成过程中返回错误", Retryable: true}
		}
		if len(event.Choices) > 0 {
			choice := event.Choices[0]
			if choice.Delta.Content != "" {
				if e := emit(choice.Delta.Content); e != nil {
					return false, e
				}
			}
			if choice.FinishReason != nil {
				switch *choice.FinishReason {
				case "stop":
					finished = true
				case "length":
					return false, &Error{Code: "MODEL_OUTPUT_TRUNCATED", Message: "模型输出达到长度上限，回答未完成"}
				default:
					return false, &Error{Code: "MODEL_STREAM_FAILED", Message: "模型未正常完成回答"}
				}
			}
		}
		return false, nil
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			done, e := flush()
			if e != nil {
				return e
			}
			if done {
				if !finished {
					return &Error{Code: "MODEL_STREAM_INTERRUPTED", Message: "模型未报告正常完成"}
				}
				return nil
			}
		} else if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return &Error{Code: "MODEL_STREAM_INTERRUPTED", Message: "模型流读取中断", Retryable: true}
	}
	_, err := flush()
	if err != nil {
		return err
	}
	if !finished {
		return &Error{Code: "MODEL_STREAM_INTERRUPTED", Message: "模型回答未完成，连接已关闭", Retryable: true}
	}
	return nil
}
