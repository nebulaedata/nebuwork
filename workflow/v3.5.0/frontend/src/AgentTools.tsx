import { lazy, Suspense, useState } from "react";
import { Alert, Button, Collapse, Spin, Tabs, Tooltip } from "antd";
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileCode2,
  FileDiff,
  FilePenLine,
  Files,
  GitBranch,
  LoaderCircle,
  Package,
  Play,
  Search,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { pretty } from "./api";
import { Modal } from "./ui";

const Diff = lazy(() =>
  import("./CodeEditor").then((m) => ({ default: m.SourceDiff })),
);
type Change = {
  path: string;
  before: { content: string; revision: string } | null;
  after: { content: string; revision: string };
};
export type AgentCall = {
  round_id: string;
  call_id: string;
  name: string;
  state: string;
  arguments: Record<string, unknown>;
  result: { result?: Record<string, unknown>; error?: string } | null;
  changes: Change[] | null;
  created_at?: number;
  finished_at?: number | null;
};
export type ToolInvocation = {
  key: number;
  name: string;
  call?: AgentCall;
  fallbackState: string;
};

const actions: Record<string, [string, LucideIcon]> = {
  workflow_guide: ["阅读开发指南", Files],
  workflow_health: ["检查服务状态", Search],
  workflow_list: ["查看工作流列表", Files],
  workflow_get: ["读取工作流", GitBranch],
  workflow_create: ["创建工作流", GitBranch],
  workflow_save_definition: ["更新流程编排", GitBranch],
  workflow_validate: ["校验工作流", Search],
  workflow_archive: ["归档工作流", Files],
  source_read: ["读取文件", FileCode2],
  source_save: ["修改文件", FilePenLine],
  source_revisions: ["查看文件历史", Files],
  source_restore: ["恢复文件版本", FilePenLine],
  task_list: ["查看任务列表", Files],
  task_create: ["创建任务", Play],
  task_get: ["查看任务状态", Search],
  task_control: ["控制任务", Play],
  task_rerun_preview: ["预览重跑范围", Search],
  task_rerun: ["重跑任务", Play],
  task_events: ["查看运行事件", Files],
  task_logs: ["读取执行日志", FileCode2],
  task_wait: ["等待任务完成", Clock3],
  artifact_list: ["查看产物列表", Files],
  artifact_read: ["读取产物", FileCode2],
  environment_shared: ["查看共享环境", Package],
  environment_get: ["查看执行环境", Package],
  environment_select: ["切换执行环境", Package],
  environment_packages: ["查看已安装包", Package],
  environment_operate: ["配置独立环境", Package],
  environment_operation_get: ["查看环境操作", Search],
  environment_wait: ["等待环境就绪", Clock3],
  tool_result_read: ["继续读取工具结果", Files],
};
const statuses: Record<string, string> = {
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  stopped: "已停止",
  interrupted: "已中断",
  unknown: "待核对",
};

function describe(name: string, call?: AgentCall) {
  let [label, icon] = actions[name] ?? ["调用工具", Wrench];
  const args = call?.arguments ?? {};
  const result = call?.result?.result;
  let target = String(args.path ?? args.step_id ?? args.workflow_id ?? "");
  if (name === "source_save" && args.expected_revision === null)
    label = "创建文件";
  if (name === "workflow_create" && args.copy_from) label = "复制工作流";
  if (name === "workflow_archive" && args.archived === false)
    label = "取消归档";
  if (name === "task_control")
    label =
      {
        start: "启动任务",
        pause: "暂停任务",
        resume: "继续任务",
        cancel: "取消任务",
      }[String(args.action)] ?? label;
  const taskId =
    args.task_id ?? (name.startsWith("task_") ? result?.id : undefined);
  if (taskId)
    target = [args.step_id, "任务 " + String(taskId).slice(0, 8)]
      .filter(Boolean)
      .join(" · ");
  if (name === "environment_shared") target = "Python 包清单";
  if (name === "environment_select")
    target = args.mode === "isolated" ? "独立环境" : "共享环境";
  if (name === "environment_operate") {
    label =
      {
        create: "创建独立环境",
        install: "安装工作流依赖",
        rebuild: "重建独立环境",
      }[String(args.kind)] ?? label;
    if (args.kind === "install")
      target = args.requirements
        ? "requirements.txt"
        : Array.isArray(args.packages)
          ? args.packages.join(", ")
          : target;
  }
  if (name === "artifact_read")
    target = String(result?.name ?? args.artifact_id ?? "");
  if (name === "tool_result_read") target = String(args.call_id ?? "");
  if (!actions[name]) target = name;
  const displayTarget = args.path
    ? (String(args.path).split(/[\\/]/).at(-1) ?? target)
    : name === "artifact_read" && !result?.name
      ? "产物 " + String(args.artifact_id ?? "").slice(0, 8)
      : target;
  return { label, icon, target, displayTarget, taskId };
}

function ToolState({ state }: { state: string }) {
  const Icon =
    state === "running"
      ? LoaderCircle
      : state === "succeeded"
        ? Check
        : CircleAlert;
  const label = statuses[state] ?? state;
  return (
    <Tooltip title={"工具" + label}>
      <span
        className={"agent-tool-state " + state}
        role="img"
        aria-label={"工具" + label}
      >
        <Icon
          size={14}
          className={state === "running" ? "agent-tool-spinner" : undefined}
        />
        {!["running", "succeeded"].includes(state) && <span>{label}</span>}
      </span>
    </Tooltip>
  );
}

