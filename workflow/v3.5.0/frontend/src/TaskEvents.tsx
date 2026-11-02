import { useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Collapse,
  Input,
  Progress,
  Segmented,
  Select,
  Tabs,
  Tag,
} from "antd";
import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Info,
  Search,
  TriangleAlert,
} from "lucide-react";
import { date, pretty } from "./api";
import { Empty } from "./ui";
import { states, type Event, type Task } from "./types";
import {
  describeError,
  describeEvent,
  type EventDescription,
} from "./eventPresentation";

type Inspect = (step: string, attempt: number | null) => void;

function CurrentOutcome({ task, inspect }: { task: Task; inspect: Inspect }) {
  const failures = task.steps.filter((s) =>
    ["failed", "timed_out", "interrupted"].includes(s.state),
  );
  const blocked = task.steps.filter((s) => s.state === "blocked");
  if (task.state === "failed")
    return (
      <Alert
        className="event-outcome"
        showIcon
        type="error"
        title={`任务未完成${failures.length ? ` · ${failures.length} 个步骤异常` : ""}${blocked.length ? `，${blocked.length} 个步骤受上游影响` : ""}`}
        description={
          <>
            {failures.map((step) => {
              const attempt = step.history.at(-1);
              return (
                <div className="event-failure" key={step.name}>
                  <Button
                    type="link"
                    size="small"
                    onClick={() => inspect(step.name, attempt?.number ?? null)}
                  >
                    {step.name}
                  </Button>
                  <span>
                    {describeError(
                      attempt?.state === "timed_out"
                        ? "Step execution exceeded its timeout"
                        : (attempt?.error ?? ""),
                      task.definition.steps[step.name]?.timeout,
                    )}
                  </span>
                </div>
              );
            })}
            {!!blocked.length && (
              <p>
                未执行的下游：{blocked.map((s) => s.name).join("、")}
                。先处理上游异常，重跑会包含关联下游。
              </p>
            )}
            {!failures.length && !blocked.length && (
              <p>查看下方异常记录，定位未完成的步骤。</p>
            )}
          </>
        }
      />
    );
  const description: Record<string, string> = {
    ready: "任务尚未执行，可点击页面上方的「开始执行」。",
    queued: "等待可用的执行位置，满足依赖条件的步骤会开始执行。",
    running: `已成功 ${task.steps.filter((s) => s.state === "succeeded").length} / ${task.steps.length} 个步骤，运行中 ${task.steps.filter((s) => s.state === "running").length} 个，等待重试 ${task.steps.filter((s) => s.state === "retry_wait").length} 个。`,
    succeeded: `全部 ${task.steps.length} 个步骤已成功。下方保留历次运行记录，早前的错误不代表当前仍然失败。`,
    paused: "已运行步骤已收尾，可检查记录后继续执行。",
    pausing: "不再派发新步骤，正在等待已运行步骤收尾。",
    cancelled: "本次任务已取消，历史记录和产物仍可查看。",
    cancelling: "正在停止执行中的步骤，尚未开始的步骤不再运行。",
    waiting_manual:
      "服务重启后不会自动续跑。检查记录和产物后，手动继续或重跑。",
  };
  return (
    <Alert
      className="event-outcome"
      showIcon
      type={
        task.state === "succeeded"
          ? "success"
          : task.state === "waiting_manual"
            ? "warning"
            : "info"
      }
      title={"当前任务：" + (states[task.state] ?? task.state)}
      description={description[task.state] ?? "下方显示任务的历史运行记录。"}
    />
  );
}

