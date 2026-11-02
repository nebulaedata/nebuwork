package api

import (
	"nebulaekno/internal/extraction"
	"nebulaekno/internal/jobs"
	"reflect"
)

func progressSchemas() map[string]any {
	timestamp := map[string]string{"type": "string", "format": "date-time"}
	counter := map[string]any{"type": "integer", "minimum": 0}
	extractionProgress := schemaOf(reflect.TypeOf(extraction.ExtractionProgress{}))
	extractionProgress["description"] = "参数提取进度。分块总数、完成和失败按根分块统计，拆分子块及回放不重复累计；active_blocks 展示当前并行分块，recent_blocks 最多保留最近 20 项。复用和跳过计数属于本次执行尝试，历史缺省字段不代表零。每个新租约独立记录 pipeline 计时。"
	span := map[string]any{"type": "object", "properties": map[string]any{
		"name": map[string]string{"type": "string"}, "status": map[string]string{"type": "string"},
		"started_at": timestamp, "finished_at": timestamp, "engine": map[string]string{"type": "string"},
		"progress": map[string]string{"$ref": "#/components/schemas/WorkProgress"},
		"children": map[string]any{"type": "array", "items": map[string]string{"$ref": "#/components/schemas/PipelineSpan"}},
	}}
	pipeline := map[string]any{"type": "object", "properties": map[string]any{
		"run_id": map[string]string{"type": "string"}, "attempt": counter, "status": map[string]string{"type": "string"}, "started_at": timestamp, "finished_at": timestamp,
		"stages": map[string]any{"type": "array", "items": map[string]string{"$ref": "#/components/schemas/PipelineSpan"}},
	}}
	return map[string]any{
		"WorkProgress": map[string]any{"type": "object", "description": "真实工作计数；total 缺省或 0 表示总数未知，不应计算百分比。DOCX anydoc 使用 block，内置解析器使用 docx_block 与 paragraphs/tables；page 仅用于实际按页处理，converted_page 明确指转换副本。", "properties": map[string]any{"unit": map[string]string{"type": "string"}, "completed": counter, "total": counter, "current": counter, "paragraphs": counter, "tables": counter, "sheet": map[string]string{"type": "string"}, "sheet_index": counter, "sheets": counter, "batch": counter, "batches": counter, "attempt": counter, "max_retries": counter, "failed_batches": counter, "retrying": map[string]string{"type": "boolean"}}},
		"PipelineSpan": span, "Pipeline": pipeline,
		"TaskSnapshot": map[string]any{"type": "object", "additionalProperties": true, "properties": map[string]any{
			"id": map[string]string{"type": "string", "format": "uuid"}, "state": map[string]string{"type": "string"}, "stage": map[string]string{"type": "string"},
			"server_time": timestamp, "last_event_id": counter, "checkpoint": map[string]any{"type": "object", "additionalProperties": true, "properties": map[string]any{"pipeline": map[string]string{"$ref": "#/components/schemas/Pipeline"}, "extraction": extractionProgress, "wiki_batches": schemaOf(reflect.TypeOf(jobs.WikiPlan{})), "graph_batches": schemaOf(reflect.TypeOf(jobs.GraphPlan{})), "graph_retry_only": map[string]string{"type": "boolean"}, "wiki_retry_only": map[string]string{"type": "boolean"}}},
		}},
	}
}
