import { createUuid } from '../lib/uuid.js';
export function createExtensionMarketApi(request, auth) {
  let epoch = auth.getSnapshot().version;
  const pending = new Map();
  auth.subscribe?.(() => { const next = auth.getSnapshot().version; if (epoch !== next) { pending.clear(); epoch = next; } });
  const base = '/api/market';
  const entry = id => `${base}/extensions/${encodeURIComponent(id)}`;
  async function write(path, body = {}, suppliedKey) {
    const version = auth.getSnapshot().version;
    if (epoch !== version) { pending.clear(); epoch = version; }
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path + ':' + JSON.stringify(body)));
    auth.assertCurrent(version);
    const signature = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('');
    const key = suppliedKey || pending.get(signature) || createUuid();
    pending.set(signature, key);
    const result = await request(path, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) });
    auth.assertCurrent(version); pending.delete(signature); return result;
  }
  return {
    fetchExtensionMarket: (filter = {}, signal) => request(`${base}/extensions?${new URLSearchParams(Object.entries(filter).map(([key, value]) => [key, String(value)]))}`, { signal }),
    fetchMarketExtension: (id, signal) => request(entry(id), { signal }),
    fetchMarketTargets: signal => request(`${base}/targets`, { signal }),
    createMarketExtension: body => write(`${base}/extensions`, body),
    saveMarketExtension: (id, body) => write(`${entry(id)}/draft`, body),
    saveMarketExtensionAuth: (id, body) => write(`${entry(id)}/auth`, body),
    publishMarketExtension: (id, revision) => write(`${entry(id)}/publish`, { revision }),
    listMarketExtension: (id, revision, listed) => write(`${entry(id)}/${listed ? 'restore' : 'withdraw'}`, { revision }),
    async uploadMarketAsset(id, file, path, key, revision) {
      const version = auth.getSnapshot().version;
      const body = new FormData(); body.append('file', file); body.append('path', path); body.append('revision', String(revision));
      const result = await request(`${entry(id)}/files`, { method: 'POST', headers: { 'Idempotency-Key': key }, body });
      auth.assertCurrent(version); return result;
    },
    installMarketExtension: (id, body) => write(`${entry(id)}/install`, body),
    fetchMarketOperations: signal => request(`${base}/operations`, { signal }),
    fetchMarketOperation: (id, signal) => request(`${base}/operations/${encodeURIComponent(id)}`, { signal }),
    retryMarketOperation: id => write(`${base}/operations/${encodeURIComponent(id)}/retry`),
    fetchMarketInstallations: (kind, id, signal) => request(`${base}/installations?${new URLSearchParams({ targetKind: kind, targetId: id })}`, { signal }),
    removeMarketInstallation: (id, body) => write(`${base}/installations/${encodeURIComponent(id)}/remove`, body),
  };
}

export function runtimeScopeHref(kind, id) {
  if (kind === 'expert') return `#/agent/${encodeURIComponent(id)}?tab=ext`;
  if (kind === 'workbench') return `#/workbench?tab=pro&id=${encodeURIComponent(id)}`;
  return `#/project/${encodeURIComponent(id)}?tab=runtime`;
}

export function marketScopeHref(kind, id) {
  return `#/plaza?tab=ext&targetKind=${encodeURIComponent(kind)}&targetId=${encodeURIComponent(id)}`;
}
