import { createUuid } from '../lib/uuid.js';
export const MAX_FILE_BYTES = 2 * 1024 ** 3;
export const LOCAL_OFFICE_BYTES = 20 * 1024 ** 2;
export const TEXT_PREVIEW_BYTES = 5 * 1024 ** 2;
const enc = encodeURIComponent;
const wait = (ms, signal) => new Promise((resolve, reject) => { if (signal?.aborted) return reject(new DOMException('已取消', 'AbortError')); const stop = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); }; const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms); signal?.addEventListener('abort', stop, { once: true }); });
const hex = buffer => [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
let snapshot = [];
const listeners = new Set();
export const fileUploadStore = { subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, getSnapshot: () => snapshot };
function publish(id, value) { snapshot = [...snapshot.filter(row => row.id !== id), { ...snapshot.find(row => row.id === id), ...value, id }]; listeners.forEach(fn => fn()); }

export function createFileApi(request, endpoint, auth) {
  let accountVersion=auth.getSnapshot().version;
  auth.subscribe?.(()=>{const current=auth.getSnapshot().version;if(current!==accountVersion){accountVersion=current;snapshot=[];listeners.forEach(fn=>fn());}});
  const uploads = project => `/api/projects/${enc(project)}/artifact-uploads`;
  const preview = id => `/api/file-previews/${enc(id)}`;
  const api = {
    createFilePreview: (source, indexText, signal) => request('/api/file-previews', { method: 'POST', body: JSON.stringify({ source, indexText: !!indexText }), signal }),
    createFileDownload: (source, signal) => request('/api/file-previews', { method: 'POST', body: JSON.stringify({ source, downloadOnly: true }), signal }),
    filePreviewStatus: (id, signal) => request(preview(id), { signal }),
    filePreviewUrl: id => endpoint(preview(id) + '/content'),
    filePreviewDownloadUrl: id => endpoint(preview(id) + '/download'),
    filePreviewCell: (id, sheet, row, column, start, signal) => request(`${preview(id)}/sheets/${enc(sheet)}/cell?row=${row}&column=${column}&start=${start}`, { signal }),
    filePreviewAction: (id, action, signal) => request(preview(id) + '/' + action, { method: 'POST', body: '{}', signal }),
    filePreviewRows: (id, sheet, { row = 0, column = 0, limit = 200, columns = 50 } = {}, signal) => request(`${preview(id)}/sheets/${enc(sheet)}/rows?row=${row}&column=${column}&limit=${limit}&columns=${columns}`, { signal }),
    filePreviewLocate: (id, quote, signal) => request(preview(id) + '/locate', { method: 'POST', body: JSON.stringify({ quote }), signal }),
    fileUploadStatus: (project, id, signal) => request(`${uploads(project)}/${enc(id)}`, { signal }),
    cancelFileUpload: (project, id, signal) => request(`${uploads(project)}/${enc(id)}/cancel`, { method: 'POST', body: '{}', signal }),
    async uploadLargeArtifact(project, file, taskId, key = createUuid(), options = {}) {
      if (file.size > MAX_FILE_BYTES) throw new Error('单个文件最大 2048 MiB');
      const identity = auth.getSnapshot(), epoch = identity.version, abort = new AbortController();
      const stop = () => abort.abort(); options.signal?.addEventListener('abort', stop, { once: true }); if (options.signal?.aborted) abort.abort();
      const unsubscribe = auth.subscribe(() => { if (auth.getSnapshot().version !== epoch) { abort.abort(); snapshot = []; listeners.forEach(fn => fn()); } });
      const signature = hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([project, taskId, file.name, file.size, file.lastModified]))));
      const slot = `nebu-file-upload:${identity.user?.id || epoch}:${signature}`;
      let saved; try { saved = JSON.parse(localStorage.getItem(slot) || 'null'); } catch {}
      const requestKey=saved?.key||key;try{localStorage.setItem(slot,JSON.stringify({...saved,key:requestKey}));}catch{} let transfer, id = saved?.id || requestKey;
      const progress = (state, confirmed, extra = {}) => { if (auth.getSnapshot().version !== epoch) return; const value = { name: file.name, projectId: project, taskId, size: file.size, state, confirmed, ...extra }; publish(id, value); options.onProgress?.({ ...value, id }); };
      let cancelled=false,restart=false;
      const retry = async () => {const result=await api.uploadLargeArtifact(project, file, taskId, restart?createUuid():requestKey, options);options.onRetryComplete?.(result.data);return result;};
      try {
        if (saved?.id) { const result = await api.fileUploadStatus(project, saved.id, abort.signal); transfer = result.data; }
        else { const result = await request(uploads(project), { method: 'POST', headers: { 'Idempotency-Key': requestKey }, body: JSON.stringify({ name: file.name, size: file.size, mediaType: file.type || 'application/octet-stream', ...(taskId ? { taskId } : {}) }), signal: abort.signal }); transfer = result.data; }
        id = transfer.id; auth.assertCurrent(epoch);
        if (['expired', 'cancelled'].includes(transfer.status)) { localStorage.removeItem(slot);restart=true;throw new Error('原上传会话已过期或取消，重试将建立新上传'); }
        if (transfer.name !== file.name || transfer.size !== file.size) throw new Error('所选文件与原上传会话不一致');
        try { localStorage.setItem(slot, JSON.stringify({ id, key:requestKey })); } catch {}
        const confirmed = new Map((transfer.parts || []).map(p => [p.number, p]));
        let bytes = [...confirmed.values()].reduce((sum, p) => sum + p.size, 0);
        const partSize = transfer.partSize, total = Math.max(1, Math.ceil(file.size / partSize));
        if (partSize !== 16 * 1024 ** 2 || total > 128) throw new Error('分块上传协议不匹配');
        const cancel = async () => {cancelled=true;abort.abort();auth.assertCurrent(epoch);try{const result=await api.cancelFileUpload(project,id);const state=result.data.status;if(state==='cancelled'){progress('cancelled',bytes,{cancel:null,retry:null});localStorage.removeItem(slot);}else progress(state==='complete'?'complete':'paused',bytes,{cancel:null,error:'文件已进入发布阶段，请查询原上传结果',retry});}catch(error){progress('paused',bytes,{cancel:null,error:error.message,retry});throw error;}};
        progress('verifying', bytes, { cancel, retry });
        // A reselected file must match EVERY previously confirmed part, including completed sessions.
        for (const part of confirmed.values()) { auth.assertCurrent(epoch); if (abort.signal.aborted) throw new DOMException('已取消', 'AbortError'); const value = await file.slice((part.number - 1) * partSize, part.number * partSize).arrayBuffer(); if (hex(await crypto.subtle.digest('SHA-256', value)) !== part.sha256) throw new Error('文件内容与已上传分块不一致，请选择原文件'); }
        let cursor = 1, failure;
        const send = async () => { while (!failure && !abort.signal.aborted) { const number = cursor++; if (number > total) return; if (confirmed.has(number)) continue; const blob = file.slice((number - 1) * partSize, number * partSize, 'application/octet-stream'); const digest = hex(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())); auth.assertCurrent(epoch); try { await request(`${uploads(project)}/${enc(id)}/parts/${number}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Part-Sha256': digest }, body: blob, signal: abort.signal }); bytes += blob.size; progress('uploading', bytes, { cancel, retry }); } catch (e) { failure = e; } } };
        if (transfer.status === 'uploading') { progress('uploading', bytes, { cancel, retry }); await Promise.all([send(), send(), send()]); if (failure) throw failure; }
        if (abort.signal.aborted) throw new DOMException('已取消', 'AbortError');
        if (transfer.status !== 'complete') transfer = (await request(`${uploads(project)}/${enc(id)}/complete`, { method: 'POST', body: '{}', signal: abort.signal })).data;
        while (transfer.status !== 'complete') { if (['failed', 'expired', 'cancelled'].includes(transfer.status)) throw new Error(transfer.error || '文件上传未完成'); progress('sealing', bytes, { cancel, retry }); await wait(2000, abort.signal); transfer = (await api.fileUploadStatus(project, id, abort.signal)).data; }
        auth.assertCurrent(epoch); localStorage.removeItem(slot); progress('complete', file.size, { cancel: null, retry: null }); return { code: 0, data: transfer.result };
      } catch (error) {if(!cancelled)progress(abort.signal.aborted ? 'paused' : 'failed', snapshot.find(row=>row.id===id)?.confirmed || 0, { error: error.message, retry,cancel:null });throw error;}
      finally { unsubscribe(); options.signal?.removeEventListener('abort', stop); }
    },
  };
  return api;
}
