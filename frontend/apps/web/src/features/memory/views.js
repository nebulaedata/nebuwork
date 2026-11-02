import { esc, lifetime, knowledgeModal as memoryModal, modalFooter } from '../knowledge/lifecycle.js';
import './memory.css';

export const MEMORY_NAMES = { user: '我的记忆', task: '任务记忆', project: '项目记忆', workbench: '工作台经验', expert: '专家经验' };
const reach = { user: '当前账号的所有任务', task: '当前任务的后续对话', project: '当前项目内的任务', workbench: '当前账号使用此工作台的任务', expert: '当前账号获准使用此专家经验的任务' };
const stateName = { draft: '待审核', active: '已批准', disabled: '已停用', rejected: '已拒绝', deleted: '已删除' };
const syncName = { pending: '等待同步', syncing: '同步中', ready: '已同步', failed: '同步失败', not_required: '尚未发布' };
const recallName = { disabled: '记忆功能未启用', unsupported: '执行内核尚不支持记忆', unavailable: '记忆暂不可用', partial: '部分召回', empty: '未命中', ready: '召回完成' };
const problemName = { revoked: '范围权限已变化', busy: '检索繁忙', unavailable: '服务不可用', sync_pending: '部分来源尚未同步', source_unverified: '部分来源版本无法核验', budget_exhausted: '部分内容超出预算', context_limit: '记忆上下文超出限制' };
const recallStatus = context => [recallName[context.status] || context.status, ...new Set((context.problems || []).map(p => problemName[p.status] || p.status))].join(' · ');
const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const status = entry => entry.state === 'active' && entry.syncState === 'ready' ? (entry.automatic ? '来源已处理' : '已生效') : `${stateName[entry.state] || entry.state} · ${syncName[entry.syncState] || entry.syncState}`;
function sourcePreview(entry) {
  if (!entry.automatic) return entry.content;
  try {
    const source = JSON.parse(entry.content);
    const outcome = { completed: '已完成', failed: '失败', cancelled: '已取消' }[source.status] || source.status;
    return [`执行状态：${outcome}`, source.failure && `失败原因：${source.failure}`, source.userStatement && `用户陈述：${source.userStatement}`, source.assistantConclusions?.length && `助手报告：${source.assistantConclusions.join('；')}`].filter(Boolean).join('\n');
  } catch { return entry.content; }
}

