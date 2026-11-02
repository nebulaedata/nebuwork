import { createUuid } from '../lib/uuid.js';
/** Account-scoped Java transport. Uncertain mutations keep their original key. */
export function createDatabaseApi(request, auth) {
  const enc = encodeURIComponent, pending = new Map(); let epoch = auth.getSnapshot().version;
  auth.subscribe?.(() => { const next = auth.getSnapshot().version; if (next !== epoch) { pending.clear(); epoch = next; } });
  const base = id => `/api/databases/${enc(id)}`;
  async function write(path, body, signal, suppliedKey) {
    const version = auth.getSnapshot().version;
    if (version !== epoch) { pending.clear(); epoch = version; }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(body)));
    auth.assertCurrent(version);
    const signature = path + ':' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join(''), key = suppliedKey || pending.get(signature) || createUuid();
    pending.set(signature, key);
    const result = await request(path, { method: 'POST', signal, headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) });
    auth.assertCurrent(version); pending.delete(signature); return result;
  }
  return {
    fetchDatabaseScope: (kind, id, signal) => request(`/api/database-scopes/${enc(kind)}/${enc(id)}/databases`, { signal }),
    createDatabase: (kind, id, config, signal, key) => write(`/api/database-scopes/${enc(kind)}/${enc(id)}/databases`, config, signal, key),
    fetchDatabase: (id, signal) => request(base(id), { signal }),
    saveDatabase: (id, body, signal) => write(base(id) + '/config', body, signal),
    changeDatabase: (id, action, revision, signal) => {
      if (!['enable', 'disable', 'remove'].includes(action)) throw new Error('无效数据库管理操作');
      return write(base(id) + '/' + action, { revision }, signal);
    },
    testDatabase: (id, signal) => write(base(id) + '/test', {}, signal),
    submitDatabaseOperation: (id, body, signal, key) => write(base(id) + '/operations', body, signal, key),
    fetchDatabaseOperation: (id, operation, signal) => request(base(id) + '/operations/' + enc(operation), { signal }),
    fetchDatabaseOperations: (id, offset = 0, signal) => request(base(id) + '/operations?offset=' + offset, { signal }),
    cancelDatabaseOperation: (id, operation, signal) => write(base(id) + '/operations/' + enc(operation) + '/cancel', {}, signal),
    reconcileDatabaseOperation: (id, operation, signal) => write(base(id) + '/operations/' + enc(operation) + '/reconcile', {}, signal),
    previewDatabaseImport: (id, body, signal) => request(base(id) + '/imports/preview', { method: 'POST', body: JSON.stringify(body), signal }),
    async uploadDatabaseImport(id, file, signal, key) {
      if (file.size > 20 * 1024 * 1024) throw new Error('导入文件最大 20 MiB');
      if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error('请选择 CSV 或 XLSX 文件');
      const version = auth.getSnapshot().version;
      const form = new FormData(); form.append('file', file);
      const result = await request(base(id) + '/imports/upload', { method: 'POST', headers: { 'Idempotency-Key': key || createUuid() }, body: form, signal });
      auth.assertCurrent(version); return result;
    },
    downloadDatabase: (id, operation, signal) => request(base(id) + (operation ? `/operations/${enc(operation)}/download` : '/download'), { responseType: 'blob', signal }),
  };
}
