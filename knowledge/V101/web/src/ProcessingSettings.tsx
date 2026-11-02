import { useEffect, useState } from "react";
import {
  Button,
  Input,
  InputNumber,
  Select,
  Switch,
  Tabs,
  TagInput,
  Textarea,
  Checkbox,
  MessagePlugin,
} from "tdesign-react";
import { Row, send } from "./api";
import { Busy, ErrorNotice, useData } from "./ui";
import { ProcessingSuggestion } from "./ProcessingSuggestion";

const engineNames: Record<string, string> = {
  excel: "专用表格解析",
  anydoc: "anydoc",
  native: "内置",
  simple: "Simple",
  paddleocr_vl: "PaddleOCR-VL",
  tesseract: "Tesseract OCR",
  libreoffice: "LibreOffice（转 PDF）",
  ffmpeg: "FFmpeg",
};
export const defaultImageInstructions =
  "请用简体中文客观描述图片中可观察到的内容、布局与文字。不推断人物身份、意图或未显示的事实。说明看不清的内容。直接返回描述。";
const defaultTags = [
  "人物",
  "组织",
  "地点",
  "产品",
  "项目",
  "技术",
  "概念",
  "事件",
  "流程",
];
const defaultRelations = [
  "属于",
  "包含",
  "负责",
  "提供",
  "使用",
  "依赖",
  "位于",
  "参与",
  "别名",
  "关联",
];

type ProcessingFieldProps = {
  value: Row;
  onChange: (value: Row) => void;
  knowledgeBaseId?: string;
};

// Knowledge bases keep their own format choices and processing strategy.
// Engine service connections are configured globally in Settings.
export function ProcessingFields(props: ProcessingFieldProps) {
  return (
    <Tabs defaultValue="formats" className="processing-tabs">
      <Tabs.TabPanel
        value="formats"
        label="文件格式与引擎"
        destroyOnHide={false}
      >
        <div className="tab-content">
          <FormatEngineFields {...props} />
        </div>
      </Tabs.TabPanel>
      <Tabs.TabPanel value="strategy" label="解析策略" destroyOnHide={false}>
        <div className="tab-content">
          <ParsingStrategyFields {...props} />
        </div>
      </Tabs.TabPanel>
    </Tabs>
  );
}

function FormatEngineFields({ value: v, onChange }: ProcessingFieldProps) {
  const catalog = useData<Row>("/parser-engines");
  const groups: Row[] = catalog.data?.formats || [];
  const set = (key: string, value: any) => onChange({ ...v, [key]: value });
  return (
    <div className="settings-group">
      <p className="help">
        按文件类型选择引擎。设置用于新上传或重新处理的任务，已生成的内容保持当前版本。
        WPS 文字和演示先核验内部格式并按需转换；WPS 表格保留原始行列和保存值，转换图片的位置会单独标记。
      </p>
      <div className="toolbar parser-toolbar">
        <span className="help">
          每种文件类型独立配置；同一行列出的扩展名共用该项选择。
        </span>
        <Button
          size="small"
          variant="outline"
          disabled={!groups.length}
          onClick={() =>
            set(
              "parser_engines",
              Object.fromEntries(groups.map((g) => [g.key, g.default])),
            )
          }
        >
          恢复默认引擎
        </Button>
      </div>
      <ErrorNotice message={catalog.error} />
      <div className="engine-grid">
        {groups.map((g) => (
          <div className="engine-row" key={g.key}>
            <div>
              <span className="field-label">{g.name}</span>
              <div className="extension-tags">
                {g.extensions.map((ext: string) => (
                  <span key={ext}>.{ext}</span>
                ))}
              </div>
            </div>
            <Select
              aria-label={g.name + "解析引擎"}
              value={v.parser_engines?.[g.key] || g.default}
              options={g.choices.map((id: string) => ({
                value: id,
                label: (g.key === "ofd" && id === "native" ? "内置文本提取（旧版）" : engineNames[id]) + (id === g.default ? "（默认）" : ""),
              }))}
              onChange={(x) =>
                set("parser_engines", { ...v.parser_engines, [g.key]: x })
              }
            />
          </div>
        ))}
      </div>
      <p className="help">
        anydoc 已内置，无需额外连接；Simple 音视频解析使用 FFmpeg
        和已绑定的语音识别模型。PaddleOCR-VL 使用「设置 →
        解析引擎配置」中的全局服务连接。未配置时任务提示待配置，不会自动切换到其他引擎。
        OFD 默认先逐页渲染，再用 PaddleOCR-VL 识别文字、表格与图片，保留原页码及区域定位。
      </p>
    </div>
  );
}

