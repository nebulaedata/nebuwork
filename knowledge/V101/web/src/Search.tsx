import { useEffect, useState } from "react";
import {
  Button,
  Alert,
  Checkbox,
  Input,
  InputNumber,
  Select,
  Tag,
  Space,
  MessagePlugin,
  Upload,
} from "tdesign-react";
import { SearchIcon } from "tdesign-icons-react";
import { api, Row, send } from "./api";
import { Empty, ErrorNotice, SourceLink, useData } from "./ui";
const modes = [
  { value: "keyword", label: "关键词检索" },
  { value: "vector", label: "向量检索" },
  { value: "hybrid", label: "混合检索" },
  { value: "graph", label: "图谱召回" },
  { value: "wiki", label: "Wiki 检索" },
  { value: "image_text", label: "图片文字检索" },
  { value: "image_vector", label: "图片语义检索" },
  { value: "multi", label: "多路综合检索" },
];
export function Search() {
  const kbs = useData<Row[]>("/knowledge-bases?page_size=100");
  const [ids, setIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [imageID, setImageID] = useState("");
  const [mode, setMode] = useState("hybrid");
  const [topK, setTopK] = useState(10);
  const [explain, setExplain] = useState(false);
  const [result, setResult] = useState<Row>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (kbs.data?.length && !ids.length) setIds([kbs.data[0].id]);
  }, [kbs.data]);
  async function search() {
    if (!ids.length || (!query.trim() && !imageID)) {
      MessagePlugin.warning("请选择知识库并输入查询内容");
      return;
    }
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      setResult(
        await send("/search", {
          query_text: query,
          query_image_id: ["image_vector", "multi"].includes(mode)
            ? imageID
            : undefined,
          mode,
          knowledge_base_ids: ids,
          top_k: topK,
          candidate_k: Math.max(50, topK),
          include_sources: true,
          include_context: true,
          explain,
          rerank: { mode: "auto" },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>检索测试</h1>
          <p className="subtitle">
            选择检索方式，查看命中内容、得分与原文位置。
          </p>
        </div>
      </div>
      <div className="section">
        <div className="form-grid">
          <label className="field">
            <span className="field-label">检索范围</span>
            <Select
              multiple
              filterable
              value={ids}
              options={(kbs.data || []).map((k) => ({
                value: k.id,
                label: k.name,
              }))}
              placeholder="选择一个或多个知识库"
              onChange={(value) => setIds(value as string[])}
            />
          </label>
          <label className="field">
            <span className="field-label">检索方式</span>
            <Select
              value={mode}
              options={modes}
              onChange={(v) => setMode(String(v))}
            />
          </label>
        </div>
        <div
          className="responsive-stack"
          style={{ marginTop: 20, flexWrap: "nowrap" }}
        >
          <Input
            value={query}
            onChange={setQuery}
            onEnter={search}
            prefixIcon={<SearchIcon />}
            placeholder="输入问题、关键词或图片中的内容描述"
            size="large"
          />
          <Button size="large" loading={busy} onClick={search}>
            检索
          </Button>
        </div>
        <div className="responsive-stack" style={{ marginTop: 16 }}>
          <span className="help">返回条数</span>
          <InputNumber
            value={topK}
            min={1}
            max={100}
            onChange={(v) => setTopK(Number(v))}
            size="small"
          />
          <Checkbox checked={explain} onChange={setExplain}>
            显示检索诊断
          </Checkbox>
          <span className="help">模型或索引未就绪时，会明确显示原因。</span>
        </div>
        {["image_vector", "multi"].includes(mode) && (
          <div style={{ marginTop: 16 }}>
            <p className="help">
              可上传临时查询图片，以图搜图；图片保留 1 小时。
            </p>
            <Upload
              accept="image/png,image/jpeg,image/webp"
              theme="file"
              onRemove={() => setImageID("")}
              requestMethod={async (files) => {
                const file = Array.isArray(files) ? files[0] : files;
                const form = new FormData();
                form.append("file", file.raw!);
                try {
                  const result = await api("/search/query-images", {
                    method: "POST",
                    body: form,
                  });
                  setImageID(result.query_image_id);
                  return { status: "success" as const, response: {} };
                } catch (e) {
                  return {
                    status: "fail" as const,
                    error: (e as Error).message,
                    response: {},
                  };
                }
              }}
            />
          </div>
        )}
      </div>
      <ErrorNotice message={error || kbs.error} />
      {result ? (
        <>
          <div className="toolbar">
            <h3>{result.results?.length || 0} 条结果</h3>
            <span className="help">{result.meta?.duration_ms ?? "—"} ms</span>
          </div>
          {result.meta?.warnings?.map((w: Row, i: number) => (
            <Alert
              key={i}
              theme="warning"
              style={{ marginBottom: 12 }}
              message={`${modes.find((m) => m.value === w.channel)?.label || w.channel || "检索提示"}：${w.message}`}
            />
          ))}
          {result.results?.map((item: Row) => (
            <article className="result" key={item.result_id}>
              <div className="result-meta">
                <Tag variant="light">{item.result_type}</Tag>
                {item.channels?.map((channel: string) => (
                  <span key={channel}>
                    {modes.find((m) => m.value === channel)?.label || channel}
                  </span>
                ))}
              </div>
              <h3>{item.title}</h3>
              <div className="content-text">
                {item.matched_content || item.content}
              </div>
              <Space breakLine style={{ marginTop: 16 }}>
                {item.source_refs?.map((source: Row) => (
                  <SourceLink key={source.source_ref_id} source={source} />
                ))}
              </Space>
              {explain && (
                <pre className="json">
                  {JSON.stringify(item.scores, null, 2)}
                </pre>
              )}
            </article>
          ))}
          {!result.results?.length && (
            <div className="section">
              <Empty
                title="没有找到匹配内容"
                detail="可以调整关键词、扩大知识库范围，或检查文档的索引状态。"
              />
            </div>
          )}
          {explain && (
            <pre className="json">{JSON.stringify(result.meta, null, 2)}</pre>
          )}
        </>
      ) : (
        !busy && (
          <div className="section">
            <Empty
              title="从一个问题开始"
              detail="检索结果会附带源文件、原文页码或音视频时间位置。"
            />
          </div>
        )
      )}
    </>
  );
}
