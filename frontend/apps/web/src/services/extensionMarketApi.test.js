import { describe, expect, it, vi } from 'vitest';
import { createExtensionMarketApi, runtimeScopeHref } from './extensionMarketApi.js';

function identity() {
  let version = 1, listener;
  return { getSnapshot: () => ({ version }), subscribe: fn => { listener = fn; return () => {}; },
    assertCurrent: expected => { if (version !== expected) throw Error('Account changed'); }, change: () => { version++; listener?.(); } };
}
describe('extension market transport', () => {
  it('keeps the original installation request key after an uncertain response and never automatically writes again', async () => {
    const request = vi.fn().mockRejectedValueOnce(Error('Connection lost')).mockResolvedValue({ data: { id: 'original-operation', state: 'pending' } });
    const api = createExtensionMarketApi(request, identity()), body = { targetKind: 'expert', targetId: 'expert', versionId: 'v2', runtimeRevision: 8 };
    await expect(api.installMarketExtension('extension', body)).rejects.toThrow('Connection lost');
    expect(request).toHaveBeenCalledTimes(1);
    expect((await api.installMarketExtension('extension', body)).data.id).toBe('original-operation');
    expect(request.mock.calls[0][1].headers['Idempotency-Key']).toBe(request.mock.calls[1][1].headers['Idempotency-Key']);
    expect(request.mock.calls[1][1].body).toBe(JSON.stringify(body));
    expect(request.mock.calls[0][1].signal).toBeUndefined();
  });
  it('clears old-account request keys and rejects a response arriving after account switching', async () => {
    let complete; const auth = identity(), request = vi.fn(() => new Promise(resolve => { complete = resolve; })), api = createExtensionMarketApi(request, auth);
    const body = { kind: 'mcp', name: 'Shared', description: 'Purpose' }, old = api.createMarketExtension(body);
    // The digest is asynchronous; wait until the submitted mutation exists.
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    auth.change(); complete({ data: { id: 'old-account' } }); await expect(old).rejects.toThrow('Account changed');
    request.mockResolvedValueOnce({ data: { id: 'new-account' } }); await api.createMarketExtension(body);
    expect(request.mock.calls[0][1].headers['Idempotency-Key']).not.toBe(request.mock.calls[1][1].headers['Idempotency-Key']);
  });
  it('uses POST for removal and passes abort signals only to reads', async () => {
    const request = vi.fn(async () => ({ data: {} })), api = createExtensionMarketApi(request, identity()), controller = new AbortController();
    await api.fetchMarketInstallations('project', 'project with spaces', controller.signal);
    expect(request.mock.calls[0][0]).toContain('targetId=project+with+spaces'); expect(request.mock.calls[0][1].signal).toBe(controller.signal);
    await api.removeMarketInstallation('installed', { targetKind: 'project', targetId: 'project', revision: 4 });
    expect(request.mock.calls[1][1].method).toBe('POST'); expect(request.mock.calls[1][1].headers['Idempotency-Key']).toBeTruthy();
    expect(runtimeScopeHref('expert', 'one/two')).toBe('#/agent/one%2Ftwo?tab=ext');
  });
});
