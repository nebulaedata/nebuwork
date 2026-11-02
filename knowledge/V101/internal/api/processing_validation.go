package api

import (
	"nebulaekno/internal/defaults"
	"net/url"
	"strings"
)

func validateProcessing(v map[string]any) string {
	if raw, exists := v["parser_engines"]; exists {
		engines, ok := raw.(map[string]any)
		if !ok {
			return "parser_engines 必须为对象"
		}
		for category, rawEngine := range engines {
			engine, ok := rawEngine.(string)
			found := false
			for _, choice := range defaults.ParserChoices[category] {
				if choice == engine {
					found = true
				}
			}
			if !ok || !found {
				return "不支持的解析引擎或文件分类：" + category
			}
		}
	}
	if raw, exists := v["image_instructions"]; exists {
		value, ok := raw.(string)
		if !ok || len([]rune(value)) > 12000 {
			return "图片解析要求须为不超过 12000 字的文本"
		}
	}
	if raw, exists := v["extract_config"]; exists {
		cfg, ok := raw.(map[string]any)
		if !ok {
			return "图谱配置须为对象"
		}
		if raw, exists := cfg["custom_instructions"]; exists {
			value, ok := raw.(string)
			if !ok || len([]rune(value)) > 12000 {
				return "图谱抽取要求须为不超过 12000 字的文本"
			}
		}
		for _, key := range []string{"tags", "relations"} {
			if raw, exists := cfg[key]; exists {
				list, ok := raw.([]any)
				if !ok || len(list) == 0 || len(list) > 100 {
					return "图谱实体类型和关系类型须为 1–100 项的数组"
				}
				for _, raw := range list {
					item, ok := raw.(string)
					if !ok || strings.TrimSpace(item) == "" || len([]rune(item)) > 100 {
						return "图谱类型须为 1–100 字的文本"
					}
				}
			}
		}
	}
	for key, bounds := range map[string][2]float64{"frame_interval_seconds": {1, 3600}, "max_frames": {1, 240}} {
		if raw, exists := v[key]; exists {
			n, ok := raw.(float64)
			if !ok || n < bounds[0] || n > bounds[1] || n != float64(int(n)) {
				return key + " 超出允许范围"
			}
		}
	}
	return ""
}

func validateEngineSettings(v map[string]any) string {
	cfg, ok := v["paddleocr_vl"].(map[string]any)
	if !ok {
		return "paddleocr_vl 须为对象"
	}
	endpoint, ok := cfg["endpoint"].(string)
	if !ok {
		return "PaddleOCR-VL 地址须为文本"
	}
	if endpoint != "" {
		u, err := url.Parse(endpoint)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") {
			return "PaddleOCR-VL 地址须为 HTTP(S) 服务基础地址，不含凭证或查询参数"
		}
	}
	for _, key := range []string{"use_seal_recognition", "use_chart_recognition"} {
		if _, ok := cfg[key].(bool); !ok {
			return key + " 须为布尔值"
		}
	}
	return ""
}
