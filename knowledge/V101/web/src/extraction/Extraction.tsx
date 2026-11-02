import { resourceURL } from "../integration";
import { useEffect, useState, type ComponentType } from "react";
import {
  Alert,
  Button,
  Dialog,
  Input,
  MessagePlugin,
  Pagination,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from "tdesign-react";
import { Row, send, supportsPurpose } from "../api";
import {
  action,
  ErrorNotice,
  locationLabel,
  navigate,
  useData,
  usePath,
} from "../ui";
import type { ApplicationProgressProps } from "../DocumentApplications";
import { ExtractionProgress } from "./ExtractionProgress";
import "./extraction.css";

const stateNames: Record<string, string> = {
  not_started: "尚未提取",
  queued: "排队中",
  running: "提取中",
  waiting_configuration: "等待模型配置",
  succeeded: "已完成",
  partially_failed: "部分完成",
  failed: "提取失败",
  cancelled: "已取消",
};
const typeNames: Record<string, string> = {
  requirement: "要求",
  definition: "定义",
  explanation: "解释",
  other: "其他",
};
const dispositionNames: Record<string, string> = {
  extracted: "已提取",
  context_only: "仅作上下文",
  ignored: "已忽略",
  needs_review: "待核验",
};
function ExtractionState({ value }: { value: string }) {
  return (
    <Tag
      theme={
        value === "succeeded"
          ? "success"
          : ["failed", "partially_failed", "waiting_configuration"].includes(
                value,
              )
            ? "warning"
            : "default"
      }
    >
      {stateNames[value] || value}
    </Tag>
  );
}
function total(data?: Row[]) {
  return (data as any)?.meta?.total || 0;
}

export function ExtractionHome() {
  const [kb, setKB] = useState("");
  const [q, setQ] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const libraries = useData<Row[]>("/knowledge-bases?page_size=100");
  const defaults = useData<Row>("/settings/extraction-defaults");
  const models = useData<Row[]>("/models");
  const [defaultModel, setDefaultModel] = useState("");
  useEffect(
    () => setDefaultModel(defaults.data?.model_id || ""),
    [defaults.data],
  );
  const documents = useData<Row[]>(
    "/extractions/documents?" +
      new URLSearchParams({
        knowledge_base_id: kb,
        q,
        state,
        page: String(page),
        page_size: "20",
      }),
    5000,
  );
  const modelOptions = (models.data || [])
    .filter((m) => supportsPurpose(m.purpose, "text"))
    .map((m) => ({ value: m.id, label: m.name + " · " + m.model_name }));
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>条款参数提取</h1>
          <p className="subtitle">
            从已解析的文件中手动提取技术参数与独立要求，逐条追溯原文。
          </p>
        </div>
      </div>
      <div className="section extraction-settings">
        <details>
          <summary>提取模型设置</summary>
          <p className="help">
            独立选择已保存的文本模型；留空时沿用系统文本生成模型。每次运行也可单独选择。
          </p>
          <Space>
            <Select
              aria-label="默认提取模型"
              value={defaultModel}
              onChange={(v) => setDefaultModel(String(v))}
              style={{ width: 360 }}
              options={[
                { value: "", label: "沿用系统文本生成模型" },
                ...modelOptions,
              ]}
            />
            <Button
              onClick={() =>
                action(() =>
                  send(
                    "/settings/extraction-defaults",
                    { model_id: defaultModel },
                    "PUT",
                  ),
                )
              }
            >
              保存设置
            </Button>
          </Space>
        </details>
        <ErrorNotice message={defaults.error || models.error} />
      </div>
      <div className="section">
        <div className="toolbar extraction-filters">
          <Select
            aria-label="筛选知识库"
            value={kb}
            onChange={(v) => {
              setKB(String(v));
              setPage(1);
            }}
            style={{ width: 220 }}
            options={[
              { value: "", label: "全部知识库" },
              ...(libraries.data || []).map((b) => ({
                value: b.id,
                label: b.name,
              })),
            ]}
          />
          <Input
            aria-label="搜索文件名"
            value={q}
            placeholder="搜索文件名"
            onChange={(v) => {
              setQ(v);
              setPage(1);
            }}
            style={{ width: 260 }}
            clearable
          />
          <Select
            aria-label="筛选提取状态"
            value={state}
            onChange={(v) => {
              setState(String(v));
              setPage(1);
            }}
            style={{ width: 180 }}
            options={[
              { value: "", label: "全部提取状态" },
              ...Object.entries(stateNames).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
          <Button variant="outline" onClick={documents.reload}>
            刷新
          </Button>
        </div>
        <ErrorNotice message={documents.error || libraries.error} />
        <Table
          rowKey="id"
          data={documents.data || []}
          loading={documents.loading}
          empty="暂无符合条件的文件"
          tableContentWidth="max(100%, 1100px)"
          pagination={{
            current: page,
            pageSize: 20,
            total: total(documents.data),
            showPageSize: false,
            onCurrentChange: setPage,
          }}
          columns={[
            {
              colKey: "name",
              title: "文件",
              minWidth: 240,
              ellipsis: true,
              cell: ({ row }) => (
                <Button
                  variant="text"
                  onClick={() => navigate("/extractions/" + row.id)}
                >
                  {row.name}
                </Button>
              ),
            },
            {
              colKey: "knowledge_base_name",
              title: "知识库",
              width: 180,
              ellipsis: true,
            },
            {
              colKey: "parse",
              title: "数据处理",
              width: 130,
              cell: ({ row }) => (
                <Tag
                  theme={row.current_parse_version_id ? "success" : "default"}
                >
                  {row.current_parse_version_id ? "解析可用" : "等待解析"}
                </Tag>
              ),
            },
            {
              colKey: "state",
              title: "提取状态",
              width: 160,
              cell: ({ row }) => (
                <ExtractionState value={row.state || "not_started"} />
              ),
            },
            {
              colKey: "records",
              title: "条款数",
              width: 90,
              cell: ({ row }) => row.records || 0,
            },
            {
              colKey: "needs_review",
              title: "待核验",
              width: 90,
              cell: ({ row }) => row.needs_review || 0,
            },
            {
              colKey: "actions",
              title: "操作",
              width: 250,
              cell: ({ row }) => (
                <Space>
                  <Button
                    size="small"
                    disabled={!row.current_parse_version_id}
                    onClick={() =>
                      navigate("/extractions/" + row.id + "?start=1")
                    }
                  >
                    {row.run_id ? "重新提取" : "开始提取"}
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => navigate("/extractions/" + row.id)}
                  >
                    查看结果
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </div>
    </>
  );
}

function SourceEvidence({ record }: { record: Row }) {
  return (
    <div className="extraction-evidence">
      {(record.source?.evidence || []).map((e: Row, index: number) => (
        <div className="extraction-quote" key={index}>
          <p>
            {e.clause ? "条款 " + e.clause + " · " : ""}来源单元 {e.unit_id}
          </p>
          <blockquote>{e.quote}</blockquote>
          {(e.source_refs || []).map((ref: Row) => (
            <Button
              size="small"
              variant="outline"
              key={ref.source_ref_id}
              onClick={() => navigate(ref.preview_url)}
            >
              定位原文 ·{" "}
              {(ref.locators || []).map(locationLabel).join("；") || "解析片段"}
            </Button>
          ))}
          {!e.source_refs?.length && (
            <p className="help">该证据暂时没有可访问的位置，请核验原文。</p>
          )}
        </div>
      ))}
      {!!record.validation?.issues?.length && (
        <Alert theme="warning" message={record.validation.issues.join("；")} />
      )}
    </div>
  );
}

export function DocumentExtraction({
  id,
  parseVersion = "",
  standalone = false,
  Progress = ExtractionProgress,
}: {
  id: string;
  parseVersion?: string;
  standalone?: boolean;
  Progress?: ComponentType<ApplicationProgressProps>;
}) {
  const route = usePath();
  const doc = useData<Row>("/knowledge/" + id, 5000);
  const [historyPage, setHistoryPage] = useState(1);
  const history = useData<Row[]>(
    "/knowledge/" +
      id +
      "/extractions?" +
      new URLSearchParams({
        parse_version_id: parseVersion,
        page: String(historyPage),
        page_size: "30",
      }),
    3000,
  );
  const [selected, setSelected] = useState(
    new URLSearchParams(location.search).get("run_id") || "",
  );
  const runID = selected || history.data?.[0]?.id || "";
  const run = useData<Row>(runID ? "/extractions/" + runID : "", 3000);
  useEffect(() => {
    if (run.data && run.data.knowledge_id !== id) {
      setSelected("");
      MessagePlugin.error("所选提取运行不属于当前文件");
    }
  }, [run.data, id]);
  const [startOpen, setStartOpen] = useState(
    new URLSearchParams(location.search).get("start") === "1",
  );
  const [starting, setStarting] = useState(false);
  const [modelID, setModelID] = useState("");
  const [sectionIDs, setSectionIDs] = useState<string[]>([]);
  const models = useData<Row[]>(startOpen ? "/models" : "");
  const version = parseVersion || doc.data?.current_parse_version_id || "";
  const sections = useData<Row[]>(
    startOpen && version
      ? "/knowledge/" + id + "/extractions/sections?parse_version_id=" + version
      : "",
  );
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const records = useData<Row[]>(
    runID
      ? "/extractions/" +
          runID +
          "/records?" +
          new URLSearchParams({
            q,
            type,
            status,
            page: String(page),
            page_size: "20",
          })
      : "",
    5000,
  );
  const [coveragePage, setCoveragePage] = useState(1);
  const [evidenceRecord, setEvidenceRecord] = useState<Row>();
  const [coverageStatus, setCoverageStatus] = useState("");
  const coverage = useData<Row[]>(
    runID
      ? "/extractions/" +
          runID +
          "/coverage?" +
          new URLSearchParams({
            page: String(coveragePage),
            page_size: "20",
            disposition: coverageStatus,
          })
      : "",
    5000,
  );
  const active =
    run.data &&
    ["queued", "running", "waiting_configuration"].includes(run.data.state);
  useEffect(() => {
    setSelected(new URLSearchParams(location.search).get("run_id") || "");
  }, [route]);
  useEffect(() => {
    setHistoryPage(1);
    setPage(1);
    setCoveragePage(1);
    setSectionIDs([]);
  }, [id, parseVersion]);
  useEffect(() => {
    setPage(1);
    setCoveragePage(1);
  }, [runID]);
  function selectRun(value: string) {
    setSelected(value);
    const q = new URLSearchParams(location.search);
    q.set("run_id", value);
    q.delete("start");
    navigate(`${location.pathname}?${q}`);
  }
  async function start() {
    setStarting(true);
    try {
      const created = await send("/knowledge/" + id + "/extractions", {
        ...(version ? { parse_version_id: version } : {}),
        ...(modelID ? { model_id: modelID } : {}),
        section_ids: sectionIDs,
      });
      selectRun(created.run_id);
      setStartOpen(false);
      history.reload();
      MessagePlugin.success("提取任务已创建");
    } catch (e) {
      MessagePlugin.error((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  const contents = (
    <>
      <Progress
        run={run.data?.knowledge_id === id ? run.data : undefined}
        name={doc.data?.name || ""}
      />
      <div className="toolbar extraction-heading">
        <div>
          <h3>参数提取</h3>
          <p className="help">
            仅手动执行。技术参数与文字要求分别成条，并保留原文证据。
          </p>
        </div>
        <Space>
          <Button
            disabled={!version || !!active}
            onClick={() => {
              setSectionIDs([]);
              setStartOpen(true);
            }}
          >
            {history.data?.length ? "重新提取" : "开始提取"}
          </Button>
          {runID && (
            <Button
              variant="outline"
              href={resourceURL("/api/v1/extractions/" + runID + "/export.xlsx")}
              target="_blank"
            >
              导出 Excel
            </Button>
          )}
        </Space>
      </div>
      {!version && (
        <Alert
          theme="info"
          message="请先完成文件解析。有可用解析版本后即可手动提取，无需等待 Wiki 或图谱。"
        />
      )}
      <ErrorNotice message={history.error || run.error || doc.error} />
      {!!history.data?.length && (
        <div className="extraction-history">
          <Select
            aria-label="选择提取历史"
            value={runID}
            onChange={(v) => selectRun(String(v))}
            options={history.data.map((r) => ({
              value: r.id,
              label:
                new Date(r.created_at).toLocaleString("zh-CN") +
                " · " +
                (stateNames[r.state] || r.state) +
                " · " +
                r.records +
                " 条" +
                (r.historical ? " · 历史解析版本" : ""),
            }))}
          />
          {total(history.data) > 30 && (
            <Pagination
              size="small"
              current={historyPage}
              pageSize={30}
              total={total(history.data)}
              showPageSize={false}
              onCurrentChange={(v) => {
                setHistoryPage(v);
                setSelected("");
              }}
            />
          )}
        </div>
      )}
      {run.data && (
        <>
          {run.data.historical && (
            <Alert
              theme="warning"
              message="当前结果来自历史解析版本。原文引用将打开该次提取对应的旧版本。"
            />
          )}
          <div className="extraction-summary">
            <ExtractionState value={run.data.state} />
            <span>
              已保存 {run.data.records} 条 · 待核验 {run.data.needs_review} 条
            </span>
            <span>
              分块 {run.data.completed_blocks} / {run.data.blocks} · 失败{" "}
              {run.data.failed_blocks}
            </span>
            <span>
              模型：{run.data.config?.model_display_name || "沿用默认"}
              {run.data.config?.model_name
                ? " · " + run.data.config.model_name
                : ""}
            </span>
            <span>
              范围：
              {run.data.config?.section_ids?.length
                ? run.data.config.section_ids.join("、")
                : "全文"}
            </span>
            {active && (
              <Button
                size="small"
                variant="outline"
                onClick={() =>
                  action(() =>
                    send("/tasks/" + run.data!.task_id + "/cancel", {}),
                  )
                }
              >
                取消提取
              </Button>
            )}
            {[
              "failed",
              "partially_failed",
              "cancelled",
              "waiting_configuration",
            ].includes(run.data.state) && (
              <Button
                size="small"
                variant="outline"
                onClick={() =>
                  action(() =>
                    send("/tasks/" + run.data!.task_id + "/retry", {}),
                  )
                }
              >
                继续未完成分块
              </Button>
            )}
          </div>
          <ErrorNotice message={run.data.error?.message} />
          {run.data.summary?.empty_result && (
            <Alert
              theme="warning"
              message="本次未提取到条款，请查看覆盖与问题并核验原文。"
            />
          )}
          {!!run.data.summary?.issues?.length && (
            <Alert
              theme="warning"
              message={run.data.summary.issues
                .map((i: Row) => (i.block_id || "") + " " + i.error)
                .join("；")}
            />
          )}
          <Tabs
            value={
              new URLSearchParams(location.search).get("extraction_tab") ===
              "coverage"
                ? "coverage"
                : "records"
            }
            onChange={(v) => {
              const query = new URLSearchParams(location.search);
              query.set("extraction_tab", String(v));
              navigate(`${location.pathname}?${query}`);
            }}
          >
            <Tabs.TabPanel
              value="records"
              label={"条款结果 " + run.data.records}
            >
              <div className="toolbar extraction-filters">
                <Input
                  aria-label="搜索提取结果"
                  placeholder="搜索指标、要求、条件或原文"
                  value={q}
                  onChange={(v) => {
                    setQ(v);
                    setPage(1);
                  }}
                  style={{ width: 300 }}
                  clearable
                />
                <Select
                  aria-label="筛选条款类型"
                  value={type}
                  onChange={(v) => {
                    setType(String(v));
                    setPage(1);
                  }}
                  style={{ width: 150 }}
                  options={[
                    { value: "", label: "全部类型" },
                    ...Object.entries(typeNames).map(([value, label]) => ({
                      value,
                      label,
                    })),
                  ]}
                />
                <Select
                  aria-label="筛选校验状态"
                  value={status}
                  onChange={(v) => {
                    setStatus(String(v));
                    setPage(1);
                  }}
                  style={{ width: 190 }}
                  options={[
                    { value: "", label: "全部校验状态" },
                    { value: "machine_checked", label: "程序校验通过" },
                    { value: "needs_review", label: "待核验" },
                  ]}
                />
              </div>
              <ErrorNotice message={records.error} />
              <Table
                rowKey="id"
                data={records.data || []}
                tableContentWidth="max(100%, 1400px)"
                empty={
                  active
                    ? "正在提取，完成的分块会陆续展示"
                    : "暂无符合条件的条款"
                }
                expandedRow={({ row }) => <SourceEvidence record={row} />}
                pagination={{
                  current: page,
                  pageSize: 20,
                  total: total(records.data),
                  showPageSize: false,
                  onCurrentChange: setPage,
                }}
                columns={[
                  {
                    colKey: "type",
                    title: "类型",
                    width: 90,
                    cell: ({ row }) => typeNames[row.type] || row.type,
                  },
                  {
                    colKey: "applicability",
                    title: "适用对象",
                    width: 200,
                    cell: ({ row }) => row.applicability?.text || "—",
                  },
                  { colKey: "subject", title: "对象／指标", width: 180 },
                  { colKey: "conditions", title: "条件", width: 200 },
                  { colKey: "content", title: "内容", minWidth: 280 },
                  {
                    colKey: "supplement",
                    title: "补充",
                    width: 200,
                    cell: ({ row }) =>
                      ["exceptions", "references", "relations"]
                        .flatMap((k) => row.supplement?.[k] || [])
                        .join("；") || "—",
                  },
                  {
                    colKey: "validation",
                    title: "校验／来源",
                    width: 200,
                    fixed: "right",
                    cell: ({ row }) => (
                      <div className="extraction-record-state">
                        <Tag
                          theme={
                            row.validation?.status === "needs_review"
                              ? "warning"
                              : "success"
                          }
                        >
                          {row.validation?.status === "needs_review"
                            ? "待核验"
                            : "程序校验通过"}
                        </Tag>
                        {(row.source?.evidence || [])
                          .flatMap((e: Row) => e.source_refs || [])
                          .slice(0, 1)
                          .map((ref: Row) => (
                            <Button
                              key={ref.source_ref_id}
                              size="small"
                              variant="text"
                              onClick={() => navigate(ref.preview_url)}
                            >
                              定位原文 ↗
                            </Button>
                          ))}
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => setEvidenceRecord(row)}
                        >
                          查看全部引文
                        </Button>
                      </div>
                    ),
                  },
                ]}
              />
            </Tabs.TabPanel>
            <Tabs.TabPanel value="coverage" label="覆盖与问题">
              <p className="help">
                记录每个输入单元的处置；处置登记不代表语义正确或条款完整。
              </p>
              <Select
                aria-label="筛选覆盖状态"
                style={{ width: 180, marginBottom: 16 }}
                value={coverageStatus}
                onChange={(v) => {
                  setCoverageStatus(String(v));
                  setCoveragePage(1);
                }}
                options={[
                  { value: "", label: "全部处置" },
                  ...Object.entries(dispositionNames).map(([value, label]) => ({
                    value,
                    label,
                  })),
                ]}
              />
              <ErrorNotice message={coverage.error} />
              <Table
                rowKey="unit_id"
                data={coverage.data || []}
                tableContentWidth="max(100%, 800px)"
                pagination={{
                  current: coveragePage,
                  pageSize: 20,
                  total: total(coverage.data),
                  showPageSize: false,
                  onCurrentChange: setCoveragePage,
                }}
                columns={[
                  { colKey: "unit_id", title: "单元", width: 140 },
                  {
                    colKey: "disposition",
                    title: "处置",
                    width: 140,
                    cell: ({ row }) =>
                      dispositionNames[row.disposition] || row.disposition,
                  },
                  { colKey: "text", title: "原文", minWidth: 280 },
                  { colKey: "reason", title: "原因", minWidth: 240 },
                ]}
              />
            </Tabs.TabPanel>
          </Tabs>
        </>
      )}
      <Dialog
        visible={!!evidenceRecord}
        onClose={() => setEvidenceRecord(undefined)}
        header="原文证据与待核验问题"
        footer={false}
        width="min(900px, calc(100vw - 48px))"
      >
        {evidenceRecord && <SourceEvidence record={evidenceRecord} />}
      </Dialog>
      {!runID && (
        <div className="empty">
          <p>尚未执行参数提取</p>
          <p className="help">数据处理完成后不会自动提取，请点击“开始提取”。</p>
        </div>
      )}
      <Dialog
        visible={startOpen}
        onClose={() => setStartOpen(false)}
        header="手动提取条款参数"
        confirmBtn={{
          content: "开始提取",
          loading: starting,
          disabled: !version || !!sections.error || sections.loading,
        }}
        onConfirm={start}
        closeOnOverlayClick={false}
        width={680}
      >
        <p>{doc.data?.name}</p>
        <label className="field-label">提取模型</label>
        <Select
          aria-label="本次提取模型"
          value={modelID}
          onChange={(v) => setModelID(String(v))}
          options={[
            {
              value: "",
              label: "沿用模块默认模型（未指定时使用系统文本模型）",
            },
            ...(models.data || [])
              .filter((m) => supportsPurpose(m.purpose, "text"))
              .map((m) => ({
                value: m.id,
                label: m.name + " · " + m.model_name,
              })),
          ]}
        />
        <label className="field-label" style={{ marginTop: 20 }}>
          提取章节
        </label>
        <Select
          aria-label="选择提取章节"
          multiple
          clearable
          value={sectionIDs}
          onChange={(v) => setSectionIDs(v as string[])}
          loading={sections.loading}
          placeholder="留空提取全文，可选择多个章节"
          options={(sections.data || []).map((s) => ({
            value: s.id,
            label: s.id + " " + s.title,
          }))}
        />
        <p className="help">
          选择章节会包含其子章节。提取读取当前选定解析版本，不重新解析文件。
        </p>
        <ErrorNotice message={sections.error || models.error} />
      </Dialog>
    </>
  );
  return standalone ? (
    <>
      <div className="page-heading">
        <div>
          <Button variant="text" onClick={() => navigate("/extractions")}>
            ← 全部文件
          </Button>
          <h1>{doc.data?.name || "条款参数提取"}</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            const query = new URLSearchParams({
              category: "applications",
              application: "extraction",
            });
            if (runID) query.set("run_id", runID);
            if (run.data?.knowledge_id === id) {
              query.set("parse_version_id", run.data.parse_version_id);
              query.set("file_version_id", run.data.file_version_id);
            }
            navigate(`/documents/${id}?${query}`);
          }}
        >
          文件详情
        </Button>
      </div>
      <div className="section extraction-workspace">{contents}</div>
    </>
  ) : (
    <div className="extraction-workspace">{contents}</div>
  );
}
