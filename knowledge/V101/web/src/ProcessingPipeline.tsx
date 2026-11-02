import { resourceURL } from "./integration";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  MessagePlugin,
  Table,
  Dialog,
  EnhancedTable,
  Select,
  Tag,
  Tooltip,
} from "tdesign-react";
import {
  ErrorCircleIcon,
  InfoCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "tdesign-icons-react";
import { api, Row, stateLabel } from "./api";
import { Busy, ErrorNotice, Status, useData } from "./ui";
import { ExtractionBlockProgress } from "./extraction/ExtractionBlockProgress";

const labels: Record<string, string> = {
  parse: "文档解析",
  keyword: "关键词索引",
  images: "图片内容理解",
  image_embedding: "图片向量化",
  outline: "目录提取与核验",
  embedding: "文本向量化",
  wiki: "Wiki 生成",
  graph: "知识图谱",
  preview: "生成预览",
  extract_archive: "递归解压",
  read_document: "读取文件",
  anydoc_extract: "anydoc 提取内容",
  source_positions: "读取原文位置",
  match_blocks: "核验内容块位置",
  extract_assets: "提取嵌入附件",
  read_docx: "读取段落与表格",
  read_spreadsheet: "读取工作表行列",
  convert_preview: "转换预览文件",
  inspect_wps: "核验 WPS 文件内部格式",
  normalize_wps: "读取 WPS 兼容结构副本",
  convert_wps: "转换 WPS 文件并核验产物",
  read_pages: "逐页提取文字 / OCR",
  paddle_pages: "PaddleOCR-VL 逐页解析",
  ofd_render_pages: "OFD 逐页渲染",
  save_chunks: "保存分块与关键词索引",
  inspect_media: "读取媒体信息",
  split_audio: "提取音轨与分段",
  extract_frames: "提取视频代表帧",
  frame_ocr: "识别画面文字",
  convert_media: "转换媒体预览",
  transcribe_audio: "语音转写",
  verify_outline: "核验目录标题",
  embed_chunks: "处理文本分块",
  generate_wiki: "按分块生成 Wiki",
  extract_graph: "按分块抽取实体与关系",
  describe_images: "理解图片内容",
  embed_images: "生成图片向量",
  processing: "知识处理",
  clause_extraction: "参数提取",
  extraction_source: "原文准备",
  extraction_plan: "分类与组块",
  extraction_blocks: "分块提取与校验",
  extraction_save: "汇总与保存",
};
export const stageLabel = (name: string) => labels[name] || stateLabel(name);
const engines: Record<string, string> = {
  excel: "专用表格解析",
  anydoc: "anydoc",
  native: "内置解析器",
  simple: "Simple",
  paddleocr_vl: "PaddleOCR-VL",
  libreoffice: "LibreOffice",
  tesseract: "Tesseract",
};
export function progressLabel(span?: Row) {
  const p = span?.progress;
  if (!p || !p.total) return "";
  const batchUnit = span?.name === "extract_graph" ? "块" : "批";
  if (p.batches)
    return [
      span?.status === "running"
        ? `第 ${p.batch} / ${p.batches} ${batchUnit}`
        : `共 ${p.batches} ${batchUnit}`,
      span?.status === "running"
        ? p.retrying
          ? `等待重试 ${p.attempt} / ${p.max_retries}`
          : p.attempt > 1
            ? `重试 ${p.attempt - 1} / ${p.max_retries}`
            : "首次生成"
        : "",
      `已保存 ${p.completed} / ${p.total} 个分块`,
      p.failed_batches ? `${p.failed_batches} ${batchUnit}失败` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  const unit =
    (
      {
        page: "页",
        converted_page: "页（转换副本）",
        block: "块",
        docx_block: "个内容块",
        chunk: "个分块",
        image: "张图片",
        asset: "个附件",
        frame: "帧",
        segment: "段音频",
        row: "行",
      } as Record<string, string>
    )[p.unit] || "项";
  let text =
    span?.status === "running" &&
    p.current &&
    p.completed < p.total &&
    ["page", "converted_page"].includes(p.unit)
      ? `正在处理第 ${p.current} / ${p.total} ${unit}`
      : `已处理 ${p.completed} / ${p.total} ${unit}`;
  if (p.unit === "docx_block")
    text += ` · 段落 ${p.paragraphs || 0} · 表格 ${p.tables || 0}`;
  if (p.sheet)
    text = `工作表 ${p.sheet_index}/${p.sheets}「${p.sheet}」 · ${text}`;
  return text;
}
export function currentWork(task?: Row) {
  if (!task) return "等待处理";
  if (task.state === "paused") return "已暂停，等待启动后从检查点继续";
  if (task.state === "pausing") return "正在暂停，等待当前执行退出";
  if (task.state === "queued") return task.error ? "等待重试" : "等待处理";
  if (task.state === "succeeded") return "全部启用阶段已完成";
  if (task.state === "cancelled") return "任务已取消";
  if (task.type === "clause_extraction" && task.state === "partially_failed")
    return "部分完成";
  if (task.state === "waiting_configuration") return "等待模型配置";
  if (task.state === "failed" && task.type === "clause_extraction")
    return "提取失败";
  const stages: Row[] = task.checkpoint?.pipeline?.stages || [];
  const stage =
    stages.find((s) => s.status === "running") ||
    stages.find((s) =>
      ["waiting_configuration", "failed"].includes(s.status),
    ) ||
    stages.find((s) => s.name === task.stage);
  const child =
    stage?.children?.find((s: Row) => s.status === "running") ||
    stage?.children?.at(-1);
  return [
    stageLabel(stage?.name || task.stage),
    child && stageLabel(child.name),
    progressLabel(child || stage),
  ]
    .filter(Boolean)
    .join(" · ");
}
export function useTaskStream(id: string) {
  const [data, setData] = useState<Row>();
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let active = true,
      inFlight = false,
      pending = false;
    let stream: EventSource | undefined;
    const controller = new AbortController();
    setData(undefined);
    setError("");
    setConnected(false);
    if (!id) return;
    const load = async () => {
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      try {
        const value = await api<Row>("/tasks/" + id, {
          signal: controller.signal,
        });
        if (!active) return;
        setData({ ...value, received_at: Date.now() });
        setError("");
        if (!stream) {
          stream = new EventSource(
            resourceURL(
              `/api/v1/tasks/${id}/events?last_event_id=${value.last_event_id || 0}`,
            ),
          );
          stream.onopen = () => {
            if (active) setConnected(true);
          };
          stream.onerror = () => {
            if (active) setConnected(false);
          };
          stream.addEventListener("task", () => {
            void load();
          });
        }
      } catch (e) {
        if (active && !controller.signal.aborted)
          setError((e as Error).message);
      } finally {
        inFlight = false;
        if (active && pending) {
          pending = false;
          void load();
        }
      }
    };
    void load();
    const fallback = setInterval(() => {
      void load();
    }, 5000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(fallback);
      stream?.close();
    };
  }, [id]);
  return { data, error, connected };
}
function duration(ms: number) {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const seconds = Math.max(0, ms / 1000);
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} 秒`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
  return `${Math.floor(seconds / 3600)} 时 ${Math.floor((seconds % 3600) / 60)} 分`;
}
function DiagnosticSource({ id }: { id: string }) {
  const { data, error } = useData<Row>("/sources/" + id);
  const positions = data?.locators
    ?.map((loc: Row) =>
      [
        loc.page ? `第 ${loc.page} 页` : "",
        loc.region_id || "",
        loc.paragraph ? `段落 ${loc.paragraph}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .filter(Boolean)
    .join("；");
  if (!data) return <span className="help">{error || "读取来源位置…"}</span>;
  return (
    <a href={data.preview_url} target="_blank" rel="noreferrer">
      定位原文：{positions || data.file_name}
    </a>
  );
}
function GenerationFailure({ failure }: { failure: Row }) {
  return (
    <div className="generation-failure">
      <div>
        <Tag theme="danger" variant="light">
          {failure.code}
        </Tag>{" "}
        {failure.message}
      </div>
      {(failure.issues || []).map((issue: Row, i: number) => (
        <div className="generation-issue" key={i}>
          <strong>{issue.field}</strong>
          <p>{issue.message}</p>
          {(issue.source_ref_ids || []).map((id: string) => (
            <DiagnosticSource key={id} id={id} />
          ))}
          {issue.excerpt && <pre>{issue.excerpt}</pre>}
        </div>
      ))}
      {failure.response_excerpt && (
        <details>
          <summary>查看模型返回摘录（最多 1600 字符）</summary>
          <pre>{failure.response_excerpt}</pre>
        </details>
      )}
      {!failure.issues?.length && !failure.response_excerpt && (
        <p className="help">
          本次记录未包含字段或响应明细；旧失败记录不会补造细节。
        </p>
      )}
    </div>
  );
}

