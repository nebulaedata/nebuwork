import { mountRuntimeEditor } from '../runtime/RuntimeEditor.jsx';
import { mountDatabaseScope } from '../databases/databaseMount.js';
import { usageText, sumUsage, dailyUsage, usageTrend, taskDistribution, tokenCount } from '../tasks/usage.js';
import { taskRows } from '../tasks/projectPanels.js';
import { esc, date, viewScope, showError, configStatus, modal, footer, snapshotHtml, entitySummary, markdown } from './ui.js';
import { editWorkbench, editOntology } from './editors.js';
import { renderKnowledgeScope } from '../knowledge/views.js';
import { renderMemoryScope } from '../memory/views.js';

const tabs = [['home','首页','layout-dashboard'],['stats','数据统计','bar-chart-3'],['commander','指挥官','command'],['intel','情报中心','radar'],['pro','专业工作台','package']];
const proUrl = id => '#/workbench?tab=pro' + (id ? '&id=' + encodeURIComponent(id) : '');
function card(wb) {
  return `<div class="card wb-card" style="--wc:${esc(wb.color)}"><div class="wb-head"><span class="wb-icon">${ICON(wb.icon, 19)}</span><div><div class="wb-name">${esc(wb.name)}</div><div class="dim">${wb.projectIds.length} 个项目 · ${configStatus(wb)}${wb.activeVersion ? ' · v' + wb.activeVersion : ''}</div></div></div>
    <div class="wb-desc">${esc(wb.desc)}</div><div class="wb-stats"><span>运行中任务 <b>${wb.taskStats?.activeRuns ?? '—'}</b></span><span>累计 Tokens <b>${esc(usageText(wb.taskStats))}</b></span></div><div class="wb-foot"><a class="wb-link" href="#/projects?wb=${encodeURIComponent(wb.id)}">进入工作台 ${ICON('arrow-right', 13)}</a><a class="btn btn-ghost btn-sm" href="${proUrl(wb.id)}">${ICON('settings', 12)}配置</a></div></div>`;
}
function metrics(rows) { return `<div class="grid grid-4" style="margin-bottom:24px">${rows.map(([label,value,foot]) => `<div class="card stat-card"><div class="s-label">${label}</div><div class="s-value"${label==='累计消耗'?' style="font-size:20px;line-height:1.4"':''}>${value}</div><div class="s-foot">${foot}</div></div>`).join('')}</div>`; }

