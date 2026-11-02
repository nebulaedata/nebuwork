import { apiURL, integration, resourceURL } from "./integration";
import { createId } from "./id";
const pendingWrites = new Map<string, string>();
function mapURLs(value: any): any {
  if (!integration || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(mapURLs);
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      typeof item === "string" && (key.endsWith("_url") || key === "url")
        ? resourceURL(item)
        : mapURLs(item),
    ]),
  );
}
export type Row = Record<string, any>;
export async function api<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const method = options.method || "GET";
  const identity = JSON.stringify([
    method,
    path,
    typeof options.body === "string"
      ? options.body
      : headers.get("X-Content-SHA256"),
  ]);
  const mutation = integration && !["GET", "HEAD"].includes(method);
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  )
    headers.set("Content-Type", "application/json");
  if (integration && !["GET", "HEAD"].includes(method)) {
    headers.set("X-Knowledge-Method", method);
    if (!headers.has("Idempotency-Key")) {
      const key = pendingWrites.get(identity) || createId();
      pendingWrites.set(identity, key);
      headers.set("Idempotency-Key", key);
    }
  }
  const response = await fetch(apiURL(path), {
    ...options,
    method: integration && !["GET", "HEAD"].includes(method) ? "POST" : method,
    credentials: "same-origin",
    headers,
  });
  const body = mapURLs(await response.json());
  if (!response.ok || !body.success)
    throw new Error(
      body.error?.message ||
        body.data?.error?.message ||
        body.msg ||
        "服务暂不可用",
    );
  if (mutation) pendingWrites.delete(identity);
  if (Array.isArray(body.data) && body.meta)
    Object.defineProperty(body.data, "meta", { value: body.meta });
  return body.data;
}
export const send = (path: string, body: unknown, method = "POST") =>
  api(path, { method, body: JSON.stringify(body) });
export const stateLabels: Record<string, string> = {
  available: "可定位",
  stored: "已保存，暂不解析",
  extracted: "已解压",
  partially_extracted: "部分解压",
  extract_archive: "递归解压",
  skipped: "本次未执行",
  missing: "文件丢失",
  stale: "待更新",
  queued: "排队中",
  running: "处理中",
  processing: "处理中",
  stopping: "正在终止",
  paused: "已暂停",
  pausing: "正在暂停",
  deleting: "删除中",
  succeeded: "已完成",
  waiting_configuration: "待配置",
  failed: "失败",
  partially_failed: "部分失败",
  cancelled: "已取消",
  ready: "就绪",
  historical: "历史修订",
  empty: "无可识别目录",
  partial: "部分待核验",
  disabled: "已关闭",
  pending: "等待处理",
  retrying: "等待重试",
};
export function stateLabel(value: string) {
  return stateLabels[value] || value || "—";
}
export const purposeOptions = [
  { value: "text", label: "文本生成" },
  { value: "embedding", label: "文本向量" },
  { value: "vision", label: "视觉理解 / OCR" },
  { value: "asr", label: "语音转写" },
  { value: "outline", label: "目录核验" },
  { value: "rerank", label: "重排" },
  { value: "multimodal_embedding", label: "多模态向量" },
];

export function supportsPurpose(modelPurpose: string, purpose: string) {
  return (
    modelPurpose === purpose ||
    (["text", "outline"].includes(modelPurpose) &&
      ["text", "outline"].includes(purpose))
  );
}
