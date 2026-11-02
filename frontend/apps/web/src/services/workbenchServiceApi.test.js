import { expect, it, vi } from 'vitest';
import { createWorkbenchServiceApi } from './workbenchServiceApi.js';
function fixture() { let version = 1; const request = vi.fn(), auth = { getSnapshot: () => ({ version }), assertCurrent: v => { if (v !== version) throw new DOMException('account changed', 'AbortError'); } }; return { request, api: createWorkbenchServiceApi(request, p => '/nebulaedev/nwaa' + p, auth), switchAccount: () => version++ }; }
it('keeps uncertain invocation keys stable and prevents stale-account completion', async () => {
  const { request, api, switchAccount } = fixture(); request.mockRejectedValueOnce(new Error('lost')).mockResolvedValue({ data: {} });
  const body = { projectId: 'project', input: {} };
  await expect(api.testServiceCapability('wb', 'overview', body)).rejects.toThrow('lost');
  await api.testServiceCapability('wb', 'overview', body);
  expect(request.mock.calls[0][1].headers['Idempotency-Key']).toBe(request.mock.calls[1][1].headers['Idempotency-Key']);
  let finish; request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = api.saveWorkbenchService('wb', { revision: 1, definition: {} }); switchAccount(); finish({ data: {} });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
it('keeps independent page URLs behind the gateway and restricts lifecycle actions', () => {
  const { api } = fixture(); expect(api.serviceUrl('wb', 'pages/board')).toBe('/nebulaedev/nwaa/api/workbench-services/wb/pages/board');
  expect(() => api.changeWorkbenchService('wb', 'publish-arbitrary', {})).toThrow('无效');
});
