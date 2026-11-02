import { Select, Tabs, Progress, Alert } from "antd";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Play,
  Pause,
  Square,
  RotateCcw,
  RefreshCw,
  GitBranch,
  Clock,
  AlertCircle,
} from "lucide-react";
import { api, date, pretty, uuid } from "./api";
import {
  states,
  activeStates,
  type Task,
  type Event,
  type EnvironmentRecord,
} from "./types";
import { Button, Badge, Empty, ErrorNotice, Modal, useJob } from "./ui";
import { Graph } from "./Graph";
import { ArtifactList } from "./Artifacts";
import { EnvironmentSummary } from "./Environments";
import { TaskEvents } from "./TaskEvents";

export function TaskView({ id }: { id: string }) {
  const [task, setTask] = useState<Task | null>(null),
    [events, setEvents] = useState<Event[]>([]);
  const [selected, setSelected] = useState(""),
    [attempt, setAttempt] = useState<number | null>(null),
    [logs, setLogs] = useState("");
  const [tab, setTab] = useState("artifacts"),
    [connected, setConnected] = useState(false);
  const [preview, setPreview] = useState<{
    affected: string[];
    reused: Record<string, number>;
    version: number;
    from: string[] | null;
    environment: EnvironmentRecord;
    environment_token: string;
  } | null>(null);
  const { error, setError, busy, run } = useJob();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inspector = useRef<HTMLElement>(null);
  const refresh = async () => {
    const value = await api<Task>("/tasks/" + id);
    setTask(value);
  };
  useEffect(() => {
    let alive = true;
    let stream: EventSource | undefined;
    const load = () =>
      api<Task>("/tasks/" + id)
        .then((t) => {
          if (alive) {
            setTask(t);
            setSelected((old) => old || t.steps[0]?.name || "");
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    load();
    api<Event[]>(`/tasks/${id}/events`)
      .then((initial) => {
        if (!alive) return;
        setEvents(initial);
        stream = new EventSource(
          `/api/v1/tasks/${id}/stream?after=${initial.at(-1)?.id ?? 0}`,
        );
        stream.onopen = () => setConnected(true);
        stream.onerror = () => setConnected(false);
        stream.onmessage = (message) => {
          const item = JSON.parse(message.data) as Event;
          setEvents((old) =>
            old.some((e) => e.id === item.id)
              ? old
              : [...old, item].slice(-500),
          );
          if (!timer.current)
            timer.current = setTimeout(() => {
              timer.current = null;
              load();
            }, 120);
        };
      })
      .catch((e) => setError(e.message));
    const poll = setInterval(load, 2000);
    return () => {
      alive = false;
      stream?.close();
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [id, setError]);
  const step = task?.steps.find((s) => s.name === selected);
  const record =
    step?.history.find((a) => a.number === attempt) ?? step?.history.at(-1);
  useEffect(() => {
    if (!record) {
      setLogs("");
      return;
    }
    let alive = true;
    api<{ text: string }>(
      `/tasks/${id}/logs?step=${selected}&attempt=${record.number}`,
    )
      .then((value) => {
        if (alive) setLogs(value.text);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [
    id,
    selected,
    record?.number,
    record?.state,
    events.at(-1)?.id,
    setError,
  ]);
  const action = (name: string) =>
    run(async () => {
      if (!task) return;
      await api(`/tasks/${id}/actions/${name}`, "POST", {
        expected_version: task.version,
        command_id: uuid(),
      });
      await refresh();
    });
  const rerun = (from: string[] | null) =>
    run(async () => {
      const value = await api<{
        affected: string[];
        reused: Record<string, number>;
        version: number;
        environment: EnvironmentRecord;
        environment_token: string;
      }>(`/tasks/${id}/preview`, "POST", { from_steps: from });
      setPreview({ ...value, from });
    });
  if (!task)
    return (
      <>
        <ErrorNotice message={error} clear={() => setError("")} />
        <Empty>正在读取任务…</Empty>
      </>
    );
  const complete = task.steps.filter((s) => s.state === "succeeded").length;
  return (
    <>
      <a href="#tasks" className="back">
        <ArrowLeft size={15} />
        任务列表
      </a>
      <div className="page-heading">
        <div>
          <div className="eyebrow">TASK / {task.id.slice(0, 12)}</div>
          <h1>{task.definition.name || task.workflow_id}</h1>
          <p className="muted">
            {date(task.created_at)}
            <span className="sep">·</span>
            <a href={"#workflow/" + task.workflow_id}>查看工作流</a>
          </p>
        </div>
        <div className="heading-actions">
          <Badge state={task.state} />
          {task.state === "ready" && (
            <Button
              className="primary"
              disabled={busy}
              onClick={() => action("start")}
            >
              <Play size={15} />
              开始执行
            </Button>
          )}
          {["running", "queued"].includes(task.state) && (
            <Button disabled={busy} onClick={() => action("pause")}>
              <Pause size={15} />
              暂停
            </Button>
          )}
          {["paused", "failed", "cancelled", "waiting_manual"].includes(
            task.state,
          ) && (
            <Button
              className="primary"
              disabled={busy}
              onClick={() => action("resume")}
            >
              <Play size={15} />
              继续执行
            </Button>
          )}
          {!["succeeded", "failed", "cancelled", "cancelling"].includes(
            task.state,
          ) && (
            <Button disabled={busy} onClick={() => action("cancel")}>
              <Square size={14} />
              取消任务
            </Button>
          )}
          <Button
            disabled={busy || activeStates.includes(task.state)}
            onClick={() => rerun(null)}
          >
            <RotateCcw size={15} />
            完整重跑
          </Button>
        </div>
      </div>
      <ErrorNotice message={error} clear={() => setError("")} />
      <div className="task-environment">
        <span className="muted">本轮执行环境</span>
        <EnvironmentSummary
          value={task.environment}
          empty="尚未绑定；人工开始、恢复或重跑时采用工作流当前配置"
        />
      </div>
      {task.state === "waiting_manual" && (
        <Alert
          className="manual-notice"
          type="warning"
          showIcon
          title="任务等待人工处理"
          description="服务已重启，尚未完成的步骤不会自动执行。检查历史和产物后，可选择继续或重跑。"
        />
      )}
      <div className="task-summary">
        <span>
          <GitBranch size={17} />
          <strong>
            {complete} / {task.steps.length}
          </strong>{" "}
          步骤成功
        </span>
        <Progress
          className="task-progress"
          percent={(complete / Math.max(1, task.steps.length)) * 100}
          showInfo={false}
          strokeColor="#4f8065"
          size="small"
        />
        <span className="live-status">
          <i className={connected ? "online" : ""} />
          {connected ? "事件已连接" : "正在重连 · 定时刷新"}
        </span>
      </div>
      <div className="task-workspace">
        <Graph
          definition={task.definition}
          steps={task.steps}
          onSelect={(name) => {
            setSelected(name);
            setAttempt(null);
          }}
        />
        <aside className="step-inspector" ref={inspector}>
          <div className="inspector-title">
            <span>步骤详情</span>
            {step && <Badge state={step.state} />}
          </div>
          {step ? (
            <>
              <h2>{step.name}</h2>
              <code className="entrypoint">
                {task.definition.steps[step.name].code}
              </code>
              <div className="form-section">
                <label>
                  执行记录
                  <Select
                    aria-label="执行记录"
                    value={record?.number}
                    placeholder="尚未执行"
                    onChange={setAttempt}
                    options={step.history.map((a) => ({
                      value: a.number,
                      label:
                        "第 " +
                        a.number +
                        " 次 · " +
                        (states[a.state] ?? a.state),
                    }))}
                  />
                </label>
                {record && (
                  <>
                    <div className="metadata">
                      <Clock size={14} />
                      {date(record.started_at)}
                    </div>
                    <small>
                      代码版本{" "}
                      <code>
                        {record.code_hash?.slice(0, 12) ?? "尚未加载"}
                      </code>
                    </small>
                    <EnvironmentSummary value={record.environment} />
                    <label>
                      本次上游记录<pre>{pretty(record.dependencies)}</pre>
                    </label>
                    {record.error && (
                      <pre className="error-trace">{record.error}</pre>
                    )}
                    <label>
                      控制台输出
                      <pre className="console-output">
                        {logs || "无控制台输出"}
                      </pre>
                    </label>
                  </>
                )}
              </div>
              <Button
                disabled={busy || activeStates.includes(task.state)}
                onClick={() => rerun([step.name])}
              >
                <RotateCcw size={15} />
                从此步骤重跑
              </Button>
            </>
          ) : (
            <Empty>点击节点查看详情</Empty>
          )}
        </aside>
      </div>
      <section className="panel task-records">
        <Tabs
          className="workspace-tabs"
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "artifacts",
              label: (
                <>
                  全部产物<span className="count">{task.artifacts.length}</span>
                </>
              ),
            },
            { key: "events", label: "运行事件" },
            { key: "input", label: "任务输入" },
          ]}
          tabBarExtraContent={
            <Button
              className="icon-button"
              aria-label="刷新任务"
              onClick={() => run(refresh)}
            >
              <RefreshCw size={15} />
            </Button>
          }
        />
        {tab === "artifacts" && (
          <ArtifactList key={id} artifacts={task.artifacts} />
        )}
        {tab === "input" && (
          <pre className="input-preview">{pretty(task.input)}</pre>
        )}
        {tab === "events" && (
          <TaskEvents
            key={id}
            task={task}
            events={events}
            inspect={(name, number) => {
              setSelected(name);
              setAttempt(number);
              inspector.current?.scrollIntoView({
                block: "nearest",
                behavior: "smooth",
              });
            }}
          />
        )}
      </section>
      {preview && (
        <Modal title="确认重跑范围" close={() => setPreview(null)}>
          <p>
            以下步骤及其连线关联的下游将重新执行，原执行记录与产物仍会保留。
          </p>
          <div className="affected-list">
            {preview.affected.map((name) => (
              <span key={name}>
                <RotateCcw size={13} />
                {name}
              </span>
            ))}
          </div>
          <label>
            复用的上游成功记录
            <pre className="input-preview">
              {Object.keys(preview.reused).length
                ? pretty(preview.reused)
                : "本次无需复用上游结果"}
            </pre>
          </label>
          <ErrorNotice message={error} clear={() => setError("")} />
          <p className="muted">本次重跑将使用</p>
          <EnvironmentSummary value={preview.environment} />
          <footer>
            <Button onClick={() => setPreview(null)}>取消</Button>
            <Button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/tasks/${id}/actions/rerun`, "POST", {
                    expected_version: preview.version,
                    command_id: uuid(),
                    from_steps: preview.from,
                    expected_environment: preview.environment_token,
                  });
                  setPreview(null);
                  await refresh();
                })
              }
            >
              <Play size={15} />
              执行重跑
            </Button>
          </footer>
        </Modal>
      )}
    </>
  );
}
