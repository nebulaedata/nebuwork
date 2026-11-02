import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createUuid } from './uuid.js';
import { createAgentApi } from '../services/agentApi.js';
import { workflowKey } from '../services/workflowKey.js';

beforeEach(() => vi.stubGlobal('crypto', { getRandomValues: bytes => webcrypto.getRandomValues(bytes) }));
afterEach(() => vi.unstubAllGlobals());

describe('IDs on an HTTP LAN origin', () => {
  it('generates UUID v4 IDs using only secure random bytes', () => {
    const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const ids = new Set(Array.from({ length: 1000 }, () => createUuid()));
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(pattern);
    expect(workflowKey()).toMatch(pattern);
  });

  it('keeps the same key for an uncertain write and generates a new one after success', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue({ data: {} });
    const auth = { getSnapshot: () => ({ version: 1 }), assertCurrent() {} };
    const api = createAgentApi(request, path => path, auth);
    await expect(api.sendTask('task', { content: 'goal' })).rejects.toThrow('response lost');
    await api.sendTask('task', { content: 'goal' });
    await api.sendTask('task', { content: 'goal' });
    const keys = request.mock.calls.map(([, options]) => options.headers['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});
