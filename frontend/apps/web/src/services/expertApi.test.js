import { describe, it, expect, vi } from 'vitest';
import { createExpertApi } from './expertApi.js';

const detail = () => ({
  agent: { id: 'a', sop: [], stats: { tasks: 0, successRate: null }, kbIds: [] },
  sopSets: [{ id: 's', revision: 1, kind: 'workflow', name: 'SOP', wf: { nodes: [{ id: 'n', t: '原节点', d: '', x: 10, y: 20 }] } }],
  ruleSets: [], rules: [], extensions: [], templates: [], knowledgeBases: [], tasks: [], growth: []
});

const deferred = () => {
  let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function membershipSetup(handler, version = () => 0) {
  const db = {}, request = vi.fn(handler), api = createExpertApi(request, db, undefined, version);
  db.agents.push({ ...detail().agent, sourceMarketId: 'market', revision: 7, membershipRevision: 0 });
  db.plazaAgents.push({ id: 'market', hiredAgentId: 'a', hiredAgentRevision: 7, hiredMembershipRevision: 0 });
  for (const key of ['sopSets', 'ruleSets', 'agentRules', 'agentExts', 'agentTpls']) db[key].a = [{ id: 'retained' }];
  return { db, request, api };
}
const removalResponse = () => ({ data: { id: 'a', sourceMarketId: 'market', removed: true, membershipRevision: 1 } });
describe('expert deletion, market removal and restoration', () => {
  it('deletes a custom expert from the cache without changing unrelated market or expert data', async () => {
    const pending = deferred();
    const { api, db, request } = membershipSetup((_url, options) => options?.method === 'DELETE'
      ? Promise.resolve({ data: { id: 'a', sourceMarketId: null, removed: true, membershipRevision: 1 } }) : pending.promise);
    db.agents[0].sourceMarketId = null;
    db.agents.push({ id: 'other' }); db.sopSets.other = [{ id: 'keep' }];
    db.plazaAgents[0].hiredAgentId = 'other';
    const marketBefore = structuredClone(db.plazaAgents);
    const late = expect(api.fetchAgentDetail('a')).rejects.toThrow('专家添加状态已变化');
    await api.removeExpert('a', 7, 0);
    expect(request).toHaveBeenCalledWith('/api/agents/a?revision=7&membershipRevision=0', { method: 'DELETE' });
    pending.resolve({ data: detail() }); await late;
    expect(db.agents).toEqual([{ id: 'other' }]); expect(db.sopSets.other).toEqual([{ id: 'keep' }]);
    for (const key of ['sopSets', 'ruleSets', 'agentRules', 'agentExts', 'agentTpls']) expect(db[key].a).toBeUndefined();
    expect(db.plazaAgents).toEqual(marketBefore);
  });
  it('clears only the removed expert cache after success and allows restoring the same ID', async () => {
    const { api, db, request } = membershipSetup((_url, options) => Promise.resolve(options.method === 'DELETE' ? removalResponse()
      : { data: { ...detail().agent, sourceMarketId: 'market', revision: 7, membershipRevision: 2 } }));
    db.agents.push({ id: 'other' }); db.sopSets.other = [{ id: 'keep' }]; db.extensions.push({ id: 'shared' });
    await api.removeExpert('a', 7, 0);
    expect(request).toHaveBeenCalledWith('/api/agents/a?revision=7&membershipRevision=0', { method: 'DELETE' });
    expect(db.agents.map(a => a.id)).toEqual(['other']);
    for (const key of ['sopSets', 'ruleSets', 'agentRules', 'agentExts', 'agentTpls']) expect(db[key].a).toBeUndefined();
    expect(db.sopSets.other).toEqual([{ id: 'keep' }]); expect(db.extensions).toEqual([{ id: 'shared' }]);
    expect(db.plazaAgents[0]).toMatchObject({ hiredAgentId: null, hiredAgentRevision: null, hiredMembershipRevision: 1 });
    await api.hireExpert('market');
    expect(db.agents.find(a => a.id === 'a').membershipRevision).toBe(2);
    expect(db.plazaAgents[0]).toMatchObject({ hiredAgentId: 'a', hiredAgentRevision: 7, hiredMembershipRevision: 2 });
  });
  it('keeps every cache on rejection and permits retry', async () => {
    const { api, db, request } = membershipSetup(() => Promise.reject(new Error('请先解除工作台引用')));
    const before = structuredClone(db);
    await expect(api.removeExpert('a', 7, 0)).rejects.toThrow('工作台引用');
    expect(db).toEqual(before);
    request.mockResolvedValueOnce(removalResponse());
    await api.removeExpert('a', 7, 0); expect(db.agents).toEqual([]);
  });
  it.each(['list', 'detail', 'catalog', 'binding'])('ignores a late %s response after removal', async kind => {
    const pending = deferred();
    const { api, db } = membershipSetup((url, options) => {
      if (options?.method === 'DELETE') return Promise.resolve(removalResponse());
      if (url === '/api/plaza/extensions' || url === '/api/plaza/templates') return Promise.resolve({ data: [] });
      return pending.promise;
    });
    const reads = { list: () => api.fetchAgents(), detail: () => api.fetchAgentDetail('a'),
      catalog: () => api.fetchExpertCatalogs(), binding: () => api.setExpertBinding('a', 'extensions', 'ext', true) };
    const rejected = expect(reads[kind]()).rejects.toThrow('专家添加状态已变化');
    await api.removeExpert('a', 7, 0);
    pending.resolve({ data: kind === 'list' ? [detail().agent] : kind === 'catalog' ? [{ id: 'market', hiredAgentId: 'a' }] : detail() });
    await rejected;
    expect(db.agents).toEqual([]); expect(db.sopSets.a).toBeUndefined();
    expect(db.plazaAgents[0].hiredAgentId).toBeNull();
  });
  it.each(['remove', 'hire'])('does not apply an old account’s %s response to the new account', async kind => {
    let version = 1; const pending = deferred();
    const { api, db, request } = membershipSetup(() => pending.promise, () => version);
    const rejected = expect(kind === 'remove' ? api.removeExpert('a', 7, 0) : api.hireExpert('market')).rejects.toThrow('登录状态已变化');
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    version++; db.agents = [{ id: 'new-account' }]; db.plazaAgents = [{ id: 'market', hiredAgentId: 'new-account' }];
    pending.resolve(kind === 'remove' ? removalResponse() : { data: { id: 'a', revision: 7, membershipRevision: 2 } });
    await rejected;
    expect(db.agents).toEqual([{ id: 'new-account' }]); expect(db.plazaAgents[0].hiredAgentId).toBe('new-account');
  });
  it('serializes re-adding behind an outstanding removal', async () => {
    const pending = deferred();
    const { api, db, request } = membershipSetup((_url, options) => options.method === 'DELETE' ? pending.promise
      : Promise.resolve({ data: { id: 'a', revision: 7, membershipRevision: 2 } }));
    const removing = api.removeExpert('a', 7, 0), restoring = api.hireExpert('market');
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    pending.resolve(removalResponse()); await Promise.all([removing, restoring]);
    expect(request.mock.calls.map(([, options]) => options.method)).toEqual(['DELETE', 'POST']);
    expect(db.plazaAgents[0].hiredAgentId).toBe('a'); expect(db.agents[0].membershipRevision).toBe(2);
  });
});
function setup(handler) {
  const db = { agents: [{ id: 'mock' }], sopSets: { mock: [{}] } };
  const request = vi.fn(async (url, options) => url === '/api/agents/a' && !options
    ? { code: 0, data: structuredClone(detail()) } : handler(url, options));
  const api = createExpertApi(request, db);
  return { db, request, api };
}
describe('Java expert configuration cache', () => {
  it('saves expert basic fields with POST and updates only the expert profile cache', async () => {
    const { api, db, request } = setup(async (_, options) => ({ code: 0, data: { ...detail().agent, ...JSON.parse(options.body), revision: 8 } }));
    await api.fetchAgentDetail('a'); const originalSops = structuredClone(db.sopSets.a);
    const payload = { revision: 7, name: '新名称', role: '审查', tagline: '新简介', modelProviderId: 'my-provider' };
    await api.updateAgent('a', payload);
    expect(request).toHaveBeenLastCalledWith('/api/agents/a', { method: 'POST', body: JSON.stringify(payload), signal: undefined });
    expect(db.agents[0]).toMatchObject({ name: '新名称', tagline: '新简介', modelProviderId: 'my-provider', revision: 8 }); expect(db.sopSets.a).toEqual(originalSops);
  });
  it('generates via the Java endpoint with cancellation without changing saved profiles', async () => {
    const { api, db, request } = setup(async () => ({ code: 0, data: { tagline: 'AI 草稿', modelProviderId: 'my-provider' } }));
    await api.fetchAgentDetail('a'); const before = structuredClone(db), controller = new AbortController();
    const payload = { name: '专家', role: '审查', tagline: '', modelProviderId: 'my-provider' };
    const result = await api.completeExpertAbility(payload, { signal: controller.signal });
    expect(result.data.tagline).toBe('AI 草稿'); expect(db).toEqual(before);
    expect(request).toHaveBeenLastCalledWith('/api/agents/ability-completion', { method: 'POST', body: JSON.stringify(payload), signal: controller.signal });
  });
  it('does not merge an old-account expert update response into the current cache', async () => {
    let version = 1; const pending = deferred(), db = {}, api = createExpertApi(() => pending.promise, db, undefined, () => version);
    const rejected = expect(api.updateAgent('a', { revision: 1, name: '旧账号专家' })).rejects.toThrow('登录状态已变化');
    version++; db.agents.push({ id: 'current' }); pending.resolve({ data: { id: 'a', name: '旧账号专家', revision: 2 } }); await rejected;
    expect(db.agents).toEqual([{ id: 'current' }]);
  });
  it('does not show mock experts or fall back when the server fails', async () => {
    const { db, api } = setup(() => Promise.reject(new Error('offline')));
    expect(db.agents).toEqual([]);
    await expect(api.fetchAgents()).rejects.toThrow('offline');
    expect(db.agents).toEqual([]);
  });
  it('serializes edits using the latest successful revision without losing earlier changes', async () => {
    const writes = [];
    const { api, db, request } = setup(async (_, options) => {
      const body = JSON.parse(options.body); writes.push(body);
      return { code: 0, data: { ...body, revision: body.revision + 1 } };
    });
    await api.fetchAgentDetail('a');
    await Promise.all([
      api.updateSop('a', 's', draft => { draft.wf.nodes[0].x = 80; }),
      api.updateSop('a', 's', draft => { draft.wf.nodes[0].t = '保存后的节点'; })
    ]);
    expect(writes.map(x => x.revision)).toEqual([1, 2]);
    expect(request.mock.calls.slice(1).map(([url, options]) => [url, options.method])).toEqual([
      ['/api/agents/a/sop-sets/s', 'POST'], ['/api/agents/a/sop-sets/s', 'POST']
    ]);
    expect(db.sopSets.a[0].wf.nodes[0]).toMatchObject({ x: 80, t: '保存后的节点' });
    expect(db.agents[0].sop).toEqual(['保存后的节点']);
  });
  it('rejects queued writes after a conflict and preserves the last server state', async () => {
    const { api, db, request } = setup(() => Promise.reject(Object.assign(new Error('conflict'), { status: 409 })));
    await api.fetchAgentDetail('a');
    const results = await Promise.allSettled([
      api.updateSop('a', 's', d => { d.wf.nodes = []; }),
      api.updateSop('a', 's', d => { d.name = '不能写入'; })
    ]);
    expect(results.every(r => r.status === 'rejected')).toBe(true);
    expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(db.sopSets.a[0].wf.nodes).toHaveLength(1);
    expect(db.sopSets.a[0].revision).toBe(1);
  });
  it('only removes a SOP after successful deletion', async () => {
    let fail = true;
    const { api, db } = setup(() => fail ? Promise.reject(new Error('offline')) : { code: 0, data: null });
    await api.fetchAgentDetail('a');
    await expect(api.deleteSop('a', 's')).rejects.toThrow();
    expect(db.sopSets.a).toHaveLength(1);
    fail = false;
    await api.deleteSop('a', 's');
    expect(db.sopSets.a).toEqual([]);
  });
  it('updates rule and inline rule-set caches only after persistence', async () => {
    const { api, db } = setup(() => ({ code: 0, data: { id: 'r', ruleSetId: 'rs', scene: '合规', name: '规则', enabled: true, revision: 1 } }));
    await api.fetchAgentDetail('a');
    await api.saveAgentRule('a', null, { name: '规则', scene: '合规', content: '内容' });
    expect(db.agentRules.a[0].revision).toBe(1);
    expect(db.ruleSets.a).toEqual([{ id: 'rs', name: '合规', desc: '', revision: 1 }]);
  });
  it('updates an existing rule with POST and its revision, preserving the cache on failure', async () => {
    const rule = { id: 'r', ruleSetId: 'rs', scene: '合规', name: '规则', enabled: true, revision: 1 };
    const { api, db, request } = setup(() => ({ code: 0, data: { ...rule, enabled: false, revision: 2 } }));
    await api.fetchAgentDetail('a'); db.agentRules.a = [rule];
    await api.saveAgentRule('a', rule, { enabled: false });
    expect(request).toHaveBeenLastCalledWith('/api/agents/a/rules/r', { method: 'POST', body: JSON.stringify({ enabled: false, revision: 1 }) });
    expect(db.agentRules.a[0]).toMatchObject({ enabled: false, revision: 2 });
    request.mockRejectedValueOnce(new Error('配置版本冲突'));
    await expect(api.saveAgentRule('a', db.agentRules.a[0], { enabled: true })).rejects.toThrow('配置版本冲突');
    expect(db.agentRules.a[0]).toMatchObject({ enabled: false, revision: 2 });
  });
  it('replaces bindings with the authoritative response and does not increment fake installs', async () => {
    const data = detail(); data.extensions = [{ id: 'ext', name: '扩展', installs: 0 }];
    const { api, db, request } = setup(() => ({ code: 0, data }));
    await api.fetchAgentDetail('a');
    await api.setExpertBinding('a', 'extensions', 'ext', true);
    expect(request.mock.lastCall[0]).toBe('/api/agents/a/extensions/ext');
    expect(db.agentExts.a).toEqual(['ext']);
    expect(db.extensions[0].installs).toBe(0);
  });
  it('does not partly replace catalogs on a failed load', async () => {
    const { api, db } = setup(url => url.endsWith('/templates') ? Promise.reject(new Error('offline')) : { code: 0, data: [{ id: 'fresh' }] });
    db.extensions = [{ id: 'old' }];
    await expect(api.fetchExpertCatalogs()).rejects.toThrow();
    expect(db.extensions).toEqual([{ id: 'old' }]);
  });
});
