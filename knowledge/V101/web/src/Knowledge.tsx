import { integration } from "./integration";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  Button,
  Dialog,
  Input,
  Textarea,
  Table,
  Tabs,
  Space,
  MessagePlugin,
  Pagination,
  Select,
} from "tdesign-react";
import {
  AddIcon,
  FolderIcon,
  UploadIcon,
  SearchIcon,
} from "tdesign-icons-react";
import { ImageGallery } from "./Images";
import { Wiki } from "./WikiBrowser";
const TabPanel = Tabs.TabPanel;
const GraphCanvas = lazy(() => import("./GraphCanvas"));
import { ProcessingFields } from "./ProcessingSettings";
import { UploadFiles } from "./UploadFiles";
import { RebuildDialog } from "./RebuildDialog";
import { RetryFailedTasksDialog } from "./RetryFailedTasksDialog";
import { KnowledgeTaskControls } from "./KnowledgeTaskControls";
import {
  KnowledgeProgress,
  documentStatusOptions,
  documentStatusCount,
} from "./KnowledgeProgress";
import { currentWork } from "./ProcessingPipeline";
import {
  CancelKnowledgeTasksDialog,
  knowledgeTasksURL,
} from "./CancelKnowledgeTasksDialog";
import { api, send, Row } from "./api";
import {
  action,
  Busy,
  confirmDelete,
  Empty,
  ErrorNotice,
  formatBytes,
  navigate,
  Status,
  useData,
  usePath,
} from "./ui";
export function KnowledgeBases() {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const { data, loading, error, reload } = useData<Row[]>(
    "/knowledge-bases?page_size=20&page=" +
      page +
      "&q=" +
      encodeURIComponent(query),
  );
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const defaults = useData<Row>("/settings/parser-defaults");
  const [config, setConfig] = useState<Row>({});
  const openCreate = () => {
    setConfig(defaults.data || {});
    setShow(true);
  };
  const [busy, setBusy] = useState(false);
  async function create() {
    if (!name.trim()) {
      MessagePlugin.warning("请输入知识库名称");
      return;
    }
    setBusy(true);
    try {
      const kb = await send("/knowledge-bases", {
        name,
        description,
        config,
      });
      setShow(false);
      navigate("/knowledge-bases/" + kb.id);
    } catch (e) {
      MessagePlugin.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>知识库</h1>
          <p className="subtitle">整理资料，让每次检索都有可追溯的来源。</p>
        </div>
        <Button
          icon={<AddIcon />}
          onClick={openCreate}
          disabled={!defaults.data || (!!integration && !integration.canCreate)}
        >
          创建知识库
        </Button>
      </div>
      <ErrorNotice message={error || defaults.error} />
      <div className="toolbar">
        <Input
          value={query}
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          clearable
          prefixIcon={<SearchIcon />}
          placeholder="搜索知识库名称"
          style={{ maxWidth: 320 }}
        />
        <span className="muted">{data?.length || 0} 个知识库</span>
      </div>
      {loading ? (
        <Busy />
      ) : data?.length ? (
        <div className="cards">
          {data
            .filter((k) => k.name.toLowerCase().includes(query.toLowerCase()))
            .map((k) => (
              <div className="section kb-card" key={k.id}>
                <div className="kb-card-title">
                  <span className="kb-icon">
                    <FolderIcon size={22} />
                  </span>
                  <h3>{k.name}</h3>
                </div>
                <p className="card-description">
                  {k.description ||
                    "添加文档、图片、音频或视频，构建可检索的知识。"}
                </p>
                <div className="card-bottom">
                  <span className="muted">{k.document_count} 个文档</span>
                  <Button
                    variant="text"
                    onClick={() => navigate("/knowledge-bases/" + k.id)}
                  >
                    进入知识库 →
                  </Button>
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="section">
          <Empty
            title="创建你的第一个知识库"
            detail="先创建知识库，再上传和处理资料。"
            action={
              <Button onClick={openCreate} disabled={!defaults.data}>
                创建知识库
              </Button>
            }
          />
        </div>
      )}
      <Pagination
        current={page}
        pageSize={20}
        total={(data as any)?.meta?.total || 0}
        showPageSize={false}
        onCurrentChange={setPage}
      />
      <Dialog
        header="创建知识库"
        width={780}
        className="processing-dialog"
        top="6vh"
        visible={show}
        onClose={() => setShow(false)}
        confirmBtn={{ content: "创建", loading: busy }}
        onConfirm={create}
      >
        <div className="field-stack">
          <label className="field">
            <span className="field-label">知识库名称</span>
            <Input
              value={name}
              onChange={setName}
              maxlength={256}
              placeholder="例如：产品资料、项目文档"
            />
          </label>
          <label className="field">
            <span className="field-label">描述</span>
            <Textarea
              value={description}
              onChange={setDescription}
              placeholder="这个知识库包含哪些内容？"
            />
          </label>
          <ProcessingFields value={config} onChange={setConfig} />
        </div>
      </Dialog>
    </>
  );
}
export function KnowledgeDetail({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [parseFilter, setParseFilter] = useState("");
  const kb = useData<Row>("/knowledge-bases/" + id);
  const stats = useData<Row>("/knowledge-bases/" + id + "/stats", 10000);
  const processing = useData<Row>(
    "/knowledge-bases/" + id + "/processing",
    5000,
  );
  const documents = useData<Row[]>(
    "/knowledge-bases/" +
      id +
      "/knowledge?page_size=20&page=" +
      page +
      "&q=" +
      encodeURIComponent(query) +
      "&status=" +
      encodeURIComponent(statusFilter) +
      "&parse_status=" +
      parseFilter,
    5000,
  );
  const locationPath = usePath();
  const [tab, setTab] = useState(
    new URLSearchParams(location.search).get("tab") || "documents",
  );
  useEffect(() => {
    const next = new URLSearchParams(location.search).get("tab");
    if (next && ["documents", "wiki", "graph", "images"].includes(next))
      setTab(next);
  }, [locationPath]);
  const [upload, setUpload] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [edit, setEdit] = useState<Row | null>(null);
  const [manual, setManual] = useState(false);
  const [text, setText] = useState("");
  const [title, setTitle] = useState("");
  const [rebuild, setRebuild] = useState<{
    document?: Row;
    stages?: string[];
  }>();
  const [cancelTasks, setCancelTasks] = useState(false);
  const [retryTasks, setRetryTasks] = useState(false);
  if (!kb.data)
    return kb.loading ? <Busy /> : <ErrorNotice message={kb.error} />;
  const data = kb.data;
  return (
    <>
      <div className="page-heading knowledge-page-heading">
        <div>
          <Button
            variant="text"
            size="small"
            onClick={() => navigate("/knowledge-bases")}
          >
            ← 全部知识库
          </Button>
          <h1>{data.name}</h1>
          <p className="subtitle">
            {data.description ||
              "上传资料后，可查看处理状态、知识页面和原文来源。"}
          </p>
        </div>
        <div className="knowledge-heading-actions">
          <KnowledgeTaskControls
            key={id}
            libraryId={id}
            libraryName={data.name}
            onSubmitted={() => {
              documents.reload();
              processing.reload();
              stats.reload();
            }}
          />
          <Button variant="outline" onClick={() => setRetryTasks(true)}>
            失败任务全部重试
          </Button>
          <Button
            theme="danger"
            variant="outline"
            onClick={() => setCancelTasks(true)}
          >
            全部终止
          </Button>
          <Button variant="outline" onClick={() => setRebuild({})}>
            全库重做
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              setRebuild({ stages: ["embedding", "wiki", "graph"] })
            }
          >
            部分重建
          </Button>
          <Button variant="outline" onClick={() => setEdit({ ...data })}>
            知识库设置
          </Button>
          <Button icon={<UploadIcon />} onClick={() => setUpload(true)}>
            上传文件
          </Button>
        </div>
      </div>
      <ErrorNotice message={kb.error || documents.error} />
      <div
        className={`metric-grid ${tab !== "documents" ? "metric-grid-compact" : ""}`}
      >
        {[
          ["documents", "文档"],
          ["chunks", "分块"],
          ["wiki_pages", "Wiki 页面"],
          ["graph_records", "实体关系证据"],
        ].map(([key, label]) => (
          <div className="metric" key={key}>
            <span className="muted">{label}</span>
            <div className="metric-value">{stats.data?.[key] ?? "—"}</div>
          </div>
        ))}
      </div>
      <KnowledgeProgress
        data={processing.data}
        error={processing.error}
        selected={statusFilter}
        onFilter={(value) => {
          setStatusFilter(value);
          setPage(1);
          setTab("documents");
        }}
        onRefresh={() => {
          processing.reload();
          documents.reload();
        }}
      />
      <div
        className={`section knowledge-content ${tab !== "documents" ? "is-explorer" : ""}`}
      >
        <Tabs value={tab} onChange={(v) => setTab(String(v))}>
          <TabPanel value="documents" label="文档">
            <div style={{ paddingTop: 20 }}>
              <div className="toolbar knowledge-document-toolbar">
                <div className="knowledge-document-filters">
                  <Input
                    value={query}
                    onChange={(value) => {
                      setQuery(value);
                      setPage(1);
                    }}
                    clearable
                    prefixIcon={<SearchIcon />}
                    placeholder="搜索文档名称或路径"
                    style={{ width: 280 }}
                  />
                  <Select
                    aria-label="处理状态筛选"
                    value={statusFilter}
                    style={{ width: 210 }}
                    onChange={(value) => {
                      setStatusFilter(String(value));
                      setPage(1);
                    }}
                    options={documentStatusOptions.map(([value, label]) => ({
                      value,
                      label: `${label}（${documentStatusCount(processing.data, value) ?? "—"}）`,
                    }))}
                  />
                  <Select
                    aria-label="原文解析状态筛选"
                    value={parseFilter}
                    style={{ width: 190 }}
                    onChange={(value) => {
                      setParseFilter(String(value));
                      setPage(1);
                    }}
                    options={[
                      { value: "", label: "全部原文解析状态" },
                      { value: "parsed", label: "已有原文解析结果" },
                      { value: "unparsed", label: "尚无原文解析结果" },
                    ]}
                  />
                  {(query || statusFilter || parseFilter) && (
                    <Button
                      variant="text"
                      onClick={() => {
                        setQuery("");
                        setStatusFilter("");
                        setParseFilter("");
                        setPage(1);
                      }}
                    >
                      清除筛选
                    </Button>
                  )}
                </div>
                <Space breakLine>
                  <Button
                    variant="text"
                    onClick={() => navigate(knowledgeTasksURL(id))}
                  >
                    当前库任务
                  </Button>
                  <Button variant="outline" onClick={() => setManual(true)}>
                    新建文本
                  </Button>
                </Space>
              </div>
              {!documents.data && !documents.error ? (
                <Busy />
              ) : documents.data?.length ? (
                <Table
                  tableContentWidth="max(100%, 1000px)"
                  rowKey="id"
                  data={documents.data}
                  pagination={{
                    current: page,
                    pageSize: 20,
                    total: (documents.data as any)?.meta?.total || 0,
                    showPageSize: false,
                    onCurrentChange: setPage,
                  }}
                  columns={[
                    {
                      colKey: "name",
                      title: "文件名称",
                      ellipsis: ({ row }) => (
                        <div className="document-tooltip">
                          <div>{row.name}</div>
                          {row.relative_path &&
                            row.relative_path !== row.name && (
                              <div className="document-tooltip-path">
                                {row.relative_path}
                              </div>
                            )}
                        </div>
                      ),
                      width: 280,
                      cell: ({ row }) => (
                        <div>
                          <Button
                            variant="text"
                            onClick={() => navigate("/documents/" + row.id)}
                          >
                            {row.name}
                          </Button>
                          {row.relative_path &&
                            row.relative_path !== row.name && (
                              <div
                                className="help"
                                style={{
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {row.relative_path}
                              </div>
                            )}
                        </div>
                      ),
                    },
                    { colKey: "file_type", title: "格式", width: 90 },
                    {
                      colKey: "size",
                      title: "大小",
                      width: 110,
                      cell: ({ row }) => formatBytes(row.size || 0),
                    },
                    {
                      colKey: "status",
                      title: "处理状态 / 当前进度",
                      width: 260,
                      cell: ({ row }) => (
                        <div className="document-processing-cell">
                          <div>
                            <Status
                              value={row.processing_status || row.status}
                            />
                            <span className="help">
                              {row.file_type === "zip"
                                ? "ZIP 原文件"
                                : row.status === "stored"
                                  ? "暂不解析"
                                  : row.has_parse_result
                                    ? "已有原文解析结果"
                                    : "尚无原文解析结果"}
                            </span>
                          </div>
                          {row.processing_task && (
                            <div className="document-current-work">
                              {row.processing_task.cancel_requested &&
                              row.processing_task.state === "running"
                                ? "正在等待当前任务退出"
                                : row.processing_task.partial_rebuild &&
                                    row.processing_task.state === "succeeded"
                                  ? "最近补建任务已完成"
                                  : currentWork(row.processing_task)}
                            </div>
                          )}
                          {row.processing_task && (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => navigate("/documents/" + row.id)}
                            >
                              查看进度
                            </Button>
                          )}
                        </div>
                      ),
                    },
                    {
                      colKey: "outline_status",
                      title: "文件目录",
                      width: 130,
                      cell: ({ row }) =>
                        row.outline_status ? (
                          <Status value={row.outline_status} />
                        ) : (
                          <span className="muted">
                            {row.status === "stored" || row.file_type === "zip"
                              ? "不适用"
                              : "等待提取"}
                          </span>
                        ),
                    },
                    {
                      colKey: "actions",
                      title: "操作",
                      width: 170,
                      cell: ({ row }) => (
                        <Space size={4}>
                          {row.file_type === "zip" ? (
                            <Button
                              variant="text"
                              onClick={() => navigate("/documents/" + row.id)}
                            >
                              解压详情
                            </Button>
                          ) : (
                            <Button
                              variant="text"
                              disabled={[
                                "queued",
                                "processing",
                                "running",
                                "stopping",
                              ].includes(row.processing_status || row.status)}
                              onClick={() => setRebuild({ document: row })}
                            >
                              重做
                            </Button>
                          )}
                          <Button
                            variant="text"
                            theme="danger"
                            onClick={() =>
                              confirmDelete(
                                row.name,
                                () =>
                                  api("/knowledge/" + row.id, {
                                    method: "DELETE",
                                  }),
                                documents.reload,
                              )
                            }
                          >
                            删除
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                  hover
                />
              ) : (
                <Empty
                  title={
                    query || statusFilter || parseFilter
                      ? "没有符合筛选条件的文档"
                      : "还没有文档"
                  }
                  detail={
                    query || statusFilter || parseFilter
                      ? "可切换处理状态、原文解析状态或清除搜索条件。"
                      : "支持上传文件、文件夹和 ZIP 压缩包。ZIP 自动递归解压，不支持的文件也会保存，暂不解析。"
                  }
                  action={
                    query || statusFilter || parseFilter ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setQuery("");
                          setStatusFilter("");
                          setParseFilter("");
                          setPage(1);
                        }}
                      >
                        清除筛选
                      </Button>
                    ) : (
                      <Button onClick={() => setUpload(true)}>上传文件</Button>
                    )
                  }
                />
              )}
            </div>
          </TabPanel>
          <TabPanel value="wiki" label="Wiki">
            <Wiki id={id} onRebuild={() => setRebuild({ stages: ["wiki"] })} />
          </TabPanel>
          <TabPanel value="graph" label="实体知识图谱">
            <Graph
              id={id}
              onRebuild={() => setRebuild({ stages: ["graph"] })}
            />
          </TabPanel>
          <TabPanel value="images" label="图片">
            <ImageGallery
              key={id}
              path={"/knowledge-bases/" + id + "/images"}
              fileNames
            />
          </TabPanel>
        </Tabs>
      </div>
      {retryTasks && (
        <RetryFailedTasksDialog
          libraryId={id}
          libraryName={data.name}
          onClose={() => setRetryTasks(false)}
          onSubmitted={() => {
            documents.reload();
            processing.reload();
            stats.reload();
          }}
        />
      )}
      {cancelTasks && (
        <CancelKnowledgeTasksDialog
          libraryId={id}
          libraryName={data.name}
          onClose={() => setCancelTasks(false)}
          onSubmitted={() => {
            documents.reload();
            stats.reload();
          }}
        />
      )}
      {rebuild && (
        <RebuildDialog
          libraryId={id}
          libraryName={data.name}
          count={stats.data?.documents}
          document={rebuild.document}
          initialStages={rebuild.stages}
          onClose={() => setRebuild(undefined)}
          onSubmitted={() => {
            documents.reload();
            stats.reload();
          }}
        />
      )}
      <Dialog
        header="上传到当前知识库"
        visible={upload}
        closeOnOverlayClick={false}
        closeOnEscKeydown={!uploadBusy}
        onClose={() => {
          if (!uploadBusy) setUpload(false);
        }}
        className="upload-dialog"
        top="5vh"
        footer={
          <div className="form-actions">
            <Button
              disabled={uploadBusy}
              variant="outline"
              onClick={() => navigate(knowledgeTasksURL(id))}
            >
              查看任务中心
            </Button>
            <Button disabled={uploadBusy} onClick={() => setUpload(false)}>
              完成
            </Button>
          </div>
        }
        width={780}
      >
        <UploadFiles
          kb={id}
          onUploaded={() => {
            documents.reload();
            stats.reload();
          }}
          onBusy={setUploadBusy}
        />
      </Dialog>
      <Dialog
        header="新建文本"
        visible={manual}
        onClose={() => setManual(false)}
        onConfirm={() =>
          action(
            () =>
              send("/knowledge-bases/" + id + "/knowledge/manual", {
                name: title,
                content: text,
              }),
            () => {
              setManual(false);
              setText("");
              setTitle("");
              documents.reload();
            },
          )
        }
      >
        <div className="field-stack">
          <Input value={title} onChange={setTitle} placeholder="文档标题" />
          <Textarea
            value={text}
            onChange={setText}
            autosize={{ minRows: 10, maxRows: 20 }}
            placeholder="输入正文，支持 Markdown 标题和目录结构"
          />
        </div>
      </Dialog>
      <Dialog
        header="知识库设置"
        width={780}
        className="processing-dialog"
        top="6vh"
        visible={!!edit}
        onClose={() => setEdit(null)}
        onConfirm={() =>
          edit &&
          action(
            () =>
              send(
                "/knowledge-bases/" + id,
                {
                  name: edit.name,
                  description: edit.description,
                  config: edit.config,
                },
                "PUT",
              ),
            () => {
              setEdit(null);
              kb.reload();
            },
          )
        }
      >
        {edit && (
          <div className="field-stack">
            <Input
              value={edit.name}
              onChange={(v) => setEdit({ ...edit, name: v })}
            />
            <Textarea
              value={edit.description}
              onChange={(v) => setEdit({ ...edit, description: v })}
            />
            <ProcessingFields
              value={edit.config || {}}
              knowledgeBaseId={id}
              onChange={(config) => setEdit({ ...edit, config })}
            />
            <Button
              theme="danger"
              variant="outline"
              onClick={() =>
                confirmDelete(
                  data.name,
                  () => api("/knowledge-bases/" + id, { method: "DELETE" }),
                  () => navigate("/knowledge-bases"),
                )
              }
            >
              删除知识库
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
function Graph({ id, onRebuild }: { id: string; onRebuild: () => void }) {
  const graph = useData<Row>("/knowledge-bases/" + id + "/graph", 10000);
  return (
    <>
      <ErrorNotice message={graph.error} />
      {graph.loading && !graph.data ? (
        <Busy />
      ) : graph.data?.nodes?.length ? (
        <Suspense fallback={<Busy />}>
          <GraphCanvas graph={graph.data} onRebuild={onRebuild} />
        </Suspense>
      ) : (
        <Empty
          title="暂无实体知识图谱"
          detail="绑定文本生成模型后，实体和关系会附带可核验的原文证据。"
          action={
            <Button variant="outline" onClick={onRebuild}>
              重建图谱
            </Button>
          }
        />
      )}
    </>
  );
}
