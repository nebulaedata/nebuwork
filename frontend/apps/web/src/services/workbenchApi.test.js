import { describe, expect, it, vi } from 'vitest';
import { createWorkbenchApi } from './workbenchApi.js';

const ok = data => ({ code: 0, data });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const wb = (revision = 1) => ({ id: 'mine', name: '我的工作台', projectIds: [], revision });
const config = revision => ({ workbench: wb(revision), config: { revision, agentIds: [], tplIds: [] }, agents: [], templates: [] });

describe('authenticated workbench persistence adapter', () => {
  it('creates a workbench without a remote template dependency', async () => {
    const request=vi.fn().mockResolvedValue(ok(wb())),api=createWorkbenchApi(request,{});
    await api.createWorkbench({ name:'空白' },'stable-key');
    expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][0]).toBe('/api/workbenches');expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({name:'空白'});
  });
  it('clears prototype data and loads workbenches without depending on projects', async () => {
    const db = { workbenches: [{ id: 'demo' }], projects: [{ id: 'demo' }], wbConfigs: { demo: {} } };
    const request = vi.fn(async path => { if (path !== '/api/workbenches') throw new Error('项目不可用'); return ok([wb()]); });
    const api = createWorkbenchApi(request,db);
    expect(db.workbenches).toEqual([]); expect(db.projects).toEqual([]); expect(db.wbConfigs).toEqual({});
    await api.fetchWorkbenches(); expect(db.workbenches).toEqual([wb()]); expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not replace cached configuration or claim success after a conflict', async () => {
    const request = vi.fn(async (_path, options) => { if (options) throw Object.assign(new Error('请重新加载'), { status: 409 }); return ok(config(2)); });
    const db = {}, api = createWorkbenchApi(request,db);
    await api.fetchWorkbenchConfig('mine');
    await expect(api.saveWorkbenchConfig('mine',{ revision: 1, bizName: 'unsaved' })).rejects.toMatchObject({ status: 409 });
    expect(db.wbConfigs.mine).toEqual(config(2));
  });
  it('ignores reads started before writes, including a project detail that contains a workbench', async () => {
    const gate = deferred(), db = {};
    const api = createWorkbenchApi(async (_path, options) => options ? ok(wb(3)) : gate.promise,db);
    const read = api.fetchProjectDetail('p'); const settled = Promise.allSettled([read]);
    await api.updateWorkbench('mine',{ name: '新名称', revision: 2 });
    gate.resolve(ok({ project: { id: 'p' }, workbench: wb(1) }));
    expect((await settled)[0].status).toBe('rejected'); expect(db.workbenches).toEqual([wb(3)]); expect(db.projectDetails).toEqual({});
  });
  it('ignores old-account reads and writes after a new account loads', async () => {
    let epoch = 1;
    const reads = deferred(), writes = deferred(), db = {};
    const request = vi.fn((path, options) => epoch === 2 ? Promise.resolve(ok([])) : options ? writes.promise : reads.promise);
    const api = createWorkbenchApi(request,db,() => epoch);
    const read = api.fetchWorkbenchConfig('mine'), write = api.createProject({ name: 'old', workbenchId: 'mine' },'old-key');
    const results = Promise.allSettled([read,write]);
    epoch = 2; await api.fetchWorkbenches();
    reads.resolve(ok(config(1))); writes.resolve(ok({ id: 'old-project', workbenchId: 'mine' }));
    expect((await results).every(r => r.status === 'rejected')).toBe(true);
    expect(db.workbenches).toEqual([]); expect(db.projects).toEqual([]); expect(db.wbConfigs).toEqual({});
  });
  it('sends explicit revisions, stable idempotency keys and gateway-compatible methods', async () => {
    const request = vi.fn(async path => path.endsWith('/config') || path.includes('/bindings/') ? ok(config(2)) : ok(wb(2)));
    const db = {}, api = createWorkbenchApi(request,db);
    await api.createWorkbench({ name: '空白' },'wb-key');
    await api.createProject({ name: '项目', workbenchId: 'mine' },'project-key');
    await api.saveWorkbenchConfig('mine',{ revision: 1, defaultAgentId: null });
    await api.setWorkbenchBinding('mine','tpls','case id',false,2);
    await api.updateProject('p',{ revision: 1, status: 'archived' });
    const calls = request.mock.calls;
    expect(calls[0][1].headers).toEqual({ 'Idempotency-Key': 'wb-key' });
    expect(calls[1][1].headers).toEqual({ 'Idempotency-Key': 'project-key' });
    expect(calls[2][1].method).toBe('POST'); expect(JSON.parse(calls[2][1].body)).toEqual({ revision: 1, defaultAgentId: null });
    expect(calls[3][0]).toBe('/api/workbenches/mine/bindings/tpls/case%20id'); expect(calls[3][1].method).toBe('POST'); expect(JSON.parse(calls[3][1].body)).toEqual({enabled:false,revision:2});
    expect(calls[4][1].method).toBe('POST');
  });
  it('only removes workbench caches after a successful deletion', async () => {
    let fail = true;
    const db = {}, api = createWorkbenchApi(async (_path, options) => {
      if (!options) return ok(config(1));
      if (fail) throw new Error('工作台已有项目'); return ok(null);
    },db);
    await api.fetchWorkbenchConfig('mine'); db.workbenchVersions.mine = [{ id: 'v1' }];
    await expect(api.deleteWorkbench('mine',1)).rejects.toThrow('已有项目'); expect(db.workbenches).toHaveLength(1);
    fail = false; await api.deleteWorkbench('mine',1);
    expect(db.workbenches).toEqual([]); expect(db.wbConfigs.mine).toBeUndefined(); expect(db.workbenchVersions.mine).toBeUndefined();
  });
});
