import { esc, statusLabel, lifetime, knowledgeModal, modalFooter } from './lifecycle.js';
import { openReferencePicker } from './editors.js';
import { openKnowledgeBrowser } from './browser.js';
import { collectionDetails } from './connectionCollections.js';
import { mountConfigSelect } from '../../shared/configSelect.jsx';
import './knowledge.css';
import { renderKnowledgeAdministration } from './administration.js';
import { openLibraryCreate, libraryHref } from './managementForms.js';
import { openKnowledgeUpload, canUploadCollection, refreshAfterUploads } from './uploads.js';

const scopeNames = { expert: '专家', workbench: '工作台', project: '项目', user: '统一连接', publication: '发布版本' };
const notice = '<p class="dim knowledge-note">在此配置、浏览与验证检索。启用任务执行后，工作台智能体按本轮授权引用检索项目知识。</p>';
const errorHtml = error => '<div class="knowledge-error" role="alert">' + esc(error.message || '知识库加载失败') + '</div><button class="btn btn-ghost btn-sm" data-retry>重新加载</button>';

export async function renderKnowledgeSettings(el) {
  return renderKnowledgeAdministration(el, renderKnowledgeCatalog);
}

export async function renderKnowledgeScope(host, { kind, id, valid = () => true, onChanged }) {
  if (!host) return;
  const reload = () => renderKnowledgeScope(host, { kind, id, valid, onChanged });
  const changed = onChanged || reload;
  const life = lifetime(host, valid); host.innerHTML = '<div class="card empty">正在读取知识库引用…</div>';
  try {
    const result = await API.fetchKnowledgeScope(kind, id, life.signal); if (!life.live()) return;
    const scope = result.data, rows = scope.knowledgeBases;
    host.innerHTML = '<section class="card wbc-section knowledge-scope-card"><div class="tc-head"><h3 class="tc-title">' + ICON('book-open', 15) + '知识库<span class="pill pill-dim">' + rows.length + '</span></h3><div class="knowledge-actions"><button class="btn btn-ghost btn-sm" data-bind>引用知识库</button><button class="btn btn-ghost btn-sm" data-create-library>新增知识库</button><button class="btn btn-ghost btn-sm" data-refresh>刷新</button></div></div><div class="knowledge-error" role="alert"></div><div class="wbc-resource-list">' +
      rows.map((r, index) => '<div class="file-row wbc-resource-row"><span class="file-icon wbc-resource-icon" style="--resource-color:#6C63F0">' + ICON('book-open', 14) + '</span><div class="wbc-resource-copy"><div class="wbc-resource-name">' + esc(r.name) + (r.inherited ? ' <span class="pill pill-dim">继承 v' + esc(r.sourceVersion) + '</span>' : '') + '</div><div class="wbc-resource-description">' + esc(r.connectionName) + ' · ' + esc(statusLabel(r.enabled && r.connectionStatus !== 'failed' ? r.indexingStatus : r.connectionStatus)) + '</div><div class="dim knowledge-id">' + esc(r.collectionId) + '</div></div><div class="knowledge-actions"><button class="btn btn-ghost btn-sm" data-browse="' + index + '"' + (r.enabled ? '' : ' disabled') + '>浏览 / 检索</button>' + (!r.inherited ? '<button class="btn-icon wbc-remove" data-remove="' + index + '" title="移除引用" aria-label="移除' + esc(r.name) + '的引用">' + ICON('trash-2', 13) + '</button>' : '') + '</div></div>').join('') +
      (!rows.length ? '<div class="wbc-empty">尚未引用知识库，可选择自己的知识库，或通过统一连接新建。</div>' : '') + '</div>' + notice + '</section>';
    host.querySelector('[data-bind]').addEventListener('click', () => openReferencePicker(scope, life.live, changed));
    if (['expert', 'workbench'].includes(kind)) {
      const actions = host.querySelector('.tc-head .knowledge-actions');
      actions.insertAdjacentHTML('afterbegin', '<button class="btn btn-ghost btn-sm" data-upload-files>上传文件</button><button class="btn btn-ghost btn-sm" data-upload-folder>上传文件夹</button>');
      actions.querySelector('[data-upload-files]').onclick = () => openKnowledgeUpload({ scope, valid: life.live });
      actions.querySelector('[data-upload-folder]').onclick = () => openKnowledgeUpload({ scope, folder: true, valid: life.live });
    }
    host.querySelector('[data-create-library]').addEventListener('click', () => openLibraryCreate(scope.connections, life.live, async created => {
      try {
        const current = await API.fetchKnowledgeScope(kind, id, life.signal); if (!life.live()) return;
        await API.bindKnowledge(kind, id, { revision: current.data.revision, connectionId: created.connectionId, collectionId: created.collectionId }, life.signal);
        if (life.live()) await changed();
      } catch (error) { if (life.live()) UI.toast('知识库已创建，引用未完成：' + error.message + '。请通过“引用知识库”重试。', 'err'); }
    }));
    host.querySelector('[data-refresh]').addEventListener('click', changed);
    host.querySelectorAll('[data-browse]').forEach(button => button.addEventListener('click', () => {
      const ref = { ...rows[Number(button.dataset.browse)], scopeKind: kind, scopeId: id };
      openKnowledgeBrowser(ref, (payload, signal) => API.readKnowledgeReference(kind, id, ref.id, payload, signal), life.live);
    }));
    host.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
      const ref = rows[Number(button.dataset.remove)];
      knowledgeModal('移除知识库引用', '<p>移除「' + esc(ref.name) + '」的引用，远端知识库及文档会保留。</p>' + modalFooter('移除引用'), life.live, ctx => ctx.action('[data-save]', async () => {
        await API.unbindKnowledge(kind, id, ref.id, scope.revision, ctx.signal);
        if (!ctx.live()) return; UI.closeModal(); await changed();
      }));
    }));
  } catch (error) { if (life.live() && error.name !== 'AbortError') { host.innerHTML = '<div class="card card-pad">' + errorHtml(error) + '</div>'; host.querySelector('[data-retry]').addEventListener('click', changed); } }
}

