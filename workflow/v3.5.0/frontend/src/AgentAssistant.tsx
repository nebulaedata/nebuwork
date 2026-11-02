import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Drawer, Input, Select, Spin, Tag } from "antd";
import ReactMarkdown from "react-markdown";
import { Bot, Plus, Send, Square, X } from "lucide-react";
import { api, ApiError, date, uuid } from "./api";
import { Button, Empty, ErrorNotice, Modal, useJob } from "./ui";
import { WorkflowView } from "./WorkflowView";

import { ToolActivity, type AgentCall } from "./AgentTools";

export type AgentSession = {
  id: string;
  workflow_id: string;
  title: string;
  state: string;
  version: number;
  created_at: number;
  calls: AgentCall[];
  rounds: { id: string; state: string; error: string | null }[];
};
type Event = {
  id: number;
  round_id: string;
  kind: string;
  payload: {
    text?: string;
    name?: string;
    call_id?: string;
    error?: string;
    changed?: boolean;
  };
};
const labels: Record<string, string> = {
  idle: "尚未开始",
  running: "处理中",
  stopping: "正在停止",
  stopped: "已停止",
  succeeded: "已完成",
  failed: "失败",
  interrupted: "已中断",
  unknown: "待核对",
};
export const notifyWorkflow = (id: string) =>
  window.dispatchEvent(
    new CustomEvent("nebulae:workflow-change", { detail: id }),
  );

function transcript(events: Event[]) {
  const items: {
    key: number;
    kind: "user" | "assistant" | "tool" | "error" | "notice";
    text: string;
    name?: string;
    round?: string;
    call?: string;
  }[] = [];
  let current: (typeof items)[number] | undefined;
  for (const e of events) {
    if (e.kind === "user.message") {
      current = undefined;
      items.push({ key: e.id, kind: "user", text: e.payload.text ?? "" });
    }
    if (e.kind === "pi.message_start") {
      current = { key: e.id, kind: "assistant", text: "" };
      items.push(current);
    }
    if (e.kind === "pi.delta") {
      if (!current) {
        current = { key: e.id, kind: "assistant", text: "" };
        items.push(current);
      }
      current.text += e.payload.text ?? "";
    }
    if (e.kind === "pi.message") {
      if (current) current.text = e.payload.text ?? current.text;
      current = undefined;
    }
    if (e.kind === "tool.start") {
      current = undefined;
      items.push({
        key: e.id,
        kind: "tool",
        text: "",
        name: e.payload.name,
        round: e.round_id,
        call: e.payload.call_id,
      });
    }
    if (
      e.kind === "tool.rejected" ||
      (e.kind.startsWith("round.") && e.payload.error)
    )
      items.push({
        key: e.id,
        kind: "error",
        text: e.payload.error ?? "操作失败",
      });
    if (e.kind === "pi.compaction_start")
      items.push({ key: e.id, kind: "notice", text: "正在整理长对话上下文…" });
    if (e.kind === "pi.compaction_end")
      items.push({
        key: e.id,
        kind: "notice",
        text: e.payload.error ?? "上下文整理完成，完整历史仍可查看。",
      });
  }
  // Empty assistant messages are emitted around tool-only model turns.
  // Keep adjacent calls together without merging across real text or user turns.
  type Item = (typeof items)[number];
  const blocks: (Item | { key: number; kind: "tools"; items: Item[] })[] = [];
  for (const item of items) {
    if (item.kind === "assistant" && !item.text.trim()) continue;
    const last = blocks.at(-1);
    if (item.kind === "tool") {
      if (last?.kind === "tools" && last.items[0].round === item.round)
        last.items.push(item);
      else blocks.push({ key: item.key, kind: "tools", items: [item] });
    } else blocks.push(item);
  }
  return blocks;
}

