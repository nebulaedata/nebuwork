import { esc, lifetime, knowledgeModal, modalFooter, statusLabel } from './lifecycle.js';
import { openConnectionEditor } from './editors.js';
import { renderOperations } from './management.js';
import { openCreationTemplates } from './creationTemplates.js';
import { renderCreationJobs } from './creation.js';
import { knowledgeHref } from './routes.js';
import { v101WorkspaceHref } from './v101Workspace.js';

export async function renderKnowledgeAdministration(el, renderCatalog) {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  if (query.get('view') === 'library') {
    location.hash = knowledgeHref({connectionId:query.get('connection'),collectionId:query.get('collection')},{tab:'document',from:'#/settings?tab=knowledge'});return;
  }
  el.innerHTML = '<div class="page settings-page knowledge-settings-page"><h2>知识库</h2><div data-admin></div><div data-mine></div><section class="card card-pad knowledge-settings-card" data-creation-jobs></section><section class="card card-pad knowledge-settings-card" data-operations></section></div>';
  const host = el.querySelector('[data-admin]'), life = lifetime(host);
  void renderCatalog(el.querySelector('[data-mine]'));
  void renderOperations(el.querySelector('[data-operations]'));
  void renderCreationJobs(el.querySelector('[data-creation-jobs]'));
  const load = async () => {
    try {
      const { data: settings } = await API.fetchKnowledgeSettings(life.signal); if (!life.live()) return;
      if (!settings.canEdit) {
        host.innerHTML = '<p class="section-desc">连接由管理员统一配置。你可以创建、维护和引用自己的知识库。</p><p class="dim">当前账号 ID：<code>' + esc(settings.actorId) + '</code></p>'; return;
      }
      const { data: rows } = await API.fetchKnowledgeConnections('user', '', life.signal); if (!life.live()) return;
      host.innerHTML = '<section class="card card-pad knowledge-settings-card"><div class="tc-head"><h3>管理员 · 知识库连接</h3><button class="btn btn-primary" data-add>新增知识库连接</button></div><p class="dim">开放连接允许用户新建自己的库；已有库须逐个分配。地址、空间和密钥仅管理员可配置。</p><div role="alert" class="knowledge-error"></div>' + rows.map((c, i) =>
        '<article class="knowledge-connection"><div class="knowledge-copy"><strong>' + esc(c.name) + '</strong> <span class="pill pill-dim">' + esc(c.driverName) + '</span><div class="dim">' + esc(c.endpoint) + '</div><div>' + esc(statusLabel(c.enabled ? c.testStatus : 'disabled')) + ' · ' + (c.published ? '已开放新建' : '未开放新建') + '</div></div><div class="knowledge-actions">' + [['edit', '配置'], ...(c.driver === 'nebulae-v101-rest' ? [['v101', 'V101 工作区 / 设置']] : []), ...(c.driver === 'nebulae-v100-rest' ? [['templates', '创建模板']] : []), ['test', '测试'], ['discover', '发现 / 分配'], ['usages', '引用位置'], ['delete', '删除连接']].map(([action, label]) => '<button class="btn btn-ghost btn-sm" data-action="' + action + '" data-index="' + i + '">' + label + '</button>').join('') + '</div></article>').join('') + (!rows.length ? '<p class="empty">尚未配置连接</p>' : '') + '</section>';
      host.querySelector('[data-add]').onclick = () => openConnectionEditor({ valid: life.live, onSaved: changed });
      let busy = false;
      host.querySelectorAll('[data-action]').forEach(button => button.onclick = async () => {
        if (busy || !life.live()) return;
        const c = rows[Number(button.dataset.index)], action = button.dataset.action;
        if (action === 'v101') {location.hash=v101WorkspaceHref(c.id, '/settings');return;}
        if (action === 'edit') return openConnectionEditor({ connection: c, valid: life.live, onSaved: changed });
        if (action === 'templates') return openCreationTemplates(c, life.live, changed);
        if (action === 'discover') return assignDialog(c, life.live, changed);
        if (action === 'delete') return knowledgeModal('删除知识库连接', '<p>删除连接「' + esc(c.name) + '」？存在知识库登记、历史引用或待恢复操作时无法删除，可在配置中禁用。</p>' + modalFooter('删除连接'), life.live, ctx => ctx.action('[data-save]', async () => { await API.deleteKnowledgeConnection(c.id, c.revision, ctx.signal); if (!ctx.live()) return; UI.closeModal(); await changed(); }));
        busy = true; button.disabled = true;
        try {
          if (action === 'test') { await API.testKnowledgeConnection(c.id, life.signal); if (life.live()) await load(); }
          else {
            const { data } = await API.fetchKnowledgeUsages(c.id, life.signal); if (!life.live()) return;
            knowledgeModal('连接引用位置', '<div>' + data.map(r => '<p>' + esc(r.kind) + ' · ' + esc(r.name || r.id) + (r.version ? ' · v' + esc(r.version) : '') + '</p>').join('') + (!data.length ? '<p>暂无引用</p>' : '') + '</div><div class="modal-foot"><button class="btn btn-ghost" data-close>关闭</button></div>', life.live, () => {});
          }
        } catch (error) { if (life.live() && error.name !== 'AbortError') host.querySelector('[role=alert]').textContent = error.message; }
        finally { busy = false; if (life.live()) button.disabled = false; }
      });
    } catch (error) { if (life.live() && error.name !== 'AbortError') { host.innerHTML = '<p role="alert">' + esc(error.message) + '</p><button class="btn btn-ghost" data-retry>重新加载</button>'; host.querySelector('[data-retry]').onclick = load; } }
  };
  const changed = async () => { await load(); if (life.live()) await renderCatalog(el.querySelector('[data-mine]')); };
  await load();
}

function assignDialog(connection, valid, changed) {
  knowledgeModal('发现 / 分配知识库 · ' + connection.name, '<p class="dim">请选择远端库，并填写统一用户服务的账号 ID。分配会授予该账号内容管理权限；共享历史引用不会自动升级为写权限。</p><div class="field"><label>远端知识库</label><div data-collection></div></div><div data-owner class="dim"></div><div class="field"><label for="ka-owner">接收账号 ID</label><input id="ka-owner" maxlength="160"></div><button class="btn btn-ghost" data-refresh>刷新远端目录</button>' + modalFooter('确认分配'), valid, ctx => {
    let rows = [];
    const picker = ctx.select('[data-collection]', { label: '远端知识库', onChange: id => { const row = rows.find(r => r.id === id); ctx.box.querySelector('[data-owner]').textContent = row?.ownerId ? '当前归属：' + row.ownerId : '当前未分配；可能存在历史只读引用。'; } });
    const load = async () => { const result = await API.discoverKnowledgeCollections(connection.id, ctx.signal); if (!ctx.live()) return; rows = result.data.collections; picker.setOptions(rows.map(r => ({ value: r.id, label: r.name + ' · ' + r.id }))); };
    ctx.action('[data-refresh]', load); void load().catch(ctx.error);
    ctx.action('[data-save]', async () => {
      const ownerId = ctx.box.querySelector('#ka-owner').value.trim(), collectionId = picker.getValue(); if (!ownerId || !collectionId) throw new Error('请选择知识库并填写账号 ID');
      await API.assignKnowledgeCollection(connection.id, { ownerId, collectionId }, ctx.signal); if (!ctx.live()) return; UI.closeModal(); UI.toast('知识库已分配'); await changed();
    });
  });
}