window.Views = window.Views || {};
window.Views.workbench = {
  async render(el, param, query = {}) {
    const valid = viewScope(el), active = tabs.some(t => t[0] === query.tab) ? query.tab : 'home';
    const reload = () => window.Views.workbench.render(el, param, query);
    document.getElementById('topbar-tabs').innerHTML = '<div class="tabs">' + tabs.map(([key,label,icon]) => `<a class="tab ${key === active ? 'active' : ''}" href="#/workbench?tab=${key}">${ICON(icon,14)}${label}</a>`).join('') + '</div>';
    if (active === 'commander' || active === 'intel') {
      el.innerHTML = '<div class="page"><div class="empty">正在打开工作台…</div></div>';
      const { mountWorkbenchHub } = await import('./WorkbenchHub.jsx');
      if (valid()) mountWorkbenchHub(el, active); return;
    }
    el.innerHTML = '<div class="page">' + UI.skeleton(4) + '</div>';
    try {
      if (active === 'pro' && query.id) {
        const result = await API.fetchWorkbenchConfig(query.id); if (valid()) this.config(el, result.data, valid, reload); return;
      }
      const { data: workbenches } = await API.fetchWorkbenches(); if (!valid()) return;
      if (active === 'pro') {
        el.innerHTML = `<div class="page"><div class="section-title">专业工作台</div><div class="section-desc">配置业务本体与资源引用，发布后创建项目。个人工作台按当前账号独立保存。</div>
          <div class="grid grid-2" style="margin-top:16px">${workbenches.map(card).join('')}<button class="card wb-new" id="btn-new-pro">${ICON('plus',22)}<div style="margin-top:8px">定制新工作台</div><div class="dim">定义业务与智能体资源</div></button></div><div class="config-page-error" role="alert"></div></div>`;
        el.querySelector('#btn-new-pro').addEventListener('click', () => {
          if (valid()) editWorkbench(null, valid, wb => { location.hash = proUrl(wb.id); });
        });
        return;
      }
      const { data: projects } = await API.fetchProjects(); if (!valid()) return;
      const sessions = projects.flatMap(p => p.sessions || []).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const usage = sumUsage(projects.map(p=>p.stats)), activeRuns=projects.some(p=>p.stats?.activeRuns==null)?null:projects.reduce((n,p)=>n+p.stats.activeRuns,0);
      const counts = metrics([['专业工作台',workbenches.length,'当前账号'],['项目总数',projects.length,'进行中 '+projects.filter(p=>p.status==='active').length],['运行中任务',tokenCount(activeRuns),'含排队和协作'],['累计消耗',esc(usageText(usage)),'实际模型用量']]);
      el.innerHTML = active === 'home' ? '<div class="page"><div class="wb-hero"><h1>让 <em>专家智能体</em> 驱动你的业务工作台</h1><p>以工作台定义业务，以项目组织资源。</p></div>'+counts+'<div class="section-title">垂直领域工作台</div><div class="grid grid-2">'+(workbenches.map(card).join('')||'<div class="card empty">尚未创建工作台，前往专业工作台开始配置。</div>')+'</div><a class="btn btn-primary" style="margin-top:16px" href="'+proUrl()+'">管理专业工作台</a><div class="section-title" style="margin-top:28px">最近任务</div><div class="card">'+taskRows(sessions.slice(0,8))+'</div></div>'
        : '<div class="page">'+counts+'<div class="grid grid-2"><div class="card card-pad"><div class="tc-title">按项目统计</div>'+(projects.map(p=>'<div class="file-row"><a href="#/project/'+encodeURIComponent(p.id)+'">'+esc(p.name)+'</a><span class="dim">任务 '+tokenCount(p.stats?.tasks)+' · '+esc(usageText(p.stats))+'</span></div>').join('')||'<div class="empty">暂无项目</div>')+'</div><div class="card card-pad"><div class="tc-title">近 14 日 Tokens 消耗</div>'+usageTrend({...usage,daily:dailyUsage(projects.map(p=>p.usage))})+'<div class="tc-title" style="margin-top:20px">任务分布</div>'+taskDistribution(sessions)+'</div></div></div>';

    } catch (error) { if (valid()) showError(el, error, reload); }
  },
  config(el, data, valid, reload) {
    const wb = data.workbench, c = data.config;
    const tint = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#6C63F0';
    const row = (item, kind) => `
      <div class="file-row wbc-resource-row">
        <span class="file-icon wbc-resource-icon" style="--resource-color:${tint(item.color)}">${ICON(kind === 'agents' ? 'bot' : 'layout-template',14)}</span>
        <div class="wbc-resource-copy">
          <div class="wbc-resource-name">${esc(item.name)}${kind === 'tpls' && item.scene ? `<span class="pill pill-dim">${esc(item.scene)}</span>` : ''}${kind === 'agents' && item.id === c.defaultAgentId ? '<span class="pill pill-primary">默认专家</span>' : ''}</div>
          <div class="wbc-resource-description">${esc(kind === 'agents' ? item.role : item.desc)}</div>
        </div>
        <button class="btn-icon wbc-remove" data-unbind="${kind}" data-target="${esc(item.id)}" title="移除引用" aria-label="移除${esc(item.name)}的引用">${ICON('trash-2',13)}</button>
      </div>`;
    el.innerHTML = `
      <div class="page wbc-page">
        <div class="wbc-heading">
          <a class="btn btn-ghost btn-sm" href="${proUrl()}">${ICON('chevron-left',13)}返回列表</a>
          <span class="wb-icon wbc-heading-icon" style="--wc:${tint(wb.color)}">${ICON(wb.icon,15)}</span>
          <h2>${esc(wb.name)} · 配置</h2>
        </div>
        <div class="config-page-error" role="alert"></div>

        <section class="card wbc-section" aria-labelledby="wbc-ontology-title">
          <div class="tc-head">
            <h3 class="tc-title" id="wbc-ontology-title">${ICON('file-text',15)}业务本体定义</h3>
            <button class="btn btn-ghost btn-sm" data-edit>${ICON('pencil',12)}编辑定义</button>
          </div>
          <div class="wbc-definition">
            <div class="wbc-definition-grid">
              <div class="wbc-info-box"><div class="wbc-info-label">业务名称</div><div class="wbc-info-value">${esc(c.bizName || '未定义')}</div></div>
              <div class="wbc-info-box"><div class="wbc-info-label">业务领域</div><div class="wbc-info-value">${esc(c.domain || '未定义')}</div></div>
            </div>
            <div class="wbc-info-box wbc-definition-text"><div class="wbc-info-label">业务本体定义</div><div class="wbc-info-value">${esc(c.bizDef || '未定义')}</div></div>
            <details class="wbc-advanced">
              <summary>${ICON('chevron-right',13)}术语、实体关系与业务规则</summary>
              <div class="wbc-advanced-body"><h4>术语 wiki</h4><div class="config-markdown">${markdown(c.wikiMd || '尚未填写')}</div>${entitySummary(c)}<h4>适用规则</h4><div class="config-markdown">${markdown(c.applicabilityMd || '未填写')}</div><h4>排除规则</h4><div class="config-markdown">${markdown(c.exclusionsMd || '未填写')}</div><h4>系统提示词</h4><pre class="config-text">${esc(c.systemPrompt || '未填写')}</pre></div>
            </details>
          </div>
        </section>

        <div data-runtime-editor></div>
        <div data-knowledge-scope></div>
        <div data-database-scope></div>
        <div data-memory-scope></div>

        ${[['agents','专家智能体','bot','添加专家',data.agents],['tpls','案例模板','layout-template','引用模板',data.templates]].map(([kind,label,icon,action,items]) => `
          <section class="card wbc-section" aria-labelledby="wbc-${kind}-title">
            <div class="tc-head">
              <h3 class="tc-title" id="wbc-${kind}-title">${ICON(icon,15)}${label}<span class="pill pill-dim">${items.length}</span></h3>
              <button class="btn btn-ghost btn-sm" data-add="${kind}">${ICON('plus',12)}${action}</button>
            </div>
            <div class="wbc-resource-list">${items.map(item => row(item,kind)).join('') || `<div class="wbc-empty">${kind === 'agents' ? '尚未配置专家智能体' : '尚未引用案例模板'}</div>`}</div>
          </section>`).join('')}

        <footer class="wbc-management">
          <div class="wbc-publish-copy"><div class="wbc-publish-state"><span class="pill ${wb.publishStatus === 'published' ? 'pill-success' : 'pill-dim'}">${configStatus(wb)}</span>${wb.activeVersion ? `<span>当前发布 v${wb.activeVersion}</span>` : ''}</div><p>修改保存为草稿，发布后可创建项目；已有项目保留原业务版本。运行资源独立发布。</p></div>
          <div class="config-actions">
            <button class="btn btn-ghost btn-sm" data-meta>${ICON('settings',12)}基本信息</button>
            <button class="btn btn-ghost btn-sm" data-history>${ICON('history',12)}发布历史</button>
            <button class="btn btn-primary btn-sm" data-publish>${ICON('upload',12)}发布配置</button>
            <button class="btn-icon" data-reload title="重新加载配置" aria-label="重新加载配置">${ICON('refresh-cw',14)}</button>
            <button class="btn-icon wbc-remove" data-delete title="删除工作台" aria-label="删除工作台">${ICON('trash-2',14)}</button>
          </div>
        </footer>
      </div>`;
    const paint = next => { if (valid()) this.config(el, next, valid, reload); };
    void renderKnowledgeScope(el.querySelector('[data-knowledge-scope]'), { kind: 'workbench', id: wb.id, valid, onChanged: reload });
    void renderMemoryScope(el.querySelector('[data-memory-scope]'), { kind: 'workbench', id: wb.id, valid });
    let pending = false;
    const action = (selector, fn) => el.querySelectorAll(selector).forEach(button => button.addEventListener('click', async () => {
      if (pending || !valid()) return; pending = true;
      const controls = [...el.querySelectorAll('button')].map(b => [b,b.disabled]); controls.forEach(([b]) => { b.disabled = true; });
      el.querySelector('[role=alert]').textContent = '';
      try { await fn(button); } catch (error) { if (valid()) el.querySelector('[role=alert]').textContent = error.message; }
      finally { pending = false; if (valid()) controls.forEach(([b,disabled]) => { b.disabled = disabled; }); }
    }));
    action('[data-reload]', reload);
    action('[data-edit]', () => editOntology(data, valid, paint));
    el.viewCleanup?.(); el.viewCleanup = mountRuntimeEditor(el.querySelector('[data-runtime-editor]'), 'workbench', wb.id);
    if(API.fetchDatabaseScope){const runtimeCleanup=el.viewCleanup;const databaseCleanup=mountDatabaseScope(el.querySelector('[data-database-scope]'),{kind:'workbench',id:wb.id});el.viewCleanup=()=>{runtimeCleanup?.();databaseCleanup();};}
    action('[data-meta]', () => editWorkbench(wb, valid, reload));
    action('[data-unbind]', async b => { const result = await API.setWorkbenchBinding(wb.id,b.dataset.unbind,b.dataset.target,false,c.revision); if (valid()) { paint(result.data); UI.toast('已移除草稿引用'); } });
    action('[data-add]', async b => {
      const kind = b.dataset.add, result = kind === 'agents' ? await API.fetchAgents() : await API.fetchCaseTemplates();
      if (!valid()) return;
      const used = kind === 'agents' ? c.agentIds : c.tplIds, candidates = result.data.filter(item => !used.includes(item.id));
      if (!candidates.length) throw new Error('暂无可引用的资源');
      modal(kind === 'agents' ? '添加专家智能体' : '引用案例模板', '<div class="field"><label>选择资源</label><div id="wr-select"></div></div>' + footer('确认引用'), valid, ctx => {
        const picker = ctx.select('#wr-select', { label: '选择资源', options: candidates.map(item => ({ value: item.id, label: item.name + ' · ' + (item.role || item.scene) })) });
        ctx.action('[data-save]', async () => {
          if (!picker.getValue()) throw new Error('请选择资源');
          const saved = await API.setWorkbenchBinding(wb.id,kind,picker.getValue(),true,c.revision);
          if (!ctx.live()) return; UI.closeModal(); paint(saved.data); UI.toast('引用已保存到草稿');
        });
      });
    });
    action('[data-publish]', () => modal('发布工作台配置', `<p>将当前业务本体、默认专家及资源引用保存为新的发布版本。</p><p>仅影响之后创建的项目，已有项目仍固定原版本。每轮执行使用最新发布的运行资源快照。</p>${footer('确认发布')}`, valid, ctx => ctx.action('[data-save]', async () => {
      const result = await API.publishWorkbench(wb.id,c.revision); if (!ctx.live()) return; UI.closeModal();
      UI.toast('配置已发布为 v' + result.data.version.version); reload();
    })));
    action('[data-delete]', () => modal('删除工作台', `<p>确定删除「${esc(wb.name)}」及其草稿、绑定？发布历史和运行资源版本保留用于追溯，专家与案例目录不会被删除。</p><p>已有项目或正在发布时不能删除。</p>${footer('删除工作台')}`, valid, ctx => ctx.action('[data-save]', async () => {
      await API.deleteWorkbench(wb.id,wb.revision); if (!ctx.live()) return; UI.closeModal(); UI.toast('工作台已删除'); location.hash = proUrl();
    })));
    action('[data-history]', async () => {
      const result = await API.fetchWorkbenchVersions(wb.id); if (!valid()) return;
      modal('发布历史 · ' + wb.name, `<div class="config-history">${result.data.map(v => `<div class="file-row"><span>v${v.version} · ${date(v.publishedAt)}</span><button class="btn btn-ghost btn-sm" data-version="${esc(v.id)}">查看版本</button></div>`).join('') || '<div class="empty">暂无发布记录</div>'}</div><div id="version-preview"></div>`, valid, ctx => {
        ctx.box.querySelectorAll('[data-version]').forEach(b => ctx.action(`[data-version="${b.dataset.version}"]`, async () => {
          const result = await API.fetchWorkbenchVersion(wb.id,b.dataset.version);
          if (ctx.live()) ctx.box.querySelector('#version-preview').innerHTML = `<h3>发布版本 v${result.data.version}</h3><div class="dim">${date(result.data.publishedAt)} · revision ${result.data.sourceRevision}</div>` + snapshotHtml(result.data.snapshot);
        }));
      }, 'workbench-history-modal');
    });
  },
};
