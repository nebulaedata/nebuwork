import { createUuid } from '../../lib/uuid.js';
import { authSession } from '../../services/authSession.js';
import { mountConfigSelect } from '../../shared/configSelect.jsx';

export const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
export const errorMessage = error => error.message || '请求失败，请重试';
export const configStatus = wb => wb.publishStatus === 'published' ? '已发布' : wb.activeVersionId ? '有未发布修改' : '未发布';
export function viewScope(el) {
  el.viewCleanup?.(); el.viewCleanup = null;
  const stamp = {}, version = authSession.getSnapshot().version, hash = location.hash;
  el.configViewMount = stamp;
  return () => el.isConnected && el.configViewMount === stamp && location.hash === hash && authSession.getSnapshot().version === version;
}
export function showError(el, error, retry) {
  el.innerHTML = `<div class="page"><div class="card empty"><div role="alert">${esc(errorMessage(error))}</div><button class="btn btn-ghost" data-retry>重新加载</button></div></div>`;
  el.querySelector('[data-retry]').addEventListener('click', retry);
}
/** No raw HTML, links or images are executed by the Markdown preview. */
export function markdown(source = '') {
  let fenced = false;
  return String(source).split('\n').map(line => {
    if (/^```/.test(line)) { fenced = !fenced; return fenced ? '<pre><code>' : '</code></pre>'; }
    if (fenced) return esc(line) + '\n';
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const inline = text => esc(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
    if (heading) return `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`;
    if (/^[-*]\s+/.test(line)) return '<div class="md-list-item">• ' + inline(line.slice(2)) + '</div>';
    return line ? '<p>' + inline(line) + '</p>' : '<br>';
  }).join('') + (fenced ? '</code></pre>' : '');
}
export function creationKey() {
  let fingerprint, key;
  return payload => { const next = JSON.stringify(payload); if (next !== fingerprint) { fingerprint = next; key = createUuid(); } return key; };
}
export function modal(title, html, valid, mount, variant = '') {
  UI.modal(title, html, box => {
    let disposed = false, pending = false;
    const cleanups = [], pickers = [];
    box.classList.add('workbench-config-modal');
    if (variant) box.classList.add(variant);
    const live = () => !disposed && valid();
    const note = document.createElement('div'); note.className = 'config-modal-error'; note.setAttribute('role', 'alert');
    const body = box.querySelector('.modal-body'); body.insertBefore(note, body.querySelector('.modal-foot'));
    UI.setModalCleanup(() => { disposed = true; cleanups.forEach(fn => fn()); box.classList.remove('workbench-config-modal'); if (variant) box.classList.remove(variant); });
    const context = {
      box, live,
      onCleanup(fn) { cleanups.push(fn); },
      select(selector, props) { const picker = mountConfigSelect(box.querySelector(selector), props); pickers.push(picker); cleanups.push(picker.destroy); return picker; },
      error(error) { if (live()) note.textContent = errorMessage(error); },
      action(selector, operation) {
        box.querySelector(selector).addEventListener('click', async () => {
          if (pending || !live()) return;
          pending = true; note.textContent = '';
          const controls = [...box.querySelectorAll('button,input,textarea')].map(node => [node, node.disabled]);
          controls.forEach(([node]) => { node.disabled = true; }); pickers.forEach(p => p.setDisabled(true));
          try { await operation(context); } catch (error) { context.error(error); }
          finally { pending = false; if (live()) { controls.forEach(([node, disabled]) => { node.disabled = disabled; }); pickers.forEach(p => p.setDisabled(false)); } }
        });
      },
    };
    mount(context);
  });
}
export const footer = label => `<div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" data-save>${label}</button></div>`;
export function snapshotHtml(snapshot, execution) {
  const c = snapshot.config, agents = snapshot.agents || [], templates = snapshot.templates || [];
  return `<div class="config-snapshot">${snapshot.workbench ? `<h4>发布时的工作台</h4><p>${esc(snapshot.workbench.name)} · ${esc(snapshot.workbench.desc)}</p>` : ''}<h3>${esc(c.bizName)}</h3><div class="dim">${esc(c.domain)}</div><p>${esc(c.bizDef)}</p>
    ${[['术语 wiki',c.wikiMd],['适用规则',c.applicabilityMd],['排除规则',c.exclusionsMd]].map(([label, value]) => `<h4>${label}</h4><div class="config-markdown">${value ? markdown(value) : '未填写'}</div>`).join('')}
    <h4>业务实体与关系</h4>${entitySummary(c)}<h4>系统提示词</h4><pre>${esc(c.systemPrompt || '未填写')}</pre>
    <h4>专家</h4><p>${agents.map(a => esc(a.name) + (a.id === c.defaultAgentId ? '（默认）' : '')).join('、') || '未引用'}</p>
    <h4>案例模板</h4><p>${templates.map(t => esc(t.name)).join('、') || '未引用'}</p>
    <h4>知识库</h4><p>${(snapshot.knowledgeBases || []).map(k => esc(k.name) + '（' + esc(k.collectionId) + '）').join('、') || '未引用'}</p>
    <div class="dim">知识库固定引用关系，连接配置统一维护，远端内容按任务授权检索，实际引用记录在任务上下文中。</div>
    <div class="dim">本版本固定工作台配置与引用展示信息，不冻结专家内部配置，不包含模型凭据。</div></div>`;
}
export function entitySummary(c) {
  const entities = c.entities || [], relations = c.relations || [];
  return `<div class="config-table-wrap"><table class="table"><thead><tr><th>实体</th><th>说明</th></tr></thead><tbody>${entities.map(e => `<tr><td>${esc(e.name)}</td><td>${esc(e.description)}</td></tr>`).join('') || '<tr><td colspan="2">暂无实体</td></tr>'}</tbody></table></div>
    <div class="config-table-wrap"><table class="table"><thead><tr><th>关系</th><th>源实体 → 目标实体</th><th>说明</th></tr></thead><tbody>${relations.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(entities.find(e => e.id === r.sourceEntityId)?.name)} → ${esc(entities.find(e => e.id === r.targetEntityId)?.name)}</td><td>${esc(r.description)}</td></tr>`).join('') || '<tr><td colspan="3">暂无关系</td></tr>'}</tbody></table></div>`;
}
