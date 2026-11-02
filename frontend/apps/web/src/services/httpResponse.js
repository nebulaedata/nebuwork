// Read a response body only once: proxies may return plain text or an empty 5xx.
export async function decodeHttpError(response) {
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = null; }
  const fallback = response.status >= 500 ? '服务暂时不可用，请稍后重试' : `请求失败（${response.status}）`;
  const error = new Error(body?.msg || fallback);
  error.status = response.status;
  error.detail = body?.detail;
  return error;
}
