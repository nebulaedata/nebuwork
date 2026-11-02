/** Model configuration caches are scoped to a verified login session. */
export function createModelApi(request, db, sessionVersion = () => 0) {
  let epoch;
  let tail = Promise.resolve();
  let blocked = false;
  let providersVersion = 0;
  function current() {
    const version = sessionVersion();
    if (epoch !== version) {
      epoch = version;
      tail = Promise.resolve();
      blocked = false;
      providersVersion++;
      db.modelProviders = [];
      db.modelSettings = null;
    }
    return version;
  }
  function assertCurrent(version) {
    if (sessionVersion() !== version) throw new DOMException('登录状态已变化，请重试', 'AbortError');
  }
  async function call(path, options, version = current()) {
    assertCurrent(version);
    const result = await request(path, options);
    assertCurrent(version);
    return result;
  }
  const write = (method, payload) => ({ method, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  const settingsPath = '/api/model-settings';
  async function readSettings(version) {
    const result = await call(settingsPath, undefined, version);
    assertCurrent(version);
    if (!db.modelSettings || result.data.revision >= db.modelSettings.revision) db.modelSettings = result.data;
    return { ...result, data: db.modelSettings };
  }
  function enqueue(action) {
    const version = current();
    const next = tail.then(async () => {
      assertCurrent(version);
      if (blocked) throw new Error('上次模型设置操作失败，请重新加载设置后再保存');
      return action(version);
    }).catch(error => {
      if (sessionVersion() === version) { blocked = true; db.modelSettings = null; }
      throw error;
    });
    tail = next.catch(() => {});
    return next;
  }
  return {
    async fetchModelProviders(options) {
      const version = current();
      const generation = ++providersVersion;
      const result = await call('/api/model-providers', options?.signal ? { signal: options.signal } : undefined, version);
      assertCurrent(version);
      if (generation === providersVersion) db.modelProviders = result.data;
      return { ...result, data: db.modelProviders };
    },
    async fetchModelSettings() {
      const version = current();
      await tail;
      assertCurrent(version);
      const result = await readSettings(version);
      assertCurrent(version);
      blocked = false;
      return result;
    },
    saveModelSettings(patch) {
      const changes = { ...patch };
      return enqueue(async version => {
        if (!db.modelSettings) await readSettings(version);
        // The existing gateway permits POST but does not allow PATCH through its CORS policy.
        const result = await call(settingsPath, write('POST', { ...changes, revision: db.modelSettings.revision }), version);
        assertCurrent(version);
        db.modelSettings = result.data;
        return result;
      });
    },
    discoverModels(payload) { return call('/api/model-providers/models', write('POST', payload)); },
    testModelProvider(payload) { return call('/api/model-providers/test', write('POST', payload)); },
    async createModelProvider(payload) {
      const version = current();
      const result = await call('/api/model-providers', write('POST', payload), version);
      assertCurrent(version);
      providersVersion++;
      db.modelProviders = [...db.modelProviders.filter(p => p.id !== result.data.id), result.data];
      return result;
    },
    async testSavedModelProvider(id) {
      const version = current();
      const result = await call(`/api/model-providers/${encodeURIComponent(id)}/test`, write('POST'), version);
      assertCurrent(version);
      providersVersion++;
      db.modelProviders = db.modelProviders.map(p => p.id === id ? result.data : p);
      return result;
    },
    deleteModelProvider(id) {
      return enqueue(async version => {
        const result = await call(`/api/model-providers/${encodeURIComponent(id)}`, write('DELETE'), version);
        assertCurrent(version);
        providersVersion++;
        db.modelProviders = db.modelProviders.filter(p => p.id !== id);
        db.modelSettings = null; // Deletion can advance the server's settings revision.
        return result;
      });
    },
  };
}
