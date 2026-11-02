import { createUuid } from '../lib/uuid.js';
/** No memory contents or server credentials are persisted in browser storage. */
export function createMemoryApi(request, session) {
  const active = new Map(), attempts = new Map();
  session.subscribe(() => {
    const version = session.getSnapshot().version;
    for (const [controller, owner] of active) if (owner !== version) { controller.abort(); active.delete(controller); }
    for (const [fingerprint, attempt] of attempts) if (attempt.version !== version) attempts.delete(fingerprint);
  });
  const enc = encodeURIComponent, root = '/api/memory';
  const scope = (kind, id) => `${root}/scopes/${enc(kind)}/${enc(id)}`;
  async function call(path, method = 'GET', body, signal, mutation = false, requestKey) {
    const version = session.getSnapshot().version, controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); active.set(controller, version);
    const fingerprint = mutation ? JSON.stringify([version, path, body]) : undefined;
    if (mutation && !attempts.has(fingerprint)) attempts.set(fingerprint, { version, key: createUuid() });
    try {
      const result = await request(path, { method, signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(requestKey || mutation ? { headers: { 'Idempotency-Key': requestKey || attempts.get(fingerprint).key } } : {}) });
      session.assertCurrent(version);
      if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
      if (mutation) attempts.delete(fingerprint);
      return result;
    } finally { active.delete(controller); signal?.removeEventListener('abort', abort); }
  }
  return {
    fetchMemorySettings: signal => call(`${root}/settings`, 'GET', undefined, signal),
    // The mounted editor owns its attempt key. Credentials never enter the shared retry cache.
    saveMemorySettings: (body, requestKey, signal) => call(`${root}/settings`, 'POST', body, signal, false, requestKey),
    testMemorySettings: (body, signal) => call(`${root}/settings/test`, 'POST', body, signal),
    fetchMemoryScope: (kind, id, offset = 0, signal) => call(`${scope(kind, id)}?offset=${offset}`, 'GET', undefined, signal),
    searchMemory: (kind, id, query, signal) => call(`${scope(kind, id)}/search`, 'POST', { query }, signal),
    fetchMemoryTargets: signal => call(`${root}/targets`, 'GET', undefined, signal),
    fetchMemoryCleanup: signal => call(`${root}/cleanup`, 'GET', undefined, signal),
    fetchMemory: (id, signal) => call(`${root}/entries/${enc(id)}`, 'GET', undefined, signal),
    createMemory: (kind, id, body, signal) => call(`${scope(kind, id)}/entries`, 'POST', body, signal, true),
    updateMemory: (id, body, signal) => call(`${root}/entries/${enc(id)}`, 'POST', body, signal, true),
    memoryAction: (id, action, revision, signal) => call(`${root}/entries/${enc(id)}/${enc(action)}`, 'POST', { revision }, signal, true),
    promoteMemory: (id, body, signal) => call(`${root}/entries/${enc(id)}/promote`, 'POST', body, signal, true),
    retryMemory: (id, revision, signal) => call(`${root}/entries/${enc(id)}/retry`, 'POST', { revision }, signal, true),
    fetchTaskMemoryContext: (id, signal) => call(`${root}/tasks/${enc(id)}/context`, 'GET', undefined, signal),
  };
}
