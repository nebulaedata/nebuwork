package api

import "strings"

// Dynamic settings remain open objects; concrete operations document the fields accepted by decode.
func requestSchema(path string) map[string]any {
	if path == "/api/v1/knowledge/{id}/extractions" {
		return map[string]any{"type": "object", "additionalProperties": false, "properties": map[string]any{
			"parse_version_id": map[string]string{"type": "string", "format": "uuid"},
			"model_id":         map[string]string{"type": "string", "format": "uuid"},
			"section_ids":      map[string]any{"type": "array", "maxItems": 40, "items": map[string]string{"type": "string"}},
		}}
	}
	if path == "/api/v1/processing-config/suggest" {
		return suggestionRequestSchema()
	}
	fields := map[string]string{}
	required := []string{}
	switch {
	case strings.HasSuffix(path, "/spreadsheet-settings"):
		fields = map[string]string{"file_version_id": "uuid", "excel": "object"}
		required = []string{"file_version_id", "excel"}
	case path == "/api/v1/model-connections" || path == "/api/v1/model-connections/{id}":
		fields = map[string]string{"name": "string", "base_url": "string", "api_key": "string", "clear_api_key": "boolean"}
		required = []string{"name", "base_url"}
	case strings.HasSuffix(path, "/models/discover"):
		fields = map[string]string{"id": "uuid", "connection_id": "uuid", "base_url": "string", "api_key": "string", "clear_api_key": "boolean"}
	case strings.HasSuffix(path, "/knowledge/manual"):
		fields = map[string]string{"name": "string", "content": "string"}
		required = []string{"name", "content"}
	case strings.HasSuffix(path, "/knowledge/url"):
		fields = map[string]string{"name": "string", "url": "string"}
		required = []string{"url"}
	case strings.HasSuffix(path, "/read"):
		fields = map[string]string{"file_version_id": "uuid", "parse_version_id": "uuid", "query": "string", "cursor": "string", "limit": "integer"}
		required = []string{"file_version_id"}
	case strings.HasSuffix(path, "/subtitles"):
		fields = map[string]string{"file_version_id": "uuid", "format": "string", "content": "string", "offset_ms": "integer"}
		required = []string{"file_version_id", "format", "content"}
	case strings.HasSuffix(path, "/sources/resolve-batch"):
		fields = map[string]string{"source_ref_ids": "uuid[]"}
		required = []string{"source_ref_ids"}
	case strings.HasSuffix(path, "/chunker/preview"):
		fields = map[string]string{"text": "string", "chunk_size": "integer", "chunk_overlap": "integer"}
		required = []string{"text"}
	case strings.HasSuffix(path, "/processing-config/resolve"):
		fields = map[string]string{"knowledge_base_id": "uuid", "overrides": "object", "file_type": "string"}
		required = []string{"knowledge_base_id"}
	case strings.HasSuffix(path, "/graph/query"):
		fields = map[string]string{"query": "string", "max_hops": "integer", "limit": "integer"}
	case strings.HasSuffix(path, "/revert") && strings.Contains(path, "/wiki/pages/"):
		fields = map[string]string{"revision_id": "uuid"}
		required = []string{"revision_id"}
	case strings.HasSuffix(path, "/wiki/pages") || strings.HasSuffix(path, "/wiki/pages/{page}"):
		fields = map[string]string{"title": "string", "content": "string", "source_ids": "uuid[]", "folder_id": "uuid"}
		required = []string{"title", "content"}
	case strings.HasSuffix(path, "/folders") || strings.HasSuffix(path, "/folders/{folder}"):
		fields = map[string]string{"name": "string", "parent_id": "uuid"}
		required = []string{"name"}
	default:
		return nil
	}
	properties := map[string]any{}
	for name, kind := range fields {
		schema := map[string]any{"type": kind}
		array := strings.HasSuffix(kind, "[]")
		kind = strings.TrimSuffix(kind, "[]")
		if array {
			schema = map[string]any{"type": kind}
		}
		if kind == "uuid" {
			schema = map[string]any{"type": "string", "format": "uuid"}
		}
		if array {
			schema = map[string]any{"type": "array", "items": schema}
		}
		if name == "api_key" {
			schema["writeOnly"] = true
		}
		properties[name] = schema
	}
	return map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}
}
