/* views/plaza.js — 广场:案例模板 / 扩展市场 / 专家智能体市场(顶部二级菜单) */
(function () {
  window.Views = window.Views || {};

  const PL_TABS = [
    ['tpl', '案例模板', 'layout-template'], ['ext', '扩展市场', 'puzzle'],
    ['agent', '专家智能体市场', 'bot'], ['kb', '共享知识库', 'book-open']
  ];
  const EXT_KIND = { skill: ['技能', 'sparkles'], mcp: ['MCP', 'workflow'], plugin: ['插件', 'puzzle'] };

  /* ---------- 案例模板 ---------- */
  function tabTpl() {
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
            <button class="btn btn-ghost btn-sm" data-use-tpl="${t.id}">${ICON('plus', 12)}使用模板</button>
          </div>
        </div>`).join('')}
    </div>`;
  }

  /* ---------- 扩展市场(技能 / MCP / 插件) ---------- */
  function tabExt() {
    const groups = ['skill', 'mcp', 'plugin'].map(k => ({
      kind: k, label: EXT_KIND[k][0], icon: EXT_KIND[k][1],
      list: DB.extensions.filter(x => x.kind === k)
    }));
    return `
    <div class="grid grid-3 reveal">
      ${groups.map(g => `
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:12px">${ICON(g.icon, 15)}${g.label}<span class="pill pill-dim" style="margin-left:8px">${g.list.length}</span></div>
          ${g.list.map(x => `
            <div class="file-row" style="align-items:flex-start">
              <span class="file-icon" style="color:${x.color};background:${x.color}1A">${ICON(g.icon, 14)}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:12.5px">${UI.esc(x.name)} <span class="dim mono" style="font-size:10.5px;margin-left:4px">${x.version}</span></div>
                <div class="dim" style="font-size:11px;margin-top:3px;line-height:1.5">${UI.esc(x.desc)}</div>
                <div class="dim mono" style="font-size:10.5px;margin-top:3px">${ICON('download', 10)} ${x.installs} 次安装</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-install="${x.id}" style="flex-shrink:0">安装</button>
            </div>`).join('')}
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
            <span>${ICON('download', 12)}${a.installs}</span>
            <span>${ICON('sparkles', 12)}${a.rating} 分</span>
            <span class="pill pill-dim">市场认证</span>
          </div>
          <div class="agent-foot">
            <button class="btn btn-ghost btn-sm" data-hire="${a.id}">${ICON('plus', 12)}添加到我的专家</button>
          </div>
        </div>`).join('')}
    </div>`;
  }

  /* ---------- 共享知识库 ---------- */
  function tabKb() {
    return `
    <div class="grid grid-3 reveal">
      ${DB.sharedKbs.map(k => `
        <div class="card card-pad plaza-card">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <span class="wb-icon" style="--wc:#4C9AFF;width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center">${ICON('book-open', 16)}</span>
            <div style="min-width:0">
              <div style="font-size:13.5px;font-weight:600">${UI.esc(k.name)}</div>
              <div class="dim" style="font-size:11px;margin-top:2px">${UI.esc(k.owner)} · ${UI.esc(k.field)}</div>
            </div>
          </div>
          <div class="sub" style="font-size:12px;line-height:1.6;min-height:38px">${UI.esc(k.desc)}</div>
          <div class="dim mono" style="font-size:11px;margin-top:10px">${k.docs} 文档 · ${k.chunks} 切片 · 更新 ${k.updatedAt}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">
            <span class="dim mono" style="font-size:11px">${ICON('users', 11)} ${k.refs} 个专家引用</span>
            <button class="btn btn-ghost btn-sm" data-ref-kb="${k.id}">${ICON('plus', 12)}引用知识库</button>
          </div>
        </div>`).join('')}
    </div>`;
  }

  Views.plaza = {
    async render(el, param, query) {
      el.innerHTML = '<div class="page">' + UI.skeleton(4) + '</div>';
      await API.fetchAgents();
      if (!el.isConnected) return;

      const active = PL_TABS.some(t => t[0] === (query && query.tab)) ? query.tab : 'tpl';
      const counts = { tpl: DB.plazaTemplates.length, ext: DB.extensions.length, agent: DB.plazaAgents.length, kb: DB.sharedKbs.length };
      document.getElementById('topbar-tabs').innerHTML = '<div class="tabs">' +
        PL_TABS.map(([k, label, ic]) => `<button class="tab ${k === active ? 'active' : ''}" data-ptab="${k}">${ICON(ic, 14)}${label}<span class="cnt">${counts[k]}</span></button>`).join('') +
        '</div>';
      document.querySelectorAll('#topbar-tabs [data-ptab]').forEach(b => b.addEventListener('click', () => {
        location.hash = '#/plaza?tab=' + b.dataset.ptab;
      }));

      el.innerHTML = '<div class="page">' +
        '<div class="section-title reveal">广场</div>' +
        '<div class="section-desc reveal" style="margin-bottom:18px">案例模板开箱即用,扩展增强专家能力,市场专家一键纳入团队。</div>' +
        ({ tpl: tabTpl, ext: tabExt, agent: tabAgent, kb: tabKb })[active]() + '</div>';

      el.querySelectorAll('[data-use-tpl]').forEach(b => b.addEventListener('click', async e => {
        e.stopPropagation();
        const t = DB.plazaTemplates.find(x => x.id === b.dataset.useTpl);
        /* TODO: replace with fetch('/api/plaza/templates/' + t.id + '/use', {method:'POST'}) */
        await API.createProject({ name: t.name, workbenchId: 'wb-doc', desc: '由案例模板创建:' + t.desc });
        UI.toast('已按模板创建项目「' + t.name + '」');
      }));
      el.querySelectorAll('[data-install]').forEach(b => b.addEventListener('click', () => {
        const x = DB.extensions.find(v => v.id === b.dataset.install);
        x.installs++;
        b.textContent = '已安装';
        b.disabled = true;
        UI.toast('扩展「' + x.name + '」已安装,可在专家或项目的扩展页启用');
      }));
      el.querySelectorAll('[data-ref-kb]').forEach(b => b.addEventListener('click', () => {
        const k = DB.sharedKbs.find(x => x.id === b.dataset.refKb);
        /* TODO: replace with fetch('/api/plaza/kbs/' + k.id + '/ref', {method:'POST'}) */
        k.refs++;
        b.textContent = '已引用';
        b.disabled = true;
        UI.toast('已引用「' + k.name + '」,可在专家详情的知识库页挂载');
      }));
      el.querySelectorAll('[data-hire]').forEach(b => b.addEventListener('click', async e => {
        e.stopPropagation();
        const a = DB.plazaAgents.find(x => x.id === b.dataset.hire);
        /* TODO: replace with fetch('/api/plaza/agents/' + a.id + '/hire', {method:'POST'}) */
        await API.createAgent({ name: a.name, role: a.role, tagline: a.tagline, color: a.color, model: 'DeepSeek-V4-Pro' });
        b.textContent = '已添加';
        b.disabled = true;
        UI.toast('专家「' + a.name + '」已加入团队');
      }));
    }
  };
})();