export async function renderMemoryScope(host, { kind, id, valid = () => true, api = window.API }) {
  const life = lifetime(host, valid);
  let items = [], scope = {}, enabled = false, offset = 0, hasMore = false, searching = false, serial = 0, timer;
  life.cleanup(() => clearTimeout(timer));
  host.classList.add('memory-panel');
  host.innerHTML = `<section class="card"><div class="tc-head memory-heading"><h3 class="tc-title">${MEMORY_NAMES[kind]}</h3><div class="memory-actions"><button class="btn btn-ghost btn-sm" data-refresh>刷新</button><button class="btn btn-primary btn-sm" data-create>新增记忆</button></div></div>
    <div class="memory-body"><p class="dim">使用范围：${reach[kind]}。${['workbench','expert'].includes(kind) ? '审核发布后，后续任务可以使用。' : '提升到用户、工作台或专家范围需审核发布。'}</p><p class="memory-notice" data-notice></p>
    <form class="memory-search"><input aria-label="检索记忆" maxlength="4000" placeholder="输入问题，检索已生效的记忆"><button class="btn btn-ghost btn-sm" type="submit">检索</button><button class="btn btn-ghost btn-sm" type="button" data-reset>查看全部</button></form>
    ${kind === 'task' ? '<button class="btn btn-ghost btn-sm" data-context>查看各轮实际使用的记忆</button>' : ''}
    ${kind === 'user' ? '<button class="btn btn-ghost btn-sm" data-cleanup>查看尚未完成的记忆清理</button>' : ''}
    <div class="memory-error" data-error role="alert"></div><div data-items>正在加载…</div><button class="btn btn-ghost btn-sm" data-more hidden>加载更多</button></div></section>`;
  const error = value => { if (life.live() && value.name !== 'AbortError') host.querySelector('[data-error]').textContent = value.message || String(value); };
  const action = (selector, fn) => host.querySelector(selector)?.addEventListener('click', event => {
    event.preventDefault(); if (!life.live()) return; Promise.resolve().then(fn).catch(error);
  });
  function schedule() {
    clearTimeout(timer);
    if (enabled && !searching && items.some(e => ['pending','syncing'].includes(e.syncState))) timer = setTimeout(() => {
      if (!life.live()) return;
      if (document.querySelector('.workbench-config-modal')) { schedule(); return; }
      void load(false).catch(error);
    }, 5000);
  }
  async function load(more = false) {
    const request = ++serial; searching = false; clearTimeout(timer);
    const { data } = await api.fetchMemoryScope(kind, id, more ? offset : 0, life.signal);
    if (!life.live() || request !== serial) return;
    scope = data.scope; enabled = data.enabled; hasMore = data.hasMore; offset = data.nextOffset;
    items = more ? [...items, ...data.items.filter(e => !items.some(old => old.id === e.id))] : data.items;
    host.querySelector('[data-error]').textContent = '';
    host.querySelector('[data-notice]').textContent = enabled ? '任务记录与助手结论保留来源；记忆不代替事实核验。' : '记忆服务未启用。可维护内容，启用后继续同步；普通任务不受影响。';
    if (!enabled) {
      const link = document.createElement('a'); link.href = '#/settings?tab=memory-settings'; link.textContent = ' 查看记忆设置';
      host.querySelector('[data-notice]').append(link);
    }
    host.querySelector('[data-create]').disabled = scope.readOnly;
    paint(); schedule();
  }
  function paint(facts) {
    const data = facts || items;
    host.querySelector('[data-more]').hidden = searching || !hasMore;
    host.querySelector('[data-items]').innerHTML = data.length ? data.map((entry, i) => {
      const fact = Boolean(facts), content = fact ? entry.text : sourcePreview(entry);
      return `<article class="memory-entry"><div class="memory-entry-head"><strong>${esc(entry.title)}</strong>${fact ? `<span class="pill pill-dim">${MEMORY_NAMES[entry.kind]}</span>` : `<span class="pill pill-dim">${esc(status(entry))}</span>`}</div>
        <p class="memory-excerpt">${esc(String(content || '').slice(0, 420))}${String(content || '').length > 420 ? '…' : ''}</p>
        <p class="dim memory-meta">${entry.automatic ? '自动提取来源 · ' : ''}版本 ${esc(entry.revision)}${entry.updatedAt ? ' · '+date(entry.updatedAt) : ''}${entry.sourceTaskDeleted ? ' · 来源任务已删除，记忆独立保留' : ''}</p>
        ${entry.error ? `<p class="memory-error">${esc(entry.error)}</p>` : ''}
        <div class="memory-actions"><button class="btn btn-ghost btn-sm" data-detail="${i}">内容与来源</button>${!scope.readOnly ? `${fact || entry.state === 'active' ? `<button class="btn btn-ghost btn-sm" data-promote="${i}">提升范围</button>` : ''}
        ${!fact ? `${entry.state !== 'deleted' ? `<button class="btn btn-ghost btn-sm" data-edit="${i}">编辑</button>` : ''}${entry.state === 'draft' ? `<button class="btn btn-primary btn-sm" data-approve="${i}">审核发布</button><button class="btn btn-ghost btn-sm" data-reject="${i}">拒绝</button>` : ''}${entry.state === 'active' ? `<button class="btn btn-ghost btn-sm" data-disable="${i}">停用</button>` : ''}${entry.syncState === 'failed' ? `<button class="btn btn-ghost btn-sm" data-retry="${i}">重试同步</button>` : ''}${entry.state !== 'deleted' ? `<button class="btn btn-ghost btn-sm memory-delete" data-delete="${i}">删除</button>` : ''}` : ''}` : ''}</div></article>`;
    }).join('') : '<div class="empty">暂无记忆记录</div>';
    host.querySelectorAll('[data-detail]').forEach(button => button.onclick = () => details(data[Number(button.dataset.detail)]).catch(error));
    for (const name of ['edit','promote','approve','reject','disable','delete','retry']) host.querySelectorAll(`[data-${name}]`).forEach(button => button.onclick = () => {
      const entry = data[Number(button.dataset[name])];
      Promise.resolve().then(async () => {
        const full = facts ? (await api.fetchMemory(entry.entryId, life.signal)).data : entry;
        if (!life.live()) return;
        if (name === 'edit' || name === 'promote') editor(full, name === 'promote', facts ? entry.text : undefined);
        else confirmAction(full, name);
      }).catch(error);
    });
  }
  async function details(entry) {
    const { data } = await api.fetchMemory(entry.entryId || entry.id, life.signal);
    if (!life.live()) return;
    memoryModal('记忆内容与来源', `<p>${esc(data.title)} · ${esc(status(data))}</p><h4>已提取事实（最多 50 条）</h4>${(data.facts || []).map(f => `<pre class="memory-content">${esc(f.text)}</pre>`).join('') || `<p class="dim">${data.extractionStatus === 'empty' ? '本来源没有提取出可用事实' : data.extractionStatus === 'unavailable' ? '事实读取暂不可用' : '尚无已同步事实'}</p>`}<h4>来源内容</h4><pre class="memory-content">${esc(data.content)}</pre><h4>来源</h4><pre class="memory-content">${esc(JSON.stringify(data.source,null,2))}</pre>
      ${data.source?.taskId && !data.sourceTaskDeleted ? `<a class="btn btn-ghost btn-sm" href="#/task/${encodeURIComponent(data.source.taskId)}">打开来源任务</a>` : ''}
      <h4>版本记录</h4>${(data.history || []).map(v => `<details><summary>v${esc(v.revision)} · ${esc(v.action)} · ${date(v.createdAt)}</summary><pre class="memory-content">${esc(v.entry.content)}</pre></details>`).join('')}<div class="modal-foot"><button class="btn btn-ghost" data-close>关闭</button></div>`, life.live, () => {});
  }
  function editor(entry = null, promote = false, factText) {
    const content = factText ?? (promote && entry?.automatic ? '' : entry?.content ?? '');
    const needsReview = ['workbench','expert'].includes(kind) || entry?.source?.requiresReview;
    memoryModal(promote ? '提升记忆范围' : entry ? '编辑记忆' : '新增记忆', `${promote ? '<div class="field"><label>目标范围</label><div data-target></div></div><p class="memory-notice" data-reach>正在加载可用范围…</p>' : `<p class="dim">使用范围：${reach[kind]}</p>`}
      ${promote && entry?.automatic && !factText ? '<p class="memory-notice">请填写已确认的可复用事实，或先检索并选择提取出的事实。整轮来源不会自动带入目标范围。</p>' : ''}
      <div class="field"><label>标题</label><input data-title maxlength="300" value="${esc(entry?.title || '')}"></div><div class="field"><label>记忆内容</label><textarea data-content rows="10" maxlength="50000">${esc(content)}</textarea></div>
      <p class="dim">只保留目标范围需要的内容，移除无关客户原文、凭据及附件内容。${promote ? '提升至项目后同步；提升至用户、工作台或专家时先保存草稿，审核后生效。' : needsReview ? '保存为待审核草稿，审核后才供其他任务使用。' : '保存后异步提取并同步。'}</p>${modalFooter(promote ? '保存提升' : '保存')}`, life.live, ctx => {
      let picker, targets = [];
      if (promote) {
        picker = ctx.select('[data-target]', { label: '目标记忆范围', onChange: value => {
          const target = targets.find(t => `${t.kind}:${t.scopeId}` === value);
          ctx.box.querySelector('[data-reach]').textContent = target ? `${target.kind === 'project' ? '保存并同步后' : '审核后'}可用于：${reach[target.kind]} · ${target.name}` : '请选择目标范围';
        } });
        api.fetchMemoryTargets(ctx.signal).then(({ data }) => {
          if (!ctx.live()) return;
          targets = data.filter(t => !t.readOnly && !(t.kind === entry.kind && t.scopeId === entry.scopeId));
          picker.setOptions(targets.map(t => ({ value: `${t.kind}:${t.scopeId}`, label: `${MEMORY_NAMES[t.kind]} · ${t.name}` })));
          ctx.box.querySelector('[data-reach]').textContent = '请选择目标范围，确认哪些任务可以复用此内容。';
        }).catch(ctx.error);
      }
      ctx.action('[data-save]', async () => {
        const body = { title: ctx.box.querySelector('[data-title]').value.trim(), content: ctx.box.querySelector('[data-content]').value.trim() };
        let message = '已保存，状态以同步结果为准';
        if (!body.title || !body.content) throw new Error('请填写标题和内容');
        if (promote) {
          const target = targets.find(t => `${t.kind}:${t.scopeId}` === picker.getValue());
          if (!target) throw new Error('请选择目标范围');
          await api.promoteMemory(entry.id, { ...body, revision: entry.revision, kind: target.kind, scopeId: target.scopeId }, ctx.signal);
          message = target.kind === 'project' ? '已提升到项目，等待同步' : '草稿已提交到目标范围，待审核';
        } else if (entry) await api.updateMemory(entry.id, { ...body, revision: entry.revision }, ctx.signal);
        else await api.createMemory(kind, id, body, ctx.signal);
        if (!ctx.live()) return;
        UI.closeModal(); UI.toast(message); await load();
      });
    });
  }
  function confirmAction(entry, action) {
    const label = { approve:'审核发布', reject:'拒绝', disable:'停用', delete:'删除', retry:'重试同步' }[action];
    memoryModal(`${label}记忆`, `<p>${esc(entry.title)}</p><p>${action === 'approve' ? `审核发布后可用于${reach[entry.kind]}。` : action === 'delete' ? '立即停止后续召回，并异步删除远端记忆；历史执行审计保留。' : action === 'disable' ? '停止后续召回，已经发生的执行记录保留。' : '此操作只作用于当前记忆条目。'}</p>${modalFooter(label)}`, life.live, ctx => {
      ctx.action('[data-save]', async () => {
        if (action === 'retry') await api.retryMemory(entry.id, entry.revision, ctx.signal);
        else await api.memoryAction(entry.id, action, entry.revision, ctx.signal);
        if (!ctx.live()) return; UI.closeModal(); await load();
      });
    });
  }
  action('[data-refresh]', () => load()); action('[data-more]', () => load(true));
  action('[data-reset]', () => { host.querySelector('input').value = ''; return load(); });
  action('[data-create]', () => editor());
  action('[data-context]', () => openTaskMemoryHistory(id, life.live, api));
  action('[data-cleanup]', () => openMemoryCleanup(life.live, api));
  host.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault(); const query = host.querySelector('input').value.trim(); if (!query) return;
    const request = ++serial; clearTimeout(timer); searching = true;
    try {
      const { data } = await api.searchMemory(kind, id, query, life.signal);
      if (!life.live() || request !== serial) return;
      host.querySelector('[data-error]').textContent = '';
      host.querySelector('[data-notice]').textContent = recallStatus(data);
      paint(data.results);
    } catch (e) { error(e); }
  });
  try { await load(); } catch (e) { if (life.live()) host.querySelector('[data-items]').textContent = '加载失败，请点击刷新重试'; error(e); }
  return life.dispose;
}

