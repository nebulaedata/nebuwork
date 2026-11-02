import { authSession } from '../../services/authSession.js';
import { esc, knowledgeModal } from './lifecycle.js';
import { libraryHref } from './managementForms.js';
import { createUploadQueue, formatUploadSize, validateUpload } from './uploadQueue.js';
import './uploads.css';

export const knowledgeUploads = createUploadQueue({ session: authSession, upload: (...args) => API.uploadKnowledgeFile(...args) });
export const canUploadCollection = collection => !!collection.canManage && ['document', 'wiki'].includes(collection.type || 'document');
const labels = { queued: '等待', uploading: '上传中', accepted: '已接收', duplicate: '已存在', failed: '失败', unknown: '结果待核对', cancelled: '已停止' };
const parsing = { pending: '等待解析', processing: '解析中', finalizing: '生成增强内容', completed: '解析已完成', failed: '解析失败', cancelled: '解析已取消' };

export async function loadUploadTargets({ target, scope }, api = API, signal) {
  const references = target ? [target] : (scope?.knowledgeBases || []).filter(r => !r.inherited && r.enabled !== false);
  const connections = [...new Set(references.map(r => r.connectionId))];
  const results = await Promise.allSettled(connections.map(id => api.fetchKnowledgeCollections(id, signal)));
  const targets = [], errors = [];
  results.forEach((result, index) => {
    if (result.status === 'rejected') { errors.push(result.reason.message); return; }
    for (const collection of result.value.data.collections || []) {
      if (!canUploadCollection(collection) || !references.some(r => r.connectionId === connections[index] && r.collectionId === collection.id)) continue;
      targets.push({ connectionId: connections[index], collectionId: collection.id, name: collection.name,
        connectionName: scope?.connections?.find(c => c.id === connections[index])?.name || target?.connectionName || '' });
    }
  });
  return { targets, errors };
}

export function openKnowledgeUpload({ target, scope, folder = false, valid = () => true }) {
  knowledgeModal(folder ? '上传文件夹' : '上传文件',
    '<div class="knowledge-upload-form"><label class="field">目标知识库<div data-upload-target></div></label>' +
    '<p class="knowledge-note" data-upload-note>正在检查可上传的知识库…</p>' +
    '<div class="knowledge-actions"><button class="btn btn-ghost" data-pick-files>选择文件（可多选）</button><button class="btn btn-ghost" data-pick-folder>选择文件夹</button>' +
    '<input hidden type="file" multiple data-upload-files aria-label="选择上传文件"><input hidden type="file" multiple webkitdirectory data-upload-folder aria-label="选择上传文件夹"></div>' +
    '<p class="dim">单文件最多 2 GiB。文件夹递归导入并保留来源路径；空文件夹不导入。资料写入此知识库后，其他引用处也会读取更新。</p>' +
    '<div data-upload-summary role="status"></div><div class="knowledge-upload-list" data-upload-selection></div>' +
    '<p class="knowledge-note">开始后可关闭窗口或切换页面，顶部“上传任务”可查看进度。刷新网页、退出或切换账号会停止剩余上传。</p></div>' +
    '<div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" data-upload-start disabled>开始上传</button></div>', valid, ctx => {
      let files = [], targets = [];
      const button = ctx.box.querySelector('[data-upload-start]'), note = ctx.box.querySelector('[data-upload-note]');
      const picker = ctx.select('[data-upload-target]', { label: '上传目标知识库', onChange: () => paint() });
      picker.setDisabled(true);
      const fileInput = ctx.box.querySelector('[data-upload-files]'), folderInput = ctx.box.querySelector('[data-upload-folder]');
      const folderButton = ctx.box.querySelector('[data-pick-folder]');
      const folderSupported = 'webkitdirectory' in folderInput;
      folderButton.disabled = !folderSupported;
      if (!folderSupported) folderButton.title = '当前浏览器不支持文件夹选择，请使用多选文件';
      ctx.box.querySelector(folder ? '[data-pick-folder]' : '[data-pick-files]').classList.add('btn-primary');
      function paint() {
        if (!ctx.live()) return;
        const invalid = files.filter(file => validateUpload(file));
        ctx.box.querySelector('[data-upload-summary]').textContent = files.length ? '已选择 ' + files.length + ' 个文件 · ' + formatUploadSize(files.reduce((sum, file) => sum + file.size, 0)) + (invalid.length ? ' · ' + invalid.length + ' 个文件需移除或调整' : '') : '尚未选择文件';
        const list = ctx.box.querySelector('[data-upload-selection]');
        list.innerHTML = files.map((file, index) => '<div class="knowledge-upload-row"><div class="knowledge-copy"><strong>' + esc(file.webkitRelativePath || file.name) + '</strong><div class="dim">' + formatUploadSize(file.size) + '</div><div class="knowledge-error">' + esc(validateUpload(file)) + '</div></div><button class="btn btn-ghost btn-sm" data-remove-file="' + index + '" aria-label="移除 ' + esc(file.name) + '">移除</button></div>').join('');
        list.querySelectorAll('[data-remove-file]').forEach(b => b.onclick = () => { files.splice(Number(b.dataset.removeFile), 1); paint(); });
        button.disabled = !files.length || !!invalid.length || !picker.getValue();
      }
      const append = input => {
        const incoming = [...input.files]; input.value = '';
        for (const file of incoming) {
          if (!files.some(existing => (existing.webkitRelativePath || existing.name) === (file.webkitRelativePath || file.name) && existing.size === file.size && existing.lastModified === file.lastModified)) files.push(file);
        }
        paint();
      };
      fileInput.onchange = () => append(fileInput); folderInput.onchange = () => append(folderInput);
      ctx.box.querySelector('[data-pick-files]').onclick = () => fileInput.click(); folderButton.onclick = () => folderInput.click();
      ctx.cleanup(() => { files = []; });
      void loadUploadTargets({ target, scope }, API, ctx.signal).then(result => {
        if (!ctx.live()) return;
        targets = result.targets;
        picker.setOptions(targets.map((t, i) => ({ value: String(i), label: t.name + (t.connectionName ? ' · ' + t.connectionName : '') })));
        if (targets.length === 1) picker.setValue('0');
        picker.setDisabled(!targets.length);
        note.textContent = (targets.length ? '仅显示当前账号有管理权限、支持文件上传的知识库。' : '暂无可上传的知识库。请先新增或引用自己的文档知识库；FAQ 请使用导入功能。') + (result.errors.length ? ' 部分目录读取失败：' + result.errors.join('；') : '') + (!folderSupported ? ' 当前浏览器不支持文件夹选择，可多选文件上传。' : '');
        paint();
      }).catch(ctx.error);
      ctx.action('[data-upload-start]', () => {
        const selected = targets[Number(picker.getValue())];
        if (!selected || picker.getValue() === undefined) throw new Error('请选择目标知识库');
        knowledgeUploads.enqueue(selected, files);
        UI.closeModal(); openUploadTasks();
      });
      paint();
    });
}

