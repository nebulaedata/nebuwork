import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkflowSettings } from './WorkflowSettings.jsx';
import { WorkflowContext } from './ui.jsx';
let dom, root, host, call, config;
beforeEach(() => {
  dom = new JSDOM('<main></main>', { url: 'http://localhost/#/settings?tab=workflow-settings' });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('navigator', dom.window.navigator); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.querySelector('main'); root = createRoot(host);
  config = { canEdit: true, enabled: false, configured: true, revision: 3, baseUrl: 'http://127.0.0.1:8765', requestTimeoutMs: 15000, hasApiKey: true, originLocked: false };
  call = vi.fn(async () => config);
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); vi.unstubAllGlobals(); });
const mount = async () => act(async () => { root.render(<WorkflowContext.Provider value={{ call, live: () => true }}><WorkflowSettings /></WorkflowContext.Provider>); });
const click = async text => act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === text).click(); });
describe('Workflow settings', () => {
  it('shows account status without connection or secret fields for ordinary users', async () => {
    config = { canEdit: false, enabled: true, actorId: '<current-account>' }; await mount();
    expect(host.querySelector('input')).toBeNull(); expect(host.textContent).toContain('<current-account>');
    expect(host.textContent).toContain('仅指定管理员');
  });
  it('keeps drafts after a lost save response and reuses the submission key', async () => {
    await mount(); expect(host.querySelector('input[type=password]').value).toBe('');
    call.mockImplementation(async (path, method) => { if (method === 'POST') throw new Error('响应丢失'); return config; });
    await click('保存配置'); const first = call.mock.calls.find(args => args[1] === 'POST');
    expect(host.textContent).toContain('响应丢失');
    call.mockImplementation(async () => ({ ...config, revision: 4 })); await click('保存配置');
    const writes = call.mock.calls.filter(args => args[1] === 'POST'); expect(writes[1][3].key).toBe(first[3].key);
    expect(host.textContent).toContain('配置已保存'); expect(host.querySelector('input[type=password]').value).toBe('');
  });
  it('tests without saving and keeps a locked service address read-only', async () => {
    config.originLocked = true; await mount(); expect(host.querySelector('input[type=url]').readOnly).toBe(true);
    call.mockResolvedValue({ message: '调度器已就绪；未创建任务', latencyMs: 10 }); await click('测试连接');
    expect(call.mock.calls.filter(args => args[1] === 'POST').map(args => args[0])).toEqual(['/workflow/settings/test']);
    expect(host.textContent).toContain('未创建任务');
  });
});
