package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"nebulaekno/internal/bootstrap"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"time"
)

type Model struct {
	ID           string         `json:"id"`
	ConnectionID string         `json:"connection_id,omitempty"`
	Name         string         `json:"name"`
	Purpose      string         `json:"purpose"`
	Protocol     string         `json:"protocol"`
	BaseURL      string         `json:"base_url"`
	ModelName    string         `json:"model_name"`
	APIKey       string         `json:"api_key,omitempty"`
	ClearAPIKey  bool           `json:"clear_api_key,omitempty"`
	Dimension    *int           `json:"dimension,omitempty"`
	Config       map[string]any `json:"config"`
}
type Error struct {
	Code, Message string
	Retryable     bool
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }
func Missing(purpose string) error {
	return &Error{Code: "MODEL_NOT_CONFIGURED", Message: "请配置并绑定" + purpose + "模型"}
}
func Load(ctx context.Context, s *bootstrap.Services, id string) (Model, error) {
	var m Model
	var encrypted []byte
	e := s.DB.QueryRow(ctx, "SELECT m.id::text,m.name,m.purpose,m.protocol,coalesce(c.base_url,m.base_url),m.model_name,CASE WHEN m.connection_id IS NOT NULL THEN c.secret ELSE m.secret END,m.dimension,m.config,coalesce(m.connection_id::text,'') FROM models m LEFT JOIN model_connections c ON c.id=m.connection_id WHERE m.id::text=$1", id).Scan(&m.ID, &m.Name, &m.Purpose, &m.Protocol, &m.BaseURL, &m.ModelName, &encrypted, &m.Dimension, &m.Config, &m.ConnectionID)
	if e != nil {
		return m, Missing("指定用途")
	}
	m.APIKey, e = s.Identity.Decrypt(encrypted)
	if e != nil {
		return m, &Error{Code: "CREDENTIAL_DECRYPT_FAILED", Message: "无法解密模型凭证"}
	}
	return m, nil
}
func Bound(ctx context.Context, s *bootstrap.Services, purpose string, overrides map[string]any) (Model, error) {
	var bindings map[string]any
	if e := s.DB.QueryRow(ctx, "SELECT value FROM settings WHERE key='model-bindings'").Scan(&bindings); e != nil {
		return Model{}, Missing(purpose)
	}
	if nested, ok := overrides["model_bindings"].(map[string]any); ok {
		for k, v := range nested {
			bindings[k] = v
		}
	}
	id, _ := bindings[purpose].(string)
	if id == "" && purpose == "outline" {
		id, _ = bindings["text"].(string)
	}
	if id == "" {
		return Model{}, Missing(purpose)
	}
	m, e := Load(ctx, s, id)
	if e != nil {
		return m, e
	}
	if !SupportsPurpose(m.Purpose, purpose) {
		return Model{}, Missing(purpose)
	}
	return m, nil
}
func Validate(m Model) string {
	u, e := url.Parse(m.BaseURL)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "模型地址必须为有效的 HTTP(S) 基础 URL"
	}
	if strings.TrimSpace(m.Name) == "" || strings.TrimSpace(m.ModelName) == "" {
		return "模型名称和服务模型标识必填"
	}
	if m.Purpose == "multimodal_embedding" && m.Protocol != "jina" {
		return "图片向量使用 jina 兼容协议"
	}
	if m.Protocol != "openai" && m.Protocol != "jina" {
		return "协议须为 openai 或 jina"
	}
	if value, exists := m.Config["allow_image_input"]; exists {
		if _, ok := value.(bool); !ok {
			return "allow_image_input 必须为布尔值"
		}
	}
	for name, bounds := range map[string][2]float64{"timeout_seconds": {5, 600}, "max_concurrency": {1, 128}} {
		if v, exists := m.Config[name]; exists {
			n, ok := v.(float64)
			if !ok || n < bounds[0] || n > bounds[1] || n != float64(int(n)) {
				return name + " 超出允许范围"
			}
		}
	}
	if m.Dimension != nil && (*m.Dimension < 1 || *m.Dimension > 16000) {
		return "向量维度须为 1–16000"
	}
	return ""
}
func request(ctx context.Context, m Model, path string, body any, out any) error {
	b, e := json.Marshal(body)
	if e != nil {
		return e
	}
	return rawRequest(ctx, m, path, "application/json", bytes.NewReader(b), out)
}
func rawRequest(ctx context.Context, m Model, path, contentType string, body io.Reader, out any) error {
	release, e := acquire(ctx, m)
	if e != nil {
		return e
	}
	defer release()
	timeout := 300 * time.Second
	if v, ok := m.Config["timeout_seconds"].(float64); ok && v >= 5 && v <= 600 {
		timeout = time.Duration(v) * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, e := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(m.BaseURL, "/")+path, body)
	if e != nil {
		return &Error{Code: "MODEL_CONFIG_INVALID", Message: "模型 URL 无效"}
	}
	req.Header.Set("Content-Type", contentType)
	if m.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+m.APIKey)
	}
	client := &http.Client{Timeout: timeout, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}
	r, e := client.Do(req)
	if e != nil {
		return &Error{Code: "UPSTREAM_UNAVAILABLE", Message: "模型请求失败或超时", Retryable: true}
	}
	defer r.Body.Close()
	if r.StatusCode < 200 || r.StatusCode >= 300 {
		return &Error{Code: "MODEL_REQUEST_FAILED", Message: fmt.Sprintf("模型返回 HTTP %d", r.StatusCode), Retryable: r.StatusCode == 429 || r.StatusCode >= 500}
	}
	if e = json.NewDecoder(io.LimitReader(r.Body, 32<<20)).Decode(out); e != nil {
		return &Error{Code: "MODEL_RESPONSE_INVALID", Message: "模型响应不是有效 JSON"}
	}
	return nil
}

