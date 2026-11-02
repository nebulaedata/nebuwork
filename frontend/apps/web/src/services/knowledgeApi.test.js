import { describe, expect, it, vi } from 'vitest';
import { createKnowledgeApi } from './knowledgeApi.js';
function fixture(request = vi.fn(async () => ({ code: 0, data: {} })), beforeApi) {
  let version = 1; const listeners = new Set(), mutated = vi.fn();
  const session = { getSnapshot: () => ({ version }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    assertCurrent: before => { if (before !== version) throw new DOMException('账号已变化', 'AbortError'); } };
  beforeApi?.(session);
  const api = createKnowledgeApi(request, session, mutated);
  return { api, request, mutated, switchAccount: () => { version++; listeners.forEach(fn => fn()); } };
}
describe('knowledge MCP API', () => {
  it('forwards multipart files and optional source paths without JSON headers or replay', async () => {
    const { api, request, mutated } = fixture(), form = new FormData(), controller = new AbortController();
    form.set('file', new File(['正文'], 'a.md')); form.set('fileName', 'a.md');
    form.set('relativePath', '公司/制度/a.md'); form.set('collectionId', 'opaque:/library'); form.set('requestKey', 'knowledge-stable-key');
    await api.uploadKnowledgeFile('connection/id', form, controller.signal);
    expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][0]).toBe('/api/knowledge-mcp/connections/connection%2Fid/upload');
    expect(request.mock.calls[0][1].body).toBe(form); expect(request.mock.calls[0][1].method).toBe('POST');
    expect(form.get('relativePath')).toBe('公司/制度/a.md');
    expect(mutated).not.toHaveBeenCalled();
  });
  it('encodes only local route IDs and sends the opaque collection ID unchanged in the body', async () => {
    const { api, request } = fixture();
    await api.bindKnowledge('expert', 'expert/id', { revision: 7, connectionId: 'mcp', collectionId: 'remote:/a?x=1&y=%2F' });
    const [path, options] = request.mock.calls[0];
    expect(path).toBe('/api/knowledge-scopes/expert/expert%2Fid/references');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ revision: 7, connectionId: 'mcp', collectionId: 'remote:/a?x=1&y=%2F' });
  });
  it('requests file counts only for collection overviews', async () => {
    const { api, request } = fixture();
    await api.fetchKnowledgeCollections('connection/id');
    await api.fetchKnowledgeCollections('connection/id', undefined, true);
    expect(request.mock.calls[0][0]).toBe('/api/knowledge-mcp/connections/connection%2Fid/collections');
    expect(request.mock.calls[1][0]).toBe('/api/knowledge-mcp/connections/connection%2Fid/collections?includeDocumentCounts=true');
    expect(request.mock.calls[1][1].method).toBe('GET');
  });
  it('reads a bound reference without sending caller-controlled collection restrictions', async () => {
    const { api, request, mutated } = fixture();
    await api.readKnowledgeReference('project', 'p', 'r', { operation: 'search', query: '差旅', topK: 5 });
    expect(request.mock.calls[0][0]).toBe('/api/knowledge-scopes/project/p/references/r/read');
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ operation: 'search', query: '差旅', topK: 5 });
    expect(mutated).not.toHaveBeenCalled();
  });
  it('aborts requests on account change and rejects late responses even if the transport ignores abort', async () => {
    let resolve; const request = vi.fn(() => new Promise(done => { resolve = done; }));
    const { api, switchAccount } = fixture(request);
    const pending = api.fetchKnowledgeScope('expert', 'a');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    switchAccount(); expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    resolve({ code: 0, data: { private: 'alice' } }); await rejected;
  });
  it('keeps new-session requests started by an earlier auth listener while aborting old ones', async () => {
    const finishes = [], request = vi.fn(() => new Promise(resolve => { finishes.push(resolve); }));
    let current;
    const { api, switchAccount } = fixture(request, session => {
      session.subscribe(() => { current = api.fetchKnowledgeConnections(); });
    });
    const previous = api.fetchKnowledgeConnections();
    const rejected = expect(previous).rejects.toMatchObject({ name: 'AbortError' });
    switchAccount();
    expect(request.mock.calls).toHaveLength(2);
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    expect(request.mock.calls[1][1].signal.aborted).toBe(false);
    finishes[0]({ code: 0, data: ['previous-account'] });
    finishes[1]({ code: 0, data: ['current-account'] });
    await rejected;
    await expect(current).resolves.toEqual({ code: 0, data: ['current-account'] });
  });
  it('forwards caller cancellation and invalidates aggregate reads around configuration changes', async () => {
    let resolve; const request = vi.fn(() => new Promise(done => { resolve = done; }));
    const { api, mutated } = fixture(request), controller = new AbortController();
    const pending = api.createLocalKnowledge('workbench', 'w', { revision: 3, connection: {}, collectionId: 'A' }, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(mutated).toHaveBeenCalledTimes(1);
    controller.abort(); expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    resolve({ code: 0, data: {} }); await rejected;
    expect(mutated).toHaveBeenCalledTimes(2);
  });
  it('preserves revision failures and never retries writes or uses browser persistence', async () => {
    const request = vi.fn(async () => { throw new Error('配置已变化'); }), { api } = fixture(request);
    await expect(api.unbindKnowledge('expert', 'a', 'ref', 8)).rejects.toThrow('配置已变化');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/api/knowledge-scopes/expert/a/references/ref?revision=8');
    expect(request.mock.calls[0][1].method).toBe('DELETE');
  });
});