export function AgentChat({
  workflowId,
  initialSession,
  close,
}: {
  workflowId: string;
  initialSession?: string;
  close?: () => void;
}) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [selected, setSelected] = useState(
    initialSession ?? localStorage.getItem("nebulae.agent." + workflowId) ?? "",
  );
  const [session, setSession] = useState<AgentSession | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [text, setText] = useState("");
  const [connected, setConnected] = useState(true);
  const { busy, error, setError, run } = useJob();
  const viewport = useRef<HTMLDivElement>(null),
    follow = useRef(true);
  const sending = useRef(false),
    pending = useRef<{
      session_id: string;
      text: string;
      version: number;
      command_id: string;
    } | null>(null);
  const refresh = async () => {
    if (selected)
      setSession(await api<AgentSession>("/agent/sessions/" + selected));
  };
  const list = async () => {
    const rows = await api<AgentSession[]>(
      "/agent/sessions?workflow_id=" + encodeURIComponent(workflowId),
    );
    setSessions(rows);
    if (!selected || !rows.some((s) => s.id === selected))
      setSelected(rows[0]?.id ?? "");
  };
  useEffect(() => {
    run(list);
  }, [workflowId]);
  useEffect(() => {
    if (!selected) {
      setSession(null);
      return;
    }
    let alive = true;
    localStorage.setItem("nebulae.agent." + workflowId, selected);
    setEvents([]);
    setSession(null);
    follow.current = true;
    api<AgentSession>("/agent/sessions/" + selected)
      .then((s) => {
        if (alive) setSession(s);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    const source = new EventSource(
      "/api/v1/agent/sessions/" + selected + "/stream",
    );
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.onmessage = (event) => {
      if (!alive) return;
      const value = JSON.parse(event.data) as Event;
      setEvents((previous) =>
        previous.some((e) => e.id === value.id)
          ? previous
          : [...previous, value],
      );
      if (
        value.kind === "tool.start" ||
        value.kind === "tool.end" ||
        value.kind === "tool.rejected" ||
        value.kind.startsWith("round.")
      ) {
        api<AgentSession>("/agent/sessions/" + selected)
          .then((s) => {
            if (alive) setSession(s);
          })
          .catch((e) => {
            if (alive) setError(e.message);
          });
        if (value.kind === "tool.end" && !value.payload.error)
          notifyWorkflow(workflowId);
      }
    };
    return () => {
      alive = false;
      source.close();
    };
  }, [selected, workflowId]);
  useEffect(() => {
    if (follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [events, session]);
  const active = session && ["running", "stopping"].includes(session.state);
  const newSession = async () => {
    const value = await api<AgentSession>("/agent/sessions", "POST", {
      workflow_id: workflowId,
      title: "工作流构建",
      command_id: uuid(),
    });
    setSessions((previous) => [value, ...previous]);
    setSelected(value.id);
    return value;
  };
  const send = async () => {
    if (!text.trim() || sending.current || active) return;
    sending.current = true;
    try {
      let current = session;
      if (!current) current = await newSession();
      const request =
        pending.current?.text === text &&
        pending.current.session_id === current.id
          ? pending.current
          : {
              session_id: current.id,
              text,
              version: current.version,
              command_id: uuid(),
            };
      pending.current = request;
      const result = await api<AgentSession>(
        `/agent/sessions/${current.id}/messages`,
        "POST",
        {
          text: request.text,
          expected_version: request.version,
          command_id: request.command_id,
        },
      );
      setSession(result);
      setText("");
      pending.current = null;
      follow.current = true;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500)
        pending.current = null;
      throw error;
    } finally {
      sending.current = false;
    }
  };
  return (
    <section className="agent-chat" aria-label="工作流助手">
      <header className="agent-chat-header">
        <div>
          <Bot size={18} />
          <strong>工作流助手</strong>
          <Tag>Pi</Tag>
        </div>
        {close && (
          <Button
            className="icon-button"
            aria-label="收起工作流助手"
            onClick={close}
          >
            <X size={16} />
          </Button>
        )}
      </header>
      <div className="agent-session-picker">
        <Select
          aria-label="会话历史"
          value={selected || undefined}
          placeholder="选择会话"
          options={sessions.map((s) => ({
            value: s.id,
            label: s.title + " · " + date(s.created_at),
          }))}
          onChange={setSelected}
        />
        <Button
          aria-label="新建助手会话"
          disabled={busy || !!active}
          onClick={() =>
            run(async () => {
              await newSession();
            })
          }
        >
          <Plus size={15} />
        </Button>
      </div>
      <div className="agent-chat-meta">
        <span>
          {session ? labels[session.state] : "告诉我你想构建什么流程"}
        </span>
        <a href="#agent-settings">模型设置</a>
      </div>
      {!connected && (
        <Alert
          type="warning"
          title="连接已断开，正在重连；不会重复发送消息。"
        />
      )}
      <div
        className="agent-messages"
        ref={viewport}
        onScroll={() => {
          const el = viewport.current;
          if (el)
            follow.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {!events.length && (
          <Empty>
            描述输入、处理步骤和期望产物，或让我解释、修复当前工作流。
          </Empty>
        )}
        {transcript(events).map((item) =>
          item.kind === "tools" ? (
            <ToolActivity
              key={item.key}
              items={item.items.map((tool) => ({
                key: tool.key,
                name: tool.name ?? "",
                call: session?.calls.find(
                  (c) => c.call_id === tool.call && c.round_id === tool.round,
                ),
                fallbackState:
                  session?.rounds.find((r) => r.id === tool.round)?.state ===
                  "running"
                    ? "running"
                    : "unknown",
              }))}
            />
          ) : item.kind === "error" ? (
            <Alert key={item.key} type="error" title={item.text} />
          ) : item.kind === "notice" ? (
            <p key={item.key} className="muted">
              {item.text}
            </p>
          ) : (
            item.text && (
              <article key={item.key} className={"agent-message " + item.kind}>
                <small>{item.kind === "user" ? "你" : "工作流助手"}</small>
                <ReactMarkdown skipHtml>{item.text}</ReactMarkdown>
              </article>
            )
          ),
        )}
      </div>
      <div className="agent-composer">
        <ErrorNotice
          message={error}
          clear={() => {
            setError("");
            refresh().catch(() => {});
          }}
        />
        {session &&
          ["failed", "interrupted", "stopped"].includes(session.state) && (
            <Button
              size="small"
              onClick={() =>
                setText(
                  "请先核对上轮已完成的操作和当前状态，再继续原来的工作。",
                )
              }
            >
              手动继续
            </Button>
          )}
        <Input.TextArea
          aria-label="给工作流助手的消息"
          placeholder="描述需求；Enter 发送，Shift+Enter 换行"
          value={text}
          autoSize={{ minRows: 2, maxRows: 6 }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              run(send);
            }
          }}
        />
        <div className="agent-composer-actions">
          <small>直接保存修改 · 执行过程可追溯</small>
          {active ? (
            <Button
              disabled={busy || session.state === "stopping"}
              onClick={() =>
                run(async () => {
                  await api(`/agent/sessions/${session.id}/stop`, "POST", {
                    expected_version: session.version,
                    command_id: uuid(),
                  });
                  await refresh();
                })
              }
            >
              <Square size={14} />
              停止生成
            </Button>
          ) : (
            <Button
              className="primary"
              disabled={busy || !text.trim()}
              onClick={() => run(send)}
            >
              <Send size={14} />
              发送
            </Button>
          )}
        </div>
        {active && (
          <small className="muted">
            停止生成不会取消已提交任务，可在任务详情中取消。
          </small>
        )}
      </div>
    </section>
  );
}

export function AgentWorkbench({
  workflowId,
  initialSession,
  children,
}: {
  workflowId: string;
  initialSession?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!!initialSession);
  const [wide, setWide] = useState(
    () => window.matchMedia("(min-width: 1200px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1200px)");
    const change = () => setWide(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return (
    <>
      <div className="agent-workbench-toolbar">
        <Button onClick={() => setOpen(!open)}>
          <Bot size={16} />
          工作流助手
        </Button>
      </div>
      <div
        className={"agent-workbench " + (open && wide ? "with-assistant" : "")}
      >
        <div className="agent-workbench-content">{children}</div>
        {open && wide && (
          <AgentChat
            workflowId={workflowId}
            initialSession={initialSession}
            close={() => setOpen(false)}
          />
        )}
      </div>
      {!wide && (
        <Drawer
          title="工作流助手"
          open={open}
          onClose={() => setOpen(false)}
          size={Math.min(440, window.innerWidth)}
          styles={{ body: { padding: 0 } }}
          destroyOnHidden
        >
          <AgentChat workflowId={workflowId} initialSession={initialSession} />
        </Drawer>
      )}
    </>
  );
}

export function AgentSessionPage({ id }: { id: string }) {
  const [session, setSession] = useState<AgentSession | null>(null),
    [exists, setExists] = useState(false);
  const { error, setError, run } = useJob();
  useEffect(() => {
    run(async () =>
      setSession(await api<AgentSession>("/agent/sessions/" + id)),
    );
  }, [id]);
  useEffect(() => {
    if (!session) return;
    const check = () =>
      api("/workflows/" + session.workflow_id)
        .then(() => setExists(true))
        .catch(() => {});
    check();
    window.addEventListener("nebulae:workflow-change", check);
    return () => window.removeEventListener("nebulae:workflow-change", check);
  }, [session?.workflow_id]);
  if (!session)
    return error ? (
      <ErrorNotice message={error} clear={() => setError("")} />
    ) : (
      <Spin />
    );
  return (
    <AgentWorkbench workflowId={session.workflow_id} initialSession={id}>
      {exists ? (
        <WorkflowView id={session.workflow_id} />
      ) : (
        <section className="panel agent-pending">
          <h2>{session.title}</h2>
          <p>工作流 ID：{session.workflow_id}</p>
          <p className="muted">
            在助手中发送需求后创建。会话已保留，可以随时继续。
          </p>
        </section>
      )}
    </AgentWorkbench>
  );
}

export function AICreate({ close }: { close: () => void }) {
  const [id, setId] = useState(""),
    [name, setName] = useState(""),
    [text, setText] = useState("");
  const command = useRef(uuid()),
    created = useRef<AgentSession | null>(null),
    sendId = useRef(uuid());
  const { busy, error, setError, run } = useJob();
  return (
    <Modal title="AI 创建工作流" close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (!created.current)
              created.current = await api<AgentSession>(
                "/agent/sessions",
                "POST",
                {
                  workflow_id: id,
                  title: name || id,
                  new_workflow: true,
                  command_id: command.current,
                },
              );
            const session = created.current;
            await api(`/agent/sessions/${session.id}/messages`, "POST", {
              text: `工作流名称：${name || id}\n${text}`,
              expected_version: session.version,
              command_id: sendId.current,
            });
            location.hash = "agent/" + session.id;
            close();
          });
        }}
      >
        <label>
          名称
          <Input
            aria-label="AI 工作流名称"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!!created.current}
          />
        </label>
        <label>
          工作流 ID
          <Input
            aria-label="AI 工作流 ID"
            required
            pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,99}"
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!created.current}
          />
        </label>
        <label>
          构建需求
          <Input.TextArea
            aria-label="构建需求"
            required
            autoSize={{ minRows: 4, maxRows: 9 }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="例如：读取文本，分别统计字数和生成大写文本，汇合后保存报告，并执行一次测试。"
          />
        </label>
        <ErrorNotice message={error} clear={() => setError("")} />
        {created.current && (
          <Button href={"#agent/" + created.current.id} onClick={close}>
            打开已保留的会话
          </Button>
        )}
        <footer>
          <Button href="#agent-settings" onClick={close}>
            模型设置
          </Button>
          <Button className="primary" type="submit" disabled={busy}>
            开始构建
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
