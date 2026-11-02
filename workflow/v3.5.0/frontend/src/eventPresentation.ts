import { states, type Event, type Task } from "./types";

export type EventDescription = {
  title: string;
  description: string;
  tone: "info" | "success" | "warning" | "error";
  category: "event" | "log";
  hint?: string;
  progress?: number;
  original?: string;
};
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
const names = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const seconds = (value: number) => `${value} 秒`;
export function describeError(error: string, timeout?: number | null) {
  if (error === "Step execution exceeded its timeout")
    return timeout
      ? `超过设置的 ${seconds(timeout)}仍未完成，系统已终止本次执行。`
      : "超过设置的执行时限，系统已终止本次执行。";
  if (error === "Scheduler stopped before recording completion")
    return "服务停止前未记录到执行完成，本次执行已标记为中断。";
  if (error === "Cancelled by user") return "本次执行已被人工取消。";
  if (error === "A staged artifact is missing or changed")
    return "暂存的产物文件丢失或发生变化，本次结果未发布。";
  if (error.startsWith("Worker exited without a valid completion record"))
    return "步骤进程已退出，但没有返回有效的完成记录。请查看该步骤的控制台输出。";
  const missing = error.match(
    /ModuleNotFoundError: No module named ['"]([^'"]+)['"]/,
  );
  if (missing)
    return `当前执行环境找不到 Python 模块「${missing[1]}」。请检查依赖安装和环境选择。`;
  const last = error.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return last
    ? `代码报错：${last}`
    : "本次执行发生异常，请查看步骤日志和原始错误。";
}

const taskStates: Record<string, [string, string, EventDescription["tone"]]> = {
  ready: ["任务等待开始", "任务已准备好，尚未开始执行。", "info"],
  queued: [
    "任务进入执行队列",
    "等待可用的执行位置，不代表步骤已经开始。",
    "info",
  ],
  running: ["任务开始运行", "开始执行依赖条件已满足的步骤。", "info"],
  succeeded: ["任务全部完成", "本轮所有步骤均已成功。", "success"],
  failed: [
    "任务未能完成",
    "存在失败、中断或受上游影响而未执行的步骤，请先排查异常步骤。",
    "error",
  ],
  pausing: [
    "正在暂停任务",
    "不再启动新步骤，已经运行的步骤继续收尾。",
    "warning",
  ],
  paused: ["任务已暂停", "运行中的步骤已收尾，等待人工继续。", "warning"],
  cancelling: [
    "正在取消任务",
    "正在终止运行中的步骤，其余步骤不再执行。",
    "warning",
  ],
  cancelled: ["任务已取消", "本次运行已停止，历史记录与产物保留。", "warning"],
  waiting_manual: [
    "任务等待人工处理",
    "不会自动执行；检查历史和产物后，可手动继续或重跑。",
    "warning",
  ],
};

