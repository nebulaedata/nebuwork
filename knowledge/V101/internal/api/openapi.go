package api

import (
	"encoding/json"
	"html/template"
	"nebulaekno/internal/ai"
	"nebulaekno/internal/defaults"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"time"
)

type operation struct{ Method, Path string }

func (s *Server) handle(pattern string, handler http.HandlerFunc) {
	s.mux.HandleFunc(pattern, handler)
	parts := strings.SplitN(pattern, " ", 2)
	if len(parts) == 2 && (strings.HasPrefix(parts[1], "/api/v1/") || strings.HasPrefix(parts[1], "/health/")) {
		s.operations = append(s.operations, operation{parts[0], parts[1]})
	}
}

func schemaOf(t reflect.Type) map[string]any {
	if t == reflect.TypeOf(json.RawMessage{}) {
		return map[string]any{}
	}
	if t == reflect.TypeOf(time.Time{}) {
		return map[string]any{"type": "string", "format": "date-time"}
	}
	if t.Kind() == reflect.Pointer {
		return schemaOf(t.Elem())
	}
	switch t.Kind() {
	case reflect.String:
		return map[string]any{"type": "string"}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Int, reflect.Int64:
		return map[string]any{"type": "integer"}
	case reflect.Float64:
		return map[string]any{"type": "number"}
	case reflect.Array, reflect.Slice:
		return map[string]any{"type": "array", "items": schemaOf(t.Elem())}
	case reflect.Struct:
		properties := map[string]any{}
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			if f.PkgPath != "" && !f.Anonymous {
				continue
			}
			tag := strings.Split(f.Tag.Get("json"), ",")[0]
			if tag == "-" {
				continue
			}
			if f.Anonymous && tag == "" {
				embedded := schemaOf(f.Type)
				if fields, ok := embedded["properties"].(map[string]any); ok {
					for key, value := range fields {
						properties[key] = value
					}
				}
				continue
			}
			if tag == "" {
				tag = f.Name
			}
			properties[tag] = schemaOf(f.Type)
		}
		return map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
	case reflect.Map:
		return map[string]any{"type": "object", "additionalProperties": true}
	default:
		return map[string]any{}
	}
}
func (s *Server) openAPI() map[string]any {
	paths := map[string]any{}
	for _, o := range s.operations {
		if strings.HasSuffix(o.Path, "openapi.json") {
			continue
		}
		entry, _ := paths[o.Path].(map[string]any)
		if entry == nil {
			entry = map[string]any{}
		}
		parameters := []any{}
		for _, part := range strings.Split(o.Path, "/") {
			if strings.HasPrefix(part, "{") {
				name := strings.Trim(part, "{}")
				schema := map[string]any{"type": "string"}
				if name == "id" || name == "page" || name == "folder" || name == "evidence" || name == "chunk" {
					schema["format"] = "uuid"
				}
				parameters = append(parameters, map[string]any{"name": name, "in": "path", "required": true, "schema": schema})
			}
		}
		if o.Method == "GET" {
			for _, name := range []string{"page", "page_size"} {
				parameters = append(parameters, map[string]any{"name": name, "in": "query", "schema": map[string]any{"type": "integer", "minimum": 1}})
			}
			if strings.Contains(o.Path, "/knowledge/") {
				for _, name := range []string{"file_version_id", "parse_version_id"} {
					parameters = append(parameters, map[string]any{"name": name, "in": "query", "schema": map[string]string{"type": "string", "format": "uuid"}})
				}
			}
		}
		if o.Method == "GET" && strings.HasPrefix(o.Path, "/api/v1/knowledge-bases/") && strings.HasSuffix(o.Path, "/wiki/graph") {
			parameters = append(parameters, map[string]any{"name": "view", "in": "query", "description": "默认返回页面关系数组；overview 返回全部页面元数据 nodes、edges 与 unresolved_references。根据当前 Wiki 正文实时解析，不调用模型。页面引用与实体知识图谱相互独立。", "schema": map[string]any{"type": "string", "enum": []string{"overview"}}})
		}
		responses := map[string]any{}
		for status, description := range map[string]string{"200": "成功", "201": "已创建", "202": "任务已持久化并排队", "400": "参数错误", "404": "资源不存在", "409": "状态或能力冲突", "413": "文件超限", "422": "缺少样本或能力不可用", "500": "内部错误", "502": "模型调用失败", "503": "服务或依赖未就绪"} {
			responses[status] = map[string]any{"description": description, "content": map[string]any{"application/json": map[string]any{"schema": map[string]string{"$ref": "#/components/schemas/Envelope"}}}}
		}
		tag := strings.Split(strings.TrimPrefix(o.Path, "/api/v1/"), "/")[0]
		op := map[string]any{"operationId": strings.ToLower(o.Method) + strings.NewReplacer("/", "_", "{", "", "}", "", "-", "_").Replace(o.Path), "summary": o.Method + " " + strings.TrimPrefix(o.Path, "/api/v1"), "tags": []string{tag}, "parameters": parameters, "responses": responses}
		if strings.Contains(o.Path, "/extractions") {
			op["description"] = "独立手动条款参数提取。仅读取冻结的解析版本，保留六字段、原文引文及版本化 source_refs/preview_url；不重新解析或写入 Wiki、图谱。运行状态沿用 tasks；partially_failed 表示部分完成或存在待核验。machine_checked 仅代表程序校验通过。记录支持 q/type/status 分页筛选；覆盖支持 disposition；文件工作台支持 knowledge_base_id/q/state；历史支持 parse_version_id。"
			if o.Method == "GET" {
				for _, name := range []string{"q", "type", "status", "disposition", "state", "knowledge_base_id"} {
					parameters = append(parameters, map[string]any{"name": name, "in": "query", "schema": map[string]string{"type": "string"}})
				}
				op["parameters"] = parameters
			}
			if strings.HasSuffix(o.Path, "/export.xlsx") {
				responses["200"] = map[string]any{"description": "所选运行全部结果的四表 Excel，包含规范条款、待核验、覆盖与问题、说明，不受页面筛选影响", "content": map[string]any{"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": map[string]any{"schema": map[string]string{"type": "string", "format": "binary"}}}}
			}
		}
		if o.Path == "/api/v1/settings/{key}" {
			op["description"] = "按 key 读取或更新公共设置。appearance 为后台主题色，格式 {brand_color:\"#6254e8\"}，接受 #RRGGBB 十六进制颜色，默认紫蓝色。保存外观不触发文档处理，也不修改模型与知识库设置。"
		}
		if o.Path == "/api/v1/knowledge/{id}/sheets" {
			op["description"] = "读取 XLS/XLSX/ET/ETT 源文件工作表结构，返回 file_version_id、parse_version_id、sheets（id/name/row_count/column_count/hidden/merged_ranges）、settings。可指定历史版本。旧文件只生成独立预览缓存，不改写解析和生成结果。ET/ETT 先核验内部 BIFF/OOXML 结构，失败返回明确原因。"
		}
		if o.Path == "/api/v1/knowledge/{id}/sheets/{sheet_id}/cells" {
			op["description"] = "按原始行列范围读取源单元格。rows[].cells 返回 address、row、column、value、display、format、formula、warning；merged_ranges 提供原合并范围和 master 单元格。公式只读缓存，XLS 不提供公式文本。空行保留原行号。"
			for key, limit := range map[string]int{"row_start": 200000, "column_start": 16384, "row_count": 200, "column_count": 50} {
				parameters = append(parameters, map[string]any{"name": key, "in": "query", "schema": map[string]any{"type": "integer", "minimum": 1, "maximum": limit}})
			}
			op["parameters"] = parameters
		}
		if o.Path == "/api/v1/knowledge/{id}/spreadsheet-settings" {
			op["description"] = "保存当前文件的 Excel 策略，不自动重跑。请求 {file_version_id,excel:{header_rows:[1],sheets:{工作表名称:{header_rows:[1,2]}}}}。空数组表示不设表头；每组最多 20 个唯一原始行号。返回 requires_reparse=true；显式调用 reparse 后应用。旧版本不允许修改当前设置。"
		}
		if o.Path == "/api/v1/knowledge/{id}/preview/manifest" {
			op["description"] = "Excel 返回 type=spreadsheet、sheets_url 和明确的文件/解析版本，预览直接读取源单元格；其他格式保持原预览协议。"
		}
		if o.Path == "/api/v1/sources/{id}" {
			op["description"] = "Excel 来源 locators 含 sheet_id、sheet、row_start/row_end、column_start/column_end、cell_range、mapping（exact/converted_structure/unverified）。context_source_ref_ids/context_sources 单独返回补充表头及合并主单元格引用，含 quote、locators、preview_url；角色为 header/merged_master，后者保留 merged_range。补充来源没有正文字符偏移；定位使用原单元格位置。所有来源绑定文件及解析版本。"
			op["description"] = op["description"].(string) + " WPS 来源额外保留 source_format、normalized_format；转换副本坐标标记 mapping=converted_structure、coordinate_space=converted_document，partial=true，不声明原文件精确位置。下载仍为原始 WPS 文件。"
		}
		if o.Path == "/api/v1/knowledge/{id}/content" {
			op["description"] = "解析内容保持文件及解析版本绑定。WPS conversion 字段含 source_format、detected_container、normalized_format、method（container_alias/libreoffice）、mapping、source_sha256、normalized_sha256。warnings 保留转换和图片限制；旧版本 conversion 为 null。"
		}
		if o.Path == "/api/v1/file-formats" {
			op["description"] = "支持 WPS/WPT、ET/ETT、DPS/DPT 的 Office 兼容二进制和 OOXML 容器。文件实际结构在解析前核验；加密、损坏、类型错配或不支持的专有版本明确失败，不按纯文本或其他引擎替代成功。"
		}
		if o.Path == "/api/v1/processing-config/suggest" {
			op["summary"] = "AI 生成图片解析要求或知识图谱配置草稿"
			op["description"] = "使用文本用途绑定的 text/outline 模型。仅发送 context 和 current，不读取文件内容，不写入设置。未绑定模型返回 422，上游失败或输出不合规返回 502。接受请求取消。"
			responses["200"] = map[string]any{"description": "可编辑的配置建议，saved=false", "content": map[string]any{"application/json": map[string]any{"schema": suggestionResponseSchema()}}}
		}
		if o.Method == "GET" && (o.Path == "/api/v1/knowledge/{id}/images" || o.Path == "/api/v1/knowledge-bases/{id}/images") {
			op["summary"] = "分页查看区域图片、内嵌图片及视频代表帧"
			op["description"] = "data 为资源数组，meta 包含 total/page/page_size/has_more。返回 id、knowledge_id、file_version_id、parse_version_id、kind（image/video_frame）、content_url、locators、source_ref_id 和 caption_ready。知识库列表只返回当前解析版本；文档列表可指定历史文件及解析版本。不返回本地存储路径。"
		}
		if o.Method == "GET" && o.Path == "/api/v1/knowledge/{id}/content" {
			op["description"] = "返回 content、engine、文件及解析版本。image_occurrences 含 Unicode char_start/char_end、reference_only（旧图片占位文字可隐藏）、unplaced（未核验正文插入位置）、images（版本绑定的 content_url、locators、source_ref_id）。插图仅用于排版，不改变 content 或引用偏移；unplaced 图片应单独展示。visual_layout_version=2 表示 PDF 已按版面区域裁剪。requires_image_reparse 提示旧版 PaddleOCR 需要重新处理。warnings 的 PAGE_IMAGE_NOT_CROPPED 表示整页被跳过；IMAGE_ASSET_UNAVAILABLE 表示图片缺失或无法转换；EXTERNAL_IMAGE_NOT_FETCHED 表示图片未随文件上传。"
		}
		if o.Method == "GET" && o.Path == "/api/v1/images/{id}" {
			op["summary"] = "查看图片及其解析数据"
			op["description"] = "返回资源信息、recognized_text（原始解析块合并，不重复拼接分块重叠部分）及 source_refs。AI 描述位于 image_caption/frame_caption 来源的 generated_text，保留 source_ref_id、locators 和 model_id。空结果表示尚无已保存数据，不代表解析成功。资源与来源始终匹配文件和解析版本。"
		}
		if o.Method == "POST" && o.Path == "/api/v1/knowledge/{id}/images/rebuild" {
			op["summary"] = "补充当前解析版本缺少的图片理解"
			op["description"] = "创建局部任务，保留已有图片描述，仅处理缺少描述的图片；使用知识库图片理解开关和模型绑定。不重新解析、不改写 Wiki、图谱、已有文本分块或引用。返回 task_id。"
		}
		if o.Method == "GET" && o.Path == "/api/v1/knowledge/{id}/chunks" {
			op["description"] = "分页返回分块，meta 包含总数。表格块另含 context_source_ref_ids（独立的表头/合并主单元格来源），content 含上下文但 char_start/char_end 只对应正文。图片按已核验的工作表行范围关联；转换/未核验位置不冒充精确行关联。每个分块附带 content_origin、block_type（text/table/image/spreadsheet）、layout、locators、images。images 仅关联该分块来源实际引用的图片资源，包含 id、kind、content_url 及文件和解析版本。PDF 图片为版面检测后的裁剪图，locators 保留原页页码及归一化区域；整页预览图不参与图片列表和图片检索。"
		}
		if o.Method == "GET" && o.Path == "/api/v1/tasks/{id}" {
			op["description"] = "checkpoint.graph_batches 提供逐块容错状态、有效实体/关系数、待修复项和原文证据错误。checkpoint.wiki_batches 提供每批状态、轮次、尝试次数、错误与历史记录；Wiki 进度包含 batch/batches/attempt/max_retries/failed_batches。Wiki 结构化来源由程序生成链接，有效页面和局部修复草稿在同一事务保存；已成功页面不重写。issues 提供字段、校验原因、source_ref_ids 与有限长度原文/响应摘录；OCR_QUALITY_SUSPECT 保留原始 OCR 并阻止异常来源进入生成阶段。任务快照包含 checkpoint.pipeline 实时阶段及子阶段计时、真实工作计数。server_time 用于校正客户端时间；last_event_id 用于从此快照接续 SSE。历史任务可能没有 pipeline；不得补造开始时间或百分比。每次获取新任务租约生成新的 run_id，已有成功检查点仍然保留。"
			responses["200"] = map[string]any{"description": "任务及进度快照", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"type": "object", "properties": map[string]any{"success": map[string]string{"type": "boolean"}, "data": map[string]string{"$ref": "#/components/schemas/TaskSnapshot"}}}}}}
		}
		if o.Method == "POST" && (o.Path == "/api/v1/search" || strings.HasPrefix(o.Path, "/api/v1/search/") && !strings.HasSuffix(o.Path, "query-images")) {
			op["description"] = "检索当前解析版本并保留原文来源。图谱召回可使用已验证且同步到 Neo4j 的部分证据，无需等待整篇或全部文档完成；未同步及历史解析证据不参与召回。部分覆盖仍返回 200，在 meta.warnings 中给出 GRAPH_PARTIAL_COVERAGE，并在 meta.graph_coverage 返回文档完成数、已有同步证据的文档数、证据及待同步数量。没有任何可用图谱且无已完成阶段时返回 INDEX_NOT_READY；多路允许部分成功时按原通道降级语义处理。已完成但没有实体的图谱正常返回空结果。"
			responses["200"] = map[string]any{"description": "检索结果与覆盖提示", "content": map[string]any{"application/json": map[string]any{"schema": map[string]any{"type": "object", "properties": map[string]any{
				"success": map[string]string{"type": "boolean"}, "data": map[string]any{"type": "object", "properties": map[string]any{
					"results": map[string]any{"type": "array", "items": map[string]string{"$ref": "#/components/schemas/SearchResult"}},
					"meta":    map[string]any{"type": "object", "additionalProperties": true, "properties": map[string]any{"graph_coverage": schemaOf(reflect.TypeOf(GraphSearchCoverage{})), "warnings": map[string]any{"type": "array", "items": map[string]any{"type": "object", "additionalProperties": true}}}},
				}},
			}}}}}
		}
		if o.Method == "GET" && (o.Path == "/api/v1/knowledge/{id}/content" || o.Path == "/api/v1/knowledge/{id}/chunks" || o.Path == "/api/v1/images/{id}" || o.Path == "/api/v1/sources/{id}") {
			description, _ := op["description"].(string)
			op["description"] = description + " OCR 循环清理只生成展示投影：content/quote/recognized_text 保持原始内容，display_content/display_quote/display_recognized_text 为去重结果。ocr_cleanup 为 null 或包含 algorithm、message、needs_review=true、removed_characters、removals（当前原始文本内的 Unicode char_start/char_end）。只清理单个 OCR 区域内的长连续重复，表格、数字和生成描述不清理。清理不等同于识别正确；引用坐标、文件/解析版本和已成功生成结果不改写。历史记录读取时可获得同样投影，无需重解析。"
		}
		if o.Path == "/api/v1/tasks/{id}/wiki/retry-failed" || o.Path == "/api/v1/tasks/{id}/graph/retry-failed" {
			op["summary"] = "仅补跑 Wiki 未完成批次"
			op["description"] = "无需请求体。仅对已停止且 Wiki 阶段失败的当前解析版本任务有效；运行中、已完成或过期版本返回 409。保留成功批次、页面与历史记录；未完成批次开启新一轮，首次请求加最多 2 次重试。只运行 Wiki，不重跑解析、向量化、图片或图谱；其他阶段失败/待配置状态仍保留。旧任务没有批次检查点时重新生成 Wiki 并开始记录；不会虚构成功批次。材料或 Wiki 配置变更时拒绝混用旧批次。"
		}
		if o.Path == "/api/v1/tasks/{id}/graph/retry-failed" {
			op["summary"] = "仅补跑实体图谱失败分块"
			op["description"] = "无需请求体。仅限已停止且 graph 阶段失败的当前解析版本；409 表示运行中、过期或无失败。保留成功分块与已经验证的实体、关系，仅局部修复失败项。每块每轮首次调用加最多两次重试，失败不会中断其余分块。原文或抽取配置变化后拒绝复用旧证据。旧缓存只有通过当前分块原文校验才复用。OCR 异常需核验原文并重新解析，不通过重试生成绕过。"
		}
		if strings.HasSuffix(o.Path, "/events") {
			responses["200"] = map[string]any{"description": "SSE，event: task。阶段、状态或进度变更时发出事件，progress=true 表示进度更新，客户端重新 GET 任务快照。可用 Last-Event-ID 或 last_event_id 续接。", "content": map[string]any{"text/event-stream": map[string]any{"schema": map[string]string{"type": "string"}}}}
			parameters = append(parameters, map[string]any{"name": "last_event_id", "in": "query", "schema": map[string]string{"type": "integer"}})
			parameters = append(parameters, map[string]any{"name": "Last-Event-ID", "in": "header", "schema": map[string]string{"type": "string"}})
			op["parameters"] = parameters
		}
		if o.Method == "GET" && (strings.HasSuffix(o.Path, "/download") || strings.HasSuffix(o.Path, "/preview") || strings.HasPrefix(o.Path, "/api/v1/preview-assets/") || strings.HasPrefix(o.Path, "/api/v1/images/") && strings.HasSuffix(o.Path, "/content")) {
			response := map[string]any{"description": "文件内容（Range 请求返回 206）", "content": map[string]any{"application/octet-stream": map[string]any{"schema": map[string]string{"type": "string", "format": "binary"}}}}
			responses["200"] = response
			responses["206"] = response
			parameters = append(parameters, map[string]any{"name": "Range", "in": "header", "schema": map[string]string{"type": "string"}})
			op["parameters"] = parameters
		}
		if o.Method == "POST" || o.Method == "PUT" || o.Method == "PATCH" {
			schema := map[string]any{"type": "object", "additionalProperties": true}
			if described := requestSchema(o.Path); described != nil {
				schema = described
			}
			contentType := "application/json"
			if strings.HasSuffix(o.Path, "/search") || strings.HasPrefix(o.Path, "/api/v1/search/") && !strings.HasSuffix(o.Path, "query-images") {
				schema = map[string]any{"$ref": "#/components/schemas/SearchRequest"}
			}
			if strings.HasSuffix(o.Path, "/test-file") || strings.HasSuffix(o.Path, "/file") || strings.HasSuffix(o.Path, "/files") || strings.HasSuffix(o.Path, "query-images") {
				contentType = "multipart/form-data"
				schema = map[string]any{"type": "object", "required": []string{"file"}, "properties": map[string]any{"file": map[string]string{"type": "string", "format": "binary"}}}
			}
			if strings.HasSuffix(o.Path, "/knowledge/file") || strings.HasSuffix(o.Path, "/knowledge/files") {
				schema["properties"].(map[string]any)["relative_path"] = map[string]any{"type": "string", "description": "可选，放在对应 file 字段之前；也可使用 multipart filename 携带相对路径。"}
				if strings.HasSuffix(o.Path, "/files") {
					schema["properties"].(map[string]any)["file"] = map[string]any{"type": "array", "items": map[string]any{"type": "string", "format": "binary"}, "maxItems": 1000}
				}
				op["description"] = "支持任意文件格式；ZIP 排队自动递归解压，原 ZIP 保留。上传和每层解压自动过滤文件名以 ~$ 开头的 Office 临时文件，不创建文档或任务。单文件过滤返回 HTTP 200、state=skipped、skip_reason=office_temporary_file；批量结果在 data 中返回同样状态。其他未知格式只存储，state=stored、task_id 为空。返回 relative_path、source_archive_id 和 storage_reason。"
			}
			if strings.Contains(o.Path, "/parts/") {
				contentType = "application/octet-stream"
				schema = map[string]any{"type": "string", "format": "binary"}
				parameters = append(parameters, map[string]any{"name": "X-Content-SHA256", "in": "header", "schema": map[string]string{"type": "string"}})
				op["parameters"] = parameters
			}
			if strings.HasSuffix(o.Path, "/uploads") {
				op["description"] = "正常文件返回 HTTP 201 并创建分片会话。文件名以 ~$ 开头时返回 HTTP 200、state=skipped、skip_reason=office_temporary_file，不创建上传会话、文件或解析任务；客户端应停止上传该文件。"
				schema = map[string]any{"type": "object", "required": []string{"file_name", "file_size"}, "properties": map[string]any{"file_name": map[string]string{"type": "string"}, "file_size": map[string]any{"type": "integer", "minimum": 0}, "relative_path": map[string]any{"type": "string", "description": "文件夹中的相对路径，包含文件名；ZIP 子文件自动记录来源路径。"}, "sha256": map[string]any{"type": "string", "pattern": "^[a-fA-F0-9]{64}$"}}}
			}
			if o.Path == "/api/v1/models" || o.Path == "/api/v1/models/{id}" || o.Path == "/api/v1/models/test" {
				schema = map[string]any{"$ref": "#/components/schemas/ModelInput"}
			}
			if o.Path == "/api/v1/knowledge-bases" || o.Path == "/api/v1/knowledge-bases/{id}" {
				schema = schemaOf(reflect.TypeOf(kbInput{}))
				schema["properties"].(map[string]any)["config"] = map[string]string{"$ref": "#/components/schemas/ProcessingConfig"}
			}
			op["requestBody"] = map[string]any{"content": map[string]any{contentType: map[string]any{"schema": schema}}}
		}
		describeDocumentRelated(o, op)
		describeQA(o, op)
		entry[strings.ToLower(o.Method)] = op
		paths[o.Path] = entry
	}
	search := schemaOf(reflect.TypeOf(SearchInput{}))
	search["required"] = []string{"knowledge_base_ids"}
	p := search["properties"].(map[string]any)
	p["mode"] = map[string]any{"enum": []string{"keyword", "vector", "hybrid", "graph", "wiki", "image_text", "image_vector", "multi"}}
	p["top_k"] = map[string]any{"type": "integer", "minimum": 1, "maximum": 100, "default": 10}
	p["candidate_k"] = map[string]any{"type": "integer", "minimum": 1, "maximum": 500, "default": 50}
	model := schemaOf(reflect.TypeOf(ai.Model{}))
	model["properties"].(map[string]any)["api_key"] = map[string]any{"type": "string", "writeOnly": true}
	model["properties"].(map[string]any)["config"] = map[string]any{"type": "object", "additionalProperties": true, "properties": map[string]any{
		"allow_image_input": map[string]any{"type": "boolean", "default": false, "description": "文本生成模型是否允许图片输入；未配置时关闭。其他用途不保存此开关，视觉用途保持图片输入能力。"},
		"timeout_seconds":   map[string]any{"type": "integer", "minimum": 5, "maximum": 600},
		"max_concurrency":   map[string]any{"type": "integer", "minimum": 1, "maximum": 128},
	}}
	return map[string]any{"openapi": "3.1.0", "info": map[string]string{"title": "NebulaeKno API", "version": Version, "description": "公共知识库接口，无调用方鉴权。来源以文件及解析版本为准。"}, "security": []any{}, "paths": paths, "components": map[string]any{"schemas": map[string]any{"Pipeline": progressSchemas()["Pipeline"], "PipelineSpan": progressSchemas()["PipelineSpan"], "WorkProgress": progressSchemas()["WorkProgress"], "TaskSnapshot": progressSchemas()["TaskSnapshot"], "ParserSelections": parserSelectionSchema(), "ProcessingConfig": map[string]any{"type": "object", "additionalProperties": true, "properties": map[string]any{"parser_engines": map[string]string{"$ref": "#/components/schemas/ParserSelections"}}}, "SearchRequest": search, "SearchResult": schemaOf(reflect.TypeOf(Hit{})), "ModelInput": model, "Envelope": map[string]any{"type": "object", "required": []string{"success"}, "properties": map[string]any{"success": map[string]any{"type": "boolean"}, "data": map[string]any{}, "meta": map[string]any{"type": "object"}, "error": map[string]any{"type": "object", "properties": map[string]any{"code": map[string]string{"type": "string"}, "message": map[string]string{"type": "string"}, "retryable": map[string]string{"type": "boolean"}}}}}}}}
}

