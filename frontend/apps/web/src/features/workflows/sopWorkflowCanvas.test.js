import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mountRemoteSopCanvas } from './sopWorkflowCanvas.js';

let dom, host, remote, api, ui, cleanup, modalCleanup, conflict, sources;
const clone = value => structuredClone(value);
const status = state => state;
beforeEach(() => {
  dom = new JSDOM('<main><span data-workflow-status></span><span data-workflow-error></span><button data-workflow-refresh></button><button data-sop-add-node disabled></button><div id="wf-canvas"></div></main><div id="modal"></div>', { url: 'http://localhost/#/agent/a?tab=sop' });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('location', dom.window.location); vi.stubGlobal('MutationObserver', dom.window.MutationObserver);
  host = document.querySelector('main'); conflict = false; modalCleanup = null; sources = new Map();
  remote = { revision: 'v1', archived: false, error: null, definition: { name: '真实工作流', environment: { mode: 'shared' }, steps: {
    a: { code: 'steps/a.py:run', needs: [], retries: 2, retry_delay: 3, timeout: 20 },
    b: { code: 'steps/b.py:run', needs: ['a'], retries: 0 }, c: { code: 'steps/c.py:run', needs: ['b'], retries: 1 },
  }, layout: { a: { x: 26, y: 24 } } } };
  api = { workflowRequest: vi.fn(async (_path, method, body) => {
    if (method === 'POST') {
      if (_path.includes('/source?')) {
        const source = new URL('http://test' + _path).searchParams.get('path');
        if (sources.has(source)) throw new Error('文件已存在');
        sources.set(source, body.content); return { path: source, content: body.content, revision: 'source1' };
      }
      if (conflict || body.expected_revision !== remote.revision) throw new Error('版本冲突，请重新加载');
      remote = { ...remote, definition: clone(body.definition), revision: 'v' + (Number(remote.revision.slice(1)) + 1) }; return clone(remote);
    }
    if (_path.includes('/source?')) { const source = new URL('http://test' + _path).searchParams.get('path'); return { path: source, content: sources.get(source), revision: 'source1' }; }
    return { id: 'owned-wf', enabled: true, status: 'ready', error: null, workflow: clone(remote) };
  }) };
  ui = { esc: String, toast: vi.fn(), setModalCleanup: callback => { modalCleanup = callback; },
    closeModal: () => { modalCleanup?.(); document.querySelector('#modal').replaceChildren(); },
    modal: (_title, html, callback) => { const box = document.querySelector('#modal'); box.innerHTML = html; callback(box); },
  };
});
afterEach(() => { modalCleanup?.(); cleanup?.(); vi.useRealTimers(); dom.window.close(); vi.unstubAllGlobals(); });
async function mount() {
  cleanup = mountRemoteSopCanvas(host, { workflow: { id: 'owned-wf', status: 'ready' } }, 'a', api, ui, status);
  await vi.waitFor(() => expect(host.querySelectorAll('.wf-node')).toHaveLength(3));
}
describe('real Workflow in expert SOP', () => {
  it('distinguishes queued creation from an active worker and opens the confirmed workflow', async () => {
    vi.useFakeTimers();
    api.workflowRequest
      .mockResolvedValueOnce({ id: 'owned-wf', enabled: true, status: 'pending' })
      .mockResolvedValueOnce({ id: 'owned-wf', enabled: true, status: 'syncing' });
    cleanup = mountRemoteSopCanvas(host, { workflow: { id: 'owned-wf', status: 'pending' } }, 'a', api, ui, status);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.querySelector('[data-workflow-status]').textContent).toBe('pending');
    expect(host.querySelector('#wf-canvas').textContent).toContain('等待后台创建');
    expect(host.querySelector('[data-sop-add-node]').disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.querySelector('[data-workflow-status]').textContent).toBe('syncing');
    expect(host.querySelector('#wf-canvas').textContent).toContain('正在创建真实工作流');
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.querySelectorAll('.wf-node')).toHaveLength(3);
    expect(host.querySelector('[data-sop-add-node]').disabled).toBe(false);
    const count = api.workflowRequest.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.workflowRequest).toHaveBeenCalledTimes(count);
  });
  it('stops an unchanged creation after five minutes without changing server status and allows manual refresh', async () => {
    vi.useFakeTimers();
    api.workflowRequest.mockResolvedValue({ id: 'owned-wf', enabled: true, status: 'pending' });
    const set = { workflow: { id: 'owned-wf', status: 'pending' } };
    cleanup = mountRemoteSopCanvas(host, set, 'a', api, ui, status);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(host.querySelector('#wf-canvas').textContent).toContain('等待创建超过 5 分钟');
    expect(host.querySelector('[data-workflow-error]').textContent).toContain('已停止自动刷新');
    expect(set.workflow.status).toBe('pending');
    expect(host.querySelector('[data-workflow-status]').textContent).toBe('pending');
    expect(host.querySelector('[data-workflow-retry]')).toBeNull();
    const count = api.workflowRequest.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(api.workflowRequest).toHaveBeenCalledTimes(count);
    host.querySelector('[data-workflow-refresh]').click();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.querySelector('[data-workflow-error]').textContent).toBe('');
    expect(host.querySelector('#wf-canvas').textContent).toContain('等待后台创建');
    api.workflowRequest.mockResolvedValue({ id: 'owned-wf', enabled: true, status: 'ready', workflow: clone(remote) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(host.querySelectorAll('.wf-node')).toHaveLength(3);
    expect(api.workflowRequest.mock.calls.every(([, method]) => !method || method === 'GET')).toBe(true);
  });
  it('retries a failed creation using the original owned workflow and prevents duplicate submissions', async () => {
    api.workflowRequest
      .mockResolvedValueOnce({ id: 'owned-wf', enabled: true, status: 'failed', error: '服务连接失败' })
      .mockResolvedValueOnce({ id: 'owned-wf', status: 'pending' });
    cleanup = mountRemoteSopCanvas(host, { workflow: { id: 'owned-wf', status: 'failed' } }, 'a', api, ui, status);
    await vi.waitFor(() => expect(host.querySelector('[data-workflow-retry]')).not.toBeNull());
    expect(host.querySelector('#wf-canvas').textContent).toContain('服务连接失败');
    const retry = host.querySelector('[data-workflow-retry]'); retry.click(); retry.click();
    await vi.waitFor(() => expect(host.querySelectorAll('.wf-node')).toHaveLength(3));
    const writes = api.workflowRequest.mock.calls.filter(([, method]) => method === 'POST');
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe('/workflows/owned-wf/retry');
  });
  it('stops polling when the integration is disabled and shows no retry action', async () => {
    vi.useFakeTimers();
    api.workflowRequest.mockResolvedValue({ id: 'owned-wf', enabled: false, status: 'failed', error: '创建未完成' });
    cleanup = mountRemoteSopCanvas(host, { workflow: { id: 'owned-wf', status: 'failed' } }, 'a', api, ui, status);
    await vi.advanceTimersByTimeAsync(10000);
    expect(host.querySelector('#wf-canvas').textContent).toContain('接入已关闭');
    expect(host.querySelector('[data-workflow-retry]')).toBeNull();
    expect(api.workflowRequest).toHaveBeenCalledTimes(1);
  });
  it('creates a real Python node after recovering a lost source-create response', async () => {
    await mount();
    const original = api.workflowRequest.getMockImplementation();
    let lost = false;
    api.workflowRequest.mockImplementation(async (...args) => {
      const result = await original(...args);
      if (!lost && args[0].includes('/source?') && args[1] === 'POST') { lost = true; throw new Error('创建源码的响应丢失'); }
      return result;
    });
    host.querySelector('[data-sop-add-node]').click(); document.querySelector('[data-step-id]').value = 'report';
    document.querySelector('[data-step-save]').click();
    await vi.waitFor(() => expect(host.querySelectorAll('.wf-node')).toHaveLength(4));
    expect(remote.definition.steps.report).toMatchObject({ code: 'steps/report.py:run', needs: [], retries: 0 });
    expect(sources.size).toBe(1); expect(sources.get('steps/report.py')).toContain('def run(ctx):');
    expect(api.workflowRequest.mock.calls.find(([, method, body]) => method === 'POST' && body.definition)[2].expected_revision).toBe('v1');
    expect(document.querySelector('[data-step-save]')).toBeNull();
  });
  it('saves branches and node removal through Java using actual 3.5 definitions and revisions', async () => {
    await mount();
    host.querySelector('[data-node-id="a"] .wf-port-out').click(); host.querySelector('[data-node-id="c"] .wf-port-in').click();
    await vi.waitFor(() => expect(host.querySelectorAll('.wf-edge')).toHaveLength(3));
    const first = api.workflowRequest.mock.calls.find(([, method]) => method === 'POST');
    expect(first[0]).toBe('/workflows/owned-wf/definition'); expect(first[2].expected_revision).toBe('v1');
    expect(remote.definition.steps.c.needs).toEqual(['b', 'a']);
    expect(remote.definition.steps.a).toMatchObject({ code: 'steps/a.py:run', retries: 2, retry_delay: 3, timeout: 20 });
    host.querySelector('[data-node-id="b"] .wf-node-x').click();
    await vi.waitFor(() => expect(host.querySelectorAll('.wf-node')).toHaveLength(2));
    expect(remote.definition.steps.b).toBeUndefined(); expect(remote.definition.steps.c.needs).toEqual(['a']);
    expect(remote.definition.environment).toEqual({ mode: 'shared' }); expect(remote.definition.layout.a).toEqual({ x: 26, y: 24 });
    expect(api.workflowRequest.mock.calls.filter(([, method]) => method === 'POST')[1][2].expected_revision).toBe('v2');
  });
  it('preserves run scenarios while editing real graph connections', async () => {
    const presets = [{ id: 'normal', name: '常规执行', description: '处理指定文本', input: { text: 'hello' }, fields: { '/text': '处理内容' } }];
    remote.definition.input_presets = clone(presets); await mount();
    host.querySelector('[data-node-id="a"] .wf-port-out').click(); host.querySelector('[data-node-id="c"] .wf-port-in').click();
    await vi.waitFor(() => expect(remote.definition.steps.c.needs).toEqual(['b', 'a']));
    expect(remote.definition.input_presets).toEqual(presets);
  });
  it('keeps node edits in the dialog after a revision conflict', async () => {
    await mount(); conflict = true;
    host.querySelector('[data-node-id="a"] .wf-node-t').click();
    document.querySelector('[data-step-code]').value = 'steps/alternate.py:run';
    document.querySelector('[data-step-retries]').value = '5'; document.querySelector('[data-step-save]').click();
    await vi.waitFor(() => expect(document.querySelector('[data-step-error]').textContent).toContain('版本冲突'));
    expect(document.querySelector('[data-step-code]').value).toBe('steps/alternate.py:run');
    expect(document.querySelector('[data-step-retries]').value).toBe('5'); expect(document.querySelector('[data-step-save]').disabled).toBe(false);
    expect(remote.definition.steps.a.retries).toBe(2);
  });
  it('cancels a late load on navigation and never paints the previous account response', async () => {
    let resolve;
    api.workflowRequest.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    cleanup = mountRemoteSopCanvas(host, { workflow: { id: 'owned-wf', status: 'ready' } }, 'a', api, ui, status);
    const signal = api.workflowRequest.mock.calls[0][3].signal;
    location.hash = '#/agents'; window.dispatchEvent(new dom.window.Event('hashchange'));
    expect(signal.aborted).toBe(true);
    resolve({ enabled: true, status: 'ready', workflow: clone(remote) }); await Promise.resolve(); await Promise.resolve();
    expect(host.querySelector('.wf-node')).toBeNull(); expect(host.querySelector('[data-sop-add-node]').disabled).toBe(true);
  });
  it('keeps archived workflows visible without mutation controls', async () => {
    remote.archived = true; await mount();
    expect(host.querySelector('.wf-readonly')).not.toBeNull(); expect(host.querySelector('.wf-port')).toBeNull();
    expect(host.querySelector('[data-sop-add-node]').disabled).toBe(true);
    host.querySelector('.wf-node-x').click(); expect(api.workflowRequest).toHaveBeenCalledTimes(1);
  });
});
