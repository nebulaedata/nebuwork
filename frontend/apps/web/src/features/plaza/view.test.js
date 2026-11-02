import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('./view.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
let dom, api, db, ui, views, el, removeModal;
beforeEach(() => {
  dom = new JSDOM('<div id="topbar-tabs"></div><main></main>', { url: 'http://localhost/#/plaza?tab=agent' });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('location', dom.window.location);
  db = { agents: [], extensions: [], plazaTemplates: [], plazaAgents: [
    { id: 'market', name: '测试专家', role: '方向', tagline: '简介', color: '#6C63F0', hiredAgentId: 'expert', hiredAgentRevision: 7, hiredMembershipRevision: 2 }
  ] };
  api = { fetchAgents: vi.fn(async () => ({ data: [] })), fetchExpertCatalogs: vi.fn(async () => ({ data: {} })),
    hireExpert: vi.fn(async () => { Object.assign(db.plazaAgents[0], { hiredAgentId: 'expert', hiredAgentRevision: 7, hiredMembershipRevision: 4 }); }) };
  ui = { esc: s => String(s ?? ''), skeleton: () => '', toast: vi.fn() };
  views = {}; window.Views = views; el = document.querySelector('main'); removeModal = vi.fn();
  new Function('window', 'Views', 'DB', 'API', 'UI', 'ICON', 'openRemoveExpertModal', source)(window, views, db, api, ui, () => '', removeModal);
});
afterEach(() => { dom.window.close(); vi.unstubAllGlobals(); });
const render = () => views.plaza.render(el, null, { tab: 'agent' });
describe('market expert membership actions', () => {
  it('shows removal beside added experts and re-enables adding after confirmed removal', async () => {
    await render(); expect(el.querySelector('[data-hire]').disabled).toBe(true);
    el.querySelector('[data-remove-market]').click();
    expect(removeModal).toHaveBeenCalledOnce();
    const modal = removeModal.mock.calls[0][0];
    expect(modal.expert).toEqual({ id: 'expert', name: '测试专家', revision: 7, membershipRevision: 2 });
    expect(el.querySelector('[data-hire]').disabled).toBe(true);
    db.plazaAgents[0].hiredAgentId = null; await modal.onRemoved();
    expect(el.querySelector('[data-remove-market]')).toBeNull(); expect(el.querySelector('[data-hire]').disabled).toBe(false);
    el.querySelector('[data-hire]').click();
    await vi.waitFor(() => expect(el.querySelector('[data-remove-market]')).not.toBeNull());
    expect(api.hireExpert).toHaveBeenCalledWith('market'); expect(el.querySelector('[data-hire]').disabled).toBe(true);
  });
  it('shows a retryable load error if the post-removal refresh fails', async () => {
    await render(); el.querySelector('[data-remove-market]').click(); db.plazaAgents[0].hiredAgentId = null;
    api.fetchExpertCatalogs.mockRejectedValueOnce(new Error('市场暂时不可用'));
    await removeModal.mock.calls[0][0].onRemoved();
    expect(el.textContent).toContain('市场暂时不可用'); expect(el.querySelector('[data-hire]')).toBeNull();
    el.querySelector('[data-retry-market]').click();
    await vi.waitFor(() => expect(el.querySelector('[data-hire]')?.disabled).toBe(false));
  });
  it('does not repaint another route when adding finishes late', async () => {
    db.plazaAgents[0].hiredAgentId = null; let resolve;
    api.hireExpert.mockImplementation(() => new Promise(done => { resolve = done; }));
    await render(); el.querySelector('[data-hire]').click();
    location.hash = '#/agents'; el.innerHTML = '新页面'; resolve();
    await Promise.resolve(); await Promise.resolve();
    expect(el.textContent).toBe('新页面'); expect(ui.toast).not.toHaveBeenCalled();
  });
});