function openMemoryCleanup(valid, api) {
  memoryModal('尚未完成的记忆清理', '<p class="dim">已停止召回。网络恢复后自动继续清理；配置或提取错误可在修复后重试。包含已删除任务的记录，最多显示 100 条。</p><div data-cleanups></div><div class="modal-foot"><button class="btn btn-ghost" data-refresh>刷新</button><button class="btn btn-ghost" data-close>关闭</button></div>', valid, ctx => {
    const load = async () => {
      const { data } = await api.fetchMemoryCleanup(ctx.signal);
      if (!ctx.live()) return;
      ctx.box.querySelector('[data-cleanups]').innerHTML = data.map((entry, i) => `<article class="memory-entry"><strong>${esc(entry.title)}</strong><p>${esc(syncName[entry.syncState] || entry.syncState)} · ${esc(MEMORY_NAMES[entry.kind])}</p><p class="memory-error">${esc(entry.error)}</p>${entry.syncState === 'failed' ? `<button class="btn btn-ghost btn-sm" data-retry-cleanup="${i}">重试清理</button>` : ''}</article>`).join('') || '<p>没有待清理记录</p>';
      data.forEach((entry, i) => ctx.action(`[data-retry-cleanup="${i}"]`, async () => { await api.retryMemory(entry.id, entry.revision, ctx.signal); await load(); }));
    };
    ctx.action('[data-refresh]', load); load().catch(ctx.error);
  });
}

