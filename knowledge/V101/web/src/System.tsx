import { useEffect, useState } from "react";
import {
  Button,
  Drawer,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
} from "tdesign-react";
import { api, send, Row, stateLabel } from "./api";
import { action, ErrorNotice, Status, useData, usePath, navigate } from "./ui";
import { CancelKnowledgeTasksDialog } from "./CancelKnowledgeTasksDialog";
import { RetryFailedTasksDialog } from "./RetryFailedTasksDialog";
import { KnowledgeTaskControls } from "./KnowledgeTaskControls";
import { PipelineView, useTaskStream, currentWork } from "./ProcessingPipeline";
import { ArchiveReport } from "./StoredDocument";
export function Tasks() {
  const route = usePath();
  const libraryId =
    new URLSearchParams(route.split("?")[1] || "").get("knowledge_base_id") ||
    "";
  const library = useData<Row>(
    libraryId ? "/knowledge-bases/" + encodeURIComponent(libraryId) : "",
  );
  const taskRoot = libraryId
    ? `/knowledge-bases/${encodeURIComponent(libraryId)}/tasks`
    : "/tasks";
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const list = useData<Row[]>(
    taskRoot + "?page_size=20&page=" + page + "&state=" + filter,
    3000,
  );
  const [detail, setDetail] = useState<Row>();
  const [cancelTasks, setCancelTasks] = useState(false);
  const [retryTasks, setRetryTasks] = useState(false);
  useEffect(() => {
    setPage(1);
    setDetail(undefined);
    setCancelTasks(false);
    setRetryTasks(false);
  }, [libraryId]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{libraryId ? "当前知识库任务" : "任务中心"}</h1>
          <p className="subtitle">
            {libraryId ? (library.data?.name || "当前知识库") + " · " : ""}
            查看处理阶段、失败原因和已保存的检查点。
          </p>
        </div>
        <Space breakLine>
          {libraryId && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  navigate("/knowledge-bases/" + encodeURIComponent(libraryId))
                }
              >
                返回知识库
              </Button>
              <KnowledgeTaskControls
                key={libraryId}
                libraryId={libraryId}
                libraryName={library.data?.name || "当前知识库"}
                onSubmitted={list.reload}
              />
              <Button
                variant="outline"
                disabled={!library.data || !!library.error}
                onClick={() => setRetryTasks(true)}
              >
                失败任务全部重试
              </Button>
              <Button
                theme="danger"
                variant="outline"
                disabled={!library.data || !!library.error}
                onClick={() => setCancelTasks(true)}
              >
                全部终止
              </Button>
            </>
          )}
          <Button variant="outline" onClick={list.reload}>
            刷新
          </Button>
        </Space>
      </div>
      <ErrorNotice message={list.error || library.error} />
      {retryTasks && (
        <RetryFailedTasksDialog
          libraryId={libraryId}
          libraryName={library.data?.name || "当前知识库"}
          onClose={() => setRetryTasks(false)}
          onSubmitted={list.reload}
        />
      )}
      {cancelTasks && (
        <CancelKnowledgeTasksDialog
          libraryId={libraryId}
          libraryName={library.data?.name || "当前知识库"}
          onClose={() => setCancelTasks(false)}
          onSubmitted={list.reload}
        />
      )}
      <div className="section">
        <div className="toolbar">
          <Select
            value={filter}
            onChange={(v) => {
              setFilter(String(v));
              setPage(1);
            }}
            style={{ width: 220 }}
            options={[
              { value: "", label: "全部状态" },
              ...[
                "queued",
                "running",
                "pausing",
                "paused",
                "waiting_configuration",
                "partially_failed",
                "failed",
                "succeeded",
                "cancelled",
              ].map((v) => ({ value: v, label: stateLabel(v) })),
            ]}
          />
          <span className="help">状态每 3 秒更新</span>
        </div>
        <Table
          tableLayout="fixed"
          tableContentWidth="max(100%, 960px)"
          rowKey="id"
          data={list.data || []}
          pagination={{
            current: page,
            pageSize: 20,
            total: (list.data as any)?.meta?.total || 0,
            showPageSize: false,
            onCurrentChange: setPage,
          }}
          loading={list.loading}
          empty="暂无处理任务"
          columns={[
            {
              colKey: "document_name",
              title: "任务",
              cell: ({ row }) => (
                <Tooltip
                  content={
                    <span className="task-name-full">
                      {row.document_name || row.type}
                    </span>
                  }
                  placement="top-left"
                >
                  <Button
                    className="task-name-button"
                    variant="text"
                    onClick={() => setDetail(row)}
                  >
                    {row.document_name || row.type}
                  </Button>
                </Tooltip>
              ),
            },
            {
              colKey: "type",
              title: "模块",
              width: 140,
              cell: ({ row }) =>
                row.type === "clause_extraction" ? "条款参数提取" : "数据处理",
            },
            {
              colKey: "state",
              title: "状态",
              width: 120,
              cell: ({ row }) =>
                row.cancel_requested && row.state === "running" ? (
                  <Tag theme="warning">正在取消</Tag>
                ) : row.type === "clause_extraction" &&
                  row.state === "partially_failed" ? (
                  <Tag theme="warning">部分完成</Tag>
                ) : (
                  <Status value={row.state} />
                ),
            },
            {
              colKey: "stage",
              title: "当前阶段",
              width: 240,
              ellipsis: true,
              cell: ({ row }) => currentWork(row),
            },
            {
              colKey: "error",
              title: "说明",
              width: 220,
              ellipsis: true,
              cell: ({ row }) => row.error?.message || "—",
            },
            {
              colKey: "actions",
              title: "操作",
              width: 150,
              cell: ({ row }) => (
                <>
                  {[
                    "queued",
                    "running",
                    "pausing",
                    "paused",
                    "waiting_configuration",
                  ].includes(row.state) && (
                    <Button
                      variant="text"
                      onClick={() =>
                        action(
                          () => send("/tasks/" + row.id + "/cancel", {}),
                          list.reload,
                        )
                      }
                    >
                      取消
                    </Button>
                  )}
                  {[
                    "failed",
                    "partially_failed",
                    "cancelled",
                    "waiting_configuration",
                  ].includes(row.state) && (
                    <Button
                      variant="text"
                      onClick={() =>
                        action(
                          () => send("/tasks/" + row.id + "/retry", {}),
                          list.reload,
                        )
                      }
                    >
                      重试
                    </Button>
                  )}
                </>
              ),
            },
          ]}
        />
      </div>
      <Drawer
        header={
          detail?.type === "clause_extraction"
            ? "参数提取流水线"
            : "数据处理流水线"
        }
        visible={!!detail}
        onClose={() => setDetail(undefined)}
        footer={false}
        size="min(1120px, 100vw)"
      >
        {detail && (
          <TaskDetail
            id={detail.id}
            name={detail.document_name || detail.type}
          />
        )}
      </Drawer>
    </>
  );
}
function TaskDetail({ id, name }: { id: string; name: string }) {
  const task = useTaskStream(id);
  return (
    <>
      <h3 className="task-name-full">{name}</h3>
      <ErrorNotice message={task.error} />
      {task.data && (
        <>
          {task.data.type === "clause_extraction" ? (
            <div className="section">
              <PipelineView task={task.data} connected={task.connected} />
              <Button
                onClick={() =>
                  navigate(
                    "/extractions/" +
                      task.data!.knowledge_id +
                      "?run_id=" +
                      task.data!.config.run_id,
                  )
                }
              >
                查看提取进度与结果
              </Button>
            </div>
          ) : (
            <PipelineView task={task.data} connected={task.connected} />
          )}
          <p className="help">任务 ID：{id}</p>
          {task.data.checkpoint?.archive_report && (
            <ArchiveReport report={task.data.checkpoint.archive_report} />
          )}
          {task.data.error && <ErrorNotice message={task.data.error.message} />}
          <h3 style={{ marginTop: 24 }}>本次有效配置</h3>
          <pre className="json">
            {JSON.stringify(task.data.config, null, 2)}
          </pre>
        </>
      )}
    </>
  );
}
export function System() {
  const status = useData<Row>("/system/status", 5000);
  const infra = useData<Row>("/system/infrastructure", 5000);
  const init = useData<Row[]>("/system/initialization");
  const version = useData<Row>("/system/version");
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>系统状态</h1>
          <p className="subtitle">
            基础设施连接由部署环境提供，页面展示脱敏状态。
          </p>
        </div>
        <Status value={status.data?.ready ? "ready" : "pending"} />
      </div>
      <ErrorNotice message={status.error || infra.error} />
      <div className="section">
        <h2>运行环境</h2>
        {[
          ["postgres", "PostgreSQL + pgvector"],
          ["neo4j", "Neo4j + APOC"],
          ["redis", "Redis"],
        ].map(([key, label]) => (
          <div className="status-row" key={key}>
            <div>
              <span className="field-label">{label}</span>
              <p className="help">{infra.data?.[key] || "读取中"}</p>
            </div>
            <Tag theme="success" variant="light">
              {status.data?.components?.[key] || "检查中"}
            </Tag>
          </div>
        ))}
        <div className="status-row">
          <span>解析工作进程</span>
          <Status
            value={
              status.data?.components?.reader === "ready" ? "ready" : "pending"
            }
          />
        </div>
        <div className="status-row">
          <span>版本</span>
          <span>{version.data?.version || "—"}</span>
        </div>
        <div className="status-row">
          <span>安装身份</span>
          <span className="help">{status.data?.installation_id || "—"}</span>
        </div>
      </div>
      <div className="section">
        <div className="toolbar">
          <h2>初始化记录</h2>
          <Button variant="text" onClick={init.reload}>
            刷新
          </Button>
        </div>
        <Table
          rowKey="created_at"
          data={init.data || []}
          columns={[
            { colKey: "stage", title: "阶段" },
            {
              colKey: "status",
              title: "结果",
              cell: ({ row }) => <Status value={row.status} />,
            },
            {
              colKey: "created_at",
              title: "时间",
              cell: ({ row }) =>
                new Date(row.created_at).toLocaleString("zh-CN"),
            },
            {
              colKey: "error",
              title: "原因",
              cell: ({ row }) => row.error?.message || "—",
            },
          ]}
        />
      </div>
    </>
  );
}
