// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ProjectPublishedServices } from './ProjectPublishedServices.jsx';
const auth = vi.hoisted(() => ({ version: 1, listeners: new Set() }));
vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: () => ({ version: auth.version }), subscribe: fn => { auth.listeners.add(fn); return () => auth.listeners.delete(fn); } } }));
let host, root;
const service = { enabled: true, available: true, activeReleaseId: 'r2', draft: { name: '未发布草稿' } };
const releases = [{ id: 'r3', definition: { name: '历史版本' } }, { id: 'r2', version: 2, createdAt: '2026-10-21T01:00:00Z', definition: {
  name: '法律咨询服务', pages: [{ key: 'report', name: '法律法规看板', capabilities: [], projectIds: ['p1'] }],
  capabilities: [{ key: 'search', name: '法规查询', description: '检索当前项目法规', channels: { api: true, mcp: true }, projectIds: ['p1'] }, { key: 'private', name: '其他项目能力', channels: { api: true }, projectIds: ['p2'] }],
} }];
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; auth.version = 1; auth.listeners.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('API', { fetchWorkbenchService: vi.fn(async () => ({ data: structuredClone(service) })), fetchServiceReleases: vi.fn(async () => ({ data: structuredClone(releases) })), serviceUrl: (wb, suffix) => '/nebulaedev/nwaa/api/workbench-services/' + wb + '/' + suffix });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(projectId = 'p1') { await act(async () => root.render(<ProjectPublishedServices projectId={projectId} workbenchId="wb"/>)); }
async function click(name) { await act(async () => [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name || b.textContent === name).click()); }
it('renders project HTML, API documentation and one MCP connection with real scoped tools', async () => {
  await render();
  expect(host.textContent).toContain('法律法规看板'); expect(host.textContent).toContain('法规查询');
  expect(host.textContent).not.toMatch(/未发布草稿|历史版本|其他项目能力/);
  const page = [...host.querySelectorAll('a')].find(a => a.textContent.startsWith('打开页面'));
  expect(new URL(page.href).searchParams.get('projectId')).toBe('p1'); expect(page.target).toBe('_blank');
  const docs = [...host.querySelectorAll('a')].find(a => a.textContent.startsWith('查看文档'));
  expect(new URL(docs.href).searchParams.get('releaseId')).toBe('r2');
  expect(host.querySelectorAll('.project-service-tools li')).toHaveLength(1);
  expect([...host.querySelectorAll('a')].some(a => a.href.endsWith('/mcp'))).toBe(false);
  await click('复制MCP 连接地址');
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/nebulaedev/nwaa/api/workbench-services/wb/mcp'));
  expect(host.querySelector('[role=status]').textContent).toContain('已复制');
});
it('refreshes active publication and removes stale links on failure, then supports retry', async () => {
  await render(); API.fetchWorkbenchService.mockRejectedValueOnce(new Error('访问已撤销'));
  await click('刷新已发布服务'); expect(host.querySelector('[role=alert]').textContent).toContain('访问已撤销');
  expect(host.querySelector('.project-services-grid')).toBeNull();
  await click('重新加载'); expect(host.textContent).toContain('法律法规看板');
});
it('shows disabled, runtime-off and empty states without usable runtime links', async () => {
  API.fetchWorkbenchService.mockResolvedValueOnce({ data: { ...service, enabled: false } }); await render();
  expect(host.textContent).toContain('服务已停用'); expect(host.querySelector('.project-services-grid')).toBeNull();
  API.fetchWorkbenchService.mockResolvedValueOnce({ data: { ...service, available: false } }); await click('刷新已发布服务');
  expect(host.textContent).toContain('运行功能未启用'); expect([...host.querySelectorAll('a')].some(a => a.target === '_blank')).toBe(false);
  API.fetchWorkbenchService.mockResolvedValueOnce({ data: { ...service, activeReleaseId: null } }); await click('刷新已发布服务');
  expect(host.textContent).toContain('暂无已发布服务'); expect(host.querySelector('.project-services-grid')).toBeNull();
});
it('clears old project data, aborts replaced reads and ignores late results', async () => {
  let resolve; API.fetchWorkbenchService.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  await render(); const signal = API.fetchWorkbenchService.mock.calls[0][1]; expect(host.textContent).toContain('正在读取');
  await render('p2'); expect(signal.aborted).toBe(true); expect(host.textContent).toContain('其他项目能力'); expect(host.textContent).not.toContain('法律法规看板');
  await act(async () => resolve({ data: service })); expect(host.textContent).not.toContain('法律法规看板');
});
it('clears all service details and aborts reads immediately on account change', async () => {
  await render(); const signal = API.fetchWorkbenchService.mock.calls[0][1];
  await act(async () => { auth.version++; auth.listeners.forEach(fn => fn()); });
  expect(signal.aborted).toBe(true); expect(host.textContent).toContain('登录状态已变化'); expect(host.textContent).not.toContain('法律法规看板');
  expect(API.fetchWorkbenchService).toHaveBeenCalledTimes(1); expect(host.querySelectorAll('a')).toHaveLength(0);
});
it('reports clipboard failures and aborts pending reads on unmount', async () => {
  await render(); navigator.clipboard.writeText.mockRejectedValue(new Error('blocked')); await click('复制法规查询地址');
  expect(host.querySelector('[role=alert]').textContent).toContain('手动复制');
  const signal = API.fetchWorkbenchService.mock.calls[0][1]; await act(async () => root.unmount()); expect(signal.aborted).toBe(true);
  root = createRoot(host);
});
