/** No knowledge payloads or credentials are persisted in browser storage. */
export function createKnowledgeApi(request, session, onMutation = () => {}, endpoint = path => path) {
  const active = new Map();
  session.subscribe(() => {
    const currentVersion = session.getSnapshot().version;
    // An earlier listener may already have started requests for the new session.
    active.forEach((version, controller) => {
      if (version !== currentVersion) { controller.abort(); active.delete(controller); }
    });
  });
  const enc = encodeURIComponent;
  const base = '/api/knowledge-mcp/connections';
  const scope = (kind, id) => '/api/knowledge-scopes/' + enc(kind) + '/' + enc(id);
  async function call(path, method = 'GET', body, signal, extra = {}) {
    const version = session.getSnapshot().version, controller = new AbortController();
    const mutation = method !== 'GET' && !['/read', '/test', '/preview', '/media'].some(suffix => path.endsWith(suffix));
    // Background file uploads change content, not expert/workbench reference definitions.
    const changesReferences = mutation && !path.endsWith('/upload');
    if (changesReferences) onMutation();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    active.set(controller, version);
    try {
      const result = await request(path, { ...extra, method, signal: controller.signal, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
      session.assertCurrent(version);
      if (controller.signal.aborted) throw new DOMException('请求已取消', 'AbortError');
      return result;
    } finally { active.delete(controller); signal?.removeEventListener('abort', abort); if (changesReferences && session.getSnapshot().version === version) onMutation(); }
  }
  return {
    knowledgeV101Url: (connectionId, path = "/knowledge-bases") => endpoint("/api/knowledge-v101/" + enc(connectionId) + "/ui" + path),
    fetchKnowledgeCreationTemplates: (connectionId, signal) => call(connectionId ? base + '/' + enc(connectionId) + '/creation-templates' : '/api/knowledge-mcp/creation-templates', 'GET', undefined, signal),
    fetchKnowledgeCreationResources: (id, signal) => call(base + '/' + enc(id) + '/creation-resources', 'GET', undefined, signal),
    saveKnowledgeCreationTemplate: (connectionId, id, payload, signal) => call(base + '/' + enc(connectionId) + '/creation-templates' + (id ? '/' + enc(id) : ''), 'POST', payload, signal),
    validateKnowledgeCreationTemplate: (id, config, signal) => call(base + '/' + enc(id) + '/creation-templates/validate', 'POST', config, signal),
    createKnowledgeJob: (payload, signal) => call('/api/knowledge-mcp/creation-jobs', 'POST', payload, signal),
    fetchKnowledgeCreationJobs: signal => call('/api/knowledge-mcp/creation-jobs', 'GET', undefined, signal),
    fetchKnowledgeCreationJob: (id, signal) => call('/api/knowledge-mcp/creation-jobs/' + enc(id), 'GET', undefined, signal),
    confirmKnowledgeCreationJob: (id, business, signal) => call('/api/knowledge-mcp/creation-jobs/' + enc(id) + '/confirm', 'POST', { business }, signal),
    retryKnowledgeCreationJob: (id, recover, signal) => call('/api/knowledge-mcp/creation-jobs/' + enc(id) + (recover ? '/recover' : '/retry'), 'POST', {}, signal),
    fetchKnowledgeSettings: signal => call('/api/knowledge-mcp/settings', 'GET', undefined, signal),
    discoverKnowledgeCollections: (id, signal) => call(base + '/' + enc(id) + '/discover', 'GET', undefined, signal),
    assignKnowledgeCollection: (id, payload, signal) => call(base + '/' + enc(id) + '/assign', 'POST', payload, signal),
    manageKnowledge: (id, payload, signal) => call(base + '/' + enc(id) + '/manage', 'POST', payload, signal),
    fetchKnowledgeOperations: signal => call('/api/knowledge-mcp/operations', 'GET', undefined, signal),
    recoverKnowledgeOperation: (id, signal) => call('/api/knowledge-mcp/operations/' + enc(id) + '/recover', 'POST', {}, signal),
    fetchKnowledgeProgress: (id, signal) => call('/api/knowledge-mcp/operations/' + enc(id) + '/progress', 'GET', undefined, signal),
    downloadKnowledgeErrors: (id, signal) => call('/api/knowledge-mcp/operations/' + enc(id) + '/errors', 'POST', {}, signal, { responseType: 'blob' }),
    uploadKnowledgeFile: (id, form, signal) => call(base + '/' + enc(id) + '/upload', 'POST', form, signal),
    downloadKnowledgeFile: (id, payload, signal) => call(base + '/' + enc(id) + '/download', 'POST', payload, signal, { responseType: 'blob' }),
    knowledgeCatalogContent: (connectionId, collectionId, action, payload, signal) => call(base + '/' + enc(connectionId) + '/' + action, 'POST', { ...payload, collectionId }, signal, { responseType: 'blob' }),
    knowledgeReferenceContent: (kind, id, ref, action, payload, signal) => call(scope(kind, id) + '/references/' + enc(ref) + '/' + action, 'POST', payload, signal, { responseType: 'blob' }),
    fetchKnowledgeDrivers: signal => call('/api/knowledge-mcp/drivers', 'GET', undefined, signal),
    fetchKnowledgeTargets: (kind, signal) => call('/api/knowledge-mcp/targets?kind=' + enc(kind), 'GET', undefined, signal),
    fetchKnowledgeConnections: (kind = 'user', id = '', signal) => call(base + '?kind=' + enc(kind) + '&scopeId=' + enc(id), 'GET', undefined, signal),
    createKnowledgeConnection: (payload, signal) => call(base, 'POST', payload, signal),
    updateKnowledgeConnection: (id, payload, signal) => call(base + '/' + enc(id), 'POST', payload, signal),
    deleteKnowledgeConnection: (id, revision, signal) => call(base + '/' + enc(id) + '?revision=' + revision, 'DELETE', undefined, signal),
    testKnowledgeDraft: (connection, connectionId, signal) => call(base + '/test', 'POST', { connection, ...(connectionId ? { connectionId } : {}) }, signal),
    testKnowledgeConnection: (id, signal) => call(base + '/' + enc(id) + '/test', 'POST', {}, signal),
    fetchKnowledgeCollections: (id, signal, includeDocumentCounts = false) => call(base + '/' + enc(id) + '/collections' + (includeDocumentCounts ? '?includeDocumentCounts=true' : ''), 'GET', undefined, signal),
    fetchKnowledgeUsages: (id, signal) => call(base + '/' + enc(id) + '/references', 'GET', undefined, signal),
    fetchKnowledgeScope: (kind, id, signal) => call(scope(kind, id), 'GET', undefined, signal),
    bindKnowledge: (kind, id, payload, signal) => call(scope(kind, id) + '/references', 'POST', payload, signal),
    createLocalKnowledge: (kind, id, payload, signal) => call(scope(kind, id) + '/connections', 'POST', payload, signal),
    unbindKnowledge: (kind, id, ref, revision, signal) => call(scope(kind, id) + '/references/' + enc(ref) + '?revision=' + revision, 'DELETE', undefined, signal),
    readKnowledgeReference: (kind, id, ref, payload, signal) => call(scope(kind, id) + '/references/' + enc(ref) + '/read', 'POST', payload, signal),
    readKnowledgeCatalog: (connectionId, collectionId, payload, signal) => call(base + '/' + enc(connectionId) + '/read', 'POST', { ...payload, collectionId }, signal),
  };
}