function chooseTarget(reference, valid, agentId) {
  knowledgeModal('选择引用目标', '<div class="field"><label>引用到</label><div id="kt-kind"></div></div><div class="field"><label>选择对象</label><div id="kt-target"></div></div><div class="knowledge-note" data-target-note></div><button class="btn btn-ghost btn-sm" data-target-retry>刷新对象列表</button>' + modalFooter('引用此知识库'), valid, ctx => {
    let generation = 0, targetController;
    ctx.cleanup(() => targetController?.abort());
    const target = ctx.select('#kt-target', { label: '选择引用目标' });
    const load = async () => {
      const stamp = ++generation; targetController?.abort(); targetController = new AbortController(); target.setValue(undefined); target.setOptions([]);
      ctx.box.querySelector('[data-target-note]').textContent = '正在读取可引用对象…';
      try {
        const result = await API.fetchKnowledgeTargets(kind.getValue(), targetController.signal);
        if (!ctx.live() || stamp !== generation) return;
        target.setOptions(result.data.map(row => ({ value: row.id, label: row.name })));
        if (kind.getValue() === 'expert' && agentId && result.data.some(row => row.id === agentId)) target.setValue(agentId);
        ctx.box.querySelector('[data-target-note]').textContent = result.data.length ? '' : '暂无可引用对象，请先创建。';
      } catch (error) { if (ctx.live() && stamp === generation) { ctx.box.querySelector('[data-target-note]').textContent = '读取失败，可刷新重试。'; ctx.error(error); } }
    };
    const kind = ctx.select('#kt-kind', { label: '引用目标类型', value: 'expert',
      options: ['expert', 'workbench', 'project'].map(value => ({ value, label: scopeNames[value] })), onChange: () => { ctx.clear(); void load(); } });
    ctx.action('[data-target-retry]', load);
    void load();
    ctx.action('[data-save]', async () => {
      if (!target.getValue()) throw new Error('请选择引用目标');
      const { data: scope } = await API.fetchKnowledgeScope(kind.getValue(), target.getValue(), ctx.signal);
      if (!ctx.live()) return;
      await API.bindKnowledge(kind.getValue(), target.getValue(), { revision: scope.revision, connectionId: reference.connectionId, collectionId: reference.collectionId }, ctx.signal);
      if (!ctx.live()) return; UI.closeModal(); UI.toast('知识库引用已保存');
    });
  });
}
export async function renderKnowledgeCatalog(host, { valid = () => true, agentId } = {}) {
  const life = lifetime(host, valid), reload = () => renderKnowledgeCatalog(host, { valid, agentId });
  host.innerHTML = '<div class="card empty">正在读取统一知识库连接…</div>';
  try {
    const { data: connections } = await API.fetchKnowledgeConnections('user', '', life.signal); if (!life.live()) return;
    host.innerHTML = '<section class="card card-pad knowledge-settings-card"><div class="tc-head"><h3 class="tc-title">我的知识库</h3><a class="btn btn-ghost btn-sm" href="#/settings?tab=knowledge">知识库设置</a></div><p class="dim">仅显示你创建或获分配的知识库，其他账号的内容不可见。</p><div class="knowledge-search"><div class="field knowledge-copy"><label>选择连接</label><div data-catalog-select></div></div><button class="btn btn-ghost btn-sm" data-load>刷新目录</button><button class="btn btn-primary btn-sm" data-create-library>新增知识库</button></div><div class="knowledge-error" role="alert"></div><div data-catalog-items></div></section>';
    let generation = 0, controller;
    const items = host.querySelector('[data-catalog-items]'), note = host.querySelector('[role=alert]');
    const load = async () => {
      const stamp = ++generation; controller?.abort(); controller = new AbortController(); note.textContent = '';
      const count = document.querySelector('[data-ptab="kb"] .cnt'); if (count) count.textContent = '—';
      const id = picker.getValue(); items.textContent = id ? '正在发现知识库…' : '请先选择一个已启用的连接。';
      if (!id) return;
      try {
        const result = await API.fetchKnowledgeCollections(id, controller.signal, true); if (!life.live() || generation !== stamp) return;
        const rows = result.data.collections || [];
        items.innerHTML = rows.map((c, index) => '<div class="knowledge-connection"><div class="knowledge-copy"><div class="knowledge-name">' + esc(c.name) + ' <span class="pill pill-dim">' + esc(statusLabel(c.indexingStatus)) + '</span></div>' + collectionDetails(c) + '<div class="dim knowledge-id">' + esc(c.id) + '</div></div><div class="knowledge-actions">' + (connections.find(x => x.id === id)?.capabilities?.includes('manage') ? '<a class="btn btn-ghost btn-sm" href="' + esc(libraryHref(id, c.id)) + '">管理 / 详情</a>' : '') + '<button class="btn btn-ghost btn-sm" data-browse="' + index + '">浏览 / 检索</button><button class="btn btn-ghost btn-sm" data-reference="' + index + '">引用</button></div></div>').join('') || '<div class="empty">此连接暂无可见知识库</div>';
        const counter = document.querySelector('[data-ptab="kb"] .cnt'); if (counter) counter.textContent = rows.length;
        const ref = index => ({ ...rows[index], collectionId: rows[index].id, connectionId: id, driver: connections.find(c=>c.id===id)?.driver });
        items.querySelectorAll('.knowledge-connection').forEach((row, index) => {
          if (!canUploadCollection(rows[index])) return;
          const actions = row.querySelector('.knowledge-actions');
          actions.insertAdjacentHTML('afterbegin', '<button class="btn btn-ghost btn-sm" data-upload-files>上传文件</button><button class="btn btn-ghost btn-sm" data-upload-folder>上传文件夹</button>');
          actions.querySelector('[data-upload-files]').onclick = () => openKnowledgeUpload({ target: ref(index), valid: life.live });
          actions.querySelector('[data-upload-folder]').onclick = () => openKnowledgeUpload({ target: ref(index), folder: true, valid: life.live });
        });
        items.querySelectorAll('[data-browse]').forEach(b => b.addEventListener('click', () => openKnowledgeBrowser(ref(Number(b.dataset.browse)), (payload, signal) => API.readKnowledgeCatalog(id, ref(Number(b.dataset.browse)).collectionId, payload, signal), life.live)));
        items.querySelectorAll('[data-reference]').forEach(b => b.addEventListener('click', () => chooseTarget(ref(Number(b.dataset.reference)), life.live, agentId)));
      } catch (error) { if (life.live() && generation === stamp && error.name !== 'AbortError') { items.textContent = '目录读取失败，请刷新重试。'; note.textContent = error.message; } }
    };
    const picker = mountConfigSelect(host.querySelector('[data-catalog-select]'), { label: '选择统一知识库连接',
      options: connections.map(c => ({ value: c.id, label: c.name + (c.enabled ? '' : ' · 已禁用'), disabled: !c.enabled })),
      value: connections.find(c => c.enabled)?.id, onChange: () => { void load(); } });
    life.cleanup(() => { controller?.abort(); picker.destroy(); });
    host.querySelector('[data-load]').addEventListener('click', load);
    host.querySelector('[data-create-library]').addEventListener('click', () => openLibraryCreate(connections, life.live, created => { location.hash = libraryHref(created.connectionId, created.collectionId); }));
    await load();
    refreshAfterUploads(life, load, target => target.connectionId === picker.getValue());
  } catch (error) { if (life.live() && error.name !== 'AbortError') { host.innerHTML = errorHtml(error); host.querySelector('[data-retry]').addEventListener('click', reload); } }
}
