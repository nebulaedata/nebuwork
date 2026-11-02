import { describe, expect, it } from 'vitest';
import { accountTasks, buildSystemGraph, displayGraph, factsFromEvents, graphPositions, questionFocus, structuredValues, systemStatistics } from './systemModel.js';
const usage = totalTokens => ({ totalTokens, inputTokens: totalTokens, outputTokens: 0, callCount: 1, usageKnown: true });
const fixture = () => ({
  workbenches: [{ id: 'w', name: '工作台', activeVersionId: 'v2', taskStats: usage(100) }],
  projects: [{ id: 'p', name: '固定项目', workbenchId: 'w', ontologyVersion: 1, agents: [{ id: 'old', name: '原专家' }], stats: usage(100), usage: { ...usage(100), daily: [] }, sessions: [{ id: 't', title: '实际任务', status: 'completed', usage: usage(100) }] }],
  experts: [{ id: 'new', name: '新专家', stats: usage(900) }, { id: 'old', name: '原专家', stats: usage(100) }],
  versions: { v2: { version: 2, snapshot: { agents: [{ id: 'new', name: '新专家' }] } } }
});
const event = (sequence, type, payload = {}, runId = 'r') => ({ sessionId: 's', sequence, type, payload, runId });
describe('authorized system relationship projection', () => {
  it('keeps published bindings separate from pinned project experts, without inventing execution', () => {
    const graph = buildSystemGraph(fixture());
    expect(graph.edges.find(e => e.source === 'workbench:w' && e.target === 'expert:new')).toMatchObject({ configured: true });
    expect(graph.edges.find(e => e.source === 'project:p' && e.target === 'expert:old')).toMatchObject({ configured: true });
    expect(graph.edges.filter(e => e.source === 'task:t')).toEqual([]);
    expect(graph.nodes.some(n => n.kind === 'memory')).toBe(false);
  });
  it('requires actual run-start/delegation evidence and deduplicates repeated run attribution', () => {
    const data = fixture(), state = factsFromEvents([event(1, 'run.started'), event(2, 'expert.delegated', { expertId: 'new', name: '新专家', runId: 'child' })], 's');
    data.details = { t: { session: { id: 's' }, runs: [{ id: 'r', manifest: { primaryExpertId: 'old', experts: [{ id: 'old', name: '原专家' }] }, children: [{ id: 'child', expertId: 'new', status: 'completed' }] }, { id: 'queued', status: 'queued', manifest: { primaryExpertId: 'unused', experts: [{ id: 'unused' }] } }], state } };
    const graph = buildSystemGraph(data);
    expect(graph.edges.filter(e => e.source === 'task:t').map(e => [e.target, e.label])).toEqual([['expert:old', '主专家执行'], ['expert:new', '委派参与']]);
    expect(graph.nodes.some(n => n.id === 'unused')).toBe(false);
  });
  it('does not link a failed dispatch or assistant-mentioned task, but links persisted successful creates', () => {
    const data = fixture(); data.projects[0].sessions.push({ id: 'child', title: '子任务' });
    const state = factsFromEvents([event(1, 'tool.started', { toolCallId: 'call', name: 'mcp__nebuwork__nw_task_create', arguments: { projectId: 'p' } }), event(2, 'tool.completed', { toolCallId: 'call', result: { content: [{ text: JSON.stringify({ data: { task: { id: 'child' } } }) }] } }), event(3, 'message.completed', { messageId: 'm', role: 'assistant', content: '已派发 task:fake' })], 's');
    data.details = { t: { state } };
    expect(buildSystemGraph(data).edges.filter(e => e.label === '派发任务')).toHaveLength(1);
    state.turns[0].tools.call.status = 'failed';
    expect(buildSystemGraph(data).edges.filter(e => e.label === '派发任务')).toEqual([]);
  });
  it('shows no synthetic graph data for an empty account', () => expect(buildSystemGraph({})).toEqual({ nodes: [], edges: [] }));
  it('uses stable positions across metadata refreshes', () => {
    const graph = buildSystemGraph(fixture()), first = graphPositions(graph);
    expect(graphPositions({ nodes: [...graph.nodes].reverse() }).get('workbench:w')).toEqual(first.get('workbench:w'));
    expect(first.get('project:p')).not.toEqual(first.get('workbench:w'));
  });
});
describe('persisted query focus', () => {
  it('prefers concrete successful queries over broad catalogs and never parses prose', () => {
    const graph = buildSystemGraph(fixture()), turns = [{ id: 'r', tools: {
      list: { name: 'mcp__nebuwork__nw_expert_list', status: 'completed', result: { data: { items: [{ id: 'new' }] } } },
      get: { name: 'mcp__nebuwork__nw_project_get', status: 'completed', arguments: { id: 'p' }, result: { content: [{ text: '{"data":{"id":"p"}}' }] } },
      bad: { name: 'mcp__nebuwork__nw_task_get', status: 'failed', arguments: { id: 't' }, result: { data: { id: 't' } } }
    }, messages: { a: { content: '关联专家 new' } } }];
    expect(questionFocus(turns, graph)).toEqual({ runId: 'r', keys: ['project:p'], failed: true });
  });
  it('clears previous question focus for a new general-answer round', () => {
    expect(questionFocus([{ id: 'new', tools: {}, messages: { m: { content: '{"id":"p"}' } } }], buildSystemGraph(fixture())).keys).toEqual([]);
    expect(structuredValues('这个项目是 p')).toEqual([]);
    expect(structuredValues({ isError: true, data: { id: 'p' } })).toEqual([]);
  });
  it('ignores transport identity and usage authorization task IDs when focusing the user subject', () => {
    const graph = buildSystemGraph(fixture());
    const turns = [{id:'r',tools:{identity:{name:'mcp__nebuwork__nw_identity_get',status:'completed',result:{data:{taskId:'t',projectId:'p'}}},usage:{name:'mcp__nebuwork__nw_usage_get',status:'completed',arguments:{kind:'workbench',id:'w',taskId:'t'},result:{data:{totalTokens:100}}}}}];
    expect(questionFocus(turns,graph).keys).toEqual(['workbench:w']);
  });
  it('reassembles only contiguous completed resource chunks before extracting real object identities', () => {
    const text='{"items":[{"id":"p"}]}', first=text.slice(0,10), second=text.slice(10);
    const tools={a:{name:'nw_resource_read',status:'completed',arguments:{uri:'nebuwork://resource/x'},result:{data:{encoding:'utf8',offset:0,text:first,nextOffset:10}}},b:{name:'nw_resource_read',status:'completed',arguments:{uri:'nebuwork://resource/x'},result:{data:{encoding:'utf8',offset:10,text:second,nextOffset:null}}}};
    expect(questionFocus([{id:'r',tools}],buildSystemGraph(fixture())).keys).toEqual(['project:p']);
    tools.b.result.data.offset=11;expect(questionFocus([{id:'r',tools}],buildSystemGraph(fixture())).keys).toEqual([]);
  });
  it('replays split start/completion events with their original arguments', () => {
    const state = factsFromEvents([event(2, 'tool.completed', { toolCallId: 'x', name: 'nw_usage_get', result: { data: usage(100) } }), event(1, 'tool.started', { toolCallId: 'x', name: 'nw_usage_get', arguments: { kind: 'project', id: 'p' } }), event(2, 'tool.completed', { toolCallId: 'x', name: 'nw_usage_get', result: { data: usage(100) } })], 's');
    expect(questionFocus(state.turns, buildSystemGraph(fixture())).keys).toEqual(['project:p']);
  });
});
describe('bounded rendering and complete statistics', () => {
  it('expands fifty tasks per project, caps only rendered tasks, and includes explicitly focused old tasks', () => {
    const data = fixture(); data.projects[0].sessions = Array.from({ length: 310 }, (_, i) => ({ id: `t${i}`, title: `任务${i}`, status: i === 309 ? 'failed' : 'completed', usage: usage(1) }));
    const graph = buildSystemGraph(data);
    expect(displayGraph(graph).shownTasks).toBe(0);
    expect(displayGraph(graph, { p: 50 }).shownTasks).toBe(50);
    expect(displayGraph(graph, { p: 350 }).shownTasks).toBe(200);
    expect(displayGraph(graph, {}, ['task:t309']).nodes.some(n => n.id === 't309')).toBe(true);
    expect(systemStatistics(data).taskCount).toBe(310); expect(systemStatistics(data).failed).toBe(1);
  });
  it('keeps account totals independent of expert totals and rendering limits', () => {
    const data = fixture(); const stats = systemStatistics(data);
    expect(stats.usage.totalTokens).toBe(100); expect(stats.ranks[0].usage.totalTokens).toBe(100);
    expect(stats.usage.totalTokens).not.toBe(1100); expect(accountTasks(data.projects)[0].projectId).toBe('p');
  });
  it('distinguishes unknown, zero, unavailable and missing daily data', () => {
    const data = fixture(); data.projects[0].stats = { totalTokens: null, usageKnown: false }; delete data.projects[0].usage;
    expect(systemStatistics(data).usage.totalTokens).toBeNull(); expect(systemStatistics(data).todayUsage.totalTokens).toBeNull();
    data.projects[0].stats = usage(0); expect(systemStatistics(data).usage.totalTokens).toBe(0);
    data.projects[0].stats = { unavailable: true }; expect(systemStatistics(data).usage.unavailable).toBe(true);
  });
  it('never derives expert participation counts from configured project experts', () => {
    const data = fixture(), selected = buildSystemGraph(data).nodes.find(n => n.key === 'expert:old');
    expect(systemStatistics(data, selected).tasks).toEqual([]); expect(systemStatistics(data, selected).partial).toBe(true);
    const stats = systemStatistics(data, selected, { 'expert:old': { tasks: [{ id: 't', status: 'failed' }], hasMore: false, usage: { ...usage(30), daily: [] } } });
    expect(stats.failed).toBe(1); expect(stats.usage.totalTokens).toBe(100); expect(stats.partial).toBe(false);
  });
  it('shows actual expert participation tasks when focusing an expert without treating bindings as executions', () => {
    const data=fixture(); data.details={'expert:new':{tasks:[{id:'t',role:'collaborator',runId:'child'}]}};
    const graph=buildSystemGraph(data), view=displayGraph(graph,{},['expert:new']);
    expect(view.nodes.some(n=>n.key==='task:t')).toBe(true); expect(view.edges.some(e=>e.source==='task:t'&&e.target==='expert:new'&&!e.configured)).toBe(true);
    expect(view.nodes.some(n=>n.key==='workbench:w')).toBe(true);
    delete data.details;expect(buildSystemGraph(data).edges.some(e=>e.source==='task:t'&&e.target==='expert:new')).toBe(false);
  });
});
