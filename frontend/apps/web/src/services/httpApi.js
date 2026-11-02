import { createWorkbenchServiceApi } from './workbenchServiceApi.js';
import { createDatabaseApi } from './databaseApi.js';
import { createAgentApi } from './agentApi.js';
import { createExtensionMarketApi } from './extensionMarketApi.js';
import { createExpertApi } from './expertApi.js';
import { createModelApi } from './modelApi.js';
import { createWorkbenchApi } from './workbenchApi.js';
import { createKnowledgeApi } from './knowledgeApi.js';
import { createMemoryApi } from './memoryApi.js';
import { createWorkflowApi } from './workflowApi.js';
import { decodeHttpError } from './httpResponse.js';
import { apiEndpoint } from './apiEndpoint.js';
import { authSession } from './authSession.js';
/* 经同源网关访问 Java；其他业务接口保留原契约，不做失败回退。 */
(function () {
  let knowledgeEpoch = 0;
  const endpoint = path => apiEndpoint(path, import.meta.env.VITE_API_BASE_URL || (import.meta.env.VITE_API_PREFIX || '/nebulaedev').replace(/\/+$/, '') + '/nwaa');

  async function decodeError(response, version) {
    const error = await decodeHttpError(response);
    authSession.assertCurrent(version);
    if (response.status === 401) authSession.invalidate(version);
    return error;
  }

  async function request(path, options) {
    const version = authSession.getSnapshot().version;
    const knowledgeVersion = knowledgeEpoch;
    const headers = new Headers(options && options.headers);
    if (options && options.body && !(options.body instanceof FormData) && !(options.body instanceof Blob) && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const response = await fetch(endpoint(path), { ...options, headers, credentials: 'include' });
    authSession.assertCurrent(version);
    if (!response.ok) throw await decodeError(response, version);
    if (options?.responseType === 'blob') {
      const blob = await response.blob(); authSession.assertCurrent(version);
      return { code: 0, data: blob };
    }
    if (response.status === 204) return { code: 0, data: null };
    const body = await response.json();
    authSession.assertCurrent(version);
    if ((!options?.method || options.method === 'GET') && /^\/api\/(agents|workbenches|projects)(\/|$|\?)/.test(path) && knowledgeVersion !== knowledgeEpoch)
      throw new DOMException('知识库引用已变化，请重新加载', 'AbortError');
    if (body.code !== 0) throw new Error(body.msg || `API ${response.status}`);
    return body;
  }

  function mergeById(target, next) {
    next.forEach(item => {
      const index = target.findIndex(current => current.id === item.id);
      if (index >= 0) target[index] = item; else target.push(item);
    });
  }
  window.API = {
    ...createDatabaseApi(request, authSession),
    ...createWorkbenchServiceApi(request, endpoint, authSession),
    ...createWorkflowApi(request, authSession, endpoint),
    login(username, password) {
      return authSession.login(username, password);
    },
    logout() { return authSession.logout(); },
    health() { return request('/api/health'); },
    integration() { return request('/api/integration'); },
    ...createModelApi(request, DB, () => authSession.getSnapshot().version),
    ...createWorkbenchApi(request, DB, () => authSession.getSnapshot().version),
    ...createKnowledgeApi(request, authSession, () => { knowledgeEpoch++; }, endpoint),
    ...createMemoryApi(request, authSession),
    ...createAgentApi(request, endpoint, authSession),
    ...createExtensionMarketApi(request, authSession),
    ...createExpertApi(request, DB, endpoint, () => authSession.getSnapshot().version)
  };
})();
