// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import JSEncrypt from 'jsencrypt';
import { createAuthApi } from './authApi.js';
const response = (data, code = 0) => ({ ok: code === 0, status: code || 200, json: async () => ({ code, data, msg: '拒绝访问' }) });
describe('Java account service', () => {
  it('fetches the current key and encrypts the original password with cookie credentials', async () => {
    const rsa = new JSEncrypt({ default_key_size: '2048' });
    const fetcher = vi.fn().mockResolvedValueOnce(response({ publicKey: rsa.getPublicKey() })).mockResolvedValueOnce(response({}));
    await createAuthApi({ fetcher }).login('  alice  ', ' password with spaces ');
    expect(fetcher.mock.calls[0][0]).toBe('/nebulaedev/nwaa/api/auth/public-key');
    const [url, options] = fetcher.mock.calls[1];
    const body = JSON.parse(options.body);
    expect(url).toBe('/nebulaedev/nwaa/api/auth/login');
    expect(options).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(body.account).toBe('alice');
    expect(rsa.decrypt(body.encryptedPassword)).toBe(' password with spaces ');
    expect(body.password).toBeUndefined();
  });
  it('does not post a password when encryption fails', async () => {
    const fetcher = vi.fn(async () => response({ publicKey: 'invalid' }));
    await expect(createAuthApi({ fetcher }).login('alice', 'secret')).rejects.toThrow('加密失败');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('only exposes account profile fields to the session state', async () => {
    const api = createAuthApi({ fetcher: async () => response({ id: 'u1', account: 'alice', name: '姓名', role: 'admin', password_hash: 'never-cache' }) });
    expect(await api.currentUser()).toEqual({ id: 'u1', account: 'alice', name: '姓名', email: '', phone: '', avatar: '' });
  });
  it('distinguishes expiration from connection and invalid-profile failures', async () => {
    expect(await createAuthApi({ fetcher: async () => response(null, 401) }).currentUser()).toBeNull();
    await expect(createAuthApi({ fetcher: async () => { throw Error('offline'); } }).currentUser()).rejects.toThrow('无法连接');
    await expect(createAuthApi({ fetcher: async () => response({}) }).currentUser()).rejects.toThrow('有效用户');
  });
  it('keeps logout failures visible', async () => {
    await expect(createAuthApi({ fetcher: async () => response(null, 500) }).logout()).rejects.toThrow('拒绝访问');
  });
});