export function WikiBatchProgress({
  task,
  stage = "wiki",
}: {
  task: Row;
  stage?: "wiki" | "graph";
}) {
  const label = stage === "wiki" ? "Wiki 批次" : "实体图谱分块";
  const unit = stage === "wiki" ? "批" : "块";
  const [details, setDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const plan = task.checkpoint?.[stage + "_batches"];
  const batches: Row[] = plan?.batches || [];
  const success = batches.filter((b) => b.status === "succeeded").length;
  const failed = batches.filter((b) => b.status === "failed").length;
  const active = batches.find((b) =>
    ["running", "retrying"].includes(b.status),
  );
  const canRetry =
    task.checkpoint?.[stage] === "failed" &&
    [
      "partially_failed",
      "failed",
      "cancelled",
      "waiting_configuration",
    ].includes(task.state);
  if (!plan && !canRetry) return null;
  return (
    <div className="wiki-batch-progress">
      <div className="toolbar">
        <div>
          <strong>{label}</strong>
          <span className="help">
            {plan
              ? `已保存 ${success} / ${batches.length} ${unit} · 失败 ${failed} ${unit}`
              : "旧任务未记录明细，补跑时将核验并复用已有证据"}
          </span>
        </div>
        <div className="toolbar-actions">
          {plan && (
            <Button
              size="small"
              variant="text"
              onClick={() => setDetails(true)}
            >
              处理明细
            </Button>
          )}
          {canRetry && (
            <Button
              size="small"
              variant="outline"
              loading={submitting}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await api(`/tasks/${task.id}/${stage}/retry-failed`, {
                    method: "POST",
                  });
                  MessagePlugin.success(
                    plan
                      ? "已提交：保留成功批次，仅补跑未完成批次"
                      : "已提交补跑，其他阶段保持原状",
                  );
                } catch (e) {
                  MessagePlugin.error((e as Error).message);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {plan
                ? stage === "wiki"
                  ? "仅补跑失败批次"
                  : "仅补跑失败分块"
                : "重试本阶段"}
            </Button>
          )}
        </div>
      </div>
      {active && task.state === "running" && (
        <p className="help">
          第 {active.index} / {batches.length} {unit} ·{" "}
          {active.status === "retrying"
            ? `等待重试 ${active.attempts} / 2`
            : active.attempts > 1
              ? `重试 ${active.attempts - 1} / 2`
              : "首次生成"}
          {active.error?.message ? ` · ${active.error.message}` : ""}
        </p>
      )}
      <Dialog
        header={label + "详情"}
        placement="center"
        className="wiki-batch-dialog"
        visible={details}
        width="min(900px, calc(100vw - 48px))"
        footer={false}
        closeOnOverlayClick={false}
        onClose={() => setDetails(false)}
      >
        <p className="help">
          每项首次生成失败后最多重试 2
          次。已通过的页面、实体和关系会保留；局部修复不会删除未通过的事实。OCR
          异常需核对原文后重新解析，反复生成不能修复错误原文。
        </p>
        <Table
          size="small"
          rowKey="index"
          tableLayout="fixed"
          maxHeight={360}
          data={batches}
          expandedRow={({ row }) => (
            <div className="generation-diagnostics">
              {row.error && <GenerationFailure failure={row.error} />}
              {(row.history || [])
                .filter((h: Row) => h.error)
                .map((h: Row, i: number) => (
                  <details key={i}>
                    <summary>
                      第 {h.round} 轮 / 第 {h.number} 次：{h.error.code} ·{" "}
                      {h.error.message}
                    </summary>
                    <GenerationFailure failure={h.error} />
                  </details>
                ))}
              {!row.error && !(row.history || []).some((h: Row) => h.error) && (
                <p className="help">本项无失败记录</p>
              )}
            </div>
          )}
          columns={[
            {
              colKey: "index",
              title: stage === "wiki" ? "批次" : "分块",
              width: 64,
            },
            {
              colKey: "range",
              title: "分块范围",
              width: 110,
              cell: ({ row }) => `${row.start + 1}–${row.start + row.count}`,
            },
            {
              colKey: "status",
              title: "状态",
              width: 100,
              cell: ({ row }) => <Status value={row.status} />,
            },
            {
              colKey: "attempts",
              title: "尝试",
              width: 130,
              cell: ({ row }) => `第 ${row.round} 轮 · ${row.attempts} / 3 次`,
            },
            {
              colKey: "accepted",
              title: "已保留",
              width: 120,
              cell: ({ row }) =>
                stage === "wiki"
                  ? `${row.accepted_pages?.length ?? "—"} 页`
                  : `${row.accepted_entities || 0} 实体 / ${row.accepted_relations || 0} 关系`,
            },
            {
              colKey: "error",
              title: "最近错误 / 重试记录",
              cell: ({ row }) => (
                <div className="wiki-batch-error">
                  {row.error?.message ||
                    (row.status === "succeeded"
                      ? "校验通过，结果已保存"
                      : "等待处理")}
                  {(row.history || []).some((h: Row) => h.error) && (
                    <div className="help">
                      {(row.history || []).filter((h: Row) => h.error).length}{" "}
                      条失败记录 · 展开查看
                    </div>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Dialog>
    </div>
  );
}
export function PipelineView({
  task,
  connected,
}: {
  task: Row;
  connected: boolean;
}) {
  const [clock, setClock] = useState(Date.now());
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>("");
  const pipeline = task.checkpoint?.pipeline;
  const extraction = task.type === "clause_extraction";
  const displayState = (state: string) =>
    extraction && state === "partially_failed" ? "部分完成" : stateLabel(state);
  const status = (state: string) =>
    extraction && state === "partially_failed" ? (
      <Tag theme="warning">部分完成</Tag>
    ) : (
      <Status value={state} />
    );
  const active = task.state === "running";
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => setCollapsed([]), [task.id, pipeline?.run_id]);
  const serverNow = task.server_time
    ? new Date(task.server_time).getTime() +
      Math.max(0, clock - task.received_at)
    : clock;
  const end = pipeline?.finished_at
    ? new Date(pipeline.finished_at).getTime()
    : active
      ? serverNow
      : new Date(task.updated_at).getTime();
  const start = pipeline ? new Date(pipeline.started_at).getTime() : end;
  const elapsed = Math.max(0, end - start);
  const scale = Math.max(1000, Math.ceil(elapsed / 1000) * 1000) * 1.08;
  const stages = useMemo(() => {
    const recorded: Row[] = pipeline?.stages || [];
    const names = ["ingest", "rebuild"].includes(task.type)
      ? [
          "parse",
          "keyword",
          "images",
          "image_embedding",
          "outline",
          "embedding",
          "wiki",
          "graph",
        ]
      : task.type === "clause_extraction" &&
          (pipeline ||
            ["queued", "running", "waiting_configuration"].includes(task.state))
        ? [
            "extraction_source",
            "extraction_plan",
            "extraction_blocks",
            "extraction_save",
          ]
        : [];
    for (const span of recorded)
      if (!names.includes(span.name)) names.push(span.name);
    return names.map((name) => {
      const span = recorded.find((s) => s.name === name);
      const enabledKey = (
        {
          images: "image_caption",
          image_embedding: "image_embedding",
          outline: "outline_enabled",
          wiki: "wiki_enabled",
          graph: "graph_enabled",
        } as Record<string, string>
      )[name];
      const planned =
        enabledKey && task.config?.[enabledKey] === false
          ? "disabled"
          : "pending";
      return {
        ...span,
        id: name,
        name,
        status: span?.status || task.checkpoint?.[name] || planned,
        children: span?.children?.map((c: Row, i: number) => ({
          ...c,
          id: `${name}/${c.name}/${i}`,
        })),
      };
    });
  }, [task]);
  const branchIDs = stages.filter((s) => s.children?.length).map((s) => s.id);
  const rows: Row[] = [
    {
      id: "root",
      name:
        task.type === "clause_extraction" ? "clause_extraction" : "processing",
      status: task.state,
      started_at: pipeline?.started_at,
      finished_at: pipeline?.finished_at,
      children: stages,
    },
  ];
  const expandable = ["root", ...branchIDs];
  const enabled = stages.filter(
    (s) => !["disabled", "skipped"].includes(s.status),
  );
  const done = enabled.filter((s) => s.status === "succeeded").length;
  const timed = (row: Row) =>
    row.started_at &&
    (!active || row.status !== "running"
      ? new Date(row.finished_at || task.updated_at).getTime()
      : serverNow) - new Date(row.started_at).getTime();
  const selectedSpan = [
    rows[0],
    ...stages.flatMap((s) => [s, ...(s.children || [])]),
  ].find((s) => s.id === selected);
  return (
    <div className={`pipeline-view${extraction ? " is-extraction" : ""}`}>
      <div className="pipeline-meta">
        {task.type === "clause_extraction" &&
        task.state === "partially_failed" ? (
          <Tag theme="warning">部分完成</Tag>
        ) : (
          <Status value={task.state} />
        )}
        {pipeline && (
          <span>
            耗时 <b>{duration(elapsed)}</b>
          </span>
        )}
        {(!extraction || pipeline) && (
          <span>
            已完成 {done} / {enabled.length} 阶段
          </span>
        )}
        {stages.length > enabled.length && (
          <span>关闭 / 跳过 {stages.length - enabled.length}</span>
        )}
        <span>尝试 #{pipeline?.attempt || task.attempts || 0}</span>
        {["running", "queued"].includes(task.state) && (
          <span
            className={`pipeline-live ${connected ? "" : "is-reconnecting"}`}
          >
            <span className="pipeline-dot" />
            {connected ? "实时更新" : "重新连接 · 5 秒刷新"}
          </span>
        )}
      </div>
      {task.error?.message && (
        <div className="pipeline-error">
          <ErrorCircleIcon />
          <span>{task.error.message}</span>
        </div>
      )}
      {!pipeline && (
        <p className="pipeline-notice">
          <InfoCircleIcon />
          <span>
            {task.state === "queued"
              ? "任务开始后展示真实耗时和处理进度。"
              : "此任务未记录阶段耗时，以下为已保存的处理状态。"}
          </span>
        </p>
      )}
      {pipeline && (
        <p className="help pipeline-current">
          {currentWork(task)}
          {task.cancel_requested && active ? " · 正在取消" : ""}
        </p>
      )}
      {task.type !== "clause_extraction" && (
        <>
          <WikiBatchProgress task={task} />
          <WikiBatchProgress task={task} stage="graph" />
        </>
      )}
      <EnhancedTable
        key={`${task.id}/${pipeline?.run_id || "pending"}`}
        className="pipeline-table"
        rowKey="id"
        size="small"
        tableLayout="fixed"
        tableContentWidth="max(100%, 620px)"
        data={rows}
        rowClassName={({ row }) =>
          `pipeline-row ${row.id === "root" ? "is-root" : ""} ${row.id === selected ? "is-selected" : ""} is-${row.status}`
        }
        onRowClick={({ row }) => setSelected(row.id === selected ? "" : row.id)}
        tree={{ indent: 16, treeNodeColumnIndex: 0 }}
        treeExpandAndFoldIcon={({ type }) =>
          type === "fold" ? (
            <ChevronDownIcon size={14} />
          ) : (
            <ChevronRightIcon size={14} />
          )
        }
        expandedTreeNodes={expandable.filter((id) => !collapsed.includes(id))}
        onExpandedTreeNodesChange={(keys) =>
          setCollapsed(expandable.filter((id) => !keys.includes(id)))
        }
        columns={[
          {
            colKey: "name",
            title: "处理阶段",
            width: 276,
            cell: ({ row }) => (
              <Tooltip
                content={[
                  stageLabel(row.name),
                  displayState(row.status),
                  progressLabel(row),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                placement="top-left"
              >
                <div className="pipeline-name">
                  <span className={`pipeline-dot is-${row.status}`} />
                  <div className="pipeline-name-text">
                    <div>
                      {stageLabel(row.name)}{" "}
                      {row.engine && (
                        <span className="pipeline-engine">
                          {engines[row.engine] || row.engine}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Tooltip>
            ),
          },
          ...(pipeline
            ? [
                {
                  colKey: "duration",
                  title: "耗时",
                  width: 86,
                  cell: ({ row }: { row: Row }) => (
                    <span className="pipeline-duration">
                      {row.started_at &&
                      !["disabled", "skipped"].includes(row.status)
                        ? duration(timed(row))
                        : "—"}
                    </span>
                  ),
                },
              ]
            : [
                {
                  colKey: "state",
                  title: "状态",
                  width: 104,
                  cell: ({ row }: { row: Row }) => status(row.status),
                },
              ]),
          {
            colKey: "timeline",
            title: pipeline ? (
              <div className="pipeline-axis">
                {[0, 0.25, 0.5, 0.75, 1].map((x) => (
                  <span key={x}>{duration(scale * x)}</span>
                ))}
              </div>
            ) : (
              "处理情况"
            ),
            cell: ({ row }) => {
              if (!pipeline)
                return (
                  <span className="pipeline-state-note">
                    {progressLabel(row) ||
                      (row.status === "succeeded"
                        ? "已保存处理结果"
                        : row.status === "failed"
                          ? "点击查看阶段详情"
                          : displayState(row.status))}
                  </span>
                );
              if (
                !row.started_at ||
                ["disabled", "skipped"].includes(row.status)
              )
                return (
                  <div className="pipeline-track">
                    <span className="pipeline-track-note">
                      {row.status === "succeeded"
                        ? "已复用处理结果"
                        : displayState(row.status)}
                    </span>
                  </div>
                );
              const left = Math.max(
                0,
                ((new Date(row.started_at).getTime() - start) / scale) * 100,
              );
              const width = Math.min(
                100 - left,
                Math.max(0.3, (timed(row) / scale) * 100),
              );
              return (
                <div className="pipeline-track">
                  <div
                    className={`pipeline-bar is-${row.status}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    aria-label={`${stageLabel(row.name)}：${stateLabel(row.status)}，耗时 ${duration(timed(row))}`}
                  />
                  {row.status === "running" && progressLabel(row) && (
                    <span className="pipeline-bar-progress">
                      {progressLabel(row)}
                    </span>
                  )}
                </div>
              );
            },
          },
        ]}
      />
      {selectedSpan && (
        <div className="pipeline-inspector">
          <div className="toolbar">
            <strong>{stageLabel(selectedSpan.name)}</strong>
            {status(selectedSpan.status)}
          </div>
          <div>
            {progressLabel(selectedSpan) ||
              (selectedSpan.status === "succeeded"
                ? "该阶段的结果已保存。"
                : displayState(selectedSpan.status))}
          </div>
          {selectedSpan.engine && (
            <p>
              解析引擎：{engines[selectedSpan.engine] || selectedSpan.engine}
            </p>
          )}
          {selectedSpan.status === "failed" &&
            (task.checkpoint?.[selectedSpan.id.split("/")[0] + "_error"]
              ?.message ||
              task.error?.message) && (
              <p className="pipeline-error-text">
                阶段错误：
                {task.checkpoint?.[selectedSpan.id.split("/")[0] + "_error"]
                  ?.message || task.error?.message}
              </p>
            )}
        </div>
      )}
      {extraction && <ExtractionBlockProgress task={task} />}
      <div className="pipeline-footnote">
        <InfoCircleIcon />
        <span>
          {pipeline
            ? "横条表示实际耗时，点击阶段查看详情。进度单位由解析引擎提供。"
            : "点击阶段查看详情；新的处理任务会记录实时耗时。"}
        </span>
      </div>
    </div>
  );
}
export function PipelineTask({ id }: { id: string }) {
  const task = useTaskStream(id);
  return (
    <>
      <ErrorNotice message={task.error} />
      {task.data ? (
        <PipelineView task={task.data} connected={task.connected} />
      ) : (
        <Busy />
      )}
    </>
  );
}
export function DocumentProcessing({ id, name }: { id: string; name: string }) {
  const tasks = useData<Row[]>(`/knowledge/${id}/stages`, 2000);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const processingTasks = tasks.data?.filter(
    (t) => t.type !== "clause_extraction",
  );
  const latest = processingTasks?.[0];
  const taskID = selected || latest?.id;
  return (
    <>
      <div className="processing-summary">
        <div>
          <span className="field-label">数据处理进度</span>
          <span className="help">{tasks.error || currentWork(latest)}</span>
        </div>
        <Button
          size="small"
          variant="outline"
          onClick={() => {
            setSelected("");
            setOpen(true);
          }}
          disabled={!latest}
        >
          数据处理流水线
        </Button>
      </div>
      <Dialog
        header={
          <div className="pipeline-dialog-heading">
            <span>数据处理流水线</span>
            <h2 className="pipeline-dialog-title" title={name}>
              {name}
            </h2>
          </div>
        }
        visible={open}
        width="min(1000px, calc(100vw - 48px))"
        footer={false}
        closeOnOverlayClick={false}
        onClose={() => setOpen(false)}
        className="pipeline-dialog"
        placement="center"
        destroyOnClose
      >
        {open && taskID && (
          <>
            <Select
              className="pipeline-history-select"
              size="small"
              aria-label="选择处理任务"
              value={taskID}
              onChange={(v) => setSelected(String(v))}
              options={(processingTasks || []).map((t) => ({
                value: t.id,
                label: `${new Date(t.created_at).toLocaleString("zh-CN")} · ${stateLabel(t.state)} · ${t.type === "ingest" ? "入库" : t.type === "rebuild" ? "重新处理" : stageLabel(t.type)}`,
              }))}
            />
            <PipelineTask key={taskID} id={taskID} />
          </>
        )}
      </Dialog>
    </>
  );
}
