import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderMemorySettings } from './memorySettings.js';
const auth = vi.hoisted(() => ({ version: 1, listeners: new Set() }));
vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: () => ({ version: auth.version }), subscribe: fn => { auth.listeners.add(fn); return () => auth.listeners.delete(fn); } } }));
vi.mock('../../shared/configSelect.jsx', () => ({ mountConfigSelect: vi.fn() }));
const ok = data => ({ code: 0, data });
const config = { canEdit: true, actorId: 'alice', configured: true, enabled: false, revision: 4,
  baseUrl: 'http://192.168.77.152:8888', hasApiKey: true, originLocked: false, recallTimeoutMs: 3000, requestTimeoutMs: 15000, recallMaxTokens: 3000 };
let dom, host, api;
beforeEach(() => {
  auth.version = 1; auth.listeners.clear();
  dom = new JSDOM('<main></main>', { url: 'http://localhost/#/settings?tab=memory-settings' });
  for (const name of ['window', 'document', 'location', 'MutationObserver']) vi.stubGlobal(name, name === 'window' ? dom.window : dom.window[name]);
  host = document.querySelector('main');
  api = { fetchMemorySettings: vi.fn().mockResolvedValue(ok(config)), saveMemorySettings: vi.fn(), testMemorySettings: vi.fn() };
});
afterEach(() => { host.querySelector('.memory-settings')?.knowledgeCleanup?.(); dom.window.close(); vi.unstubAllGlobals(); });
const field = name => host.querySelector(`[name="${name}"]`);
const submit = () => host.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
const edit = (name, value) => { field(name).value = value; field(name).dispatchEvent(new dom.window.Event('input', { bubbles: true })); };

describe('global memory settings', () => {
  it('uses backend permission and exposes no configuration editor for ordinary accounts', async () => {
    api.fetchMemorySettings.mockResolvedValue(ok({ canEdit: false, enabled: true, actorId: '<img src=x>', configured: true }));
    await renderMemorySettings(host, api);
    expect(host.querySelector('form')).toBeNull(); expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('仅指定管理员'); expect(host.textContent).toContain('<img src=x>');
  });
  it('keeps draft and submission key after an uncertain failure, then clears the secret on success', async () => {
    await renderMemorySettings(host, api); expect(field('apiKey').value).toBe('');
    edit('apiKey', 'new-secret'); api.saveMemorySettings.mockRejectedValueOnce(new Error('响应丢失'));
    submit(); await vi.waitFor(() => expect(host.textContent).toContain('响应丢失'));
    const first = api.saveMemorySettings.mock.calls[0]; expect(first[0]).toMatchObject({ revision: 4, apiKey: 'new-secret', clearApiKey: false });
    expect(field('apiKey').value).toBe('new-secret');
    api.saveMemorySettings.mockResolvedValue(ok({ ...config, revision: 5 }));
    submit(); await vi.waitFor(() => expect(host.textContent).toContain('配置已保存'));
    expect(api.saveMemorySettings.mock.calls[1][1]).toBe(first[1]); expect(field('apiKey').value).toBe('');
    expect(dom.window.localStorage.length).toBe(0); expect(dom.window.sessionStorage.length).toBe(0);
  });
  it('uses a new operation identity when the draft changes after a conflict', async () => {
    await renderMemorySettings(host, api); api.saveMemorySettings.mockRejectedValue(new Error('数据已变化，请重新加载后保存'));
    submit(); await vi.waitFor(() => expect(host.textContent).toContain('数据已变化'));
    const first = api.saveMemorySettings.mock.calls[0][1]; edit('recallMaxTokens', '1200');
    submit(); await vi.waitFor(() => expect(api.saveMemorySettings).toHaveBeenCalledTimes(2));
    expect(api.saveMemorySettings.mock.calls[1][1]).not.toBe(first); expect(field('recallMaxTokens').value).toBe('1200');
  });
  it('tests the draft without saving and distinguishes reachability from memory extraction', async () => {
    await renderMemorySettings(host, api); edit('apiKey', 'test-secret');
    api.testMemorySettings.mockResolvedValue(ok({ reachable: true, latencyMs: 25, message: '健康接口可达；未验证提取、召回效果' }));
    host.querySelector('[data-test]').click(); await vi.waitFor(() => expect(host.textContent).toContain('配置尚未保存'));
    expect(api.testMemorySettings.mock.calls[0][0].apiKey).toBe('test-secret'); expect(api.saveMemorySettings).not.toHaveBeenCalled();
    expect(host.textContent).toContain('未验证提取、召回效果');
    edit('baseUrl', 'http://new-host:8888'); expect(host.querySelector('[data-result]').textContent).toBe('');
  });
  it('locks existing destinations and submits explicit secret removal with an empty password', async () => {
    api.fetchMemorySettings.mockResolvedValue(ok({ ...config, originLocked: true }));
    await renderMemorySettings(host, api); expect(field('baseUrl').readOnly).toBe(true);
    edit('apiKey', 'discard-this'); field('clearApiKey').click(); expect(field('apiKey').disabled).toBe(true); expect(field('apiKey').value).toBe('');
    api.saveMemorySettings.mockResolvedValue(ok({ ...config, revision: 5, hasApiKey: false }));
    submit(); await vi.waitFor(() => expect(api.saveMemorySettings).toHaveBeenCalled());
    expect(api.saveMemorySettings.mock.calls[0][0]).toMatchObject({ clearApiKey: true, apiKey: '' });
  });
  it('clears secrets on identity change and suppresses late connection responses', async () => {
    await renderMemorySettings(host, api); edit('apiKey', 'old-account-key');
    let resolve; api.testMemorySettings.mockImplementation(() => new Promise(done => { resolve = done; }));
    host.querySelector('[data-test]').click(); const password = field('apiKey');
    auth.version++; auth.listeners.forEach(fn => fn());
    expect(password.value).toBe(''); expect(api.testMemorySettings.mock.calls[0][1].aborted).toBe(true);
    resolve(ok({ reachable: true, latencyMs: 1, message: 'old-account-result' })); await Promise.resolve();
    expect(host.textContent).not.toContain('old-account-result'); expect(host.querySelector('form')).toBeNull();
  });
  it('does not render a late administrator configuration after navigation', async () => {
    let resolve; api.fetchMemorySettings.mockImplementation(() => new Promise(done => { resolve = done; }));
    const rendering = renderMemorySettings(host, api); location.hash = '#/settings?tab=profile';
    resolve(ok(config)); await rendering; expect(host.querySelector('form')).toBeNull();
  });
});
