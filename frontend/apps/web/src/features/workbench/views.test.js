import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: () => ({ version: 1 }), subscribe: () => () => {} } }));
vi.mock('../runtime/RuntimeEditor.jsx',()=>({mountRuntimeEditor:()=>()=>{}}));
vi.mock('../../shared/configSelect.jsx', () => ({ mountConfigSelect: vi.fn() }));
vi.mock('../services/ProjectPublishedServices.jsx', () => ({ mountProjectPublishedServices: el => { el.textContent = '已发布服务'; return () => {}; } }));
vi.mock('./WorkbenchHub.jsx', () => ({ mountWorkbenchHub: (el, role) => { el.innerHTML = `<div data-hub="${role}">真实工作台入口</div>`; } }));
let dom, el, api;
beforeEach(async () => {
  vi.resetModules();
  dom = new JSDOM('<div id="topbar-title"></div><div id="topbar-crumb"></div><div id="topbar-tabs"></div><div id="page"></div>', { url: 'http://localhost/#/workbench?tab=pro' });
  vi.stubGlobal('window',dom.window); vi.stubGlobal('document',dom.window.document); vi.stubGlobal('location',dom.window.location);
  vi.stubGlobal('MutationObserver',dom.window.MutationObserver);
  vi.stubGlobal('ICON',() => ''); vi.stubGlobal('UI',{ skeleton: () => '', toast: vi.fn() });
  api = { fetchWorkbenches: vi.fn(async () => ({ data: [] })), fetchProjects: vi.fn(async () => ({ data: [] })), fetchProjectDetail: vi.fn() };
  vi.stubGlobal('API',api); el = document.getElementById('page');
  await import('./view.js'); await import('../projects/detailView.js');
});
afterEach(() => { el.viewCleanup?.(); dom.window.close(); vi.unstubAllGlobals(); });

describe('workbench page integration and empty execution data', () => {
  it('loads the professional list independently, offers retry, and has no mock fallback', async () => {
    api.fetchWorkbenches.mockRejectedValueOnce(new Error('工作台服务暂不可用'));
    await window.Views.workbench.render(el,null,{ tab: 'pro' });
    expect(el.textContent).toContain('工作台服务暂不可用'); expect(api.fetchProjects).not.toHaveBeenCalled();
    expect(el.textContent).not.toContain('文件审查工作台');
    el.querySelector('[data-retry]').click();
    await vi.waitFor(() => expect(el.textContent).toContain('定制新工作台'));
    expect(api.fetchProjects).not.toHaveBeenCalled();
  });
  it('uses real empty counts and mounts the two existing hub entries', async () => {
    await window.Views.workbench.render(el,null,{ tab: 'home' });
    expect(el.textContent).toContain('尚未创建工作台'); expect(el.textContent).not.toMatch(/NaN|Infinity|1\.2M/);
    await window.Views.workbench.render(el,null,{ tab: 'stats' }); expect(el.textContent).toContain('暂无项目');
    api.fetchWorkbenches.mockClear(); api.fetchProjects.mockClear();
    await window.Views.workbench.render(el,null,{ tab: 'commander' }); expect(el.querySelector('[data-hub="commander"]')).toBeTruthy();
    await window.Views.workbench.render(el,null,{ tab: 'intel' }); expect(el.querySelector('[data-hub="intel"]')).toBeTruthy();
    expect(api.fetchWorkbenches).not.toHaveBeenCalled(); expect(api.fetchProjects).not.toHaveBeenCalled();
  });
  it('opens a business project directly and enables new-engine tasks', async () => {
    location.hash = '#/project/p';
    api.fetchProjectDetail.mockResolvedValue({ data: {
      project: { id: 'p', name: '真实项目', workbenchId: 'w', workbenchName: '工作台', ontologyVersion: 2, revision: 1, status: 'active' },
      sessions: [], files: [], workbenchVersion: { version: 2, snapshot: { config: { bizName: '业务', domain: '领域', entities: [], relations: [] }, agents: [], templates: [] } },
    } });
    await window.Views.project.render(el,'p',{});
    expect(el.textContent).toContain('真实项目'); expect(el.textContent).toContain('业务配置 v2');
    expect(el.querySelector('[data-project-services]').textContent).toBe('已发布服务');
    expect(el.querySelector('[data-new]').disabled).toBe(false);
    await window.Views.project.render(el,'p',{ tab: 'files' }); expect(el.textContent).toContain('暂无成果文件');
    expect(el.querySelector('input[type=file]')).not.toBeNull();
    expect(api.fetchWorkbenches).not.toHaveBeenCalled();
  });
  it('never paints a late response over a different page', async () => {
    let resolve; api.fetchWorkbenches.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = window.Views.workbench.render(el,null,{ tab: 'pro' });
    location.hash = '#/projects'; el.textContent = '另一页面';
    resolve({ data: [{ id: 'late', name: '旧数据', projectIds: [], icon: 'package', color: '#123456' }] }); await pending;
    expect(el.textContent).toBe('另一页面');
  });
});
