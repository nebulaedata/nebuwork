package api

import (
	"reflect"
	"strings"
)

// Keep the document projection contract separate from the knowledge-base API.
func describeDocumentRelated(o operation, op map[string]any) {
	if o.Method != "GET" {
		return
	}
	suffix := strings.TrimPrefix(o.Path, "/api/v1/knowledge/{id}")
	if suffix == o.Path {
		return
	}
	object := func(properties map[string]any) map[string]any {
		return map[string]any{"type": "object", "properties": properties}
	}
	str := map[string]any{"type": "string"}
	integer := map[string]any{"type": "integer"}
	boolean := map[string]any{"type": "boolean"}
	scope := schemaOf(reflect.TypeOf(documentScope{}))["properties"].(map[string]any)
	add := func(fields map[string]any) map[string]any {
		for k, v := range fields {
			scope[k] = v
		}
		return object(scope)
	}
	parameters := []any{}
	for _, p := range op["parameters"].([]any) {
		param := p.(map[string]any)
		if param["in"] == "query" && (param["name"] == "page" || param["name"] == "page_size") {
			continue
		}
		parameters = append(parameters, param)
	}
	query := func(name, description string, schema map[string]any) {
		parameters = append(parameters, map[string]any{"name": name, "in": "query", "description": description, "schema": schema})
	}
	var data map[string]any
	var meta map[string]any
	var summary, description string
	switch suffix {
	case "/related/stats":
		summary = "文档 Wiki 与实体图谱统计和阶段状态"
		description = "数量覆盖所选版本的全部已保存结果。stages.wiki/graph 含 state、error、task_id；失败且已有成果时为 partially_failed。pending_sync_records 表示已保存但尚未同步 Neo4j 的证据记录数。"
		data = add(map[string]any{"wiki_pages": integer, "entities": integer, "relations": integer, "evidence_records": integer, "pending_sync_records": integer, "wiki_url": str, "graph_url": str, "stages": object(map[string]any{"wiki": object(map[string]any{"state": str, "error": map[string]any{}, "task_id": str}), "graph": object(map[string]any{"state": str, "error": map[string]any{}, "task_id": str})})})
	case "/wiki/pages":
		summary = "分页查询本文件贡献的 Wiki 页面"
		description = "data 为页面元数据数组，不含正文。source_ids 只包含本文件所选解析版本的引用。shared 表示其他文件也贡献了该页面。content_state 为 ready/partial/unavailable；缺少可核验贡献标记时不把全页正文归属本文件。"
		data = map[string]any{"type": "array", "items": schemaOf(reflect.TypeOf(documentWikiPage{}))}
		meta = add(map[string]any{"page": integer, "page_size": integer, "total": integer, "has_more": boolean})
		query("q", "按标题搜索", str)
		query("page", "页码", map[string]any{"type": "integer", "minimum": 1, "default": 1})
		query("page_size", "每页数量", map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "default": 20})
	case "/wiki/pages/{page}":
		summary = "读取本文件可核验的 Wiki 贡献正文"
		description = "保留原正文与 source: 引用；不可独立提取时 content 缺省，reason 解释原因，仍返回本文件 source_ids 和 full_page_url。历史解析版本使用匹配来源的最近 Wiki 内容/修订，revision_id 标识采用的修订；不重新生成正文。"
		data = add(schemaOf(reflect.TypeOf(documentWikiPage{}))["properties"].(map[string]any))
	case "/wiki/graph":
		summary = "本文件 Wiki 页面关系图"
		description = "返回全部范围内页面节点 nodes、关系 edges 及 unresolved_references。仅从本文件已核验贡献正文解析链接，关系两端均须在文档结果范围内；不会引入其他文件贡献的链接。"
		data = add(map[string]any{"nodes": schemaOf(reflect.TypeOf([]documentWikiPage{})), "edges": schemaOf(reflect.TypeOf([]wikiPageLink{})), "unresolved_references": integer})
	case "/graph":
		summary = "按证据记录分页读取本文件实体与事实关系"
		description = "读取 PostgreSQL graph_records，不使用全库同名实体的描述。nodes 按名称合并，descriptions 分别保留 text/type/quote/source_ref_id/evidence_id/synced；relations 保留稳定 id 和各自证据。跨页按节点 name、关系 id 去重并合并 descriptions/source_ids/types。meta.total_records 是全部证据记录数，returned_records 是当前批次数量；pending_sync_records 仅统计当前批次。has_more=true 时结果不完整，携带实际 parse_version_id 和 next_cursor 继续读取；新结果可能在后续刷新时增加。source_ref_id 可调用 /sources/{id} 获取原文预览定位。"
		fields := schemaOf(reflect.TypeOf(documentGraphData{}))["properties"].(map[string]any)
		fields["meta"] = object(map[string]any{"total_records": integer, "returned_records": integer, "page_size": integer, "has_more": boolean, "next_cursor": str, "pending_sync_records": integer})
		data = add(fields)
		query("page_size", "每批证据记录数", map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "default": 20})
		query("cursor", "上批 next_cursor，必须配合相同解析版本；版本不匹配返回 400", str)
	default:
		return
	}
	op["summary"] = summary
	op["description"] = description + " 所有查询只读，不修改生成结果。file_version_id、parse_version_id 可选，缺省使用当前解析版本；显式版本不属于文档或互不匹配返回 404，不回退其他版本。响应返回实际采用的版本，后续分页必须固定该版本。无解析结果时返回空结果及空 parse_version_id。"
	op["parameters"] = parameters
	fields := map[string]any{"success": boolean, "data": data}
	if meta != nil {
		fields["meta"] = meta
	}
	op["responses"].(map[string]any)["200"] = map[string]any{"description": "所选文档版本的只读结果", "content": map[string]any{"application/json": map[string]any{"schema": object(fields)}}}
}
