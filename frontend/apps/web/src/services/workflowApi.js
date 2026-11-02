/** Requests stay on Java's authenticated gateway. No remote service credentials enter this adapter. */
export function createWorkflowApi(request, session, urlFor = path => path) {
  const active = new Map();
  session.subscribe(() => {
    const version = session.getSnapshot().version;
    for (const [controller, owner] of active) if (owner !== version) controller.abort();
  });
  return {
    async workflowRequest(path, method = 'GET', body, { signal, key } = {}) {
      if (!/^\/(workflows|workflow-tasks|workflow\/settings)(\/|\?|$)/.test(path)) throw new Error('无效 Workflow 请求');
      const version = session.getSnapshot().version, controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) abort();
      signal?.addEventListener('abort', abort, { once: true }); active.set(controller, version);
      try {
        const result = await request('/api' + path, { method, signal: controller.signal,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          ...(key ? { headers: { 'Idempotency-Key': key } } : {}) });
        session.assertCurrent(version);
        if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
        return result.data;
      } finally { active.delete(controller); signal?.removeEventListener('abort', abort); }
    },
    workflowArtifactUrl(id, artifact) { return urlFor(`/api/workflows/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifact)}/download`); },
  };
}
