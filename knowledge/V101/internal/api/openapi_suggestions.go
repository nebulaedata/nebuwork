package api

func suggestionSchema(required bool) map[string]any {
	text := func(limit int) map[string]any {
		return map[string]any{"type": "string", "maxLength": limit}
	}
	list := map[string]any{"type": "array", "maxItems": 100, "items": text(100)}
	graph := map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
		"tags": list, "relations": list, "custom_instructions": text(12000), "text": text(8000),
	}}
	image := map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"image_instructions": text(12000)}}
	wrapper := map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{"extract_config": graph}}
	if required {
		image["required"] = []string{"image_instructions"}
		wrapper["required"] = []string{"extract_config"}
		graph["required"] = []string{"tags", "relations", "custom_instructions", "text"}
		list["minItems"] = 1
	}
	return map[string]any{"anyOf": []any{image, wrapper}}
}

func suggestionRequestSchema() map[string]any {
	return map[string]any{"type": "object", "additionalProperties": false, "required": []string{"kind", "context"}, "properties": map[string]any{
		"kind":              map[string]any{"type": "string", "enum": []string{"image", "graph"}},
		"context":           map[string]any{"type": "string", "minLength": 1, "maxLength": 4000, "description": "资料类型与处理目标；不自动读取或上传知识库原文。"},
		"current":           suggestionSchema(false),
		"knowledge_base_id": map[string]any{"type": "string", "format": "uuid", "description": "可选；使用该知识库文本用途绑定，否则使用全局文本用途绑定。"},
	}}
}

func suggestionResponseSchema() map[string]any {
	return map[string]any{"type": "object", "required": []string{"success", "data"}, "properties": map[string]any{
		"success": map[string]any{"const": true},
		"data": map[string]any{"type": "object", "required": []string{"kind", "suggestion", "model", "saved"}, "properties": map[string]any{
			"kind":       map[string]any{"enum": []string{"image", "graph"}},
			"suggestion": suggestionSchema(true),
			"saved":      map[string]any{"const": false, "description": "仅返回草稿，不保存设置。"},
			"model":      map[string]any{"type": "object", "properties": map[string]any{"id": map[string]any{"type": "string", "format": "uuid"}, "name": map[string]any{"type": "string"}, "purpose": map[string]any{"enum": []string{"text", "outline"}}}},
		}},
	}}
}
