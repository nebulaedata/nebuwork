// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createAuthSession, safeReturnTo } from './authSession.js';

const user = { id: 'u1', name: '真实用户' };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
describe('server-backed session lifecycle', () => {
  it('restores a session only from the server and surfaces network errors separately', async () => {
    sessionStorage.setItem('ah-auth', '1');
    const api = { currentUser: vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline')) };
    const state = createAuthSession(api);
    await state.ensure();
    expect(state.getSnapshot().status).toBe('unauthenticated');
    await state.refresh();
    expect(state.getSnapshot().status).toBe('error');
  });
  it('ignores a stale restore response after logout', async () => {
    const pending = deferred();
    const api = { currentUser: () => pending.promise, logout: async () => {} };
    const state = createAuthSession(api);
    const restore = state.ensure();
    await state.logout();
    pending.resolve(user); await restore;
    expect(state.getSnapshot()).toMatchObject({ status: 'unauthenticated', user: null });
  });
  it('cannot restore a user from a login response that arrives after logout', async () => {
    const pending = deferred();
    const api = { login: async () => {}, currentUser: () => pending.promise, logout: async () => {} };
    const state = createAuthSession(api);
    const login = state.login('account', 'secret');
    const rejected = expect(login).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve(); await state.logout();
    pending.resolve(user); await rejected;
    expect(state.getSnapshot().user).toBeNull();
  });
  it('preserves the current user on failed logout and rejects old business responses', async () => {
    const state = createAuthSession({ currentUser: async () => user, logout: async () => { throw new Error('offline'); } });
    await state.ensure();
    const version = state.getSnapshot().version;
    await expect(state.logout()).rejects.toThrow('offline');
    expect(state.getSnapshot()).toMatchObject({ status: 'authenticated', user });
    expect(() => state.assertCurrent(version)).toThrow();
    state.invalidate(version); // An old 401 must not invalidate the current session.
    expect(state.getSnapshot().status).toBe('authenticated');
  });
  it('only returns to known internal routes', () => {
    for (const hash of ['https://evil.example', '#//evil.example', '#/login', '#/agents-evil', '#/missing']) expect(safeReturnTo(hash)).toBe('#/agents');
    expect(safeReturnTo('#/agent/a1?tab=sop')).toBe('#/agent/a1?tab=sop');
    expect(safeReturnTo('#/settings?tab=profile')).toBe('#/settings?tab=profile');
    expect(safeReturnTo('#/service-consent?requestId=request-1')).toBe('#/service-consent?requestId=request-1');
  });
});
