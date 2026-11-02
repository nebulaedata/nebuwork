import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  DialogPlugin,
  Loading,
  MessagePlugin,
  Tag,
} from "tdesign-react";
import { api, Row, stateLabel } from "./api";
import { appPath, appURL } from "./integration";
export function navigate(path: string) {
  history.pushState({}, "", appURL(path));
  window.dispatchEvent(new PopStateEvent("popstate"));
}
export function usePath() {
  const [path, setPath] = useState(appPath);
  useEffect(() => {
    const update = () => setPath(appPath());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return path;
}
export function useData<T>(path: string, interval = 0) {
  const [snapshot, setSnapshot] = useState<{ path: string; value: T }>();
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setError("");
    if (!path) {
      setLoading(false);
      return;
    }
    let active = true;
    const controller = new AbortController();
    const load = () =>
      api<T>(path, { signal: controller.signal })
        .then((value) => {
          if (active) {
            setSnapshot({ path, value });
            setError("");
          }
        })
        .catch((e) => {
          if (active && e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    load();
    const timer = interval ? setInterval(load, interval) : undefined;
    return () => {
      active = false;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [path, version, interval]);
  return {
    data: snapshot?.path === path ? snapshot.value : undefined,
    error,
    loading,
    reload: () => setVersion((v) => v + 1),
  };
}
export function Status({ value }: { value: string }) {
  const theme =
    value === "succeeded" || value === "ready" || value === "extracted"
      ? "success"
      : value === "failed" || value === "partially_failed"
        ? "danger"
        : value === "waiting_configuration" ||
            value === "paused" ||
            value === "pausing" ||
            value === "partial" ||
            value === "partially_extracted"
          ? "warning"
          : "default";
  return (
    <Tag theme={theme} variant="light">
      {stateLabel(value)}
    </Tag>
  );
}
export function ErrorNotice({ message }: { message?: string }) {
  return message ? (
    <div className="error-banner">
      <Alert theme="error" message={message} />
    </div>
  ) : null;
}
export function Busy() {
  return (
    <div className="empty">
      <Loading size="small" text="正在加载" />
    </div>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export async function action(fn: () => Promise<unknown>, done?: () => void) {
  try {
    await fn();
    MessagePlugin.success("操作成功");
    done?.();
  } catch (e) {
    MessagePlugin.error((e as Error).message);
  }
}
export function confirmDelete(
  name: string,
  fn: () => Promise<unknown>,
  done?: () => void,
) {
  const dialog = DialogPlugin.confirm({
    header: "确认删除",
    body: `删除“${name}”及其关联文件、索引和来源？删除任务会先停止正在进行的处理。`,
    confirmBtn: { content: "删除", theme: "danger" },
    onConfirm: () =>
      action(fn, () => {
        dialog.destroy();
        done?.();
      }),
  });
}
export function formatBytes(size: number) {
  if (size >= 1024 ** 3) return (size / 1024 ** 3).toFixed(2) + " GB";
  if (size >= 1024 ** 2) return (size / 1024 ** 2).toFixed(1) + " MB";
  return Math.ceil(size / 1024) + " KB";
}
export function timeLabel(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((s % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}.${Math.floor(
    ms % 1000,
  )
    .toString()
    .padStart(3, "0")}`;
}
export function SourceLink({
  source,
  onSelect,
}: {
  source: Row;
  onSelect?: (id: string) => void;
}) {
  const position = locationLabel(source.locators?.[0] || {});
  return (
    <Button
      variant="text"
      size="small"
      onClick={() =>
        onSelect ? onSelect(source.source_ref_id) : navigate(source.preview_url)
      }
    >
      {source.file_name} · {position}
    </Button>
  );
}

export function locationLabel(l: Row): string {
  if (l.mapping === "converted_structure")
    return "转换后 · " + locationLabel({ ...l, mapping: undefined });
  return l.page
    ? `第 ${l.page} 页`
    : l.slide
      ? `第 ${l.slide} 张`
      : l.start_ms !== undefined
        ? timeLabel(l.start_ms) +
          (l.end_ms !== undefined ? " – " + timeLabel(l.end_ms) : "")
        : l.time_ms !== undefined
          ? timeLabel(l.time_ms)
          : l.cell_range
            ? `${l.sheet} · ${l.cell_range}`
            : l.line_start
              ? `第 ${l.line_start} 行`
              : l.paragraph_id
                ? `段落 ${l.paragraph_id}`
                : "原文件";
}
