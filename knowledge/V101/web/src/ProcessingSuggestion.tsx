import { useEffect, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  MessagePlugin,
  TagInput,
  Textarea,
} from "tdesign-react";
import { api, Row } from "./api";
import { ErrorNotice } from "./ui";

const graphFields = [
  { key: "tags", label: "实体类型" },
  { key: "relations", label: "关系类型" },
  { key: "custom_instructions", label: "图谱抽取要求" },
  { key: "text", label: "抽取示例" },
];

export function ProcessingSuggestion({
  kind,
  current,
  knowledgeBaseId,
  onApply,
}: {
  kind: "image" | "graph";
  current: Row;
  knowledgeBaseId?: string;
  onApply: (patch: Row) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [context, setContext] = useState("");
  const [seed, setSeed] = useState<Row>({});
  const [reference, setReference] = useState(true);
  const [result, setResult] = useState<Row | null>(null);
  const [selected, setSelected] = useState(graphFields.map((f) => f.key));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController>();
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
      controller.current?.abort();
    },
    [],
  );

  const stop = () => {
    sequence.current++;
    controller.current?.abort();
    setBusy(false);
  };
  const close = () => {
    stop();
    setVisible(false);
  };
  async function generate() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const ticket = ++sequence.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const data = await api("/processing-config/suggest", {
        method: "POST",
        signal: request.signal,
        body: JSON.stringify({
          kind,
          context: context.trim(),
          current: reference ? seed : undefined,
          knowledge_base_id: knowledgeBaseId,
        }),
      });
      if (ticket !== sequence.current) return;
      setResult(data);
      setSelected(graphFields.map((f) => f.key));
    } catch (e) {
      if (ticket === sequence.current && !request.signal.aborted)
        setError((e as Error).message);
    } finally {
      if (ticket === sequence.current) setBusy(false);
    }
  }
  const draft = result?.suggestion || {};
  const graph = draft.extract_config || {};
  const validText = (value: unknown, limit: number) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    Array.from(value).length <= limit;
  const valid =
    kind === "image"
      ? validText(draft.image_instructions, 12000)
      : selected.length > 0 &&
        selected.every((key) => {
          const value = graph[key];
          if (key === "tags" || key === "relations")
            return (
              Array.isArray(value) &&
              value.length > 0 &&
              value.length <= 100 &&
              value.every((v) => validText(v, 100))
            );
          return validText(value, key === "text" ? 8000 : 12000);
        });
  const editGraph = (key: string, value: unknown) =>
    setResult({
      ...result,
      suggestion: { extract_config: { ...graph, [key]: value } },
    });
  function apply() {
    if (!result || !valid || busy) return;
    onApply(
      kind === "image"
        ? { image_instructions: draft.image_instructions }
        : {
            extract_config: Object.fromEntries(
              selected.map((key) => [key, graph[key]]),
            ),
          },
    );
    close();
    MessagePlugin.success("已填入当前表单，请保存配置后生效");
  }

  return (
    <>
      <Button
        size="small"
        variant="outline"
        onClick={() => {
          setSeed(current);
          setResult(null);
          setError("");
          setVisible(true);
        }}
      >
        AI 生成
      </Button>
      <Dialog
        header={kind === "image" ? "AI 生成图片解析要求" : "AI 生成图谱配置"}
        visible={visible}
        width={760}
        top="5vh"
        className="processing-ai-dialog"
        closeOnOverlayClick={false}
        onClose={close}
        confirmBtn={{
          content: "填入当前表单",
          disabled: !result || !valid || busy,
        }}
        cancelBtn="取消"
        onConfirm={apply}
      >
        <div className="field-stack">
          <p className="help">
            使用{knowledgeBaseId ? "此知识库绑定的" : "默认绑定的"}
            文本生成模型。 生成结果可编辑，填入表单后再保存生效。
          </p>
          <label className="field">
            <span className="field-label">资料类型与处理目标</span>
            <Textarea
              aria-label="AI 生成目标"
              value={context}
              disabled={busy}
              maxlength={4000}
              autosize={{ minRows: 3, maxRows: 5 }}
              placeholder={
                kind === "image"
                  ? "例如：电力设备照片和技术图纸，重点识别铭牌参数、部件名称和接线关系。"
                  : "例如：企业项目资料，关注组织、人员、设备、项目，以及负责、使用、依赖等关系。"
              }
              onChange={(value) => {
                setContext(value);
                setResult(null);
              }}
            />
          </label>
          <div className="ai-generation-actions">
            <Checkbox
              checked={reference}
              disabled={busy}
              onChange={(value) => {
                setReference(value);
                setResult(null);
              }}
            >
              参考当前填写的内容
            </Checkbox>
            <div className="responsive-stack">
              <Button
                size="small"
                variant="text"
                disabled={busy}
                onClick={() => {
                  setContext(
                    "适用于常见中文办公资料，要求准确、简洁，保留来源与不确定性。",
                  );
                  setResult(null);
                }}
              >
                使用通用场景
              </Button>
              {busy ? (
                <Button variant="outline" onClick={stop}>
                  停止生成
                </Button>
              ) : (
                <Button disabled={!context.trim()} onClick={generate}>
                  {result ? "重新生成" : "生成建议"}
                </Button>
              )}
            </div>
          </div>
          <ErrorNotice message={error} />
          {busy && (
            <p className="help" role="status">
              正在生成，可停止生成或关闭弹窗。
            </p>
          )}
          {result && (
            <div className="ai-suggestion-preview field-stack">
              <div>
                <h3>生成结果</h3>
                <p className="help">
                  模型：{result.model.name}。
                  {kind === "graph"
                    ? "勾选需要填入的字段，未勾选的字段保留当前值。"
                    : "可继续修改后填入。"}
                </p>
              </div>
              {kind === "image" ? (
                <label className="field">
                  <span className="field-label">内容理解要求</span>
                  <Textarea
                    aria-label="生成的图片解析要求"
                    value={draft.image_instructions}
                    maxlength={12000}
                    autosize={{ minRows: 4, maxRows: 8 }}
                    onChange={(value) =>
                      setResult({
                        ...result,
                        suggestion: { image_instructions: value },
                      })
                    }
                  />
                </label>
              ) : (
                graphFields.map(({ key, label }) => (
                  <div className="field" key={key}>
                    <Checkbox
                      checked={selected.includes(key)}
                      onChange={(checked) =>
                        setSelected((keys) =>
                          checked
                            ? [...keys, key]
                            : keys.filter((k) => k !== key),
                        )
                      }
                    >
                      填入{label}
                    </Checkbox>
                    {key === "tags" || key === "relations" ? (
                      <TagInput
                        aria-label={"生成的" + label}
                        value={graph[key]}
                        clearable
                        onChange={(value) => editGraph(key, value)}
                        placeholder="输入后按回车"
                      />
                    ) : (
                      <Textarea
                        aria-label={"生成的" + label}
                        value={graph[key]}
                        maxlength={key === "text" ? 8000 : 12000}
                        autosize={{ minRows: 3, maxRows: 7 }}
                        onChange={(value) => editGraph(key, value)}
                      />
                    )}
                  </div>
                ))
              )}
              {!valid && (
                <p className="help">
                  请选择要填入的字段，并填写有效内容；类型为 1–100 项，每项最多
                  100 字。
                </p>
              )}
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