export function openUploadTasks() {
  knowledgeModal('上传任务', '<p class="knowledge-note">关闭窗口或切换页面后继续上传；刷新网页会停止剩余上传。“已接收”表示文件已送达，解析和索引状态请在知识库中查看。</p><div data-upload-batches></div><div class="modal-foot"><button class="btn btn-ghost" data-clear-finished>清除已结束记录</button><button class="btn btn-primary" data-close>关闭</button></div>', () => authSession.getSnapshot().status === 'authenticated', ctx => {
    const paint = batches => {
      if (!ctx.live()) return;
      ctx.box.querySelector('[data-upload-batches]').innerHTML = batches.map(batch => {
        const waiting = batch.items.filter(i => i.status === 'queued').length;
        const finished = batch.items.filter(i => !['queued', 'uploading'].includes(i.status)).length;
        const counts = Object.entries(labels).map(([key, label]) => { const n = batch.items.filter(i => i.status === key).length; return n ? label + ' ' + n : ''; }).filter(Boolean).join(' · ');
        return '<section class="knowledge-upload-batch"><div class="knowledge-upload-batch-head"><div class="knowledge-copy"><strong>' + esc(batch.target.name) + '</strong><p class="dim">' + esc(counts) + ' · 共 ' + formatUploadSize(batch.items.reduce((sum, i) => sum + i.size, 0)) + '</p></div><a class="btn btn-ghost btn-sm" href="' + esc(libraryHref(batch.target.connectionId, batch.target.collectionId)) + '">打开知识库</a>' + (waiting ? '<button class="btn btn-ghost btn-sm" data-stop-batch="' + esc(batch.id) + '">停止剩余上传</button>' : '') + '</div><progress aria-label="批次已处理文件数" value="' + finished + '" max="' + batch.items.length + '"></progress><div class="knowledge-upload-list">' + batch.items.map(item => '<div class="knowledge-upload-row"><div class="knowledge-copy"><strong>' + esc(item.relativePath || item.name) + '</strong><div class="dim">' + formatUploadSize(item.size) + ' · ' + esc(item.message) + '</div><div class="dim knowledge-id">操作编号：' + esc(item.requestKey) + (item.operationId ? ' · 回执：' + esc(item.operationId) : '') + '</div></div><span class="knowledge-upload-state" data-state="' + item.status + '">' + labels[item.status] + (item.parseStatus ? '<small>' + esc(parsing[item.parseStatus] || item.parseStatus) + '</small>' : '') + '</span></div>').join('') + '</div></section>';
      }).join('') || '<div class="empty">暂无上传任务</div>';
      ctx.box.querySelectorAll('[data-stop-batch]').forEach(b => b.onclick = () => knowledgeUploads.stop(b.dataset.stopBatch));
    };
    ctx.cleanup(knowledgeUploads.subscribe(paint)); paint(knowledgeUploads.getSnapshot());
    ctx.box.querySelector('[data-clear-finished]').onclick = () => knowledgeUploads.clearFinished();
  });
}

/** Refresh only the mounted collection list, never the enclosing expert/workbench editor. */
export function refreshAfterUploads(life, refresh, matches = () => true) {
  let seen = new Set(knowledgeUploads.getSnapshot().flatMap(b => b.items.filter(i => ['accepted', 'duplicate'].includes(i.status)).map(i => i.id)));
  let busy = false, again = false;
  const run = async () => {
    if (busy) { again = true; return; }
    busy = true;
    try { do { again = false; if (life.live()) await refresh(); } while (again && life.live()); }
    catch (error) { if (life.live() && error.name !== 'AbortError') UI.toast(error.message, 'err'); }
    finally { busy = false; }
  };
  life.cleanup(knowledgeUploads.subscribe(batches => {
    let changed = false;
    for (const batch of batches) for (const item of batch.items) if (['accepted', 'duplicate'].includes(item.status) && !seen.has(item.id)) { seen.add(item.id); if (matches(batch.target)) changed = true; }
    if (changed && life.live()) void run();
  }));
}
