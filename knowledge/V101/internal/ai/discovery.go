package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// DiscoveryBase accepts a service root or an existing API prefix.
func DiscoveryBase(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", &Error{Code: "MODEL_CONFIG_INVALID", Message: "请填写有效的 HTTP(S) 模型服务地址"}
	}
	u.Path = strings.TrimRight(u.Path, "/")
	if u.Path == "" {
		u.Path = "/v1"
	}
	return u.String(), nil
}

func DiscoverModels(ctx context.Context, base, key string) ([]string, error) {
	base, err := DiscoveryBase(base)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", base+"/models", nil)
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return nil, &Error{Code: "UPSTREAM_UNAVAILABLE", Message: "模型列表请求失败或超时，请检查地址和网络"}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, &Error{Code: "MODEL_DISCOVERY_FAILED", Message: fmt.Sprintf("模型列表返回 HTTP %d，请检查地址、凭证或服务是否支持 /models", response.StatusCode)}
	}
	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&result); err != nil || result.Data == nil {
		return nil, &Error{Code: "MODEL_RESPONSE_INVALID", Message: "模型列表格式无效，应返回 data 数组和 id 字段"}
	}
	ids := []string{}
	seen := map[string]bool{}
	for _, item := range result.Data {
		id := strings.TrimSpace(item.ID)
		if id != "" && !seen[id] {
			ids = append(ids, id)
			seen[id] = true
		}
	}
	sort.Strings(ids)
	return ids, nil
}