func (s *Server) docsRoutes() {
	serve := func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		document := s.openAPI()
		if s.ExtractionOnly {
			info := document["info"].(map[string]string)
			info["title"] = "NebulaeKno 条款参数提取 API"
			info["description"] = "独立提取服务，与主系统共享文档、模型和历史。原文位置链接通过原主系统访问；仅提供提取及其任务接口。"
		}
		writeJSON(w, document)
	}
	s.handle("GET /api/openapi.json", serve)
	s.handle("GET /api/v1/openapi.json", serve)
	s.handle("GET /api/docs", func(w http.ResponseWriter, r *http.Request) {
		operations := append([]operation{}, s.operations...)
		sort.Slice(operations, func(i, j int) bool { return operations[i].Path < operations[j].Path })
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if s.ExtractionOnly {
			_ = extractionDocsTemplate.Execute(w, operations)
		} else {
			_ = docsTemplate.Execute(w, operations)
		}
	})
}

var extractionDocsTemplate = template.Must(template.New("extraction-docs").Parse(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>条款参数提取 API</title><style>body{font:14px/1.7 system-ui;margin:40px auto;max-width:1100px;padding:0 24px;color:#222}a{color:#6254e8}table{border-collapse:collapse;width:100%}td,th{padding:8px 12px;border-bottom:1px solid #eee;text-align:left}code{font-size:13px}</style><h1>NebulaeKno 条款参数提取 API</h1><p>独立接口服务。使用主系统已有的文档 ID 和解析版本，手动创建提取运行；通过任务接口和 SSE 查看进度，支持取消、重试、历史查询和 Excel 导出。</p><p>原文预览、文件上传和模型管理由原主系统提供。响应中的原文相对链接应在原主系统地址下打开。主系统停机时提取等待恢复。</p><p><a href="/api/openapi.json">下载 OpenAPI 3.1</a> · <a href="/health/ready">就绪状态</a></p><table><tr><th>方法</th><th>已注册接口</th></tr>{{range .}}<tr><td>{{.Method}}</td><td><code>{{.Path}}</code></td></tr>{{end}}</table></html>`))

var docsTemplate = template.Must(template.New("docs").Parse(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>NebulaeKno API</title><style>body{font:14px/1.7 system-ui;margin:40px auto;max-width:1100px;padding:0 24px;color:#183326}a{color:#078f49}table{border-collapse:collapse;width:100%}td,th{padding:8px 12px;border-bottom:1px solid #e3ebe6;text-align:left}code{font-size:13px}h1{font-size:24px}</style><h1>NebulaeKno API</h1><p>公共接口无需登录。先创建知识库，再上传文件。异步操作返回 task_id，通过任务接口和 SSE 追踪进度。</p><p><a href="/api/openapi.json">下载 OpenAPI 3.1</a> · <a href="/">返回后台</a></p><p>检索支持 keyword、vector、hybrid、graph、wiki、image_text、image_vector、multi。来源包含文件版本、解析版本、页/段落/区域/毫秒时间位置。</p><table><tr><th>方法</th><th>已注册接口</th></tr>{{range .}}<tr><td>{{.Method}}</td><td><code>{{.Path}}</code></td></tr>{{end}}</table></html>`))

func parserSelectionSchema() map[string]any {
	properties := map[string]any{}
	for key, choices := range defaults.ParserChoices {
		item := map[string]any{"type": "string", "enum": choices}
		if value, ok := defaults.ParserEngines[key]; ok {
			item["default"] = value
		} else {
			item["deprecated"] = true
		}
		properties[key] = item
	}
	return map[string]any{"type": "object", "properties": properties, "additionalProperties": false, "description": "按文件类型独立选择；文件扩展名映射见 GET /api/v1/parser-engines 的 formats。部分更新只覆盖指定类型。"}
}
