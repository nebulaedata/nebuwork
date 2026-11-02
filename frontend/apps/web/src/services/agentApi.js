import { createUuid } from '../lib/uuid.js';
import { authSession } from './authSession.js';
import { createFileApi, MAX_FILE_BYTES, LOCAL_OFFICE_BYTES } from './fileApi.js';

const enc = encodeURIComponent;
/** One account-scoped transport for the versioned engine projection exposed by Java. */
export function createAgentApi(request, endpoint, auth = authSession) {
  let epoch = auth.getSnapshot().version;
  const pending = new Map();
  async function write(path, body, suppliedKey, signal) {
    const version = auth.getSnapshot().version;
    if (version !== epoch) { pending.clear(); epoch = version; }
    const signature = `${path}:${JSON.stringify(body)}`;
    const key = suppliedKey || pending.get(signature) || createUuid();
    pending.set(signature, key);
    const result = await request(path, { method: 'POST', signal, headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) });
    auth.assertCurrent(version); pending.delete(signature); return result;
  }
  const task = id => `/api/tasks/${enc(id)}`;
  const api = {
    ...createFileApi(request, endpoint, auth),
    fetchPlatformMcpCatalog: signal => request('/api/platform-mcp/catalog', {signal}),
    fetchPlatformMcpPolicy: (id,signal) => request(`/api/workbenches/${enc(id)}/platform-mcp-policy`, {signal}),
    savePlatformMcpPolicy: (id,body,signal) => write(`/api/workbenches/${enc(id)}/platform-mcp-policy`, body, undefined, signal),
    changePlatformMcpPolicy: (id,action,revision,signal) => write(`/api/workbenches/${enc(id)}/platform-mcp-policy/${action}`, {revision}, undefined, signal),
    fetchPlatformMcpOperations: (signal,offset=0) => request(`/api/platform-mcp/operations?limit=50&offset=${offset}`, {signal}),
    fetchPlatformMcpOperation: (id,signal) => request(`/api/platform-mcp/operations/${enc(id)}`, {signal}),
    async engineSettingsRequest(path = '', method = 'GET', body, { signal, key } = {}) {
      if (!['', '/test', '/status'].includes(path) || !['GET', 'POST'].includes(method)) throw new Error('无效的引擎配置请求');
      const version = auth.getSnapshot().version;
      const result = await request('/api/agent-engine/settings' + path, { method, signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(key ? { headers: { 'Idempotency-Key': key } } : {}) });
      auth.assertCurrent(version);
      if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
      return result.data;
    },
    fetchKnowledgeEvidence: (id, evidence, signal) => request(`${task(id)}/evidence/${enc(evidence)}`, { signal }),
    readKnowledgeEvidence: (id, evidence, payload, signal) => request(`${task(id)}/evidence/${enc(evidence)}/read`, { method: 'POST', body: JSON.stringify(payload), signal }),
    knowledgeEvidenceContent: (id, evidence, action, payload, signal) => request(`${task(id)}/evidence/${enc(evidence)}/${action}`, { method: 'POST', body: JSON.stringify(payload), signal, responseType: 'blob' }),
    fetchTask: (id, signal) => request(task(id), { signal }),
    fetchProjectTasks: (id, signal) => request(`/api/projects/${enc(id)}/tasks`, { signal }),
    createTask: (project, body, key) => write(`/api/projects/${enc(project)}/tasks`, body, key),
    editTask: (id, body) => write(task(id), body),
    sendTask: (id, body, key) => write(`${task(id)}/runs`, body, key),
    fetchTaskRuns: (id,signal) => request(`${task(id)}/runs`,{signal}),
    fetchAgentRun: (id, run, signal) => request(`${task(id)}/runs/${enc(run)}`, { signal }),
    commandRun: (id, run, body, key) => write(`${task(id)}/runs/${enc(run)}/commands`, body, key),
    fetchExpertRun: (id, run, signal) => request(`${task(id)}/experts/${enc(run)}`, { signal }),
    fetchTaskHistory: (id, after, signal) => request(`${task(id)}/history?after=${after}`, { signal }),
    fetchProjectArtifacts: (project, signal) => request(`/api/projects/${enc(project)}/artifacts`, { signal }),
    fetchArtifact: (project,id,version,signal) => request(`/api/projects/${enc(project)}/artifacts/${enc(id)}?version=${version}`, {signal}),
    artifactUrl: (project, file) => endpoint(`/api/projects/${enc(project)}/artifacts/${enc(file.id)}/content?version=${file.version}`),
    artifactContent: (project, file, signal) => request(`/api/projects/${enc(project)}/artifacts/${enc(file.id)}/content?version=${file.version}`, { signal, responseType: 'blob' }),
    grantSession: (target, body) => write(`${task(target)}/session-grants`, body),
    async uploadArtifact(project, file, taskId, key = createUuid(), options = {}) {
      const accountVersion=auth.getSnapshot().version;
      if (file.size > MAX_FILE_BYTES) throw new Error('单个文件最大 2048 MiB');
      if (file.size > LOCAL_OFFICE_BYTES) return api.uploadLargeArtifact(project, file, taskId, key, options);
      const capability=await request('/api/file-previews/capabilities');
      auth.assertCurrent(accountVersion);
      if(capability.data.enabled)return api.uploadLargeArtifact(project,file,taskId,key,options);
      const form = new FormData(); form.append('file', file); if (taskId) form.append('taskId', taskId);
      return request(`/api/projects/${enc(project)}/artifacts`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: form });
    },
    fetchRuntime: (kind, id, signal) => request(`/api/runtime-resources/${enc(kind)}/${enc(id)}`, { signal }),
    saveRuntime: (kind, id, body) => write(`/api/runtime-resources/${enc(kind)}/${enc(id)}`, body),
    publishRuntime: (kind, id, revision) => write(`/api/runtime-resources/${enc(kind)}/${enc(id)}/publish`, { revision }),
    async uploadRuntime(kind, id, file, path, key = createUuid()) {
      const form = new FormData(); form.append('file', file); form.append('path', path);
      return request(`/api/runtime-resources/${enc(kind)}/${enc(id)}/files`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: form });
    },
    fetchRuntimeCredentials: signal => request('/api/runtime-credentials', { signal }),
    saveRuntimeCredential: body => write('/api/runtime-credentials', body),
    async subscribeTask(id, cursor, callbacks, signal) {
      const version = auth.getSnapshot().version;
      let failures = 0;
      while (!signal.aborted && version === auth.getSnapshot().version) {
        let reader;
        try {
          const response = await fetch(endpoint(`${task(id)}/events?after=${cursor}`), { credentials: 'include', signal, headers: { Accept: 'text/event-stream', 'Last-Event-ID': String(cursor) } });
          auth.assertCurrent(version);
          if (!response.ok) { const error = new Error(`事件连接失败 (${response.status})`); error.status = response.status; throw error; }
          reader = response.body.getReader(); callbacks.onConnection?.(true); failures = 0;
          let buffer = ''; const decoder = new TextDecoder();
          while (!signal.aborted) {
            const next = await reader.read(); auth.assertCurrent(version); if (next.done) break;
            buffer += decoder.decode(next.value, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/); buffer = blocks.pop();
            for (const block of blocks) {
              if (/^event: ?auth.expired$/m.test(block)) { auth.invalidate(version); return; }
              const data = block.split(/\r?\n/).filter(s => s.startsWith('data:')).map(s => s.slice(5).trimStart()).join('\n');
              if (!data) continue;
              const event = JSON.parse(data);
              if (event.sequence > cursor) { callbacks.onEvent(event); cursor = event.sequence; }
            }
          }
        } catch (error) {
          if (signal.aborted || version !== auth.getSnapshot().version) return;
          if (error.status === 401) { auth.invalidate(version); return; }
          callbacks.onError?.(error);
          if ([403, 404].includes(error.status)) return;
        } finally { if (reader) await reader.cancel().catch(() => {}); callbacks.onConnection?.(false); }
        if (signal.aborted) return;
        await new Promise(resolve => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, Math.min(10000, 500 * 2 ** failures++)); signal.addEventListener('abort', done, { once: true }); });
      }
    },
  };
  return api;
}