// Vision models accept images by purpose; text models must explicitly opt in.
func AllowsImageInput(m Model) bool {
	allowed, _ := m.Config["allow_image_input"].(bool)
	return m.Purpose == "vision" || m.Purpose == "text" && allowed
}

func Chat(ctx context.Context, m Model, prompt string, images []string) (string, error) {
	if len(images) > 0 && !AllowsImageInput(m) {
		return "", &Error{Code: "IMAGE_INPUT_DISABLED", Message: "该模型未允许图片输入，请在模型设置中开启后再使用图片"}
	}
	var content any = prompt
	if len(images) > 0 {
		parts := []any{map[string]any{"type": "text", "text": prompt}}
		for _, image := range images {
			parts = append(parts, map[string]any{"type": "image_url", "image_url": map[string]string{"url": image}})
		}
		content = parts
	}
	var out struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	e := request(ctx, m, "/chat/completions", map[string]any{"model": m.ModelName, "messages": []any{map[string]any{"role": "user", "content": content}}, "temperature": 0, "stream": false}, &out)
	if e != nil {
		return "", e
	}
	if len(out.Choices) == 0 || strings.TrimSpace(out.Choices[0].Message.Content) == "" {
		return "", &Error{Code: "MODEL_RESPONSE_INVALID", Message: "模型未返回内容"}
	}
	if out.Choices[0].FinishReason == "length" {
		return out.Choices[0].Message.Content, &Error{Code: "MODEL_OUTPUT_TRUNCATED", Message: "模型输出达到长度限制，未接受截断结果；请检查模型服务输出上限", Retryable: true}
	}
	if out.Choices[0].FinishReason == "content_filter" {
		return out.Choices[0].Message.Content, &Error{Code: "MODEL_OUTPUT_FILTERED", Message: "模型服务过滤了生成内容，未接受不完整结果"}
	}
	return out.Choices[0].Message.Content, nil
}
func Embeddings(ctx context.Context, m Model, inputs any) ([][]float64, error) {
	var out struct {
		Data []struct {
			Index     int       `json:"index"`
			Embedding []float64 `json:"embedding"`
		} `json:"data"`
	}
	e := request(ctx, m, "/embeddings", map[string]any{"model": m.ModelName, "input": inputs}, &out)
	if e != nil {
		return nil, e
	}
	vectors := make([][]float64, len(out.Data))
	inputValue := reflect.ValueOf(inputs)
	if inputValue.Kind() != reflect.Slice || inputValue.Len() != len(out.Data) {
		return nil, &Error{Code: "EMBEDDING_COUNT_MISMATCH", Message: "向量数量与输入不一致"}
	}
	for _, v := range out.Data {
		if v.Index < 0 || v.Index >= len(vectors) || len(v.Embedding) == 0 || len(v.Embedding) > 16000 || vectors[v.Index] != nil {
			return nil, &Error{Code: "MODEL_RESPONSE_INVALID", Message: "向量索引或数据无效"}
		}
		vectors[v.Index] = v.Embedding
	}
	if len(vectors) == 0 {
		return nil, &Error{Code: "MODEL_RESPONSE_INVALID", Message: "模型未返回向量"}
	}
	for _, v := range vectors {
		norm := 0.0
		for _, number := range v {
			if math.IsNaN(number) || math.IsInf(number, 0) {
				return nil, &Error{Code: "MODEL_RESPONSE_INVALID", Message: "向量包含无效数值"}
			}
			norm += number * number
		}
		if norm == 0 || math.IsInf(norm, 0) {
			return nil, &Error{Code: "MODEL_RESPONSE_INVALID", Message: "向量不能为零或溢出"}
		}
		if len(v) != len(vectors[0]) || m.Dimension != nil && len(v) != *m.Dimension {
			return nil, &Error{Code: "EMBEDDING_DIMENSION_MISMATCH", Message: "向量维度与模型配置不匹配"}
		}
	}
	return vectors, nil
}
func ParseJSON(text string, out any) error {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "```") {
		if i := strings.Index(text, "\n"); i >= 0 {
			text = text[i+1:]
		}
		text = strings.TrimSuffix(strings.TrimSpace(text), "```")
	}
	if e := json.Unmarshal([]byte(text), out); e != nil {
		return &Error{Code: "MODEL_RESPONSE_INVALID", Message: "生成内容未满足结构化 JSON 要求"}
	}
	return nil
}
