package defaults

const QASystemPrompt = "你是知识库问答助手。使用简体中文，依据本轮提供的资料回答问题。关键结论附可定位的来源引用；没有足够资料时明确说明，不编造事实。资料冲突时分别展示并引用。相关原文图片可以插入回答，图片中的细节无法辨认时如实说明。区分源文件原文、OCR、模型生成描述与图片解读。"

var Graph = map[string]any{
	"enabled": true, "id": "general-zh-CN", "name": "中文通用知识图谱",
	"text":                "张明负责示例公司的知识管理项目。该项目使用示例知识平台，平台依赖文档解析技术。示例公司位于示例市。",
	"tags":                []string{"人物", "组织", "地点", "产品", "项目", "技术", "概念", "事件", "流程"},
	"relations":           []string{"属于", "包含", "负责", "提供", "使用", "依赖", "位于", "参与", "别名", "关联"},
	"nodes":               []map[string]string{{"name": "张明", "type": "人物"}, {"name": "示例公司", "type": "组织"}, {"name": "知识管理项目", "type": "项目"}},
	"custom_instructions": "只抽取有原文依据的事实。实体名称沿用原文，属性和关系描述使用简体中文。明确别名可合并，含糊指代不强行推断。每项实体和关系必须保留证据分块与位置。示例仅指导抽取，禁止作为事实入库。",
}
var Settings = map[string]any{
	"qa-defaults":         map[string]any{"system_prompt": QASystemPrompt, "model_id": "", "vision_model_id": ""},
	"extraction-defaults": map[string]any{"model_id": ""},
	"appearance":          map[string]any{"brand_color": "#6254e8"},
	"model-bindings":      map[string]any{},
	"parser-defaults":     map[string]any{"parser_engines": ParserEngines, "image_instructions": ImageInstructions, "image_caption": true, "image_embedding": true, "chunk_size": 512, "chunk_overlap": 80, "graph_enabled": true, "wiki_enabled": true, "extract_config": Graph, "outline_enabled": true, "image_pipeline": "smartocr", "preprocess_mode": "off", "html_main_content": true, "excel_preserve_percentage": true, "excel": map[string]any{"header_rows": []int{}, "sheets": map[string]any{}}},
	"parser-engines":      map[string]any{"paddleocr_vl": map[string]any{"endpoint": "", "use_seal_recognition": true, "use_chart_recognition": false}},
	"retrieval-defaults":  map[string]any{"mode": "hybrid", "top_k": 10, "candidate_k": 50, "rrf_k": 60, "vector_weight": 0.7, "keyword_weight": 0.3, "rerank": "auto"},
	"preview-defaults":    map[string]any{"mode": "auto", "enabled": true},
	"media-defaults":      map[string]any{"enabled": true, "transcription": true, "frame_interval_seconds": 30, "frame_ocr": true, "frame_caption": true, "max_frames": 240},
	"storage":             map[string]any{"type": "local", "temporary_retention_hours": 24},
	"wiki-defaults":       map[string]any{"enabled": true, "language": "zh-CN", "granularity": "standard", "instructions": "使用简体中文，按概览、要点、细节、关联页面和来源组织内容。保留来源引用与专有名词，不虚构事实。相互冲突的事实分别展示来源。"},
}
