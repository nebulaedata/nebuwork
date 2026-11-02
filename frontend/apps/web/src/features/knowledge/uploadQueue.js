import { createUuid } from '../../lib/uuid.js';
export const MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024;
const bytes = value => new TextEncoder().encode(value).length;

export function validateUpload(file) {
  if (!file.size || file.size > MAX_UPLOAD_SIZE) return '文件不能为空且不得超过 2 GiB';
  if (!file.name?.trim() || file.name.length > 1024 || /[\x00-\x1f\x7f"/\\]/.test(file.name) || ['.', '..'].includes(file.name)) return '文件名无效';
  const relativePath = (file.webkitRelativePath || '').replaceAll('\\', '/');
  if (!relativePath) return '';
  const parts = relativePath.split('/'), directories = parts.slice(0, -1);
  if (/^[\/]|[:\x00-\x1f\x7f"]/.test(relativePath) || parts.at(-1) !== file.name || !directories.length || directories.length > 16) return '相对路径无效或文件夹超过 16 层';
  if (directories.some(p => !p || ['.', '..'].includes(p) || p !== p.trim() || p.endsWith('.') || bytes(p) > 128)) return '文件夹名称无效或超过 128 字节';
  if (bytes(directories.join('/')) > 1024) return '文件夹路径不得超过 1024 字节';
  return '';
}

export function formatUploadSize(size) {
  return size < 1024 ? size + ' B' : size < 1024 * 1024 ? (size / 1024).toFixed(1) + ' KiB' : (size / 1024 / 1024).toFixed(1) + ' MiB';
}

/** File objects and controllers belong to this session, never to a view or storage. */
export function createUploadQueue({ session, upload, makeId = () => createUuid() }) {
  let version = session.getSnapshot().version, batches = [], runner = null, active;
  const listeners = new Set();
  const snapshot = () => batches.map(batch => ({ ...batch, items: batch.items.map(({ file: _file, ...item }) => ({ ...item })) }));
  const publish = () => { const value = snapshot(); listeners.forEach(fn => fn(value)); };
  const cancel = (predicate, message = '已停止剩余上传') => {
    for (const batch of batches) for (const item of batch.items) if (item.status === 'queued' && predicate(batch)) {
      item.status = 'cancelled'; item.message = message; item.file = null;
    }
  };
  const unsubscribeAuth = session.subscribe(() => {
    const next = session.getSnapshot().version;
    if (next === version) return;
    version = next; active?.abort(); active = null; runner = null;
    batches.forEach(batch => batch.items.forEach(item => { item.file = null; }));
    batches = []; publish();
  });
  async function pump() {
    if (runner) return;
    const token = {}; runner = token;
    try {
      while (runner === token) {
        const batch = batches.find(b => b.items.some(i => i.status === 'queued'));
        if (!batch) break;
        const item = batch.items.find(i => i.status === 'queued'), before = version;
        const controller = new AbortController(); active = controller;
        item.status = 'uploading'; publish();
        try {
          const form = new FormData(); form.set('file', item.file); form.set('fileName', item.name);
          form.set('collectionId', batch.target.collectionId); form.set('requestKey', item.requestKey);
          if (item.relativePath) form.set('relativePath', item.relativePath);
          const response = await upload(batch.target.connectionId, form, controller.signal);
          if (before !== version || runner !== token) return;
          item.status = response.data.outcome === 'duplicate' ? 'duplicate' : 'accepted';
          item.operationId = response.data.operationId;
          const raw = response.data.result?.data || response.data.result;
          item.parseStatus = raw?.parse_status || '';
          item.message = item.status === 'duplicate' ? '保留已有文档及其原路径' : '远端已接收，解析和索引状态请在知识库中查看';
        } catch (error) {
          if (before !== version || runner !== token) return;
          item.status = !error.status || error.status >= 500 || error.status === 409 ? 'unknown' : 'failed';
          item.message = error.message || '上传结果待核对';
          const forbidden = [401, 403, 404].includes(error.status) || /连接已禁用|远端认证或权限不足/.test(item.message);
          if (forbidden) cancel(b => b.target.connectionId === batch.target.connectionId && b.target.collectionId === batch.target.collectionId, '目标不可用或权限已失效，已停止剩余上传');
        } finally {
          item.file = null;
          if (runner === token) { active = null; publish(); }
        }
      }
    } finally { if (runner === token) runner = null; }
  }
  return {
    getSnapshot: snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    enqueue(target, files) {
      if (session.getSnapshot().status !== 'authenticated') throw new Error('请先登录');
      if (!target?.connectionId || !target?.collectionId || !files.length) throw new Error('请选择目标知识库和文件');
      for (const file of files) { const error = validateUpload(file); if (error) throw new Error(file.name + '：' + error); }
      const batch = { id: makeId(), target: { ...target }, createdAt: Date.now(), items: files.map(file => ({
        id: makeId(), requestKey: 'knowledge-' + makeId(), file, name: file.name, size: file.size,
        relativePath: (file.webkitRelativePath || '').replaceAll('\\', '/'), status: 'queued', message: '',
      })) };
      batches.push(batch); publish(); void pump(); return batch.id;
    },
    stop(batchId) { cancel(batch => batch.id === batchId); publish(); },
    clearFinished() { batches = batches.filter(b => b.items.some(i => ['queued', 'uploading'].includes(i.status))); publish(); },
    dispose() { unsubscribeAuth(); active?.abort(); runner = null; batches = []; listeners.clear(); },
  };
}
