import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderMemoryScope } from './views.js';
const auth = vi.hoisted(() => ({ version: 1, listeners: new Set() }));
vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: () => ({ version: auth.version }), subscribe: fn => { auth.listeners.add(fn); return () => auth.listeners.delete(fn); } } }));
vi.mock('../../shared/configSelect.jsx', () => ({ mountConfigSelect: vi.fn() }));
const ok = data => ({ code: 0, data });
const entry = { id: 'entry', title: '<img src=x onerror=alert(1)>', content: 'Fact', kind: 'expert', scopeId: 'expert', revision: 3, state: 'draft', syncState: 'not_required', source: {} };
let dom, host, api, cleanup;
beforeEach(() => {
  auth.version = 1; auth.listeners.clear(); cleanup = null;
  dom = new JSDOM('<main></main><div id="modal-box"></div>', { url: 'http://localhost/#/agent/expert?tab=memory' });
  for (const name of ['window', 'document', 'location', 'MutationObserver']) vi.stubGlobal(name, name === 'window' ? dom.window : dom.window[name]);
  host = document.querySelector('main');
  vi.stubGlobal('UI', { toast: vi.fn(), modal: (_title, html, mount) => {
    cleanup?.(); const box = document.querySelector('#modal-box'); box.innerHTML = `<div class="modal-body">${html}</div>`; mount(box);
  }, setModalCleanup: fn => { cleanup = fn; }, closeModal: () => cleanup?.() });
  api = { fetchMemoryScope: vi.fn().mockResolvedValue(ok({ scope: { readOnly: false }, enabled: false, items: [entry], hasMore: false, nextOffset: 1 })),
    memoryAction: vi.fn(), searchMemory: vi.fn(), fetchMemory: vi.fn() };
});
afterEach(() => { cleanup?.(); host.knowledgeCleanup?.(); dom.window.close(); vi.unstubAllGlobals(); });
describe('shared memory panel', () => {
  it('escapes content, shows drafts distinctly, and submits the observed revision for review', async () => {
    await renderMemoryScope(host, { kind: 'expert', id: 'expert', api });
    expect(host.querySelector('img')).toBeNull(); expect(host.textContent).toContain(entry.title);
    expect(host.textContent).toContain('待审核');
    host.querySelector('[data-approve]').click();
    await vi.waitFor(() => expect(document.querySelector('[data-save]')).not.toBeNull());
    api.memoryAction.mockRejectedValue(new Error('数据已变化，请重新加载后保存'));
    document.querySelector('[data-save]').click();
    await vi.waitFor(() => expect(document.querySelector('#modal-box').textContent).toContain('数据已变化'));
    expect(api.memoryAction.mock.calls[0].slice(0, 3)).toEqual(['entry', 'approve', 3]);
  });
  it('keeps archived scopes read-only and does not claim extraction success from a ready source', async () => {
    api.fetchMemoryScope.mockResolvedValue(ok({ scope: { readOnly: true }, enabled: true, items: [{ ...entry, state: 'active', syncState: 'ready', automatic: true }] }));
    await renderMemoryScope(host, { kind: 'project', id: 'p', api });
    expect(host.querySelector('[data-create]').disabled).toBe(true);
    expect(host.querySelector('[data-edit]')).toBeNull(); expect(host.querySelector('[data-delete]')).toBeNull();
    expect(host.textContent).toContain('来源已处理');
  });
  it('ignores late replies after navigation', async () => {
    let resolve; api.fetchMemoryScope.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = renderMemoryScope(host, { kind: 'task', id: 't', api });
    location.hash = '#/settings'; host.textContent = '另一页面';
    resolve(ok({ scope: {}, enabled: true, items: [entry] })); await pending;
    expect(host.textContent).toBe('另一页面');
  });
  it('keeps the latest search and distinguishes outage from no matching memory', async () => {
    await renderMemoryScope(host, { kind: 'expert', id: 'expert', api });
    let resolve; api.searchMemory.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValueOnce(ok({ status: 'unavailable', results: [] }));
    const submit = value => { host.querySelector('input').value = value; host.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true })); };
    submit('old'); submit('new');
    await vi.waitFor(() => expect(host.textContent).toContain('记忆暂不可用'));
    resolve(ok({ status: 'ready', results: [{ ...entry, entryId: entry.id, text: 'stale fact' }] }));
    await Promise.resolve(); expect(host.textContent).not.toContain('stale fact');
  });
  it('shows cleanup retry for tombstones without offering edit or resurrection', async () => {
    api.fetchMemoryScope.mockResolvedValue(ok({ scope: {}, enabled: true, items: [{ ...entry, state: 'deleted', syncState: 'failed' }] }));
    await renderMemoryScope(host, { kind: 'task', id: 't', api });
    expect(host.querySelector('[data-retry]')).not.toBeNull();
    expect(host.querySelector('[data-edit]')).toBeNull(); expect(host.querySelector('[data-delete]')).toBeNull();
  });
});
