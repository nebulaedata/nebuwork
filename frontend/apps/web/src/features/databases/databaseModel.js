export const databaseTypes = { sqlite: 'SQLite', mysql: 'MySQL / MariaDB', postgresql: 'PostgreSQL' };
export const databaseStates = { queued: '排队中', running: '执行中', completed: '成功', failed: '失败', cancelled: '已取消', unknown: '结果待核对' };
export const operationNames = { schema: '读取结构', browse: '浏览数据', query: 'SQL 查询', execute: '执行 SQL', insert_rows: '新增数据', mutate_row: '修改数据', create_table: '新建表', import: '导入数据', export: '导出数据' };
export const pendingOperation = op => op && ['queued', 'running'].includes(op.state);
export const scopeLabel = { expert: '专家', workbench: '工作台', project: '项目' };
export function databaseScopeHref(kind, id, database) {
  const enc = encodeURIComponent;
  const base = kind === 'expert' ? `#/agent/${enc(id)}?tab=databases` : kind === 'project' ? `#/project/${enc(id)}?tab=databases` : `#/workbench?tab=pro&id=${enc(id)}`;
  return base + (database ? `&database=${enc(database)}` : '');
}
export function blankDatabase(type = 'sqlite') {
  return { name: '', description: '', type, host: '', port: type === 'postgresql' ? 5432 : 3306, database: '', schema: 'public', username: '', password: '', tls: 'verify-full', permissions: { read: true, write: type === 'sqlite', schema: type === 'sqlite' } };
}
export function databaseRowKey(structure, columns, row) {
  const fields = structure?.keyColumns || [];
  if (!fields.length) return null;
  const result = {};
  for (const field of fields) { const index = columns.findIndex(c => c.name === field); if (index < 0 || row[index] == null) return null; result[field] = row[index]; }
  return result;
}
export function importTableDefinition(table, mapping) {
  const used = new Set(mapping.map(m => m.target)); let id = 'id'; while (used.has(id)) id = '_' + id;
  return { table, columns: [{ name: id, type: 'INTEGER', primaryKey: true, autoIncrement: true, nullable: false }, ...mapping.map(m => ({ name: m.target, type: m.type === 'number' ? 'DECIMAL' : m.type === 'boolean' ? 'BOOLEAN' : 'TEXT', nullable: true }))] };
}
export async function waitDatabaseOperation(api, database, initial, signal, { onProgress, timeoutMs = 300000, intervalMs = 750 } = {}) {
  let op = initial; const deadline = Date.now() + timeoutMs;
  while (pendingOperation(op) && Date.now() < deadline) {
    if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    onProgress?.(op);
    await new Promise((resolve, reject) => { const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('请求已取消', 'AbortError')); }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, intervalMs); signal.addEventListener('abort', abort, { once: true }); });
    if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
    op = (await api.fetchDatabaseOperation(database, op.id, signal)).data;
  }
  if (signal.aborted) throw new DOMException('请求已取消', 'AbortError');
  onProgress?.(op); return op;
}
export function downloadDatabaseBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
