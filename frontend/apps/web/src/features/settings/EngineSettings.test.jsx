import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EngineSettings } from './EngineSettings.jsx';
let dom, root, host, call, config, alive;
const status = { nodes: [{ url: 'http://api-one:42110', ready: true, latencyMs: 4, message: '校验通过' }], workers: [{ id: 'worker-1', hostname: 'worker-one', online: true, capacity: 2, active: 1, waiting: 0, storageId: 'storage' }], clusterId: 'cluster', storageId: 'storage', ready: true, checkedAt: '2026-10-15T01:00:00Z', message: '检查完成' };
beforeEach(() => {
  dom = new JSDOM('<main></main>', { url: 'http://localhost/#/settings?tab=agent-engine' });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('navigator', dom.window.navigator); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.querySelector('main'); root = createRoot(host); alive = true;
  config = { canEdit: true, configured: true, revision: 2, apiUrls: ['http://api-one:42110'], namespace: 'nebuwork-v2', sandboxImage: 'nebu-agent-sandbox:1', requestTimeoutMs: 15000, hasSigningKey: true, hasCallbackKey: true };
  call = vi.fn(async path => path === '/status' || path === '/test' ? status : config);
});
afterEach(async () => { await act(async () => root.unmount()); dom.window.close(); vi.unstubAllGlobals(); });
const mount = async () => act(async () => { root.render(<EngineSettings call={call} isCurrent={() => alive} />); });
const click = async text => act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === text).click(); });
describe('engine connection settings', () => {
  it('shows real API and Worker state without filling saved passwords', async () => {
    await mount(); expect(host.textContent).toContain('1/1'); expect(host.textContent).toContain('worker-one');
    expect([...host.querySelectorAll('input[type=password]')].map(e => e.value)).toEqual(['', '']);
    expect(host.querySelector('[aria-label="业务命名空间"]').readOnly).toBe(true);
  });
  it('does not expose configuration or request node status for ordinary accounts', async () => {
    config = { canEdit: false, configured: true, actorId: 'ordinary' }; await mount();
    expect(host.querySelector('input')).toBeNull(); expect(host.textContent).toContain('仅指定管理员');
    expect(call.mock.calls.map(c => c[0])).toEqual(['']);
  });
  it('preserves the original submission key after an uncertain save', async () => {
    await mount(); call.mockImplementation(async (_, method) => { if (method === 'POST') throw new Error('响应丢失'); return status; });
    await click('保存配置'); await click('保存配置');
    const posts = call.mock.calls.filter(c => c[1] === 'POST'); expect(posts).toHaveLength(2); expect(posts[0][3].key).toBe(posts[1][3].key);
    expect(host.textContent).toContain('响应丢失'); expect(posts[0][2].signingKey).toBe('');
  });
  it('checks draft nodes without saving and ignores late results after leaving the account', async () => {
    await mount(); await click('检查连接'); expect(call.mock.calls.filter(c => c[1] === 'POST').map(c => c[0])).toEqual(['/test']);
    expect(host.textContent).toContain('本次检查未保存配置');
    let finish; call.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await click('保存配置'); alive = false;
    await act(async () => { finish({ ...config, revision: 3 }); });
    expect(host.textContent).not.toContain('配置已保存');
  });
  it('can add and remove node inputs without inventing an address', async () => {
    await mount(); await click('添加节点'); expect(host.querySelectorAll('input[type=url]')).toHaveLength(2);
    expect(host.querySelector('[aria-label="API 节点 2"]').value).toBe('');
    await act(async () => host.querySelector('[aria-label="移除 API 节点 2"]').click());
    expect(host.querySelectorAll('input[type=url]')).toHaveLength(1);
  });
});