export function openTaskMemoryHistory(id, valid = () => true, api = window.API) {
  memoryModal('任务使用的记忆', '<p class="dim">每轮保存准备召回快照；内核按上下文窗口决定实际注入内容。恢复执行沿用原快照。</p><div data-history>正在加载…</div><div class="modal-foot"><button class="btn btn-ghost" data-close>关闭</button></div>', valid, ctx => {
    api.fetchTaskMemoryContext(id, ctx.signal).then(({ data }) => {
      if (!ctx.live()) return;
      ctx.box.querySelector('[data-history]').innerHTML = (data.runs || []).map(run => `<details class="memory-entry"><summary>${date(run.createdAt)} · ${esc(recallStatus(run.context))} · 准备 ${run.context.results?.length || 0} 条</summary><p class="dim">Run ${esc(run.runId)}</p>${(run.context.results || []).map(f => `<p><strong>${esc(f.title)}</strong> · ${MEMORY_NAMES[f.kind]} v${esc(f.revision)}</p><pre class="memory-content">${esc(f.text)}</pre>`).join('') || '<p class="dim">本轮没有可注入的记忆。</p>'}</details>`).join('') || '<div class="empty">暂无记忆召回记录</div>';
      if (data.used?.length) ctx.box.querySelector('[data-history]').insertAdjacentHTML('beforeend', '<h4>内核实际使用记录</h4>' + data.used.map(record => `<details><summary>Run ${esc(record.runId)} · 实际 ${record.entries?.length || 0} 条</summary><pre class="memory-content">${esc(JSON.stringify(record.entries,null,2))}</pre></details>`).join(''));
      if (data.searches?.length) ctx.box.querySelector('[data-history]').insertAdjacentHTML('beforeend', '<h4>执行中按需检索</h4>' + data.searches.map(s => `<details><summary>${esc(s.record.query)} · ${esc(recallStatus(s.record.context))}</summary><pre class="memory-content">${esc(JSON.stringify(s.record.context.results,null,2))}</pre></details>`).join(''));
    }).catch(ctx.error);
  });
}
