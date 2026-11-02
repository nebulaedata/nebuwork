package api

import "strings"

func describeQA(o operation, op map[string]any) {
	if !strings.HasPrefix(o.Path, "/api/v1/qa/") && o.Path != "/api/v1/settings/qa-defaults" {
		return
	}
	op["tags"] = []string{"知识库问答"}
	op["description"] = "知识库多轮问答。会话支持全局提示词继承或覆盖、限定知识库与文档、Wiki/图谱增强。每轮冻结模型配置、提示词、版本化引用及原图。无新增鉴权。JSON 返回 success/data；列表 meta 含分页。"
	parameters, _ := op["parameters"].([]any)
	if o.Method == "POST" && (strings.HasSuffix(o.Path, "/messages") || strings.HasSuffix(o.Path, "/retry")) {
		parameters = append(parameters, map[string]any{"in": "header", "name": "Idempotency-Key", "schema": map[string]any{"type": "string", "maxLength": 200}, "description": "同会话内相同请求重复提交返回原消息 ID，不重复生成；键与问题冲突返回 409。"})
		op["parameters"] = parameters
		op["description"] = op["description"].(string) + " 返回 202 data:{user_message_id,assistant_message_id}。同会话一轮执行中时返回 QA_BUSY。retry 使用当前会话范围和配置创建新记录，保留原回答。"
	}
	if strings.HasSuffix(o.Path, "/events") {
		responses := op["responses"].(map[string]any)
		responses["200"] = map[string]any{"description": "持久化 SSE：stage {stage}、warning {message}、evidence {sources,images,rewritten_query}、delta {delta}、done {state,content,sources,images,warnings,error}。支持 Last-Event-ID/last_event_id，终态关闭。done.content 替换增量文本；重连仅恢复事件，不重跑模型。", "content": map[string]any{"text/event-stream": map[string]any{"schema": map[string]string{"type": "string"}}}}
	}
	if o.Method == "GET" && strings.HasSuffix(o.Path, "/messages") {
		op["description"] = op["description"].(string) + " 按时间倒序分页；role=user/assistant。state: queued/running/completed/failed/cancelled/interrupted。sources/images 返回 available 和原始版本快照，删除来源不会被新版本替代。"
	}
	if o.Method != "POST" && o.Method != "PUT" && o.Method != "PATCH" {
		return
	}
	properties := map[string]any{}
	required := []string{}
	if o.Path == "/api/v1/settings/qa-defaults" {
		properties = map[string]any{"system_prompt": map[string]any{"type": "string", "minLength": 1, "maxLength": 16000}, "model_id": map[string]any{"type": "string", "description": "已保存的文本生成模型 ID，空字符串沿用系统 text"}, "vision_model_id": map[string]any{"type": "string", "description": "支持图片输入的模型 ID，空字符串沿用系统 vision"}}
		op["description"] = op["description"].(string) + " GET 额外返回只读 default_system_prompt，供恢复默认使用。PUT 为字段合并更新，仅接受三项可写配置。"
	} else if strings.HasSuffix(o.Path, "/messages") {
		properties["query"] = map[string]any{"type": "string", "minLength": 1, "maxLength": 4096}
		required = []string{"query"}
	} else if strings.HasSuffix(o.Path, "/sessions") || o.Method == "PATCH" {
		properties = map[string]any{"title": map[string]any{"type": "string", "minLength": 1, "maxLength": 120}, "knowledge_base_ids": map[string]any{"type": "array", "maxItems": 100, "items": map[string]string{"type": "string", "format": "uuid"}}, "knowledge_ids": map[string]any{"type": "array", "maxItems": 1000, "items": map[string]string{"type": "string", "format": "uuid"}}, "system_prompt": map[string]any{"type": []string{"string", "null"}, "maxLength": 16000, "description": "null 或空字符串恢复沿用全局"}, "enable_wiki": map[string]any{"type": "boolean", "default": false}, "enable_graph": map[string]any{"type": "boolean", "default": false}}
	}
	op["requestBody"] = map[string]any{"required": len(required) > 0, "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"type": "object", "additionalProperties": false, "properties": properties, "required": required}}}}
}
