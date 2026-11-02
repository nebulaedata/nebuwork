/* views/agents.js — 专家智能体管理(能力核心)+ 专家详情 */
(function () {
  window.Views = window.Views || {};

  /* ---------- 列表页 ---------- */
  Views.agents = {
    async render(el) {
      el.innerHTML = '<div class="page">' + UI.skeleton(4) + '</div>';
      const { data: agents } = await API.fetchAgents();

      el.innerHTML = `
      <div class="page">
        <div class="pd-head reveal">
          <div>
            <div class="pd-title">专家智能体</div>
            <div class="pd-sub">能力核心:为每位专家配置知识库、记忆、插件与 SOP 工作流,在项目任务中按需调用,能力随数据回流持续提升。</div>
          </div>
          <button class="btn btn-primary" id="btn-new-agent">${ICON('plus', 14)}创建专家</button>
        </div>
        <div class="grid grid-3 reveal reveal-1">
          ${agents.map(a => `
            <div class="card clickable agent-card" data-agent="${a.id}">
              <div class="agent-head">
                <span class="agent-ava" style="background:${a.color}">${UI.esc(a.initials)}</span>
                <div style="flex:1;min-width:0">
                  <div class="agent-name">${UI.esc(a.name)}</div>
                  <div class="agent-role">${UI.esc(a.role)}</div>
                </div>
                <span class="pill pill-dim mono">${a.model}</span>
              </div>
              <div class="agent-tagline">${UI.esc(a.tagline)}</div>
              <div class="agent-kv">
                <div class="kv"><b>${a.stats.tasks}</b><span>累计任务</span></div>
                <div class="kv"><b>${a.stats.successRate}%</b><span>成功率</span></div>
                <div class="kv"><b>${a.stats.tokens}</b><span>Tokens</span></div>
              </div>
              <div class="lvl-bar">
                <span class="mono">Lv.${a.level}</span>
                <div class="bar"><i style="width:${a.xp}%"></i></div>
                <span class="mono">${a.xp}%</span>
              </div>
              <div class="chip-row">
                ${a.plugins.slice(0, 3).map(p => '<span class="chip">' + ICON('puzzle', 11) + UI.esc(p) + '</span>').join('')}
                ${a.kbIds.length ? '<span class="chip">' + ICON('book-open', 11) + a.kbIds.length + ' 个知识库</span>' : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>`;

      el.querySelectorAll('[data-agent]').forEach(c =>
        c.addEventListener('click', () => location.hash = '#/agent/' + c.dataset.agent));
      el.querySelector('#btn-new-agent').addEventListener('click', () => this.openCreateModal());
    },

    openCreateModal() {
      UI.openModal(`
        <div class="modal-head">
          <div class="modal-title">创建专家智能体</div>
          <button class="btn-icon" onclick="UI.closeModal()">${ICON('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div class="field" id="f-aname">
            <label>专家名称</label>
            <input id="na-name" placeholder="例如:合同谈判专家 · 子衿">
            <div class="err">请输入专家名称</div>
          </div>
          <div class="field">
            <label>专业方向</label>
            <input id="na-role" placeholder="例如:合同谈判与条款博弈">
          </div>
          <div class="field">
            <label>基础模型</label>
            <select id="na-model">
              <option>DeepSeek-V3.2</option><option>Qwen3-235B</option><option>Kimi-K2</option>
            </select>
          </div>
          <div class="field">
            <label>能力简介</label>
            <textarea id="na-tagline" rows="2" placeholder="一句话说明这位专家擅长什么"></textarea>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" onclick="UI.closeModal()">取消</button>
          <button class="btn btn-primary" id="na-submit">创建专家</button>
        </div>`);

      document.getElementById('na-submit').addEventListener('click', async () => {
        const name = document.getElementById('na-name').value.trim();
        if (!name) { document.getElementById('f-aname').classList.add('invalid'); return; }
        const btn = document.getElementById('na-submit');
        btn.disabled = true;
        btn.innerHTML = ICON('loader', 14, 'spin') + '创建中…';
        const res = await API.createAgent({
          name,
          role: document.getElementById('na-role').value.trim(),
          model: document.getElementById('na-model').value,
          tagline: document.getElementById('na-tagline').value.trim()
        });
        UI.closeModal();
        UI.toast('专家「' + name + '」已创建');
        location.hash = '#/agent/' + res.data.id;
      });
    }
  };

  /* ---------- 详情页(顶部二级菜单:概览 / SOP / 知识库 / 扩展 / 参与任务 / 消耗统计 / 引用模板) ---------- */
  const AG_TABS = [
    ['overview', '概览', 'layout-dashboard'], ['sop', 'SOP', 'layers'],
    ['kb', '知识库', 'book-open'], ['ext', '扩展', 'puzzle'],
    ['tasks', '参与任务', 'message-square'], ['usage', '消耗统计', 'bar-chart-3'],
    ['tpls', '引用模板', 'layout-template']
  ];
  const EXT_KIND = { skill: ['技能', 'sparkles'], mcp: ['MCP', 'workflow'], plugin: ['插件', 'puzzle'] };

  function agHeadCard(a) {
    return `
      <div class="card card-pad reveal" style="margin-bottom:20px">
        <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
          <span class="agent-ava" style="width:60px;height:60px;font-size:22px;border-radius:16px;background:${a.color}">${UI.esc(a.initials)}</span>
          <div style="flex:1;min-width:220px">
            <div style="display:flex;align-items:center;gap:10px">
              <span class="pd-title" style="font-size:22px">${UI.esc(a.name)}</span>
              <span class="pill pill-primary">Lv.${a.level}</span>
            </div>
            <div class="sub" style="font-size:13px;margin-top:6px">${UI.esc(a.tagline)}</div>
            <div class="dim" style="font-size:12px;margin-top:6px">${UI.esc(a.role)} · 基础模型 <span class="mono">${a.model}</span></div>
          </div>
          <div class="agent-kv" style="min-width:300px">
            <div class="kv"><b>${a.stats.tasks}</b><span>累计任务</span></div>
            <div class="kv"><b>${a.stats.successRate}%</b><span>成功率</span></div>
            <div class="kv"><b>${a.stats.cost}</b><span>累计消耗</span></div>
          </div>
        </div>
      </div>`;
  }

  function agTabOverview(a, d, kbs, exts) {
    return agHeadCard(a) + `
      <div class="grid grid-2">
        <div class="card card-pad reveal reveal-1">
          <div class="tc-title" style="margin-bottom:6px">${ICON('trending-up', 15)}能力提升 · 数据回流</div>
          <div class="section-desc" style="margin-bottom:8px">任务经验自动回流为记忆与规则,推动专家持续进化。</div>
          ${d.growth.length ? d.growth.map(g => `
            <div class="growth-item">
              <span class="growth-icon">${ICON('sparkles', 15)}</span>
              <div>
                <div style="font-size:13px"><span class="pill pill-primary" style="margin-right:8px">${g.kind}</span>${UI.esc(g.desc)}</div>
                <div class="dim" style="font-size:11px;margin-top:5px">${g.time} · 来自任务:${UI.esc(g.from)}</div>
              </div>
            </div>`).join('') : '<div class="empty" style="padding:24px">暂无回流记录,完成任务后自动产生</div>'}
        </div>
        <div class="card card-pad reveal reveal-2">
          <div class="tc-title" style="margin-bottom:12px">${ICON('puzzle', 15)}能力配置摘要</div>
          <div class="file-row"><span class="file-icon">${ICON('layers', 15)}</span><div style="flex:1;font-size:13px">SOP 工作流</div><span class="mono dim">${a.sop.length} 步</span></div>
          <div class="file-row"><span class="file-icon">${ICON('book-open', 15)}</span><div style="flex:1;font-size:13px">挂载知识库</div><span class="mono dim">${kbs.length} 个</span></div>
          <div class="file-row"><span class="file-icon">${ICON('puzzle', 15)}</span><div style="flex:1;font-size:13px">启用扩展</div><span class="mono dim">${exts.length} 个</span></div>
          <div class="lvl-bar" style="margin-top:16px">
            <span class="mono">Lv.${a.level}</span>
            <div class="bar"><i style="width:${a.xp}%"></i></div>
            <span class="mono">${a.xp}%</span>
          </div>
          <div class="dim" style="font-size:11px;margin-top:8px">距下一等级还需 ${100 - a.xp}% 经验,完成任务自动累积</div>
        </div>
      </div>`;
  }

  function agTabSop(a) {
    return agHeadCard(a) + `
      <div class="card card-pad reveal reveal-1" style="max-width:720px">
        <div class="tc-title" style="margin-bottom:16px">${ICON('layers', 15)}SOP 工作流</div>
        <div class="section-desc" style="margin-bottom:12px">专家执行任务的的标准作业流程,每一步可审计、可回流优化。</div>
        <div class="sop-flow">
          ${a.sop.map((s, i) => `<div class="sop-step"><span class="sop-num">${i + 1}</span><div class="sop-text">${UI.esc(s)}</div></div>`).join('')}
        </div>
      </div>`;
  }

  function agTabKb(a, kbs) {
    return agHeadCard(a) + `
      <div class="card card-pad reveal reveal-1">
        <div class="tc-title" style="margin-bottom:12px">${ICON('book-open', 15)}挂载知识库</div>
        ${kbs.length ? kbs.map(kb => `
          <div class="file-row">
            <span class="file-icon">${ICON('book-open', 15)}</span>
            <div style="flex:1"><div style="font-size:13px">${UI.esc(kb.name)}</div><div class="dim" style="font-size:11px">${kb.docs} 文档 · ${kb.chunks} 切片 · 更新 ${kb.updatedAt}</div></div>
          </div>`).join('') : '<div class="empty" style="padding:24px">未挂载知识库</div>'}
      </div>`;
  }

  function agTabExt(a, exts) {
    const groups = ['skill', 'mcp', 'plugin'].map(k => ({
      kind: k, label: EXT_KIND[k][0], icon: EXT_KIND[k][1],
      list: exts.filter(x => x.kind === k)
    }));
    return agHeadCard(a) + `
      <div class="grid grid-3 reveal reveal-1">
        ${groups.map(g => `
          <div class="card card-pad">
            <div class="tc-title" style="margin-bottom:12px">${ICON(g.icon, 15)}${g.label}<span class="pill pill-dim" style="margin-left:8px">${g.list.length}</span></div>
            ${g.list.length ? g.list.map(x => `
              <div class="file-row" style="align-items:flex-start">
                <span class="file-icon" style="color:${x.color};background:${x.color}1A">${ICON(g.icon, 14)}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12.5px">${UI.esc(x.name)} <span class="dim mono" style="font-size:10.5px;margin-left:4px">${x.version}</span></div>
                  <div class="dim" style="font-size:11px;margin-top:3px;line-height:1.5">${UI.esc(x.desc)}</div>
                </div>
              </div>`).join('') : '<div class="empty" style="padding:20px">未启用' + g.label + '</div>'}
            <button class="btn btn-ghost btn-sm" data-ext-add style="margin-top:10px">${ICON('plus', 13)}添加${g.label}</button>
          </div>`).join('')}
      </div>`;
  }

  function agTabTasks(a, d) {
    return agHeadCard(a) + `
      <div class="card reveal reveal-1">
        <div class="tc-head"><span class="tc-title">${ICON('history', 15)}参与任务列表</span><span class="pill pill-dim">${d.tasks.length}</span></div>
        ${d.tasks.length ? d.tasks.map(t => `
          <div class="sess-item" style="cursor:default">
            <div class="s-title">${UI.esc(t.title)}</div>
            <div class="s-meta">
              <span>${UI.esc(t.project)}</span><span>·</span><span>${t.time}</span>
              <span style="flex:1"></span>${UI.statusPill(t.status)}
            </div>
            <div class="s-meta"><span class="mono">Tokens ${t.tokens}</span></div>
          </div>`).join('') : '<div class="empty" style="padding:24px">暂无任务记录</div>'}
      </div>`;
  }

  function agTabUsage(a, d) {
    const series = [8, 14, 11, 19, 16, 24, 21, 28, 25, 32, 29, 36, 33, 41];
    return agHeadCard(a) + `
      <div class="grid grid-4 reveal reveal-1" style="margin-bottom:20px">
        <div class="card stat-card"><div class="s-label">${ICON('zap', 13)}累计 Tokens</div><div class="s-value">${a.stats.tokens}</div><div class="s-foot">全项目合计</div></div>
        <div class="card stat-card"><div class="s-label">${ICON('activity', 13)}累计成本</div><div class="s-value">${a.stats.cost}</div><div class="s-foot">本月账单口径</div></div>
        <div class="card stat-card"><div class="s-label">${ICON('check-circle', 13)}任务成功率</div><div class="s-value">${a.stats.successRate}%</div><div class="s-foot">近 ${a.stats.tasks} 个任务</div></div>
        <div class="card stat-card"><div class="s-label">${ICON('cpu', 13)}基础模型</div><div class="s-value" style="font-size:15px;margin-top:12px">${a.model}</div><div class="s-foot">消耗按模型单价折算</div></div>
      </div>
      <div class="grid grid-2 reveal reveal-2">
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:14px">${ICON('trending-up', 15)}近 14 日 Tokens 消耗(K)</div>
          ${UI.sparkline(series, a.color)}
          <div class="dim" style="font-size:11px;margin-top:8px">峰值 ${Math.max.apply(null, series)}K · 呈稳步上升趋势</div>
        </div>
        <div class="card card-pad">
          <div class="tc-title" style="margin-bottom:14px">${ICON('message-square', 15)}参与任务状态</div>
          ${UI.donut([
            { label: '运行中', value: d.tasks.filter(t => t.status === 'running').length, color: '#4C9AFF' },
            { label: '已完成', value: d.tasks.filter(t => t.status === 'done').length, color: '#3FB6B2' },
            { label: '已失败', value: d.tasks.filter(t => t.status === 'failed').length, color: '#E0645F' }
          ], d.tasks.length + ' 个')}
        </div>
      </div>`;
  }

  /* ---------- 引用模板:专家引用的广场案例模板 ---------- */
  function agTabTpls(a) {
    const ids = DB.agentTpls[a.id] || [];
    const tpls = ids.map(id => DB.plazaTemplates.find(t => t.id === id)).filter(Boolean);
    return agHeadCard(a) + `
      <div class="card reveal reveal-1">
        <div class="tc-head" style="display:flex;align-items:center;justify-content:space-between">
          <span class="tc-title">${ICON('layout-template', 15)}引用的案例模板<span class="pill pill-dim" style="margin-left:8px">${tpls.length}</span></span>
          <button class="btn btn-primary btn-sm" id="btn-ref-more">${ICON('plus', 13)}从广场引用</button>
        </div>
        <div class="tc-body">
          ${tpls.length ? tpls.map(t => `
            <div class="file-row" style="align-items:flex-start">
              <span class="file-icon" style="color:${t.color};background:${t.color}1A">${ICON('layout-template', 15)}</span>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px">${UI.esc(t.name)}<span class="pill pill-dim" style="margin-left:8px">${UI.esc(t.scene)}</span></div>
                <div class="dim" style="font-size:11.5px;margin-top:3px;line-height:1.5">${UI.esc(t.desc)}</div>
                <div class="dim mono" style="font-size:10.5px;margin-top:3px">${ICON('download', 10)} ${t.uses} 次使用 · ${t.agents} 个专家协同</div>
              </div>
              <button class="btn btn-ghost btn-sm" data-untpl="${t.id}" style="flex-shrink:0;color:var(--danger)">取消引用</button>
            </div>`).join('') : '<div class="empty" style="padding:26px">暂未引用案例模板,点击右上角「从广场引用」添加</div>'}
        </div>
      </div>`;
  }

  Views.agent = {
    async render(el, agentId, query) {
      el.innerHTML = '<div class="page">' + UI.skeleton(5) + '</div>';
      const { data: d } = await API.fetchAgentDetail(agentId);
      if (!d.agent) {
        el.innerHTML = '<div class="page"><div class="card empty">' + ICON('alert-triangle', 34) + '<div>专家不存在</div><a class="btn btn-ghost btn-sm" href="#/agents">返回列表</a></div></div>';
        return;
      }
      const a = d.agent;
      document.getElementById('topbar-title').innerHTML = '<a class="crumb-link" href="#/agents">专家智能体</a>';
      document.getElementById('topbar-crumb').innerHTML = ' / <b>' + UI.esc(a.name) + '</b>';
      const kbs = a.kbIds.map(id => DB.knowledgeBases.find(k => k.id === id)).filter(Boolean);
      const exts = (DB.agentExts[a.id] || []).map(id => DB.extensions.find(x => x.id === id)).filter(Boolean);
      const counts = { kb: kbs.length, ext: exts.length, tasks: d.tasks.length, tpls: (DB.agentTpls[a.id] || []).length };
      const active = AG_TABS.some(t => t[0] === (query && query.tab)) ? query.tab : 'overview';

      document.getElementById('topbar-tabs').innerHTML = '<div class="tabs">' +
        AG_TABS.map(([k, label, ic]) => `<button class="tab ${k === active ? 'active' : ''}" data-agtab="${k}">${ICON(ic, 14)}${label}${counts[k] !== undefined ? '<span class="cnt">' + counts[k] + '</span>' : ''}</button>`).join('') +
        '</div>';
      document.querySelectorAll('#topbar-tabs [data-agtab]').forEach(b => b.addEventListener('click', () => {
        location.hash = '#/agent/' + agentId + '?tab=' + b.dataset.agtab;
      }));

      const painters = {
        overview: () => agTabOverview(a, d, kbs, exts), sop: () => agTabSop(a),
        kb: () => agTabKb(a, kbs), ext: () => agTabExt(a, exts),
        tasks: () => agTabTasks(a, d), usage: () => agTabUsage(a, d),
        tpls: () => agTabTpls(a)
      };
      el.innerHTML = '<div class="page">' + painters[active]() + '</div>';

      el.querySelectorAll('[data-ext-add]').forEach(b => b.addEventListener('click', () => {
        location.hash = '#/plaza?tab=ext';
      }));
      const refMore = el.querySelector('#btn-ref-more');
      if (refMore) refMore.addEventListener('click', () => { location.hash = '#/plaza?tab=tpl'; });
      el.querySelectorAll('[data-untpl]').forEach(b => b.addEventListener('click', () => {
        /* TODO: replace with fetch('/api/agents/' + a.id + '/tpls/' + b.dataset.untpl, {method:'DELETE'}) */
        DB.agentTpls[a.id] = (DB.agentTpls[a.id] || []).filter(id => id !== b.dataset.untpl);
        Views.agent.render(el, agentId, query);
        UI.toast('已取消引用');
      }));
    }
  };
})();
