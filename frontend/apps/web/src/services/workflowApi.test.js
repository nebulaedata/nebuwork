import { describe, expect, it, vi } from 'vitest';
import { createWorkflowApi } from './workflowApi.js';
function session() {
  let version = 1; const listeners = new Set();
  return { getSnapshot: () => ({ version }), subscribe: fn => listeners.add(fn), assertCurrent: captured => { if (version !== captured) throw new DOMException('账号已变化', 'AbortError'); }, change: () => { version++; listeners.forEach(fn => fn()); } };
}
describe('Workflow Java gateway', () => {
  it('keeps writes on Java, uses POST and preserves the editor-owned request key', async () => {
    const request = vi.fn().mockResolvedValue({ code: 0, data: { id: 'wf' } }), api = createWorkflowApi(request, session());
    const body = { name: '真实工作流', description: '' };
    await api.workflowRequest('/workflows', 'POST', body, { key: 'stable-create-key' });
    expect(request).toHaveBeenCalledWith('/api/workflows', expect.objectContaining({ method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': 'stable-create-key' } }));
    await expect(api.workflowRequest('http://remote/api/v1/workflows')).rejects.toThrow('无效');
  });
  it('aborts on account changes and rejects a late response', async () => {
    let resolve; const identity = session(), request = vi.fn(() => new Promise(done => { resolve = done; })), api = createWorkflowApi(request, identity);
    const pending = Promise.allSettled([api.workflowRequest('/workflow/settings')]);
    identity.change(); expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    resolve({ code: 0, data: { baseUrl: 'old' } }); expect((await pending)[0].reason.name).toBe('AbortError');
  });
  it('forwards navigation cancellation and generates authorized artifact download URLs', async () => {
    const request = vi.fn().mockResolvedValue({ code: 0, data: {} }), api = createWorkflowApi(request, session(), path => '/nebulaedev/nwaa' + path), controller = new AbortController();
    controller.abort(); await expect(api.workflowRequest('/workflows/wf', 'GET', undefined, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(api.workflowArtifactUrl('w/f', 'artifact/1')).toBe('/nebulaedev/nwaa/api/workflows/w%2Ff/artifacts/artifact%2F1/download');
  });
});
