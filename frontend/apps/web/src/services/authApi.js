import JSEncrypt from 'jsencrypt';

export class AuthError extends Error {
  constructor(message, status) { super(message); this.name = 'AuthError'; this.status = status; }
}

export function createAuthApi({ prefix = '/nebulaedev', fetcher = (...args) => fetch(...args) } = {}) {
  const base = prefix.replace(/\/+$/, '') + '/nwaa/api/auth';
  async function request(path, body) {
    let response;
    try {
      response = await fetcher(base + path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'include',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { throw new AuthError('无法连接账号服务，请检查网络后重试'); }
    let result;
    try { result = await response.json(); }
    catch { throw new AuthError(`账号服务响应异常（HTTP ${response.status}）`, response.status); }
    if (!response.ok || result?.code !== 0) throw new AuthError(result?.msg || '账号服务请求失败', result?.code || response.status);
    return result.data;
  }
  return {
    async login(account, password) {
      const { publicKey } = await request('/public-key');
      let encryptedPassword;
      try { const rsa = new JSEncrypt(); rsa.setPublicKey(publicKey); encryptedPassword = rsa.encrypt(password); } catch { /* Never send plaintext on encryption failure. */ }
      if (!encryptedPassword) throw new AuthError('密码加密失败，请重试');
      await request('/login', { account: account.trim(), encryptedPassword });
    },
    async currentUser() {
      try {
        const user = await request('/me');
        if (typeof user?.id !== 'string' || !user.id.trim()) throw new AuthError('账号服务未返回有效用户信息');
        return { id: user.id, name: user.name || user.account, account: user.account, email: '', phone: '', avatar: '' };
      } catch (error) { if (error.status === 401) return null; throw error; }
    },
    logout() { return request('/logout', {}); },
  };
}

export const authApi = createAuthApi({ prefix: import.meta.env.VITE_API_PREFIX || '/nebulaedev' });
