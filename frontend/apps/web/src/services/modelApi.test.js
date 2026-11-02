import { describe, expect, it, vi } from 'vitest';
import { createModelApi } from './modelApi.js';

const ok = data => ({ code: 0, data });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

describe('current-user model configuration', () => {
  it('serializes partial settings writes using the preceding committed revision', async () => {
    const gate = deferred(), sent = [];
    const request = vi.fn(async (_path, options) => {
      if (!options) return ok({ revision: 0 });
      const body = JSON.parse(options.body); sent.push(body);
      if (sent.length === 1) await gate.promise;
      return ok({ ...body, revision: body.revision + 1 });
    });
    const db = {}, api = createModelApi(request, db);
    const first = api.saveModelSettings({ defaultProviderId: 'mine' });
    const second = api.saveModelSettings({ retainAuditTrail: false });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    gate.resolve(); await Promise.all([first, second]);
    expect(sent).toEqual([{ defaultProviderId: 'mine', revision: 0 }, { retainAuditTrail: false, revision: 1 }]);
    expect(request.mock.calls.filter(([, options]) => options).map(([path, options]) => [path, options.method]))
      .toEqual([['/api/model-settings', 'POST'], ['/api/model-settings', 'POST']]);
    expect(db.modelSettings.revision).toBe(2);
  });
  it('stops queued writes after a conflict and requires an explicit reload', async () => {
    let conflict = true;
    const request = vi.fn(async (_path, options) => {
      if (!options) return ok({ revision: 5 });
      if (conflict) throw Object.assign(new Error('版本冲突'), { status: 409 });
      return ok({ revision: JSON.parse(options.body).revision + 1 });
    });
    const db = {}, api = createModelApi(request, db);
    const results = await Promise.allSettled([api.saveModelSettings({ retainAuditTrail: false }), api.saveModelSettings({ autoMemoryBackflow: false })]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(request.mock.calls.filter(([, options]) => options)).toHaveLength(1);
    expect(db.modelSettings).toBeNull();
    conflict = false; await api.fetchModelSettings();
    await api.saveModelSettings({ retainAuditTrail: false });
    expect(db.modelSettings.revision).toBe(6);
  });
  it('rejects old-account responses and does not send queued writes under the new account', async () => {
    let version = 1;
    const gate = deferred(), request = vi.fn(async (_path, options) => options ? gate.promise : ok({ revision: 0 }));
    const db = {}, api = createModelApi(request, db, () => version);
    const first = api.saveModelSettings({ defaultProviderId: 'old' });
    const second = api.saveModelSettings({ retainAuditTrail: false });
    const results = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    version = 2; db.modelSettings = null;
    gate.resolve(ok({ revision: 1, defaultProviderId: 'old' }));
    expect((await results).every(result => result.status === 'rejected')).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(db.modelSettings).toBeNull();
  });
  it('ignores a stale list read after a successful creation', async () => {
    const gate = deferred();
    const db = {}, api = createModelApi(async (_path, options) => options ? ok({ id: 'new' }) : gate.promise, db);
    const read = api.fetchModelProviders();
    await api.createModelProvider({}); gate.resolve(ok([])); await read;
    expect(db.modelProviders).toEqual([{ id: 'new' }]);
  });
  it('reloads settings revision after deletion before the next write', async () => {
    let revision = 1;
    const writes = [];
    const db = {}, api = createModelApi(async (_path, options) => {
      if (!options) return ok({ revision, defaultProviderId: null });
      if (options.method === 'DELETE') { revision++; return ok(null); }
      writes.push(JSON.parse(options.body)); return ok({ revision: ++revision });
    }, db);
    await api.fetchModelSettings();
    await Promise.all([api.deleteModelProvider('mine'), api.saveModelSettings({ defaultProviderId: null })]);
    expect(writes[0].revision).toBe(2);
  });
});
