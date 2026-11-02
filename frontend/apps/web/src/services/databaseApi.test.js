import { expect, it, vi } from 'vitest';
import { createDatabaseApi } from './databaseApi.js';

it('uses Java scope routes and preserves uncertain mutation keys without replaying', async () => {
  let version = 1; const auth = { getSnapshot: () => ({ version }), assertCurrent: v => { if (version !== v) throw new Error('identity changed'); } };
  const request = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({ data: { id: 'db' } }), api = createDatabaseApi(request, auth);
  const config = { type: 'sqlite', name: '分析' }, signal = new AbortController().signal;
  await expect(api.createDatabase('expert', 'a/b', config, signal)).rejects.toThrow('response lost'); expect(request).toHaveBeenCalledTimes(1);
  const key = request.mock.calls[0][1].headers['Idempotency-Key'];
  await api.createDatabase('expert', 'a/b', config, signal); expect(request.mock.calls[1][1].headers['Idempotency-Key']).toBe(key);
  expect(request.mock.calls[1][0]).toBe('/api/database-scopes/expert/a%2Fb/databases'); expect(request.mock.calls[1][1].method).toBe('POST');
  request.mockRejectedValueOnce(new Error('lost')); await expect(api.createDatabase('project', 'p', config)).rejects.toThrow(); const old = request.mock.lastCall[1].headers['Idempotency-Key']; version++;
  await api.createDatabase('project', 'p', config); expect(request.mock.lastCall[1].headers['Idempotency-Key']).not.toBe(old);
});
it('rejects stale responses and uses bounded multipart imports and blob downloads', async () => {
  let version = 1, finish; const auth = { getSnapshot: () => ({ version }), assertCurrent: v => { if (version !== v) throw new Error('identity changed'); } }, request = vi.fn(() => new Promise(resolve => { finish = resolve; })), api = createDatabaseApi(request, auth);
  const pending = api.submitDatabaseOperation('db', { operation: 'query', arguments: { sql: 'SELECT 1' } }); await vi.waitFor(()=>expect(finish).toBeTypeOf('function')); version++; finish({ data: {} }); await expect(pending).rejects.toThrow('identity changed');
  request.mockResolvedValue({ data: {} }); await api.downloadDatabase('db', 'op'); expect(request.mock.lastCall).toEqual(['/api/databases/db/operations/op/download', expect.objectContaining({ responseType: 'blob' })]);
  expect(() => api.changeDatabase('db','drop',1)).toThrow('无效');
});
