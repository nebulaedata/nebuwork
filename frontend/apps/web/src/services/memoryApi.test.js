import { describe, expect, it, vi } from 'vitest';
import { createMemoryApi } from './memoryApi.js';
const ok = data => ({ code: 0, data });
function session() {
  let version = 1; const listeners = new Set();
  return { getSnapshot: () => ({ version }), subscribe: fn => listeners.add(fn),
    assertCurrent: value => { if (version !== value) throw new DOMException('Account changed', 'AbortError'); },
    change: () => { version++; listeners.forEach(fn => fn()); } };
}
describe('memory API isolation and mutations', () => {
  it('uses the editor-owned key for settings and aborts a late settings response on account change', async () => {
    let resolve; const identity = session(), request = vi.fn(() => new Promise(done => { resolve = done; }));
    const api = createMemoryApi(request, identity), controller = new AbortController();
    const saved = api.saveMemorySettings({ revision: 2, apiKey: 'secret' }, 'settings-attempt-key', controller.signal);
    const pending = Promise.allSettled([saved]);
    expect(request.mock.calls[0][0]).toBe('/api/memory/settings');
    expect(request.mock.calls[0][1].headers).toEqual({ 'Idempotency-Key': 'settings-attempt-key' });
    identity.change(); expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    resolve(ok({ canEdit: true })); expect((await pending)[0].reason.name).toBe('AbortError');
  });
  it('reuses the same idempotency key after an uncertain response and renews after success', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue(ok({ id: 'one' }));
    const api = createMemoryApi(request, session()), body = { title: '习惯', content: '使用中文' };
    await expect(api.createMemory('user', 'self', body)).rejects.toThrow('response lost');
    await api.createMemory('user', 'self', body); await api.createMemory('user', 'self', body);
    expect(request.mock.calls[0][1].headers).toEqual(request.mock.calls[1][1].headers);
    expect(request.mock.calls[1][1].headers).not.toEqual(request.mock.calls[2][1].headers);
    expect(request.mock.calls[0][0]).toBe('/api/memory/scopes/user/self/entries');
  });
  it('aborts and rejects late replies after switching account', async () => {
    let resolve; const identity = session(), request = vi.fn(() => new Promise(done => { resolve = done; }));
    const api = createMemoryApi(request, identity);
    const read = api.fetchMemoryScope('expert', 'shared'), pending = Promise.allSettled([read]);
    identity.change(); expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    resolve(ok({ items: [{ content: 'old account' }] }));
    expect((await pending)[0].reason.name).toBe('AbortError');
  });
  it('uses POST with revision, escapes object ids, and forwards cancellation', async () => {
    const request = vi.fn().mockResolvedValue(ok({})), api = createMemoryApi(request, session()), controller = new AbortController();
    await api.updateMemory('a/b', { title: 'Title', content: 'Content', revision: 7 }, controller.signal);
    expect(request.mock.calls[0][0]).toBe('/api/memory/entries/a%2Fb');
    expect(request.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(request.mock.calls[0][1].body).revision).toBe(7);
    controller.abort();
    await expect(api.fetchMemory('entry', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('does not reuse pending mutation identities across accounts', async () => {
    const request = vi.fn().mockRejectedValue(new Error('offline')), identity = session(), api = createMemoryApi(request, identity);
    await expect(api.retryMemory('entry', 2)).rejects.toThrow(); identity.change();
    await expect(api.retryMemory('entry', 2)).rejects.toThrow();
    expect(request.mock.calls[0][1].headers).not.toEqual(request.mock.calls[1][1].headers);
  });
});
