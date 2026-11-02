// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readQueue, useSystemOverview } from './useSystemOverview.js';
import { SystemGraph } from './SystemGraph.jsx';
import { buildSystemGraph } from './systemModel.js';
vi.mock('../../knowledge/KnowledgeControls.jsx', () => ({ KnowledgeSelect: ({ options, onChange, showSearch, optionFilterProp, ...props }) => <select {...props} onChange={e => onChange(e.target.value)}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
vi.mock('./Graph3D.jsx', () => ({ default: ({ onUnavailable }) => <button onClick={() => onUnavailable('三维不可用，已切换列表。')}>模拟显示不可用</button> }));
let root, host, observed;
const catalog = { workbenches: [{ id: 'w', name: '真实工作台' }], projects: [{ id: 'p', name: '真实项目', workbenchId: 'w', stats: { totalTokens: 8 }, usage: { daily: [] }, sessions: [{ id: 't', title: '真实任务', status: 'failed' }] }] };
function Probe() { observed = useSystemOverview(catalog); return <p>{observed.data.projects.map(p => p.name).join(',')} {Object.values(observed.errors).join(',')}</p>; }
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.body.innerHTML = '<div id="overview-test"></div>'; host = document.getElementById('overview-test'); root = createRoot(host);
  vi.stubGlobal('API', { fetchWorkbenches: vi.fn(async () => ({ data: catalog.workbenches })), fetchProjects: vi.fn(async () => ({ data: catalog.projects })), fetchAgents: vi.fn(async () => ({ data: [] })), createTask: vi.fn(), sendTask: vi.fn() });
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); });
it('polls the shared account projection only while visible, preserves a failed source, and removes revoked data', async () => {
  vi.useFakeTimers(); await act(async () => root.render(<Probe/>));
  expect(API.fetchProjects).toHaveBeenCalledTimes(1); expect(API.createTask).not.toHaveBeenCalled();
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(API.fetchProjects).toHaveBeenCalledTimes(1);
  API.fetchProjects.mockRejectedValueOnce(Error('暂时断线'));
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(host.textContent).toContain('真实项目'); expect(host.textContent).toContain('暂时断线');
  API.fetchProjects.mockRejectedValueOnce(Object.assign(Error('权限已撤销'), { status: 403 }));
  await act(async () => vi.advanceTimersByTimeAsync(10000)); expect(host.textContent).not.toContain('真实项目'); expect(observed.data.loaded.projects).toBe(false);
  const reads = API.fetchProjects.mock.calls.length;
  await act(async () => root.unmount()); root = createRoot(host); await act(async () => vi.advanceTimersByTimeAsync(30000)); expect(API.fetchProjects).toHaveBeenCalledTimes(reads); expect(API.sendTask).not.toHaveBeenCalled();
});
it('ignores a late response after navigating away', async () => {
  let resolve; API.fetchProjects.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => root.render(<Probe/>)); await act(async () => root.unmount()); root = createRoot(host);
  await act(async () => resolve({ data: [{ ...catalog.projects[0], name: '迟到的私有内容' }] })); expect(host.textContent).not.toContain('迟到的私有内容');
});
it('owns immutable catalog snapshots even when legacy API caches replace project rows', async () => {
  const sharedProjects = structuredClone(catalog.projects), sharedWorkbenches = structuredClone(catalog.workbenches);
  API.fetchProjects.mockResolvedValue({ data: sharedProjects }); API.fetchWorkbenches.mockResolvedValue({ data: sharedWorkbenches });
  await act(async () => root.render(<Probe/>));
  sharedProjects[0] = { id: 'p', name: '详情缓存覆盖', workbenchId: 'w' }; sharedWorkbenches[0].name = '其他读取修改的缓存';
  expect(observed.data.projects[0].sessions).toHaveLength(1); expect(observed.data.workbenches[0].name).toBe('真实工作台');
});
it('loads run/history provenance once, deduplicates concurrent reads, and follows history cursors', async () => {
  const projection = { task: { id: 't' }, session: { id: 's' }, runs: [{ id: 'r' }], events: [] };
  API.fetchTask = vi.fn(async () => ({ data: projection })); API.fetchAgentRun = vi.fn(async () => ({ data: { id: 'r', manifest: { primaryExpertId: 'e' } } }));
  API.fetchTaskHistory = vi.fn(async (id, cursor) => ({ data: cursor ? { items: [{ sequence: 2, sessionId: 's', runId: 'r', type: 'run.completed', payload: {} }], hasMore: false } : { items: [{ sequence: 1, sessionId: 's', runId: 'r', type: 'run.started', payload: {} }], hasMore: true } }));
  await act(async () => root.render(<Probe/>));
  await act(async () => { await Promise.all([observed.loadTask({ id: 't' }), observed.loadTask({ id: 't' })]); });
  expect(API.fetchTask).toHaveBeenCalledTimes(1); expect(API.fetchTaskHistory.mock.calls.map(c => c[1])).toEqual([0, 1]); expect(observed.details.t.state.turns[0].status).toBe('completed');
  await act(async () => observed.loadTask({ id: 't' })); expect(API.fetchTask).toHaveBeenCalledTimes(1);
});
it('bounds concurrent detail requests at four and rejects pending work when closed', async () => {
  const queue = readQueue(4), releases = []; let running = 0, peak = 0;
  const jobs = Array.from({ length: 8 }, () => queue.run(async () => { running++; peak = Math.max(peak, running); await new Promise(resolve => releases.push(resolve)); running--; }));
  await Promise.resolve(); expect(peak).toBe(4); releases.splice(0).forEach(done => done()); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  queue.close(); releases.splice(0).forEach(done => done()); await Promise.allSettled(jobs); expect(peak).toBeLessThanOrEqual(4);
});
it('falls back to the same real object list and drafts questions without submitting a model call', async () => {
  const graph = buildSystemGraph({ ...catalog, experts: [] }), onSelect = vi.fn(), onAsk = vi.fn();
  const props = { graph, question: { runId: '', keys: [], failed: false }, selectedKey: '', onSelect, onAsk, onStatistics: vi.fn(), onTaskDetail: vi.fn(), details: {}, loadTask: vi.fn(), errors: {} };
  await act(async () => root.render(<SystemGraph {...props}/>));
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '模拟显示不可用').click());
  expect(host.textContent).toContain('三维不可用'); expect(host.querySelector('[aria-label="系统对象列表"]').textContent).toContain('真实工作台');
  await act(async () => root.render(<SystemGraph {...props} selectedKey="project:p"/>));
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.includes('询问此对象')).click());
  expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('ID：p')); expect(API.sendTask).not.toHaveBeenCalled(); expect(API.createTask).not.toHaveBeenCalled();
});