function EventRow({
  event,
  info,
  inspect,
}: {
  event: Event;
  info: EventDescription;
  inspect: Inspect;
}) {
  const Icon = {
    info: Info,
    success: CheckCircle2,
    warning: TriangleAlert,
    error: CircleAlert,
  }[info.tone];
  return (
    <li className={"event-row " + info.tone} data-event-kind={event.kind}>
      <time
        className="event-time"
        dateTime={new Date(event.created_at * 1000).toISOString()}
        title={date(event.created_at)}
      >
        {new Date(event.created_at * 1000).toLocaleTimeString("zh-CN", {
          hour12: false,
        })}
      </time>
      <span className="event-marker">
        <Icon size={16} />
      </span>
      <div className="event-content">
        <div className="event-heading">
          <strong>{info.title}</strong>
          {event.step ? (
            <Button
              className="event-step"
              type="link"
              size="small"
              onClick={() => inspect(event.step!, event.attempt)}
              title={"查看步骤 " + event.step}
            >
              {event.step}
            </Button>
          ) : (
            <Tag>任务</Tag>
          )}
          {event.attempt !== null && (
            <span className="event-attempt">第 {event.attempt} 次执行</span>
          )}
        </div>
        <p
          className={
            "event-description " +
            (info.category === "log" ? "event-log-preview" : "")
          }
        >
          {info.description}
        </p>
        {info.progress !== undefined && (
          <Progress
            className="event-progress"
            percent={info.progress}
            size="small"
            showInfo={false}
          />
        )}
        {info.hint && <p className="event-hint">{info.hint}</p>}
        <Collapse
          ghost
          size="small"
          className="event-details"
          expandIcon={({ isActive }) => (
            <ChevronRight
              size={12}
              style={{ transform: isActive ? "rotate(90deg)" : undefined }}
            />
          )}
          items={[
            {
              key: "raw",
              label:
                info.category === "log" ? "查看完整内容与技术详情" : "技术详情",
              children: (
                <Tabs
                  size="small"
                  items={[
                    ...(info.original
                      ? [
                          {
                            key: "text",
                            label:
                              info.category === "log" ? "完整内容" : "原始错误",
                            children: (
                              <pre
                                tabIndex={0}
                                className="event-raw"
                                aria-label="事件完整内容"
                              >
                                {info.original}
                              </pre>
                            ),
                          },
                        ]
                      : []),
                    {
                      key: "event",
                      label: "原始事件",
                      children: (
                        <pre
                          tabIndex={0}
                          className="event-raw"
                          aria-label="原始事件数据"
                        >
                          {pretty(event)}
                        </pre>
                      ),
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </div>
    </li>
  );
}

export function TaskEvents({
  task,
  events,
  inspect,
}: {
  task: Task;
  events: Event[];
  inspect: Inspect;
}) {
  const [filter, setFilter] = useState("all"),
    [step, setStep] = useState(""),
    [search, setSearch] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const entries = useMemo(
    () => events.map((event) => ({ event, info: describeEvent(event, task) })),
    [events, task],
  );
  const issues = entries.filter(({ info }) =>
    ["error", "warning"].includes(info.tone),
  ).length;
  const visible = entries
    .filter(
      ({ event, info }) =>
        (filter === "all" ||
          (filter === "issues"
            ? ["error", "warning"].includes(info.tone)
            : info.category === "log")) &&
        (!step || (step === "@task" ? !event.step : event.step === step)) &&
        (!search.trim() ||
          [
            info.title,
            info.description,
            info.hint,
            event.step,
            event.kind,
            info.original,
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase())),
    )
    .reverse();
  const resetScroll = () => {
    if (viewport.current) viewport.current.scrollTop = 0;
  };
  return (
    <section className="task-events" aria-label="运行事件记录">
      <CurrentOutcome task={task} inspect={inspect} />
      <div className="event-toolbar">
        <Segmented
          aria-label="事件类型"
          value={filter}
          onChange={(value) => {
            setFilter(value);
            resetScroll();
          }}
          options={[
            { value: "all", label: "全部事件" },
            {
              value: "issues",
              label: `异常与提醒${issues ? ` ${issues}` : ""}`,
            },
            { value: "logs", label: "日志与进度" },
          ]}
        />
        <Select
          aria-label="筛选事件步骤"
          value={step}
          onChange={(value) => {
            setStep(value);
            resetScroll();
          }}
          options={[
            { value: "", label: "所有步骤" },
            { value: "@task", label: "仅任务事件" },
            ...task.steps.map((s) => ({ value: s.name, label: s.name })),
          ]}
        />
        <Input
          aria-label="搜索运行事件"
          placeholder="搜索步骤、事件或错误"
          prefix={<Search size={14} />}
          allowClear
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetScroll();
          }}
        />
      </div>
      <div className="event-list-caption">
        已载入 {events.length} 条 · 当前显示 {visible.length} 条 · 最新在前
        {events.length >= 500
          ? " · 仅保留最近 500 条在页面中，完整记录仍在数据库中"
          : ""}
      </div>
      <div className="event-list" ref={viewport}>
        {visible.length ? (
          <ol aria-label="事件时间线">
            {visible.map(({ event, info }) => (
              <EventRow
                key={event.id}
                event={event}
                info={info}
                inspect={inspect}
              />
            ))}
          </ol>
        ) : (
          <Empty>
            {events.length
              ? "没有符合筛选条件的事件"
              : "暂无运行事件，开始任务后会在这里显示执行过程。"}
          </Empty>
        )}
      </div>
    </section>
  );
}