export function describeEvent(event: Event, task: Task): EventDescription {
  const p = object(event.payload);
  const base: EventDescription = {
    title: "运行记录",
    description: "可展开技术详情查看原始事件。",
    tone: "info",
    category: "event",
  };
  const spec = event.step ? task.definition.steps[event.step] : undefined;
  switch (event.kind) {
    case "task.created":
      return {
        ...base,
        title: "任务已创建",
        description: "本次输入和流程结构已保存，等待开始执行。",
      };
    case "task.state": {
      const state = text(p.to);
      const info = taskStates[state];
      return info
        ? { ...base, title: info[0], description: info[1], tone: info[2] }
        : {
            ...base,
            title: "任务状态已更新",
            description: `${states[text(p.from)] ?? text(p.from)} → ${states[state] ?? state}`,
          };
    }
    case "task.command": {
      const actions: Record<string, string> = {
        start: "开始执行",
        pause: "暂停",
        resume: "继续执行",
        cancel: "取消任务",
        rerun: "重跑",
      };
      return {
        ...base,
        title: `已接收${actions[text(p.action)] ?? "操作"}指令`,
        description: "指令已受理，后续执行情况会继续记录在这里。",
      };
    }
    case "task.environment": {
      const environments = [
        task.environment,
        ...task.steps.flatMap((s) => s.history.map((a) => a.environment)),
      ];
      const environment = environments.find((e) => e?.id === p.revision);
      return {
        ...base,
        title: "已确定本轮 Python 环境",
        description: environment
          ? `使用${environment.mode === "isolated" ? "独立" : "共享"}环境 · Python ${environment.python_version}，本轮自动重试沿用此环境。`
          : "环境版本已固定，本轮自动重试沿用该版本。",
      };
    }
    case "task.manual_required":
      return {
        ...base,
        title: "服务重启，等待人工处理",
        description:
          "未完成的任务不会自动续跑。检查记录后，可选择继续执行或重跑。",
        tone: "warning",
      };
    case "task.invalidated": {
      const affected = names(p.affected);
      const reused = Object.entries(object(p.reused));
      return {
        ...base,
        title: "已准备重跑范围",
        description:
          `重新执行 ${affected.length} 个步骤：${affected.join("、") || "详见技术详情"}。` +
          (reused.length
            ? `复用上游成功结果：${reused.map(([step, attempt]) => `${step}（第 ${attempt} 次）`).join("、")}。`
            : "本次无需复用其他上游结果。"),
        hint: "受影响的旧结果退出当前有效集合，历史记录和文件仍保留。",
      };
    }
    case "step.started": {
      const dependencies = Object.entries(object(p.dependencies));
      return {
        ...base,
        title: "步骤开始执行",
        description: dependencies.length
          ? `使用上游成功结果：${dependencies.map(([step, attempt]) => `${step}（第 ${attempt} 次）`).join("、")}。`
          : "没有需要等待的上游步骤，已开始执行代码。",
      };
    }
    case "step.succeeded":
      return {
        ...base,
        title: "步骤执行成功",
        description: "本次执行已完成。下游在所有依赖都满足后继续执行。",
        tone: "success",
      };
    case "step.timed_out":
      return {
        ...base,
        title: "步骤执行超时",
        description: describeError(
          "Step execution exceeded its timeout",
          spec?.timeout,
        ),
        tone: "error",
        original: text(p.error),
        hint: "先检查代码和网络请求的耗时；如需调整超时时间，请修改工作流后创建新任务。",
      };
    case "step.failed":
      return {
        ...base,
        title: "步骤执行失败",
        description: describeError(text(p.error), spec?.timeout),
        tone: "error",
        original: text(p.error),
        hint: "查看该步骤的日志，修复后可从此步骤重跑。",
      };
    case "step.blocked":
      return {
        ...base,
        title: "上游未成功，本步骤未执行",
        description: `需要等待上游${spec?.needs?.length ? `「${spec.needs.join("、")}」` : "步骤"}成功。本次因上游未成功被阻塞。`,
        tone: "warning",
        hint: "先处理上游异常，从上游重跑时会自动包含关联下游。",
      };
    case "step.interrupted":
      return {
        ...base,
        title: "步骤执行被中断",
        description:
          "服务停止前未记录到执行完成，不会推断为成功，也不会自动补跑。",
        tone: "warning",
        hint: "检查本次执行的日志和产物，再决定继续或重跑。",
        original: text(p.error),
      };
    case "step.cancelled":
      return {
        ...base,
        title: "步骤已取消",
        description: "本次执行已停止，未成功的产物不会作为下游默认输入。",
        tone: "warning",
        original: text(p.error),
      };
    case "step.retry_scheduled":
      return {
        ...base,
        title: "已安排自动重试",
        description:
          typeof p.delay === "number"
            ? `已安排在 ${seconds(p.delay)}后再次执行该步骤。`
            : "已根据步骤设置安排再次执行。",
        tone: "warning",
      };
    case "artifact.staged":
      return {
        ...base,
        title: "产物已暂存",
        description: `「${text(p.name)}」已保存到${p.scope === "workflow" ? "工作流共享" : "任务"}空间；步骤成功后才会发布。`,
      };
    case "custom.progress": {
      const percent =
        typeof p.percent === "number" && Number.isFinite(p.percent)
          ? Math.min(100, Math.max(0, p.percent))
          : undefined;
      return {
        ...base,
        title: percent === undefined ? "步骤进度" : `步骤进度 · ${percent}%`,
        description: text(p.message) || "步骤上报了当前处理进度。",
        category: "log",
        progress: percent,
      };
    }
    case "custom.log":
      return {
        ...base,
        title: "步骤日志",
        description: text(p.message) || "步骤记录了一条日志。",
        category: "log",
        original: text(p.message),
      };
    case "console": {
      const output = text(p.text);
      const lines = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      // Only classify known debugger lines. Mixed business output/errors stay visible as output.
      const debugOnly =
        lines.length > 0 &&
        lines.every((line) =>
          /^(?:\d+(?:\.\d+)?s\s*-\s*)?(?:Debugger warning: It seems that frozen modules are being used, which may|make the debugger miss breakpoints\. Please pass -Xfrozen_modules=off|to python to disable frozen modules\.|Note: Debugging will proceed\. Set PYDEVD_DISABLE_FILE_VALIDATION=1 to disable this validation\.)$/.test(
            line,
          ),
        );
      return {
        ...base,
        title: debugOnly ? "Python 调试器提示" : "控制台输出",
        description: debugOnly
          ? "部分断点可能无法命中，调试仍会继续。这是一条调试提示，不表示步骤执行失败。"
          : output.trim() || "本次没有可显示的文本。",
        category: "log",
        original: output,
      };
    }
    default:
      return event.kind.startsWith("custom.")
        ? {
            ...base,
            title: `业务事件 · ${event.kind.slice(7)}`,
            description:
              text(p.message) ||
              text(event.payload) ||
              "步骤上报了业务数据，可展开技术详情查看。",
            category: "log",
          }
        : {
            ...base,
            description: `记录了一项运行信息（${event.kind}），可展开技术详情查看。`,
          };
  }
}