function ParsingStrategyFields({
  value: v,
  onChange,
  knowledgeBaseId,
}: ProcessingFieldProps) {
  const set = (key: string, value: any) => onChange({ ...v, [key]: value });
  const graph = v.extract_config || {};
  const setGraph = (key: string, value: any) =>
    set("extract_config", { ...graph, [key]: value });
  const toggle = (
    key: string,
    label: string,
    hint: string,
    fallback = true,
  ) => (
    <div className="status-row" key={key}>
      <div>
        <span className="field-label">{label}</span>
        <p className="help">{hint}</p>
      </div>
      <Switch
        aria-label={label}
        value={v[key] ?? fallback}
        onChange={(x) => set(key, Boolean(x))}
      />
    </div>
  );
  return (
    <Tabs defaultValue="content" theme="card" className="strategy-tabs">
      <Tabs.TabPanel value="content" label="分块与内容">
        <div className="settings-group">
          <h3>分块与内容</h3>
          <div className="form-grid compact-fields">
            <label className="field">
              <span className="field-label">分块长度（字符）</span>
              <InputNumber
                value={v.chunk_size ?? 512}
                min={64}
                max={8192}
                onChange={(x) => set("chunk_size", Number(x))}
              />
            </label>
            <label className="field">
              <span className="field-label">重叠长度（字符）</span>
              <InputNumber
                value={v.chunk_overlap ?? 80}
                min={0}
                max={(v.chunk_size ?? 512) - 1}
                onChange={(x) => set("chunk_overlap", Number(x))}
              />
            </label>
          </div>
          {toggle("html_main_content", "网页正文优先", "减少导航和页脚干扰。")}
        </div>
      </Tabs.TabPanel>
      <Tabs.TabPanel value="excel" label="Excel 表格">
        <div className="settings-group">
          <h3>Excel 解析策略</h3>
          <p className="help">专用表格解析和 anydoc 共用此设置。不指定表头时保留首行数据，按 A、B、C 标识列。分块补充的表头单独保留来源。</p>
          <label className="field"><span className="field-label">默认表头行</span>
            <TagInput value={(v.excel?.header_rows || []).map(String)} placeholder="留空，或输入原始行号后回车，如 1、2" onChange={rows => {
              const values=rows.map(Number);
              if (values.some(n => !Number.isInteger(n)||n<1||n>200000)||values.length>20) {MessagePlugin.warning("请输入 1–200000 的原始行号，最多 20 行");return;}
              set("excel", {...v.excel, header_rows: [...new Set(values)]});
            }} />
          </label>
          <p className="help">可在文件详情 → 原文预览 → 设置表头，为每个工作表单独覆盖。修改后需重新处理才应用到已有文件。</p>
          {toggle("excel_preserve_percentage", "保留表格百分比", "专用表格预览始终保留原始格式。此选项兼容旧版 XLSX 内置解析。")}
        </div>
      </Tabs.TabPanel>
      <Tabs.TabPanel value="media" label="音视频处理">
        <div className="settings-group">
          <h3>音视频处理</h3>
          <p className="help">
            与文件解析统一配置。ASR 保留时间段，视频帧保留实际时间位置。
          </p>
          {toggle(
            "transcription",
            "语音转写",
            "使用已绑定的语音识别模型，或导入带时间戳的字幕。",
          )}
          {toggle("frame_ocr", "视频画面 OCR", "识别代表帧中的文字。")}
          {toggle(
            "frame_caption",
            "视频画面描述",
            "使用视觉模型，遵循「图片解析」中的要求。",
          )}
          <div className="form-grid compact-fields">
            <label className="field">
              <span className="field-label">采样间隔（秒）</span>
              <InputNumber
                value={v.frame_interval_seconds ?? 30}
                min={1}
                max={3600}
                onChange={(x) => set("frame_interval_seconds", Number(x))}
              />
            </label>
            <label className="field">
              <span className="field-label">最多代表帧</span>
              <InputNumber
                value={v.max_frames ?? 240}
                min={1}
                max={240}
                onChange={(x) => set("max_frames", Number(x))}
              />
            </label>
          </div>
        </div>
      </Tabs.TabPanel>
      <Tabs.TabPanel value="images" label="图片解析">
        <div className="settings-group">
          <h3>图片解析要求</h3>
          <p className="help">
            OCR
            提取文字；视觉模型按以下要求生成描述。图片和视频代表帧共用此要求，原始
            OCR 与生成描述分别保存。
          </p>
          {toggle(
            "image_caption",
            "图片内容理解",
            "需绑定视觉模型。视频画面描述还需开启视频画面描述开关。",
          )}
          {toggle(
            "image_embedding",
            "图片向量索引",
            "需绑定多模态向量模型，用于图片向量搜索。",
          )}
          <div className="field compact-fields">
            <span className="field-heading">
              <span className="field-label">内容理解要求</span>
              <ProcessingSuggestion
                kind="image"
                knowledgeBaseId={knowledgeBaseId}
                current={{
                  image_instructions:
                    v.image_instructions ?? defaultImageInstructions,
                }}
                onApply={(patch) => onChange({ ...v, ...patch })}
              />
            </span>
            <Textarea
              aria-label="图片解析要求"
              value={v.image_instructions ?? defaultImageInstructions}
              maxlength={12000}
              autosize={{ minRows: 4, maxRows: 9 }}
              onChange={(x) => set("image_instructions", x)}
              placeholder="例如：重点提取设备铭牌、技术参数和结构关系；看不清的内容明确标注。"
            />
            <span className="help">留空使用中文通用描述要求。</span>
          </div>
        </div>
      </Tabs.TabPanel>
      <Tabs.TabPanel value="graph" label="知识图谱与目录">
        <div className="settings-group">
          {toggle(
            "outline_enabled",
            "文件目录提取",
            "优先使用原生标题和书签，保留可核验的来源位置。",
          )}
          {toggle(
            "wiki_enabled",
            "自动生成 Wiki",
            "生成中文知识页面并保留来源引用。",
          )}
          {toggle(
            "graph_enabled",
            "知识图谱",
            "按下方配置抽取实体与关系，默认开启。",
          )}
          <div className="field-stack compact-fields">
            <div className="field-heading">
              <h3>图谱抽取配置</h3>
              <ProcessingSuggestion
                kind="graph"
                knowledgeBaseId={knowledgeBaseId}
                current={{
                  extract_config: {
                    tags: graph.tags ?? defaultTags,
                    relations: graph.relations ?? defaultRelations,
                    custom_instructions: graph.custom_instructions || "",
                    text: graph.text || "",
                  },
                }}
                onApply={(patch) =>
                  set("extract_config", { ...graph, ...patch.extract_config })
                }
              />
            </div>
            <label className="field">
              <span className="field-label">实体类型</span>
              <TagInput
                aria-label="图谱实体类型"
                value={graph.tags ?? defaultTags}
                clearable
                onChange={(x) => setGraph("tags", x)}
                placeholder="输入类型后按回车"
              />
            </label>
            <label className="field">
              <span className="field-label">关系类型</span>
              <TagInput
                aria-label="图谱关系类型"
                value={graph.relations ?? defaultRelations}
                clearable
                onChange={(x) => setGraph("relations", x)}
                placeholder="输入关系后按回车"
              />
            </label>
            <label className="field">
              <span className="field-label">图谱抽取要求</span>
              <Textarea
                aria-label="图谱抽取要求"
                value={graph.custom_instructions || ""}
                maxlength={12000}
                autosize={{ minRows: 4, maxRows: 9 }}
                onChange={(x) => setGraph("custom_instructions", x)}
                placeholder="只提取有原文依据的事实；使用中文关系描述，并保留来源。"
              />
            </label>
            <label className="field">
              <span className="field-label">抽取示例（可选）</span>
              <Textarea
                value={graph.text || ""}
                autosize={{ minRows: 2, maxRows: 5 }}
                onChange={(x) => setGraph("text", x)}
              />
              <span className="help">示例只指导抽取，不会作为事实入库。</span>
            </label>
          </div>
        </div>
      </Tabs.TabPanel>
    </Tabs>
  );
}

