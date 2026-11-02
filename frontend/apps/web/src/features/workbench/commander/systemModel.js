import { agentReducer, emptyState } from '../../tasks/agentState.js';
import { taskExpertRoster } from '../../tasks/taskExperts.js';
import { dailyUsage, sumUsage } from '../../tasks/usage.js';
import { dispatchTargets, latestTasks } from '../hubModel.js';

export const kindNames = { workbench: '工作台', project: '项目', expert: '专家', task: '任务' };
export const nodeKey = (kind, id) => `${kind}:${id}`;
export const runningStates = new Set(['queued', 'preparing', 'running', 'waiting_children', 'recovering']);
export const unknownUsage = { totalTokens: null, usageKnown: false };
export function accountTasks(projects) {
  return latestTasks(projects.flatMap(project => (project.sessions || []).map(task => ({ ...task, projectId: project.id, projectName: project.name, workbenchId: project.workbenchId }))));
}
export function factsFromEvents(events, sessionId) {
  return agentReducer(emptyState(sessionId), { type: 'events', items: events || [] });
}

/** The graph is a read projection, never a model-generated assertion. */
export function buildSystemGraph({ workbenches = [], projects = [], experts = [], versions = {}, details = {}, live, history }) {
  const nodes = new Map(), edges = new Map();
  const add = (kind, row, usage, extra = {}) => {
    if (!row?.id) return;
    const key = nodeKey(kind, row.id);
    nodes.set(key, { ...row, key, kind, label: row.name || row.title || row.id, usage: usage || unknownUsage, ...extra });
  };
  const edge = (source, target, label, configured, provenance) => {
    if (nodes.has(source) && nodes.has(target)) edges.set(`${source}>${target}:${label}`, { id: `${source}>${target}:${label}`, source, target, label, configured, provenance });
  };
  const expert = e => { if (e?.id && !nodes.has(nodeKey('expert', e.id))) add('expert', e, unknownUsage, { historical: true }); };
  workbenches.forEach(w => add('workbench', w, w.taskStats));
  projects.forEach(p => add('project', p, p.stats));
  experts.forEach(e => add('expert', e, e.stats));
  accountTasks(projects).forEach(t => add('task', t, t.usage));
  projects.forEach(p => {
    edge(nodeKey('workbench', p.workbenchId), nodeKey('project', p.id), '所属项目', false, '项目的实际工作台归属');
    (p.agents || []).forEach(e => { expert(e); edge(nodeKey('project', p.id), nodeKey('expert', e.id), '配置专家', true, `项目固定业务版本 ${p.ontologyVersion || p.ontologyVersionId || '已记录'}，不代表实际参与`); });
    (p.sessions || []).forEach(t => edge(nodeKey('project', p.id), nodeKey('task', t.id), '所属任务', false, '任务的实际项目归属'));
  });
  workbenches.forEach(w => {
    const v = versions[w.activeVersionId];
    (v?.snapshot?.agents || []).forEach(e => { expert(e); edge(nodeKey('workbench', w.id), nodeKey('expert', e.id), '绑定专家', true, `工作台已发布版本 ${v.version}`); });
  });
  for (const e of experts) for (const task of details[nodeKey('expert', e.id)]?.tasks || []) {
    edge(nodeKey('task', task.id), nodeKey('expert', e.id), task.role === 'primary' ? '主专家执行' : task.role === 'collaborator' ? '委派参与' : '实际参与', false, `专家实际参与记录 ${task.runId || ''}；${task.time || '已记录'}，不代表当前配置`);
  }
  const projections = { ...details };
  if (live?.task?.id) {
    const old = details[live.task.id];
    projections[live.task.id] = { ...old, task: live.task, runs: live.runs, runDetails: { ...old?.runDetails, ...live.runDetails }, state: live.state, history: history?.state };
    if (nodes.has(nodeKey('task', live.task.id))) add('task', { ...nodes.get(nodeKey('task', live.task.id)), ...live.task }, live.task.usage);
  }
  for (const [taskId, projection] of Object.entries(projections)) {
    const key = nodeKey('task', taskId); if (!nodes.has(key)) continue;
    const state = projection.state || factsFromEvents(projection.events, projection.session?.id);
    const states = [projection.history, state].filter(Boolean);
    const delegations = Object.assign({}, ...states.map(s => s.experts));
    for (const summary of projection.runs || []) {
      const run = projection.runDetails?.[summary.id] || summary;
      const started = states.some(s => Object.values(s.events || {}).some(e => e.runId === run.id && e.type === 'run.started'));
      for (const item of taskExpertRoster(run, delegations).filter(e => e.invocations.length || e.primary && started)) {
        expert(item);
        edge(key, nodeKey('expert', item.id), item.primary ? '主专家执行' : '委派参与', false, `实际执行 ${run.id}；来自执行快照或委派记录`);
      }
    }
    for (const target of dispatchTargets(states.flatMap(s => s.turns || []))) edge(key, nodeKey('task', target), '派发任务', false, '持久化的成功任务创建／启动工具结果');
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

/** Parse JSON envelopes only. Never scan assistant prose for identities. */
export function structuredValues(value, depth = 0) {
  if (!value || depth > 12) return [];
  if (typeof value === 'string') { try { return structuredValues(JSON.parse(value), depth + 1); } catch { return []; } }
  if (Array.isArray(value)) return value.flatMap(v => structuredValues(v, depth + 1));
  if (typeof value !== 'object' || value.isError) return [];
  return [value, ...['data', 'result', 'structuredContent', 'content', 'text', 'items', 'task', 'project', 'workbench', 'agent', 'tasks', 'projects', 'experts', 'workbenches'].flatMap(k => structuredValues(value[k], depth + 1))];
}
export function questionFocus(turns, graph) {
  const turn = turns?.at(-1); if (!turn) return { runId: '', keys: [], failed: false };
  const byId = new Map();
  graph.nodes.forEach(n => { const values = byId.get(n.id) || []; values.push(n.key); byId.set(n.id, values); });
  const precise = new Set(), broad = new Set(), chunks = new Map(); let failed = false;
  const collect = (rows, destination, fields = ['id', 'taskId', 'projectId', 'workbenchId', 'expertId']) => {
    for (const row of rows) for (const field of fields) if (typeof row[field] === 'string') (byId.get(row[field]) || []).forEach(key => destination.add(key));
  };
  for (const tool of Object.values(turn.tools || {})) {
    if (tool.status === 'failed') { failed = true; continue; }
    // Identity, capabilities and operation receipts describe transport, not the user's subject.
    if (tool.status !== 'completed' || !/nw_(?:workbench_|project_|expert_|task_|usage_get|search$|resource_read$)/.test(tool.name || '')) continue;
    const accountUsage = /nw_usage_get$/.test(tool.name) && tool.arguments?.kind === 'user';
    const list = accountUsage || /(?:_list|_search|_overview_get|nw_search)$/.test(tool.name || '');
    const destination = list ? broad : precise;
    const args = structuredValues(tool.arguments);
    const result = structuredValues(tool.result);
    collect(args, destination, /nw_usage_get$/.test(tool.name) ? tool.arguments?.kind === 'run' ? ['taskId'] : accountUsage ? [] : ['id'] : undefined);
    collect(result, destination);
    if (/nw_resource_read$/.test(tool.name) && tool.arguments?.uri) {
      const parts = chunks.get(tool.arguments.uri) || [];
      result.filter(row => row.encoding === 'utf8' && typeof row.text === 'string' && Number.isInteger(row.offset)).forEach(row => parts.push(row)); chunks.set(tool.arguments.uri, parts);
    }
  }
  for (const parts of chunks.values()) {
    let cursor = 0, text = '', complete = false;
    for (const part of [...new Map(parts.map(p => [p.offset, p])).values()].sort((a, b) => a.offset - b.offset)) {
      if (part.offset !== cursor) break;
      text += part.text; cursor += part.text.length; complete = part.nextOffset == null;
    }
    if (complete) collect(structuredValues(text), broad);
  }
  return { runId: turn.id, keys: [...(precise.size ? precise : broad)], failed };
}

export function displayGraph(graph, expanded = {}, focus = [], query = '', kind = '') {
  const focusSet = new Set(focus), tasks = graph.nodes.filter(n => n.kind === 'task');
  const chosen = new Set(tasks.filter(n => focusSet.has(n.key)).slice(0, 200).map(n => n.key));
  const executionFocus = new Set(focus.filter(key => key.startsWith('expert:') || key.startsWith('task:')));
  for (const e of graph.edges) {
    if (executionFocus.has(e.target) && e.source.startsWith('task:') && chosen.size < 200) chosen.add(e.source);
    if (executionFocus.has(e.source) && e.target.startsWith('task:') && chosen.size < 200) chosen.add(e.target);
  }
  for (const [projectId, count] of Object.entries(expanded)) for (const task of tasks.filter(t => t.projectId === projectId).slice(0, count)) if (chosen.size < 200) chosen.add(task.key);
  const base = graph.nodes.filter(n => n.kind !== 'task' || chosen.has(n.key));
  const matches = base.filter(n => (!kind || n.kind === kind) && (!query || `${n.label} ${n.id}`.toLowerCase().includes(query.toLowerCase())));
  let keys = new Set(matches.map(n => n.key));
  if (focus.length) {
    const neighborhood = new Set(focus);
    graph.edges.forEach(e => { if (focusSet.has(e.source) || focusSet.has(e.target)) { neighborhood.add(e.source); neighborhood.add(e.target); } });
    keys = new Set([...keys].filter(k => neighborhood.has(k)));
    if (!kind && !query) {
      // A related dispatch task still needs its own project/workbench ancestry in view.
      for (let level = 0; level < 2; level++) graph.edges.filter(e => ['所属项目', '所属任务'].includes(e.label)).forEach(e => { if (keys.has(e.target)) keys.add(e.source); });
    }
  }
  return { nodes: base.filter(n => keys.has(n.key)), edges: graph.edges.filter(e => keys.has(e.source) && keys.has(e.target)), taskCount: tasks.length, shownTasks: base.filter(n => keys.has(n.key) && n.kind === 'task').length };
}

export function systemStatistics({ projects = [], workbenches = [], experts = [] }, selected, details = {}) {
  const allTasks = accountTasks(projects);
  let included = projects, usage, tasks = allTasks, daily = [];
  if (selected?.kind === 'workbench') included = projects.filter(p => p.workbenchId === selected.id);
  if (selected?.kind === 'project') included = projects.filter(p => p.id === selected.id);
  if (selected?.kind === 'expert') {
    const detail = details[selected.key];
    usage = selected.usage; daily = detail?.usage?.daily || [];
    tasks = detail?.tasks || []; // Actual participation only; the configured roster is never counted.
  } else if (selected?.kind === 'task') {
    usage = selected.usage; tasks = allTasks.filter(t => t.id === selected.id);
  } else {
    usage = sumUsage(included.map(p => p.stats)); daily = dailyUsage(included.map(p => p.usage));
    const ids = new Set(included.map(p => p.id)); tasks = allTasks.filter(t => ids.has(t.projectId));
  }
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const dailyAvailable = selected?.kind === 'task' ? false : selected?.kind === 'expert' ? Array.isArray(details[selected.key]?.usage?.daily) && !details[selected.key]?.usage?.unavailable : included.every(p => Array.isArray(p.usage?.daily) && !p.usage?.unavailable) && !usage?.unavailable;
  const todayUsage = daily.find(day => day.date === today) || (usage?.unavailable ? { unavailable: true } : !dailyAvailable ? unknownUsage : { totalTokens: 0 });
  const ranks = (['expert', 'project', 'task'].includes(selected?.kind) ? tasks.map(t => ({ ...t, label: t.title, usage: t.usage || (t.totalTokens !== undefined ? t : unknownUsage), key: nodeKey('task', t.id) })) : selected ? included.map(p => ({ ...p, label: p.name, usage: p.stats, key: nodeKey('project', p.id) })) : workbenches.map(w => ({ ...w, label: w.name, usage: w.taskStats, key: nodeKey('workbench', w.id) })))
    .filter(row => !row.usage?.unavailable && row.usage?.totalTokens != null).sort((a, b) => b.usage.totalTokens - a.usage.totalTokens).slice(0, 5);
  const states = selected?.kind === 'expert' && Array.isArray(details[selected.key]?.usage?.taskStates) ? details[selected.key].usage.taskStates : tasks;
  return { usage, daily, dailyAvailable, todayUsage, ranks, tasks, workbenchCount: workbenches.length, projectCount: projects.length, expertCount: experts.length, taskCount: allTasks.length,
    active: states.filter(t => runningStates.has(t.status)).length, failed: states.filter(t => t.status === 'failed').length, waiting: states.filter(t => t.status === 'waiting_input').length, interrupted: states.filter(t => t.status === 'interrupted').length,
    issues: tasks.filter(t => ['failed', 'waiting_input', 'interrupted', 'unavailable'].includes(t.status)), partial: selected?.kind === 'expert' && !!(!details[selected.key] || details[selected.key].hasMore || details[selected.key].pagesStale) };
}

/** Stable spatial groups; the renderer preserves its camera across data refreshes. */
export function graphPositions(graph) {
  const positions = new Map(), groups = graph.nodes.filter(n => n.kind === 'workbench').sort((a, b) => a.id.localeCompare(b.id));
  const put = (key, x, y, z) => positions.set(key, { x, y, z });
  groups.forEach((w, i) => {
    const angle = i * 2 * Math.PI / Math.max(groups.length, 1), radius = groups.length === 1 ? 0 : 150 + groups.length * 12;
    put(w.key, Math.cos(angle) * radius, 35, Math.sin(angle) * radius);
    graph.nodes.filter(n => n.kind === 'project' && n.workbenchId === w.id).sort((a, b) => a.id.localeCompare(b.id)).forEach((p, j, rows) => {
      const a = angle + (j - (rows.length - 1) / 2) * .9, center = positions.get(w.key), r = 90 + j % 2 * 24;
      put(p.key, center.x + Math.cos(a) * r, -35 - j % 3 * 20, center.z + Math.sin(a) * r);
      graph.nodes.filter(n => n.kind === 'task' && n.projectId === p.id).sort((a, b) => a.id.localeCompare(b.id)).forEach((t, k) => { const b = k * 2.39996, d = 38 + Math.sqrt(k) * 11; const c = positions.get(p.key); put(t.key, c.x + Math.cos(b) * d, c.y - 62 - k % 4 * 8, c.z + Math.sin(b) * d); });
    });
  });
  graph.nodes.filter(n => n.kind === 'expert').sort((a, b) => a.id.localeCompare(b.id)).forEach((e, i, rows) => { const a = i * 2 * Math.PI / Math.max(rows.length, 1); put(e.key, Math.cos(a) * (100 + groups.length * 24), 125 + i % 3 * 22, Math.sin(a) * (100 + groups.length * 24)); });
  graph.nodes.forEach((n, i) => { if (!positions.has(n.key)) put(n.key, Math.cos(i) * 80, 0, Math.sin(i) * 80); });
  return positions;
}
