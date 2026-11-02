/** View projections only: business identity and state always come from Java. */
export const ENTRY = { commander: 'commander', intel: 'intelligence' };
export function readPreference(account, role) {
  try {
    const value = JSON.parse(localStorage.getItem(`nw-hub:${account}:${role}`) || '{}');
    return Object.fromEntries(['workbenchId', 'projectId', 'taskId', 'sourceProjectId'].filter(k => typeof value?.[k] === 'string').map(k => [k, value[k]]));
  } catch { return {}; }
}
export function savePreference(account, role, value) {
  if (!account) return;
  try { localStorage.setItem(`nw-hub:${account}:${role}`, JSON.stringify(Object.fromEntries(
    ['workbenchId', 'projectId', 'taskId', 'sourceProjectId'].filter(k => typeof value[k] === 'string').map(k => [k, value[k]])))); } catch { /* Preferences are optional. */ }
}
export async function settledMap(items, fn, concurrency = 4) {
  const output = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) { const index = next++; if (index >= items.length) return;
      try { output[index] = { status: 'fulfilled', value: await fn(items[index], index) }; }
      catch (reason) { output[index] = { status: 'rejected', reason }; }
    }
  }));
  return output;
}
export const latestTasks = rows => [...rows].sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
/** Engine artifacts identify their session/run; taskId is not guaranteed in the projection. */
export function taskArtifacts(items, projection) {
  const task = projection?.task, sessionId = projection?.session?.id || task?.sessionId;
  const runs = new Set((projection?.runs || []).map(r => r.id));
  return items.filter(f => (task?.id && f.taskId === task.id) || (sessionId && f.sessionId === sessionId) || (f.runId && runs.has(f.runId)));
}
/** Only persisted, successful dispatch-tool results can establish a parent-child link. */
export function dispatchTargets(turns = []) {
  const ids = new Set();
  const visit = (value, depth = 0) => {
    if (!value || depth > 9) return;
    if (typeof value === 'string') { try { visit(JSON.parse(value), depth + 1); } catch { /* Never parse prose for IDs. */ } return; }
    if (Array.isArray(value)) { value.forEach(v => visit(v, depth + 1)); return; }
    if (typeof value !== 'object' || value.isError === true) return;
    if (typeof value.taskId === 'string') ids.add(value.taskId);
    if (typeof value.task?.id === 'string') ids.add(value.task.id);
    for (const key of ['data', 'result', 'structuredContent', 'content', 'text', 'operation']) visit(value[key], depth + 1);
  };
  turns.forEach(turn => Object.values(turn.tools || {}).forEach(tool => {
    if (tool.status === 'completed' && /(?:nw_task_create|nw_task_run_start)$/.test(tool.name || '')) visit(tool.result);
  }));
  return ids;
}
export function sourceIdentity(source) {
  if (source.kind === 'artifact') return `artifact:${source.projectId}:${source.id}:${source.version}`;
  return `knowledge:${source.scopeKind}:${source.scopeId}:${source.referenceId}:${source.documentId || ''}:${source.chunkId || ''}:${source.contentKind || 'document'}`;
}
export function sourceReference(source) {
  return source.kind === 'artifact'
    ? { kind: 'artifact', projectId: source.projectId, id: source.id, version: source.version, name: source.name }
    : { kind: 'knowledge', scopeKind: source.scopeKind, scopeId: source.scopeId, referenceId: source.referenceId,
      connectionId: source.connectionId, collectionId: source.collectionId, documentId: source.documentId,
      chunkId: source.chunkId, contentKind: source.contentKind || 'document', title: source.title };
}
export function analysisRequest(goal, sources) {
  return { title: `情报分析 · ${goal.slice(0, 45)}`, content: `${goal}\n\n请通过已授权的只读工具核验以下来源，再进行分析。区分资料事实、推断与缺失信息；保留来源身份及成果版本。不能访问时明确说明，不能凭引用编造内容。将分析结论保存为 Markdown 成果。\n\n来源引用：\n${JSON.stringify(sources.map(sourceReference), null, 2)}`,
    context: { entry: ENTRY.intel, sourceRefs: sources.map(sourceReference) } };
}
