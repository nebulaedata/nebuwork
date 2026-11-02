import { useEffect, useState } from "react";
import { Checkbox, Input, Select, Table, Tag, Tooltip } from "antd";
import {
  Workflow as FlowIcon,
  ListTodo,
  Plus,
  ArrowUpRight,
  Search,
  RefreshCw,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  FolderOpen,
  BookOpen,
  Box,
  Plug,
  Bot,
} from "lucide-react";
import { api, date } from "./api";
import { activeStates, states, type Workflow, type TaskSummary } from "./types";
import { Badge, Button, Empty, ErrorNotice, Modal, useJob } from "./ui";
import { WorkflowView } from "./WorkflowView";
import { TaskView } from "./TaskView";
import { SharedEnvironment } from "./Environments";
import { MCPSettings } from "./MCPSettings";
import { AgentSettings } from "./AgentSettings";
import { AICreate, AgentSessionPage, AgentWorkbench } from "./AgentAssistant";

function Dashboard({ mode }: { mode: string }) {
  const [aiCreate, setAICreate] = useState(false);
  const [agentDrafts, setAgentDrafts] = useState<
    { id: string; workflow_id: string; title: string }[]
  >([]);
  const [flows, setFlows] = useState<Workflow[]>([]),
    [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [query, setQuery] = useState(""),
    [archived, setArchived] = useState(false),
    [filter, setFilter] = useState("all");
  const [creating, setCreating] = useState(false),
    [id, setId] = useState(""),
    [name, setName] = useState("");
  const { busy, error, setError, run } = useJob();
  const load = async () => {
    const [flows, tasks, sessions] = await Promise.all([
      api<Workflow[]>("/workflows"),
      api<TaskSummary[]>("/tasks"),
      api<{ id: string; workflow_id: string; title: string }[]>(
        "/agent/sessions",
      ),
    ]);
    setFlows(flows);
    setTasks(tasks);
    setAgentDrafts(
      sessions.filter((s) => !flows.some((f) => f.id === s.workflow_id)),
    );
  };
  useEffect(() => {
    run(load);
    const timer = setInterval(
      () => load().catch((e) => setError(e.message)),
      3000,
    );
    return () => clearInterval(timer);
  }, [mode]);
  const shown = flows.filter(
    (f) =>
      (archived || !f.archived) &&
      (f.name + f.id).toLowerCase().includes(query.toLowerCase()),
  );
  const shownTasks = tasks.filter(
    (t) =>
      (t.id + t.workflow_id).toLowerCase().includes(query.toLowerCase()) &&
      (filter === "all" || t.state === filter),
  );
  const isTasks = mode === "tasks";
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{isTasks ? "任务运行" : "工作流"}</h1>
          <p className="muted">
            {isTasks
              ? "查看执行记录、日志与产物。"
              : "管理流程与代码，从这里开始一次运行。"}
          </p>
        </div>
        {!isTasks && (
          <div className="heading-actions">
            <Button onClick={() => setAICreate(true)}>
              <Bot size={15} />
              AI 创建
            </Button>
            <Button
              className="primary"
              onClick={() => {
                setId("");
                setName("");
                setCreating(true);
              }}
            >
              <Plus size={15} />
              新建工作流
            </Button>
          </div>
        )}
      </div>
      <div className="workspace-summary">
        <span>
          可用工作流 <strong>{flows.filter((f) => !f.archived).length}</strong>
        </span>
        <span>
          正在执行{" "}
          <strong>
            {tasks.filter((t) => activeStates.includes(t.state)).length}
          </strong>
        </span>
        <span>
          等待人工处理{" "}
          <strong>
            {tasks.filter((t) => t.state === "waiting_manual").length}
          </strong>
        </span>
        <span>
          已成功任务{" "}
          <strong>{tasks.filter((t) => t.state === "succeeded").length}</strong>
        </span>
      </div>
      <ErrorNotice message={error} clear={() => setError("")} />
      {!isTasks && agentDrafts.length > 0 && (
        <section className="panel agent-drafts">
          <strong>待完成的 AI 构建</strong>
          <div>
            {agentDrafts.map((s) => (
              <Button key={s.id} href={"#agent/" + s.id}>
                <Bot size={14} />
                {s.title} · {s.workflow_id}
              </Button>
            ))}
          </div>
        </section>
      )}
      <section className="panel list-panel">
        <div className="list-toolbar">
          <Input
            className="search"
            prefix={<Search size={15} />}
            aria-label="搜索"
            placeholder={isTasks ? "搜索任务 ID 或工作流…" : "搜索工作流…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            allowClear
          />
          <div>
            {!isTasks ? (
              <Checkbox
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              >
                包含已归档
              </Checkbox>
            ) : (
              <Select
                aria-label="任务状态筛选"
                value={filter}
                onChange={setFilter}
                style={{ width: 156 }}
                options={[
                  "all",
                  "running",
                  "waiting_manual",
                  "succeeded",
                  "failed",
                  "paused",
                  "cancelled",
                  "ready",
                ].map((value) => ({
                  value,
                  label: value === "all" ? "全部状态" : states[value],
                }))}
              />
            )}
            <Tooltip title="刷新列表">
              <Button
                aria-label="刷新列表"
                className="icon-button"
                disabled={busy}
                onClick={() => run(load)}
              >
                <RefreshCw size={15} />
              </Button>
            </Tooltip>
          </div>
        </div>
        {!isTasks ? (
          <Table<Workflow>
            rowKey="id"
            dataSource={shown}
            pagination={false}
            scroll={{ x: 660 }}
            locale={{
              emptyText: (
                <Empty>
                  这里还没有工作流。新建一个流程，从 Python 步骤开始。
                </Empty>
              ),
            }}
            columns={[
              {
                title: "工作流",
                key: "name",
                render: (_, flow) => (
                  <a href={"#workflow/" + flow.id} className="workflow-name">
                    <span className="flow-icon">
                      <FlowIcon size={19} />
                    </span>
                    <span>
                      <strong>{flow.name}</strong>
                      <small>{flow.id}</small>
                    </span>
                  </a>
                ),
              },
              {
                title: "定义状态",
                width: 145,
                render: (_, flow) => (
                  <Tooltip title={flow.error}>
                    <Tag
                      className={
                        flow.error ? "validation-tag invalid" : "validation-tag"
                      }
                    >
                      {flow.archived
                        ? "已归档"
                        : flow.error
                          ? "需要修复"
                          : "可运行"}
                    </Tag>
                  </Tooltip>
                ),
              },
              {
                title: "最近任务",
                width: 180,
                render: (_, flow) => {
                  const last = tasks.find((t) => t.workflow_id === flow.id);
                  return last ? (
                    <Badge state={last.state} />
                  ) : (
                    <span className="muted">尚无执行记录</span>
                  );
                },
              },
              {
                title: "最近运行时间",
                width: 190,
                render: (_, flow) => {
                  const last = tasks.find((t) => t.workflow_id === flow.id);
                  return (
                    <span className="muted">
                      {last ? date(last.created_at) : "—"}
                    </span>
                  );
                },
              },
              {
                title: "",
                width: 95,
                render: (_, flow) => (
                  <Button href={"#workflow/" + flow.id}>
                    打开
                    <ArrowUpRight size={14} />
                  </Button>
                ),
              },
            ]}
          />
        ) : (
          <Table<TaskSummary>
            rowKey="id"
            dataSource={shownTasks}
            pagination={{
              pageSize: 15,
              hideOnSinglePage: true,
              showSizeChanger: false,
            }}
            scroll={{ x: 700 }}
            locale={{ emptyText: <Empty>没有符合条件的任务</Empty> }}
            columns={[
              {
                title: "任务",
                render: (_, task) => (
                  <a href={"#task/" + task.id}>
                    <code>{task.id.slice(0, 12)}</code>
                  </a>
                ),
              },
              {
                title: "工作流",
                render: (_, task) => (
                  <>
                    <span>
                      {flows.find((f) => f.id === task.workflow_id)?.name ??
                        task.workflow_id}
                    </span>
                    <small>{task.workflow_id}</small>
                  </>
                ),
              },
              {
                title: "状态",
                render: (_, task) => <Badge state={task.state} />,
              },
              {
                title: "创建时间",
                render: (_, task) => (
                  <span className="muted">{date(task.created_at)}</span>
                ),
              },
              {
                title: "",
                width: 95,
                render: (_, task) => (
                  <Button href={"#task/" + task.id}>
                    查看
                    <ChevronRight size={14} />
                  </Button>
                ),
              },
            ]}
          />
        )}
        <div className="panel-footnote">
          <FolderOpen size={13} />
          {isTasks ? shownTasks.length + " 个任务" : shown.length + " 个工作流"}
          <span className="footnote-right">本机工作空间</span>
        </div>
      </section>
      {aiCreate && <AICreate close={() => setAICreate(false)} />}
      {creating && (
        <Modal title="新建工作流" close={() => setCreating(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api("/workflows", "POST", { id, name: name || id });
                setCreating(false);
                location.hash = "workflow/" + id;
              });
            }}
          >
            <label>
              名称
              <Input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：文档分析"
              />
            </label>
            <label>
              工作流 ID
              <Input
                required
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="document-analysis"
                pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,99}"
              />
            </label>
            <p className="muted">
              系统会创建流程定义和一个可编辑的 Python 步骤。
            </p>
            <ErrorNotice message={error} clear={() => setError("")} />
            <footer>
              <Button onClick={() => setCreating(false)}>取消</Button>
              <Button type="submit" className="primary" disabled={busy}>
                创建工作流
              </Button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}

export default function App() {
  const [route, setRoute] = useState(location.hash.slice(1) || "workflows");
  const [collapsed, setCollapsed] = useState(false);
  const [health, setHealth] = useState<{
    status: string;
    scheduler: boolean;
    error?: string;
  } | null>(null);
  useEffect(() => {
    const change = () => setRoute(location.hash.slice(1) || "workflows");
    window.addEventListener("hashchange", change);
    const ping = () =>
      api<{ status: string; scheduler: boolean }>("/health")
        .then(setHealth)
        .catch(() => setHealth(null));
    ping();
    const timer = setInterval(ping, 5000);
    return () => {
      window.removeEventListener("hashchange", change);
      clearInterval(timer);
    };
  }, []);
  const [page, id] = route.split("/");
  const isTasks = page === "tasks" || page === "task";
  return (
    <div className={"app-shell " + (collapsed ? "sidebar-collapsed" : "")}>
      <aside className="sidebar">
        <div className="sidebar-heading">
          <a
            className="brand"
            href="#workflows"
            aria-label="Nebulae Workflow 首页"
          >
            <FlowIcon size={20} />
            <span>
              Nebulae <small>Workflow</small>
            </span>
          </a>
          <Tooltip title="收起侧栏">
            <Button
              className="icon-button collapse-button"
              aria-label="收起侧栏"
              onClick={() => setCollapsed(true)}
            >
              <PanelLeftClose size={17} />
            </Button>
          </Tooltip>
        </div>
        <div className="workspace-label">
          <FolderOpen size={15} />
          <span>本地工作空间</span>
          <Tag>3.5</Tag>
        </div>
        <nav aria-label="主导航">
          <a
            href="#workflows"
            className={
              !isTasks && page !== "environment" && page !== "mcp"
                ? "active"
                : ""
            }
            aria-current={
              !isTasks && page !== "environment" && page !== "mcp"
                ? "page"
                : undefined
            }
            title="工作流"
          >
            <FlowIcon size={17} />
            <span>工作流</span>
          </a>
          <a
            href="#tasks"
            className={isTasks ? "active" : ""}
            aria-current={isTasks ? "page" : undefined}
            title="任务运行"
          >
            <ListTodo size={17} />
            <span>任务运行</span>
          </a>
          <a
            href="#environment"
            className={page === "environment" ? "active" : ""}
            aria-current={page === "environment" ? "page" : undefined}
            title="Python 环境"
          >
            <Box size={17} />
            <span>Python 环境</span>
          </a>
          <a
            href="#mcp"
            className={page === "mcp" ? "active" : ""}
            aria-current={page === "mcp" ? "page" : undefined}
            title="MCP 接入"
          >
            <Plug size={17} />
            <span>MCP 接入</span>
          </a>
          <a
            href="#agent-settings"
            className={page === "agent-settings" ? "active" : ""}
            aria-current={page === "agent-settings" ? "page" : undefined}
            title="智能体设置"
          >
            <Bot size={17} />
            <span>智能体设置</span>
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-runtime">
            <i
              className={
                health?.scheduler && health.status === "ok" ? "online" : ""
              }
            />
            <span>
              {health?.scheduler ? "执行核心已连接" : "服务未连接"}
              <small>本机运行 · 数据存于本地</small>
            </span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            {collapsed && (
              <Button
                className="icon-button"
                aria-label="展开侧栏"
                onClick={() => setCollapsed(false)}
              >
                <PanelLeftOpen size={17} />
              </Button>
            )}
            <span>Nebulae Workflow</span>
            <ChevronRight size={13} />
            <span className="current-location">
              {isTasks
                ? "任务运行"
                : page === "environment"
                  ? "Python 环境"
                  : page === "mcp"
                    ? "MCP 接入"
                    : page === "agent-settings"
                      ? "智能体设置"
                      : "工作流管理"}
            </span>
            {id && (
              <>
                <ChevronRight size={13} />
                <code>{id.length > 18 ? id.slice(0, 12) : id}</code>
              </>
            )}
          </div>
          <div>
            <span className="local-label">
              <i
                className={
                  health?.scheduler && health.status === "ok" ? "online" : ""
                }
              />
              本地
            </span>
            <Tooltip title="API 文档">
              <Button
                href="/docs"
                target="_blank"
                rel="noreferrer"
                aria-label="API 文档"
                className="icon-button"
              >
                <BookOpen size={16} />
              </Button>
            </Tooltip>
          </div>
        </header>
        <main>
          {health?.status === "error" && (
            <div role="alert" className="error-notice">
              调度器已停止：{health.error}。请检查服务日志，任务不会自动恢复。
            </div>
          )}
          {page === "workflow" && id ? (
            <AgentWorkbench key={id} workflowId={id}>
              <WorkflowView key={id} id={id} />
            </AgentWorkbench>
          ) : page === "agent" && id ? (
            <AgentSessionPage key={id} id={id} />
          ) : page === "agent-settings" ? (
            <AgentSettings />
          ) : page === "task" && id ? (
            <TaskView key={id} id={id} />
          ) : page === "environment" ? (
            <SharedEnvironment />
          ) : page === "mcp" ? (
            <MCPSettings />
          ) : (
            <Dashboard key={page} mode={isTasks ? "tasks" : "workflows"} />
          )}
        </main>
      </div>
    </div>
  );
}
