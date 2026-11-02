import { isActive, statuses } from './agentState.js';

/** Names come from the run snapshot; participation comes from actual delegation records. */
export function taskExpertRoster(run, delegations = {}, fallback = []) {
  const experts = new Map();
  const mainIds = new Set((run?.manifest?.instructions || [])
    .filter(item => item.source?.startsWith('expert:')).map(item => item.source.slice(7)));
  if (run?.manifest?.primaryExpertId) mainIds.add(run.manifest.primaryExpertId);
  const configured = run?.manifest ? run.manifest.experts || [] : fallback;
  const add = (id, name) => {
    if (!id) return null;
    if (!experts.has(id)) experts.set(id, { id, name: name || '协作专家', primary: mainIds.has(id), invocations: [] });
    return experts.get(id);
  };
  for (const expert of configured) add(expert.id, expert.name);
  for (const id of mainIds) add(id, fallback.find(expert => expert.id === id)?.name || '任务主专家');
  const children = new Map((run?.children || []).map(child => [child.id, child]));
  const calls = new Map(Object.values(delegations).filter(item => item.parentRunId === run?.id).map(item => [item.runId, item]));
  for (const child of children.values()) {
    const expertId = child.expertId || child.manifest?.primaryExpertId || child.manifest?.instructions?.find(item => item.source?.startsWith('expert:'))?.source.slice(7);
    if (!calls.has(child.id) && expertId) calls.set(child.id, { expertId, runId: child.id });
  }
  for (const call of calls.values()) {
    const expert = add(call.expertId, call.name);
    if (!expert) continue;
    expert.invocations.push({ runId: call.runId, status: children.get(call.runId)?.status, sequence: call.sequence || 0 });
  }
  return [...experts.values()].map(expert => {
    const calls = expert.invocations.sort((a, b) => a.sequence - b.sequence);
    const invocation = [...calls].reverse().find(call => isActive(call.status)) || calls.at(-1);
    return { ...expert, runId: invocation?.runId, status: invocation?.status,
      label: invocation ? statuses[invocation.status] || '已委派' : expert.primary ? '主专家' : run?.manifest ? '可协作' : '待执行' };
  });
}
