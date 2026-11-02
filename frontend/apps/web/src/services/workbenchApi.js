/** Workbench/project state is a cache of authenticated Java responses, never mock persistence. */
export function createWorkbenchApi(request, db, sessionVersion = () => 0) {
  let epoch = sessionVersion();
  let mutation = 0;
  const generations = new Map();
  const reset = () => {
    db.workbenches = []; db.projects = []; db.workbenchTemplates = [];
    db.wbConfigs = {}; db.workbenchVersions = {}; db.projectDetails = {};
    generations.clear();
  };
  reset();
  const current = () => { const v = sessionVersion(); if (v !== epoch) { epoch = v; reset(); } return v; };
  const assertCurrent = v => { if (sessionVersion() !== v) throw new DOMException('登录状态已变化，请重新加载', 'AbortError'); };
  const invalidate = key => generations.set(key, (generations.get(key) || 0) + 1);
  const enc = encodeURIComponent, wb = id => '/api/workbenches/' + enc(id);
  const merge = (rows, item) => { const index = rows.findIndex(row => row.id === item.id); if (index < 0) rows.push(item); else rows[index] = item; };
  const cacheConfig = data => { merge(db.workbenches, data.workbench); db.wbConfigs[data.workbench.id] = data; };
  async function read(path, cacheKey, cache, options) {
    const version = current(); invalidate(cacheKey); const stamp = generations.get(cacheKey), beforeMutation = mutation;
    const result = await request(path, options); assertCurrent(version);
    if (generations.get(cacheKey) !== stamp || beforeMutation !== mutation) throw new DOMException('数据已更新，请重新加载', 'AbortError');
    cache(result.data); return result;
  }
  async function write(path, method, body, keys, cache, idempotencyKey) {
    const version = current(); ++mutation; keys.forEach(invalidate);
    const result = await request(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}) });
    assertCurrent(version); ++mutation; keys.forEach(invalidate); cache(result.data); return result;
  }
  return {
    fetchCaseTemplates: () => read('/api/plaza/templates', 'caseTemplates', data => { db.plazaTemplates = data; }),
    fetchWorkbenches: () => read('/api/workbenches', 'workbenches', data => { db.workbenches = data; }),
    fetchWorkbenchConfig: id => read(wb(id) + '/config', 'config:' + id, cacheConfig),
    createWorkbench: (payload, key) => write('/api/workbenches', 'POST', payload, ['workbenches'], data => merge(db.workbenches, data), key),
    updateWorkbench: (id, payload) => write(wb(id), 'POST', payload, ['workbenches', 'config:' + id], data => { merge(db.workbenches, data); delete db.wbConfigs[id]; }),
    saveWorkbenchConfig: (id, payload) => write(wb(id) + '/config', 'POST', payload, ['workbenches', 'config:' + id], cacheConfig),
    setWorkbenchBinding: (id, kind, target, enabled, revision) => write(`${wb(id)}/bindings/${enc(kind)}/${enc(target)}`, 'POST', { enabled, revision }, ['workbenches', 'config:' + id], cacheConfig),
    publishWorkbench: (id, revision) => write(wb(id) + '/publish', 'POST', { revision }, ['workbenches', 'config:' + id, 'versions:' + id], data => {
      merge(db.workbenches, data.workbench); delete db.wbConfigs[id]; delete db.workbenchVersions[id];
    }),
    deleteWorkbench: (id, revision) => write(`${wb(id)}/delete`, 'POST', { revision }, ['workbenches', 'config:' + id, 'versions:' + id], () => {
      db.workbenches = db.workbenches.filter(row => row.id !== id); delete db.wbConfigs[id]; delete db.workbenchVersions[id];
    }),
    fetchWorkbenchVersions: id => read(wb(id) + '/versions', 'versions:' + id, data => { db.workbenchVersions[id] = data; }),
    fetchWorkbenchVersion: (id, version) => read(`${wb(id)}/versions/${enc(version)}`, `version:${id}:${version}`, () => {}),
    fetchProjects: workbench => read('/api/projects' + (workbench ? '?workbenchId=' + enc(workbench) : ''), 'projects', data => {
      db.projects = workbench ? [...db.projects.filter(p => p.workbenchId !== workbench), ...data] : data;
    }),
    createProject: (payload, key) => write('/api/projects', 'POST', payload, ['projects', 'workbenches'], data => {
      merge(db.projects, data); const target = db.workbenches.find(w => w.id === data.workbenchId);
      if (target && !target.projectIds.includes(data.id)) target.projectIds.push(data.id);
    }, key),
    fetchProjectDetail: (id, signal) => read('/api/projects/' + enc(id), 'project:' + id, data => { merge(db.projects, data.project); merge(db.workbenches, data.workbench); db.projectDetails[id] = data; }, signal ? { signal } : undefined),
    updateProject: (id, payload) => write('/api/projects/' + enc(id), 'POST', payload, ['projects', 'project:' + id], data => { merge(db.projects, data); delete db.projectDetails[id]; }),
  };
}
