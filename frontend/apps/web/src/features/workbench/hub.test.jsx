// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TaskBoard, Commander } from './commander/Commander.jsx';
import { Intelligence, Handoff } from './intelligence/Intelligence.jsx';
vi.mock('../knowledge/KnowledgeControls.jsx', () => ({ KnowledgeSelect: ({ options, onChange, showSearch, optionFilterProp, ...props }) => <select {...props} onChange={e => onChange(e.target.value)}><option value="">请选择</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
vi.mock('../tasks/AgentTask.jsx', () => ({ AgentTask: ({ taskId, draftRequest }) => <div data-conversation={taskId}>{draftRequest?.content}</div>, FilePreview: ({ file, projectId }) => <div data-preview-project={projectId}>{file.name} v{file.version}</div> }));
vi.mock('./commander/MemoryPanel.jsx', () => ({ MemoryPanel: () => <div>记忆</div> }));
vi.mock('./commander/Graph3D.jsx', () => ({ default: () => <div>三维关系画布</div> }));
vi.mock('../knowledge/SourceReader.jsx', () => ({ SourceNavigator: () => <div>原文</div>, knowledgeTransport: () => ({}) }));
let host, root;
const project = { id: 'intel-p', name: '情报分析', workbenchId: 'intel-w' };
const commanderProject = { id: 'cmd-p', name: '指挥中心', workbenchId: 'cmd-w' };
const catalog = { workbenches: [{ id: 'intel-w', name: '情报中心' }, { id: 'cmd-w', name: '指挥官' }], projects: [project, commanderProject] };
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text));
const select = async (label, value) => act(async () => { const el = host.querySelector(`[aria-label="${label}"]`); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); });
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  document.body.innerHTML = '<div id="hub-test"></div>'; host = document.getElementById('hub-test'); root = createRoot(host); localStorage.clear();
  vi.stubGlobal('API', { fetchProjectTasks: vi.fn(async () => ({ data: [] })), fetchTaskHistory: vi.fn(async () => ({ data: { items: [] } })),
    fetchWorkbenches: vi.fn(async () => ({ data: catalog.workbenches })), fetchProjects: vi.fn(async () => ({ data: catalog.projects })), fetchAgents: vi.fn(async () => ({ data: [] })),
    fetchKnowledgeScope: vi.fn(async () => ({ data: { knowledgeBases: [] } })), fetchProjectArtifacts: vi.fn(async () => ({ data: { items: [] } })),
    createTask: vi.fn(async () => ({ data: { task: { id: 'new-t', title: '新任务' } } })), sendTask: vi.fn(async () => ({ data: {} })) });
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('queries task metadata on a visible-only timer, retains successful sources, and never invokes a model', async () => {
  vi.useFakeTimers(); API.fetchProjectTasks.mockImplementation(async id => { if (id === 'cmd-p') throw Error('project unavailable'); return { data: [{ id: 't', title: '实际任务', status: 'waiting_input', usage: { totalTokens: null } }] }; });
  await act(async () => root.render(<TaskBoard projects={catalog.projects} targets={new Set(['t'])}/>));
  expect(host.textContent).toContain('实际任务'); expect(host.textContent).toContain('等待你的补充'); expect(host.textContent).toContain('用量未知'); expect(host.textContent).toContain('project unavailable');
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  const calls = API.fetchProjectTasks.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(30000); }); expect(API.fetchProjectTasks).toHaveBeenCalledTimes(calls);
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await act(async () => document.dispatchEvent(new Event('visibilitychange'))); expect(API.fetchProjectTasks.mock.calls.length).toBe(calls + 2);
  expect(API.createTask).not.toHaveBeenCalled(); expect(API.sendTask).not.toHaveBeenCalled();
  await act(async () => root.unmount()); root = createRoot(host);
  await vi.advanceTimersByTimeAsync(10000); expect(API.fetchProjectTasks.mock.calls.length).toBe(calls + 2);
});
it('creates a title-only commander session once even on a double click', async () => {
  let done; API.createTask.mockImplementation(() => new Promise(resolve => { done = resolve; }));
  const choose = vi.fn();
  await act(async () => root.render(<Commander project={commanderProject} workbench={catalog.workbenches[1]} catalog={catalog} preference={{}} choose={choose}/>));
  await act(async () => { button('新建会话').click(); button('新建会话').click(); });
  expect(API.createTask).toHaveBeenCalledTimes(1); expect(API.createTask.mock.calls[0][1]).toEqual({ title: '指挥官问答', context: { entry: 'commander' } });
  await act(async () => done({ data: { task: { id: 'created', title: '主会话' } } }));
  expect(choose).toHaveBeenCalledWith({ taskId: 'created' }); expect(API.sendTask).not.toHaveBeenCalled();
});
it('restores a newly created conversation missing from the older parent catalog without selecting another task', async () => {
  API.fetchProjectTasks.mockResolvedValue({ data: [{ id: 'recent', title: '刚创建的问答', projectId: commanderProject.id, context: { entry: 'commander' } }] });
  API.fetchTask=vi.fn(async()=>({data:{task:{id:'recent'},session:{id:'s'},runs:[],events:[]}}));
  const choose=vi.fn(), stale={...catalog,projects:[project,{...commanderProject,sessions:[]}]};
  await act(async()=>root.render(<Commander project={commanderProject} workbench={catalog.workbenches[1]} catalog={stale} preference={{taskId:'recent'}} choose={choose}/>));
  expect(API.fetchProjectTasks).toHaveBeenCalledWith(commanderProject.id,expect.any(AbortSignal));
  expect(choose).not.toHaveBeenCalled();expect(host.querySelector('[data-conversation="recent"]')).toBeTruthy();
});
it('browses cross-project versioned artifacts and creates exactly one analysis run without fileRefs', async () => {
  API.fetchProjectArtifacts.mockResolvedValue({ data: { items: [{ id: 'f', name: 'facts.md', version: 2, taskId: 'source-task' }] } });
  await act(async () => root.render(<Intelligence project={project} catalog={catalog} account="a" preference={{}} choose={vi.fn()}/>));
  await select('来源项目', 'cmd-p');
  expect(API.createTask).not.toHaveBeenCalled();
  await act(async () => { const checkbox = host.querySelector('[aria-label="选择facts.md"]'); checkbox.click(); });
  await act(async () => button('分析所选资料').click());
  expect(API.createTask).toHaveBeenCalledTimes(1); expect(API.sendTask).not.toHaveBeenCalled();
  const [p, body] = API.createTask.mock.calls[0]; expect(p).toBe('intel-p'); expect(body.fileRefs).toBeUndefined();
  expect(body.context.sourceRefs).toEqual([{ kind: 'artifact', projectId: 'cmd-p', id: 'f', version: 2, name: 'facts.md' }]);
  expect(host.querySelector('[data-conversation="new-t"]')).toBeTruthy();
});
it('retries an uncertain handoff with the original task and send key', async () => {
  API.sendTask.mockRejectedValueOnce(Error('响应丢失')).mockResolvedValue({ data: {} });
  savePreferenceForTest();
  await act(async () => root.render(<Handoff catalog={catalog} account="a" selected={[]} analysisProject={project.id} defaultGoal="核验结果" close={vi.fn()}/>));
  await act(async () => button('确认转交').click());
  expect(host.textContent).toContain('响应丢失');
  await act(async () => button('确认转交').click());
  expect(API.createTask).toHaveBeenCalledTimes(1); expect(API.sendTask).toHaveBeenCalledTimes(2);
  expect(API.sendTask.mock.calls[0]).toEqual(API.sendTask.mock.calls[1]);
  expect(JSON.parse(localStorage.getItem('nw-hub:a:commander')).taskId).toBe('new-t');
});
it('loads real task results by session provenance without showing an empty result while loading', async () => {
  API.fetchProjectTasks.mockResolvedValue({ data: [{ id: 't', title: '业务任务', status: 'completed' }] });
  let done;
  API.fetchTask=vi.fn(() => new Promise(resolve => { done=resolve; }));
  API.fetchProjectArtifacts.mockResolvedValue({ data: { items: [{ id: 'f', name: '真实成果.json', version: 2, sessionId: 's' }, { id: 'foreign', name: '其他任务.json', version: 1, sessionId: 'other' }] } });
  await act(async () => root.render(<TaskBoard projects={[project]} targets={new Set()}/>));
  await act(async () => button('业务任务').click());
  expect(host.textContent).toContain('正在读取任务成果'); expect(host.textContent).not.toContain('暂无已提交成果');
  await act(async () => done({ data: { task: { id: 't' }, session: { id: 's' }, runs: [] } }));
  expect(host.textContent).toContain('真实成果.json'); expect(host.textContent).not.toContain('其他任务.json');
});
function savePreferenceForTest() { localStorage.setItem('nw-hub:a:commander', JSON.stringify({ workbenchId: 'cmd-w', projectId: 'cmd-p' })); }