function ToolRow({ item }: { item: ToolInvocation }) {
  const { name, call } = item;
  const [change, setChange] = useState<Change | null>(null);
  const state = call?.state ?? item.fallbackState;
  const {
    label,
    icon: Icon,
    target,
    displayTarget,
    taskId,
  } = describe(name, call);
  const elapsed =
    call?.created_at && call.finished_at
      ? Math.max(0, call.finished_at - call.created_at)
      : null;
  return (
    <div className="agent-tool" data-tool-name={name} data-tool-state={state}>
      <Collapse
        ghost
        size="small"
        expandIconPlacement="end"
        expandIcon={({ isActive }) => (
          <ChevronRight
            size={13}
            className={
              isActive ? "agent-tool-chevron open" : "agent-tool-chevron"
            }
          />
        )}
        items={[
          {
            key: "details",
            label: (
              <span className="agent-tool-label">
                <Icon size={14} className="agent-tool-kind" />
                <span className="agent-tool-action">{label}</span>
                <span className="agent-tool-target" title={target}>
                  {displayTarget}
                </span>
                {elapsed !== null && (
                  <span className="agent-tool-duration">
                    {elapsed < 1 ? "<1s" : Math.round(elapsed) + "s"}
                  </span>
                )}
                <ToolState state={state} />
              </span>
            ),
            children: (
              <div className="agent-tool-detail">
                <div className="agent-tool-detail-meta">
                  <code>{name}</code>
                  <span>{statuses[state] ?? state}</span>
                </div>
                {(!!taskId || !!call?.changes?.length) && (
                  <div className="agent-tool-links">
                    {!!taskId && (
                      <Button
                        size="small"
                        icon={<ExternalLink size={13} />}
                        href={"#task/" + String(taskId)}
                      >
                        查看任务
                      </Button>
                    )}
                    {(call?.changes ?? []).map((c) => (
                      <Button
                        size="small"
                        key={c.path}
                        icon={<FileDiff size={13} />}
                        onClick={() => setChange(c)}
                      >
                        {c.path} · 查看差异
                      </Button>
                    ))}
                  </div>
                )}
                {call?.result?.error && (
                  <Alert type="error" showIcon title={call.result.error} />
                )}
                <Tabs
                  size="small"
                  items={[
                    {
                      key: "result",
                      label: "返回结果",
                      children: (
                        <pre
                          className="agent-tool-output"
                          tabIndex={0}
                          aria-label="工具返回结果"
                        >
                          {call?.result
                            ? pretty(call.result)
                            : state === "running"
                              ? "等待工具完成…"
                              : "结果尚未记录，请核对实际状态。"}
                        </pre>
                      ),
                    },
                    {
                      key: "arguments",
                      label: "调用参数",
                      children: (
                        <pre
                          className="agent-tool-output"
                          tabIndex={0}
                          aria-label="工具调用参数"
                        >
                          {pretty(call?.arguments ?? {})}
                        </pre>
                      ),
                    },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />
      {change && (
        <Modal
          title={"修改差异 · " + change.path}
          close={() => setChange(null)}
          wide
        >
          <Suspense fallback={<Spin />}>
            <Diff
              original={change.before?.content ?? ""}
              modified={change.after.content}
              language={change.path.endsWith(".py") ? "python" : "plaintext"}
            />
          </Suspense>
        </Modal>
      )}
    </div>
  );
}

export function ToolActivity({ items }: { items: ToolInvocation[] }) {
  const [expanded, setExpanded] = useState(false);
  const states = items.map((item) => item.call?.state ?? item.fallbackState);
  const running = states.includes("running");
  const failed = states.filter((s) => s === "failed").length;
  const uncertain = states.filter(
    (s) => !["running", "failed", "succeeded"].includes(s),
  ).length;
  const visible = expanded ? items : items.slice(-4);
  const toggle = () => setExpanded(!expanded);
  return (
    <section className="agent-tool-activity" aria-label="工具执行记录">
      <div className="agent-tool-summary">
        {running ? (
          <LoaderCircle size={13} className="agent-tool-spinner" />
        ) : failed || uncertain ? (
          <CircleAlert size={13} />
        ) : (
          <Check size={13} />
        )}
        <span>
          {running ? "正在执行" : "执行记录"} · {items.length} 项操作
        </span>
        {failed > 0 && (
          <Button
            type="text"
            size="small"
            className="agent-tool-issues"
            onClick={() => setExpanded(true)}
          >
            {failed} 项失败
          </Button>
        )}
        {uncertain > 0 && (
          <Button
            type="text"
            size="small"
            className="agent-tool-issues"
            onClick={() => setExpanded(true)}
          >
            {uncertain} 项待核对
          </Button>
        )}
      </div>
      {!expanded && items.length > 4 && (
        <Button
          type="text"
          size="small"
          className="agent-tool-expand"
          onClick={toggle}
          icon={<ChevronDown size={13} />}
          aria-expanded={expanded}
        >
          展开全部 {items.length} 项操作
        </Button>
      )}
      <div className="agent-tool-timeline">
        {visible.map((item) => (
          <ToolRow key={item.key} item={item} />
        ))}
      </div>
      {expanded && items.length > 4 && (
        <Button
          type="text"
          size="small"
          className="agent-tool-expand"
          onClick={toggle}
          icon={<ChevronDown size={13} className="agent-tool-collapse-icon" />}
          aria-expanded={expanded}
        >
          收起较早的操作
        </Button>
      )}
    </section>
  );
}
