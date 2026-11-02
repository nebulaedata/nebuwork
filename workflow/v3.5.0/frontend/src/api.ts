import { createUuid } from './uuid.js';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/v1" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal,
  });
  const body = await response.json();
  if (!response.ok)
    throw new ApiError(
      typeof body.detail === "string"
        ? body.detail
        : JSON.stringify(body.detail ?? body),
      response.status,
    );
  return body as T;
}
export const uuid = () => createUuid();
export const date = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString("zh-CN", { hour12: false });
export const pretty = (value: unknown) => JSON.stringify(value, null, 2);
