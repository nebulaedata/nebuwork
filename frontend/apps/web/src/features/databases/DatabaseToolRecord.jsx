import React, { useEffect, useState } from 'react';
import { databaseStates, databaseScopeHref, operationNames } from './databaseModel.js';
import { useDatabaseLife } from './useDatabaseLife.js';

export function databaseToolRecord(tool) {
  if (!tool.name?.startsWith('database_')) return null;
  let visited = 0;
  const find = (value, depth = 0) => {
    if (++visited > 10000 || depth > 20) return null;
    if (typeof value === 'string' && value.length < 2 * 1024 * 1024) { try { return find(JSON.parse(value), depth + 1); } catch { return null; } }
    if (!value || typeof value !== 'object') return null;
    if (/^dbo-[a-f0-9]{40}$/.test(value.operationId || '') && /^db-[a-f0-9]{40}$/.test(value.databaseId || '')) return value;
    for (const item of Object.values(value)) { const result = find(item, depth + 1); if (result) return result; }
    return null;
  };
  return find(tool.result) || find(tool.output);
}
export function databaseToolStatus(tool) {
  const record = databaseToolRecord(tool);
  return record ? record.state === 'queued' ? '已提交' : databaseStates[record.state] : null;
}
export function DatabaseToolRecord({ tool }) {
  const initial = databaseToolRecord(tool), life = useDatabaseLife('database-tool:' + tool.id);
  const [record, setRecord] = useState(null), [database, setDatabase] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { setRecord(null); setDatabase(null); setError(''); }, [life.epoch]);
  if (!initial) return null;
  async function load() { if (busy) return; setBusy(true); setError(''); try { const results = await Promise.all([API.fetchDatabaseOperation(initial.databaseId, initial.operationId, life.signal()), API.fetchDatabase(initial.databaseId, life.signal())]); if (life.live()) { setRecord(results[0].data); setDatabase(results[1].data); } } catch (e) { if (life.live()) setError(e.message); } finally { if (life.live()) setBusy(false); } }
  return <div className="agent-database-record"><button className="btn btn-ghost btn-sm" disabled={busy} onClick={load}>{busy ? '正在读取操作…' : '查看数据库操作'}</button>{error && <p role="alert">{error}</p>}{record && <><p>{operationNames[record.operation]} · {databaseStates[record.state]}{record.result?.affectedRows != null ? ` · 影响 ${record.result.affectedRows} 行` : ''}</p>{record.error && <p role="alert">{record.error}</p>}<a href={databaseScopeHref(database.scopeKind, database.scopeId, database.id)}>打开 {database.name}</a>{record.state === 'unknown' && <p>此操作结果待核对，系统未自动重复写入。</p>}</>}</div>;
}