type ParserSection = "formats" | "strategy";

function parserSectionValues(value: Row, section: ParserSection): Row {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) =>
      section === "formats"
        ? key === "parser_engines"
        : key !== "parser_engines",
    ),
  );
}

export function DefaultParserSettings({ section }: { section: ParserSection }) {
  const current = useData<Row>("/settings/parser-defaults");
  const [value, setValue] = useState<Row>({});
  const [saved, setSaved] = useState<Row>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (current.data) {
      setValue(current.data);
      setSaved(parserSectionValues(current.data, section));
    }
  }, [current.data, section]);
  const patch = parserSectionValues(value, section);
  const changed = JSON.stringify(patch) !== JSON.stringify(saved);
  const formats = section === "formats";
  async function save() {
    setSaving(true);
    try {
      await send("/settings/parser-defaults", patch, "PUT");
      setSaved(patch);
      MessagePlugin.success(formats ? "格式引擎已保存" : "解析策略已保存");
    } catch (e) {
      MessagePlugin.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="tab-content parser-settings-page">
      <div className="toolbar parser-page-heading">
        <div>
          <h2>{formats ? "文件格式与引擎" : "解析策略"}</h2>
          <p className="help">
            {formats
              ? "为每种文件类型选择默认解析引擎。"
              : "配置分块、音视频、图片和知识提取的默认处理方式。"}
            保存后用于新建知识库，已有知识库可独立设置。
          </p>
        </div>
        <Button
          loading={saving}
          disabled={!current.data || !changed}
          onClick={save}
        >
          {formats ? "保存格式引擎" : "保存解析策略"}
        </Button>
      </div>
      <ErrorNotice message={current.error} />
      {!current.data ? (
        current.loading ? (
          <Busy />
        ) : (
          <Button variant="outline" onClick={current.reload}>
            重新加载
          </Button>
        )
      ) : formats ? (
        <FormatEngineFields value={value} onChange={setValue} />
      ) : (
        <ParsingStrategyFields value={value} onChange={setValue} />
      )}
    </div>
  );
}

