import { openRemoveExpertModal } from '../agents/removeExpertModal.js';
import { renderKnowledgeCatalog } from '../knowledge/views.js';
import { mountExtensionMarket } from './ExtensionMarket.jsx';
/* views/plaza.js — 广场:案例模板 / 扩展市场 / 专家智能体市场(顶部二级菜单) */
(function () {
  window.Views = window.Views || {};

  const PL_TABS = [
    ['tpl', '案例模板', 'layout-template'], ['ext', '扩展市场', 'puzzle'],
    ['agent', '专家智能体市场', 'bot'], ['kb', '共享知识库', 'book-open']
  ];

  function onAction(button, operation) {
    button.addEventListener('click', async event => {
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
      try { await operation(); }
      catch (error) { if (button.isConnected) UI.toast(error.message || '操作失败，请重试', 'err'); }
      finally { button.disabled = false; }
    });
  }

  /* ---------- 案例模板 ---------- */
  function tabTpl(agent) {
    return `
    <div class="grid grid-3 reveal">
      ${DB.plazaTemplates.map(t => `
        <div class="card card-pad clickable plaza-card" data-tpl="${t.id}">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <span class="wb-icon" style="--wc:${t.color};width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center">${ICON('layout-template', 16)}</span>
            <div>
              <div style="font-size:13.5px;font-weight:600">${UI.esc(t.name)}</div>
              <div class="dim" style="font-size:11px;margin-top:2px">${UI.esc(t.scene)} · ${t.agents} 个专家协同</div>
            </div>
          </div>
          <div class="sub" style="font-size:12px;line-height:1.6;min-height:38px">${UI.esc(t.desc)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">
            <span class="dim mono" style="font-size:11px">${ICON('download', 11)} ${t.uses} 次使用</span>
            <button class="btn btn-ghost btn-sm" data-use-tpl="${t.id}" ${!agent || (DB.agentTpls[agent.id] || []).includes(t.id) ? 'disabled' : ''} ${!agent ? 'title="模板直接创建项目暂未接入；请在专业工作台引用模板并发布，再创建项目"' : ''}>${ICON('plus', 12)}${agent ? ((DB.agentTpls[agent.id] || []).includes(t.id) ? '已引用' : '引用到当前专家') : '使用模板（暂未接入）'}</button>
          </div>
        </div>`).join('')}
    </div>`;
  }

  /* ---------- 专家智能体市场 ---------- */
  function tabAgent() {
    return `
    <div class="grid grid-3 reveal">
      ${DB.plazaAgents.map(a => `
        <div class="card clickable agent-card" data-market="${a.id}">
          <div class="agent-head">
            <span class="agent-ava" style="background:${a.color}">${UI.esc(a.name.split(' · ')[1] || a.name.slice(0, 2))}</span>
            <div style="min-width:0">
              <div class="agent-name">${UI.esc(a.name)}</div>
              <div class="agent-role">${UI.esc(a.role)}</div>
            </div>
          </div>
          <div class="agent-tagline">${UI.esc(a.tagline)}</div>
          <div class="agent-stats">
            <span class="pill pill-dim">专家配置</span>
          </div>
          <div class="agent-foot">
            <button class="btn btn-ghost btn-sm" data-hire="${a.id}" ${a.hiredAgentId ? 'disabled' : ''}>${ICON('plus', 12)}${a.hiredAgentId ? '已添加' : '添加到我的专家'}</button>
            ${a.hiredAgentId ? `<button class="btn btn-ghost btn-sm" data-remove-market="${a.id}">${ICON('x', 12)}从我的专家移除</button>` : ''}
          </div>
        </div>`).join('')}
    </div>`;
  }

  /* ---------- 共享知识库 ---------- */
  function tabKb() {
    return '<div data-knowledge-catalog></div>';
  }

  Views.plaza = {
    async render(el, param, query) {
      el.viewCleanup?.(); el.viewCleanup = null;
      const route = location.hash, stamp = {};
      el.expertRender = stamp;
      const live = () => el.isConnected && el.expertRender === stamp && location.hash === route;
      if (query?.tab === 'ext') {
        document.getElementById('topbar-tabs').innerHTML = '<div class="tabs">' + PL_TABS.map(([key,label,icon]) => `<button class="tab ${key==='ext'?'active':''}" data-ptab="${key}">${ICON(icon,14)}${label}<span class="cnt">—</span></button>`).join('') + '</div>';
        document.querySelectorAll('#topbar-tabs [data-ptab]').forEach(button => button.addEventListener('click', () => { location.hash = '#/plaza?tab=' + button.dataset.ptab; }));
        el.innerHTML = '<div class="page"><div data-extension-market></div></div>';
        el.viewCleanup = mountExtensionMarket(el.querySelector('[data-extension-market]'), { query, onCount: count => { if(live())document.querySelector('#topbar-tabs [data-ptab="ext"] .cnt').textContent=String(count); } });
        return;
      }
      el.innerHTML = '<div class="page">' + UI.skeleton(4) + '</div>';
      let agent;
      try {
        await Promise.all([API.fetchAgents(), API.fetchExpertCatalogs()]);
        if (!live()) return;
        agent = query && query.agentId ? (await API.fetchAgentDetail(query.agentId)).data.agent : null;
      } catch (error) {
        if (!live()) return;
        el.innerHTML = '<div class="page"><div class="card empty"><div>' + UI.esc(error.message || '市场加载失败') + '</div><button class="btn btn-ghost btn-sm" data-retry-market>重新加载</button></div></div>';
        el.querySelector('[data-retry-market]').addEventListener('click', () => Views.plaza.render(el, param, query));
        return;
      }
      if (!live()) return;

      const active = PL_TABS.some(t => t[0] === (query && query.tab)) ? query.tab : 'tpl';
      const counts = { tpl: DB.plazaTemplates.length, ext: '—', agent: DB.plazaAgents.length, kb: '—' };
      document.getElementById('topbar-tabs').innerHTML = '<div class="tabs">' +
        PL_TABS.map(([k, label, ic]) => `<button class="tab ${k === active ? 'active' : ''}" data-ptab="${k}">${ICON(ic, 14)}${label}<span class="cnt">${counts[k]}</span></button>`).join('') +
        '</div>';
      document.querySelectorAll('#topbar-tabs [data-ptab]').forEach(b => b.addEventListener('click', () => {
        location.hash = '#/plaza?tab=' + b.dataset.ptab + (agent ? '&agentId=' + encodeURIComponent(agent.id) : '');
      }));

      el.innerHTML = '<div class="page">' +
        '<div class="section-title reveal">广场</div>' +
        '<div class="section-desc reveal" style="margin-bottom:18px">' + (agent ? '当前专家：' + UI.esc(agent.name) + ' · <a href="#/agent/' + encodeURIComponent(agent.id) + '?tab=' + (active === 'ext' ? 'ext' : active === 'kb' ? 'kb' : 'tpls') + '">返回专家</a>' : '浏览案例、扩展与专家配置。') + '</div>' +
        ({ tpl: tabTpl, agent: tabAgent, kb: tabKb })[active](agent) + '</div>';
      if (active === 'kb') void renderKnowledgeCatalog(el.querySelector('[data-knowledge-catalog]'), { valid: live, agentId: agent?.id });

      el.querySelectorAll('[data-use-tpl]').forEach(b => onAction(b, async () => {
        const t = DB.plazaTemplates.find(x => x.id === b.dataset.useTpl);
        if (agent) {
          await API.setExpertBinding(agent.id, 'tpls', t.id, true);
          await Views.plaza.render(el, param, query);
          UI.toast('已引用到当前专家'); return;
        }
        UI.toast('请在专业工作台引用模板并发布，再创建项目', 'err');
      }));
      el.querySelectorAll('[data-hire]').forEach(b => onAction(b, async () => {
        const a = DB.plazaAgents.find(x => x.id === b.dataset.hire);
        await API.hireExpert(a.id);
        if (!live()) return;
        UI.toast('专家「' + a.name + '」已添加');
        await Views.plaza.render(el, param, query);
      }));
      el.querySelectorAll('[data-remove-market]').forEach(b => onAction(b, () => {
        const a = DB.plazaAgents.find(x => x.id === b.dataset.removeMarket);
        openRemoveExpertModal({ api: API, ui: UI, icon: ICON,
          expert: { id: a.hiredAgentId, name: a.name, revision: a.hiredAgentRevision, membershipRevision: a.hiredMembershipRevision },
          onRemoved: () => { if (live()) return Views.plaza.render(el, param, query); }
        });
      }));
    }
  };
})();
