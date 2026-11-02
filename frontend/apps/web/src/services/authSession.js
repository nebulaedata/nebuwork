import { authApi } from './authApi.js';

export function safeReturnTo(hash) {
  return typeof hash === 'string' && /^#\/(?:service-consent|agents|agent\/[^/?#]+|plaza|settings|workbench|projects|project\/[^/?#]+|task\/[^/?#]+|workflows|workflow\/[^/?#]+|workflow-task\/[^/?#]+)(?:\?[^#]*)?$/.test(hash)
    ? hash : '#/agents';
}
export function rememberReturnTo(hash) { sessionStorage.setItem('ah-return-to', safeReturnTo(hash)); }
export function consumeReturnTo() {
  const hash = safeReturnTo(sessionStorage.getItem('ah-return-to'));
  sessionStorage.removeItem('ah-return-to');
  return hash;
}

export function createAuthSession(api, onIdentityChange = () => {}) {
  let state = { status: 'checking', user: null, error: null, version: 0 };
  let operation = 0;
  let boot;
  const listeners = new Set();
  function publish(status, user = null, error = null) {
    state = { status, user, error, version: state.version + 1 };
    onIdentityChange(user);
    listeners.forEach(listener => listener(state));
  }
  const superseded = () => new DOMException('登录状态已变化，请重试', 'AbortError');
  const session = {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    ensure() { return boot ||= session.refresh(); },
    async refresh() {
      const current = ++operation;
      publish('checking');
      try {
        const user = await api.currentUser();
        if (current !== operation) return;
        publish(user ? 'authenticated' : 'unauthenticated', user);
      } catch (error) {
        if (current === operation) publish('error', null, error);
      }
    },
    async login(account, password) {
      const current = ++operation;
      await api.login(account, password);
      if (current !== operation) throw superseded();
      // Confirm the browser actually retained the cookie before entering a protected page.
      const user = await api.currentUser();
      if (current !== operation) throw superseded();
      if (!user) throw new Error('登录会话未建立，请允许浏览器 Cookie 后重试');
      publish('authenticated', user);
      return user;
    },
    async logout() {
      const current = ++operation;
      // In-flight business responses must not repopulate caches during logout.
      state = { ...state, version: state.version + 1 };
      listeners.forEach(listener => listener(state));
      await api.logout();
      if (current !== operation) throw superseded();
      sessionStorage.removeItem('ah-return-to');
      location.hash = '#/login';
      publish('unauthenticated');
    },
    invalidate(version = state.version) {
      if (version !== state.version) return;
      ++operation;
      publish('unauthenticated');
    },
    assertCurrent(version) {
      if (version !== state.version) throw superseded();
    },
  };
  return session;
}

function applyIdentity(user) {
  const db = window.DB;
  if (!db) return;
  // Authenticated API results belong to the current session, never to the next account.
  for (const key of ['agents', 'extensions', 'plazaTemplates', 'plazaAgents', 'projects', 'sessions', 'workbenches', 'workbenchTemplates', 'modelProviders', 'notifications', 'users', 'extAuth']) db[key] = [];
  for (const key of ['sopSets', 'ruleSets', 'agentRules', 'agentExts', 'agentTpls', 'messages', 'todos', 'audit', 'sessionContext', 'wbConfigs', 'workbenchVersions', 'projectDetails']) db[key] = {};
  db.modelSettings = null;
  db.user = user || { id: '', name: '', account: '', avatar: '', email: '', phone: '' };
}

export const authSession = createAuthSession(authApi, applyIdentity);
