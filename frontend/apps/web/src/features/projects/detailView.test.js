// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const service = vi.hoisted(() => ({ mount: vi.fn(), cleanup: vi.fn() }));
vi.mock('../services/ProjectPublishedServices.jsx', () => ({ mountProjectPublishedServices: service.mount }));
vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: () => ({ version: 1 }) } }));
vi.mock('../../shared/configSelect.jsx', () => ({ mountConfigSelect: vi.fn() }));
vi.mock('../runtime/RuntimeEditor.jsx', () => ({ mountRuntimeEditor: vi.fn() }));
vi.mock('../knowledge/views.js', () => ({ renderKnowledgeScope: vi.fn() }));
vi.mock('../memory/views.js', () => ({ renderMemoryScope: vi.fn() }));
vi.mock('../databases/databaseMount.js', () => ({ mountDatabaseScope: vi.fn() }));
vi.mock('../tasks/editor.js', () => ({ editTask: vi.fn() }));
vi.mock('./editor.js', () => ({ editProject: vi.fn() }));
let host;
beforeEach(async () => {
  vi.resetModules(); service.mount.mockReset(); service.cleanup.mockReset(); service.mount.mockReturnValue(service.cleanup);
  document.body.innerHTML = '<div id="topbar-title"></div><div id="topbar-crumb"></div><div id="topbar-tabs"></div><div id="page"></div>';
  host = document.getElementById('page'); location.hash = '#/project/p'; window.Views = {};
  vi.stubGlobal('ICON', () => ''); vi.stubGlobal('UI', { skeleton: () => '' });
  vi.stubGlobal('API', { fetchProjectDetail: vi.fn(async () => ({ data: {
    project: { id: 'p', name: '项目', workbenchId: 'wb', workbenchName: '工作台', status: 'active' }, sessions: [], files: [],
    workbenchVersion: { version: 2, snapshot: { config: {} } },
  } })) });
  await import('./detailView.js');
});
afterEach(() => { host.viewCleanup?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it('mounts published services between business configuration and recent tasks with current scope', async () => {
  await window.Views.project.render(host, 'p');
  const section = host.querySelector('[data-project-services]');
  expect(section.previousElementSibling.textContent).toContain('业务配置');
  expect(section.nextElementSibling.textContent).toContain('暂无任务');
  expect(service.mount).toHaveBeenCalledWith(section, { workbenchId: 'wb', projectId: 'p' });
});
it('unmounts overview service reads when opening another project tab', async () => {
  await window.Views.project.render(host, 'p');
  await window.Views.project.render(host, 'p', { tab: 'sessions' });
  expect(service.cleanup).toHaveBeenCalledTimes(1); expect(service.mount).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-project-services]')).toBeNull();
});
it('never mounts services after a stale project detail response', async () => {
  let resolve; API.fetchProjectDetail.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const pending = window.Views.project.render(host, 'p'); location.hash = '#/projects';
  resolve({ data: {} }); await pending;
  expect(service.mount).not.toHaveBeenCalled();
});