export function ParserServiceSettings() {
  const current = useData<Row>("/settings/parser-engines");
  const [value, setValue] = useState<Row>({});
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (current.data) setValue(current.data);
  }, [current.data]);
  const paddle = value.paddleocr_vl || {};
  const set = (key: string, v: any) =>
    setValue({ ...value, paddleocr_vl: { ...paddle, [key]: v } });
  return (
    <div className="tab-content parser-settings-page">
      <div className="parser-page-heading">
        <h2>解析引擎配置</h2>
        <p className="help">配置引擎服务的连接与运行参数，所有知识库共用。</p>
      </div>
      <ErrorNotice message={current.error} />
      {!current.data ? (
        current.loading ? (
          <Busy />
        ) : (
          <Button variant="outline" onClick={current.reload}>
            重新加载
          </Button>
        )
      ) : (
        <div className="engine-service">
          <h3>PaddleOCR-VL</h3>
          <p className="help">
            填写完整 Pipeline 服务基础地址，需支持
            /layout-parsing；不使用聊天模型的 /v1 地址。
          </p>
          <label className="field compact-fields">
            <span className="field-label">服务地址</span>
            <Input
              aria-label="PaddleOCR-VL 服务地址"
              value={paddle.endpoint || ""}
              placeholder="http://host.docker.internal:端口"
              onChange={(x) => set("endpoint", x)}
            />
          </label>
          <div className="responsive-stack compact-fields">
            <Checkbox
              checked={paddle.use_seal_recognition ?? true}
              onChange={(x) => set("use_seal_recognition", x)}
            >
              印章识别
            </Checkbox>
            <Checkbox
              checked={paddle.use_chart_recognition ?? false}
              onChange={(x) => set("use_chart_recognition", x)}
            >
              图表识别
            </Checkbox>
          </div>
          <div className="form-actions">
            <Button
              variant="outline"
              loading={checking}
              onClick={async () => {
                setChecking(true);
                try {
                  const r = await send("/parser-engines/check", value);
                  MessagePlugin.success(r.message);
                } catch (e) {
                  MessagePlugin.error((e as Error).message);
                } finally {
                  setChecking(false);
                }
              }}
            >
              检查连接
            </Button>
            <Button
              loading={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await send("/settings/parser-engines", value, "PUT");
                  MessagePlugin.success("引擎配置已保存");
                } catch (e) {
                  MessagePlugin.error((e as Error).message);
                } finally {
                  setSaving(false);
                }
              }}
            >
              保存引擎配置
            </Button>
          </div>
        </div>
      )}
      <div className="engine-builtin-note">
        <h3>内置引擎</h3>
        <p className="help">
          anydoc、内置、Simple、Tesseract 和 LibreOffice
          随应用提供，无需填写服务地址。
        </p>
        <p className="help">
          音视频转写使用已绑定的语音模型；模型连接和用途绑定在「模型」页配置。
        </p>
      </div>
    </div>
  );
}
