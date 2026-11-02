import { createUuid } from '../lib/uuid.js';
/** Service publishing uses the existing authenticated Java transport. */
export function createWorkbenchServiceApi(request, endpoint, auth) {
  const pending = new Map(); let epoch = auth.getSnapshot().version;
  const enc = encodeURIComponent, manage = wb => '/api/workbenches/' + enc(wb) + '/service';
  async function write(path, body, signal, suppliedKey) {
    const version = auth.getSnapshot().version;
    if (epoch !== version) { pending.clear(); epoch = version; }
    const signature = path + ':' + JSON.stringify(body), key = suppliedKey || pending.get(signature) || createUuid();
    pending.set(signature, key);
    const result = await request(path, { method: 'POST', signal, headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) });
    auth.assertCurrent(version); pending.delete(signature); return result;
  }
  return {
    fetchWorkbenchService: (wb, signal) => request(manage(wb), { signal }),
    saveWorkbenchService: (wb, body, signal) => write(manage(wb), body, signal),
    publishWorkbenchService: (wb, revision, signal) => write(manage(wb) + '/publish', { revision }, signal),
    previewWorkbenchService: (wb, revision, signal) => write(manage(wb) + '/preview', { revision }, signal),
    fetchServiceReleases: (wb, signal) => request(manage(wb) + '/releases', { signal }),
    changeWorkbenchService: (wb, action, body, signal) => {
      if (!['activate', 'disable'].includes(action)) throw new Error('无效服务操作');
      return write(manage(wb) + '/' + action, body, signal);
    },
    createServiceAsset: (wb, body, signal) => write(manage(wb) + '/assets', body, signal),
    fetchServiceAsset: (wb, id, signal) => request(manage(wb) + '/assets/' + enc(id), { signal }),
    testServiceCapability: (wb, key, body, signal, requestKey) => write(manage(wb) + '/test/' + enc(key), body, signal, requestKey),
    fetchServiceOperations: (wb, signal) => request(manage(wb) + '/operations', { signal }),
    fetchServiceOperation: (wb, id, signal) => request('/api/workbench-services/' + enc(wb) + '/operations/' + enc(id), { signal }),
    commandServiceOperation: (wb, id, command, signal) => write('/api/workbench-services/' + enc(wb) + '/operations/' + enc(id) + '/commands', command, signal),
    fetchServiceApps: (wb, signal) => request(manage(wb) + '/apps', { signal }),
    saveServiceApp: (wb, body, signal) => write(manage(wb) + '/apps', body, signal),
    rotateServiceApp: (wb, id, revision, signal) => write(manage(wb) + '/apps/' + enc(id) + '/rotate', { revision }, signal),
    fetchServiceConsent: (id, signal) => request('/api/service-oauth/requests/' + enc(id), { signal }),
    decideServiceConsent: (id, approve, signal) => write('/api/service-oauth/requests/' + enc(id) + '/decision', { approve }, signal),
    serviceUrl: (wb, suffix = 'manifest') => endpoint('/api/workbench-services/' + enc(wb) + '/' + suffix),
  };
}
