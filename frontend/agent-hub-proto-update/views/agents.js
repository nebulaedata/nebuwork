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

  /* ---------- 详情页(顶部二级菜单:概览 / SOP / 知识库 / 扩展 / 参与任务 / 消耗统计 / 引用模板 / 规则库) ---------- */
  const AG_TABS = [
    ['overview', '概览', 'layout-dashboard'], ['sop', 'SOP', 'layers'],
    ['kb', '知识库', 'book-open'], ['ext', '扩展', 'puzzle'],
    ['tasks', '参与任务', 'message-square'], ['usage', '消耗统计', 'bar-chart-3'],
    ['tpls', '引用模板', 'layout-template'], ['rules', '规则库', 'shield']
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

  /* ---------- SOP 集:支持工作流编排与标准化流程两种形态 ---------- */
  function sopSetsOf(a) {
    /* TODO: replace with fetch('/api/agents/' + a.id + '/sop-sets') */
    if (!DB.sopSets[a.id]) {
      /* 未配置 SOP 集的专家:由旧版 a.sop 步骤合成一个标准流程集兜底 */
      DB.sopSets[a.id] = [{
        id: 'sop-' + a.id + '-base', name: a.name + '标准作业流程', kind: 'process',
        desc: '专家执行任务的标准作业流程,每一步可审计、可回流优化。', updatedAt: '08-01',
        proc: { materials: [], specRefs: [], steps: a.sop.map(s => ({ t: s, d: '' })) }
      }];
    }
    return DB.sopSets[a.id];
  }

  function agTabSop(a) {
    const sets = sopSetsOf(a);
    return agHeadCard(a) + `
      <div class="card reveal reveal-1">
        <div class="tc-head" style="display:flex;align-items:center;justify-content:space-between">
          <span class="tc-title">${ICON('layers', 15)}SOP 集<span class="pill pill-dim" style="margin-left:8px">${sets.length}</span></span>
          <button class="btn btn-primary btn-sm" id="btn-sop-new">${ICON('plus', 13)}新建 SOP 集</button>
        </div>
        <div class="audit-filter" id="sop-chips" style="position:static"></div>
        <div class="tc-body" id="sop-detail"></div>
      </div>`;
  }

  function sopWfDetail(set) {
    const cfgs = [
      ['数据源', 'database', set.wf.source], ['处理规则', 'filter', set.wf.rules],
      ['输入', 'log-in', set.wf.input], ['输出', 'log-out', set.wf.output]
    ];
    return `
      <div style="padding:14px 18px 18px">
        <div class="grid grid-2" style="gap:10px;margin-bottom:16px">
          ${cfgs.map(c => `
            <div class="card card-pad" style="box-shadow:none">
              <div class="dim" style="font-size:11px;display:flex;align-items:center;gap:6px;margin-bottom:6px">${ICON(c[1], 12)}${c[0]}</div>
              <div style="font-size:12.5px;line-height:1.6">${UI.esc(c[2] || '未配置')}</div>
            </div>`).join('')}
        </div>
        <div class="dim" style="font-size:11.5px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
          <span>${ICON('workflow', 12)} 工作流节点编排(画布模式)</span>
          <button class="btn btn-ghost btn-sm" data-sop-add-node="${set.id}">${ICON('plus', 12)}节点</button>
        </div>
        <div class="wf-canvas" id="wf-canvas">
          <svg class="wf-edges" id="wf-edges"></svg>
          <div class="wf-canvas-hint">拖拽节点调整位置 · 点击节点编辑 · 悬停节点右上角删除</div>
        </div>
      </div>`;
  }

  function sopProcDetail(set) {
    return `
      <div style="padding:14px 18px 18px">
        <div class="dim" style="font-size:11.5px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
          <span>${ICON('paperclip', 12)} 参考素材文件</span>
          <button class="btn btn-ghost btn-sm" data-sop-upload="${set.id}">${ICON('upload', 12)}上传素材</button>
        </div>
        ${set.proc.materials.length ? set.proc.materials.map(m => `
          <div class="file-row"><span class="file-icon">${ICON('file-text', 14)}</span>
            <div style="flex:1;font-size:12.5px">${UI.esc(m)}</div>
            <button class="btn-icon" data-sop-rm-mat="${set.id}|${UI.esc(m)}" title="移除" style="color:var(--danger)">${ICON('trash-2', 12)}</button>
          </div>`).join('') : '<div class="empty" style="padding:12px;font-size:12px">暂无参考素材,可上传模板、范例等文件</div>'}
        <div class="dim" style="font-size:11.5px;margin:14px 0 8px;display:flex;align-items:center;justify-content:space-between">
          <span>${ICON('book-open', 12)} 标准流程规范引用</span>
          <button class="btn btn-ghost btn-sm" data-sop-add-spec="${set.id}">${ICON('plus', 12)}引用规范</button>
        </div>
        <div class="chip-row">${set.proc.specRefs.length ? set.proc.specRefs.map(s => '<span class="chip">' + ICON('file-check', 11) + UI.esc(s) + '</span>').join('') : '<span class="dim" style="font-size:12px">未引用规范</span>'}</div>
        <div class="dim" style="font-size:11.5px;margin:14px 0 8px;display:flex;align-items:center;justify-content:space-between">
          <span>${ICON('list-todo', 12)} 标准化操作流程</span>
          <button class="btn btn-ghost btn-sm" data-sop-add-step="${set.id}">${ICON('plus', 12)}流程步骤</button>
        </div>
        <div class="sop-flow">
          ${set.proc.steps.map((s, i) => `
            <div class="sop-step"><span class="sop-num">${i + 1}</span>
              <div class="sop-text">
                <strong>${UI.esc(s.t)}</strong>
                ${s.sys ? '<span class="pill pill-warning" style="margin-left:8px">' + ICON('monitor', 10) + ' 业务系统 · ' + UI.esc(s.sys) + '</span>' : ''}
                ${s.rpa ? '<span class="pill" style="margin-left:6px;background:var(--accent-dim);color:var(--accent)">' + ICON('cpu', 10) + ' 类 RPA 自动执行</span>' : ''}
                ${s.d ? '<div class="dim" style="font-size:11.5px;margin-top:2px">' + UI.esc(s.d) + '</div>' : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  function bindSopTab(a, el) {
    const chipsEl = el.querySelector('#sop-chips');
    const detailEl = el.querySelector('#sop-detail');
    if (!detailEl) return;
    let selId = '';
    const sets = () => sopSetsOf(a);
    const cur = () => sets().find(s => s.id === selId);
    const paintChips = () => {
      chipsEl.innerHTML = sets().map(s =>
        '<button class="af-chip' + (selId === s.id ? ' on' : '') + '" data-sop-sel="' + s.id + '">' +
        (s.kind === 'workflow' ? ICON('workflow', 11) + ' ' : ICON('list-todo', 11) + ' ') + UI.esc(s.name) + '</button>').join('');
      chipsEl.querySelectorAll('[data-sop-sel]').forEach(b => b.addEventListener('click', () => { selId = b.dataset.sopSel; paintChips(); paintDetail(); }));
    };
    const paintDetail = () => {
      const set = cur();
      if (!set) { detailEl.innerHTML = '<div class="empty" style="padding:26px">请选择一个 SOP 集查看详情</div>'; return; }
      detailEl.innerHTML = `
        <div style="padding:14px 18px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="min-width:0">
            <div style="font-size:14px;font-weight:600">${UI.esc(set.name)}
              <span class="pill ${set.kind === 'workflow' ? '' : 'pill-success'}" ${set.kind === 'workflow' ? 'style="background:var(--accent-dim);color:var(--accent)"' : ''} style="margin-left:8px">${set.kind === 'workflow' ? '工作流编排' : '标准化流程'}</span>
            </div>
            <div class="dim" style="font-size:12px;margin-top:4px;line-height:1.5">${UI.esc(set.desc)}</div>
            <div class="dim mono" style="font-size:10.5px;margin-top:4px">更新 ${set.updatedAt}</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            ${set.kind === 'workflow' ? '<button class="btn btn-ghost btn-sm" id="btn-sop-cfg">' + ICON('settings', 12) + '编排配置</button>' : ''}
            <button class="btn btn-ghost btn-sm" id="btn-sop-del" style="color:var(--danger)">${ICON('trash-2', 12)}删除</button>
          </div>
        </div>
        ${set.kind === 'workflow' ? sopWfDetail(set) : sopProcDetail(set)}`;
      if (set.kind === 'workflow') mountWfCanvas(set);
      detailEl.querySelector('#btn-sop-del').addEventListener('click', () => {
        /* TODO: replace with fetch('.../sop-sets/' + set.id, {method:'DELETE'}) */
        DB.sopSets[a.id] = sets().filter(s => s.id !== set.id);
        selId = sets().length ? sets()[0].id : '';
        paintChips(); paintDetail();
        UI.toast('SOP 集已删除');
      });
      const cfgBtn = detailEl.querySelector('#btn-sop-cfg');
      if (cfgBtn) cfgBtn.addEventListener('click', () => openSopCfgModal(set));
      const upBtn = detailEl.querySelector('[data-sop-upload]');
      if (upBtn) upBtn.addEventListener('click', () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.addEventListener('change', () => {
          if (!inp.files.length) return;
          set.proc.materials.push(inp.files[0].name);
          set.updatedAt = '今天';
          paintDetail();
          UI.toast('素材已上传');
        });
        inp.click();
      });
      detailEl.querySelectorAll('[data-sop-rm-mat]').forEach(b => b.addEventListener('click', () => {
        const name = b.dataset.sopRmMat.split('|').slice(1).join('|');
        set.proc.materials = set.proc.materials.filter(m => m !== name);
        paintDetail();
        UI.toast('素材已移除');
      }));
      const specBtn = detailEl.querySelector('[data-sop-add-spec]');
      if (specBtn) specBtn.addEventListener('click', () => {
        UI.modal('引用流程规范', `
          <div class="field"><label>规范名称</label><input id="sp-name" placeholder="如:经营分析制度(2025 修订)"></div>
          <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="sp-submit">引用</button></div>`, m => {
          m.querySelector('#sp-submit').addEventListener('click', () => {
            const v = m.querySelector('#sp-name').value.trim();
            if (!v) { UI.toast('请填写规范名称', 'err'); return; }
            set.proc.specRefs.push(v);
            UI.closeModal(); paintDetail(); UI.toast('已引用规范');
          });
        });
      });
      const nodeBtn = detailEl.querySelector('[data-sop-add-node]');
      if (nodeBtn) nodeBtn.addEventListener('click', () => openNodeModal(set, null));
      const stepBtn = detailEl.querySelector('[data-sop-add-step]');
      if (stepBtn) stepBtn.addEventListener('click', () => {
        UI.modal('添加流程步骤', `
          <div class="field"><label>步骤名称</label><input id="st-t" placeholder="如:数据核对"></div>
          <div class="field"><label>操作说明</label><textarea id="st-d" placeholder="步骤的操作指引"></textarea></div>
          <div class="field"><label>业务系统(选填,填写后生成系统操作指引)</label><input id="st-sys" placeholder="如:ERP 系统"></div>
          <div class="field" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="st-rpa" style="width:auto"><label for="st-rpa" style="margin:0">类 RPA 自动执行</label></div>
          <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="st-submit">添加</button></div>`, m => {
          m.querySelector('#st-submit').addEventListener('click', () => {
            const t = m.querySelector('#st-t').value.trim();
            if (!t) { UI.toast('请填写步骤名称', 'err'); return; }
            set.proc.steps.push({ t, d: m.querySelector('#st-d').value.trim(), sys: m.querySelector('#st-sys').value.trim(), rpa: m.querySelector('#st-rpa').checked });
            set.updatedAt = '今天';
            UI.closeModal(); paintDetail(); UI.toast('流程步骤已添加');
          });
        });
      });
    };
    /* 节点新建/编辑弹窗 */
    const openNodeModal = (set, node) => {
      const isEdit = !!node;
      UI.modal(isEdit ? '编辑节点' : '添加工作流节点', `
        <div class="field"><label>节点名称</label><input id="nd-t" placeholder="如:数据拉取" value="${isEdit ? UI.esc(node.t) : ''}"></div>
        <div class="field"><label>节点说明</label><textarea id="nd-d" placeholder="节点职责与处理逻辑">${isEdit ? UI.esc(node.d) : ''}</textarea></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="nd-submit">${isEdit ? '保存' : '添加'}</button></div>`, m => {
        m.querySelector('#nd-submit').addEventListener('click', () => {
          const t = m.querySelector('#nd-t').value.trim();
          if (!t) { UI.toast('请填写节点名称', 'err'); return; }
          const d = m.querySelector('#nd-d').value.trim();
          if (isEdit) Object.assign(node, { t, d });
          else set.wf.nodes.push({ t, d });
          set.updatedAt = '今天';
          UI.closeModal(); paintDetail(); UI.toast(isEdit ? '节点已保存' : '节点已添加');
        });
      });
    };
    /* 工作流画布:节点拖拽 + SVG 连线(顺序流 i → i+1) */
    const mountWfCanvas = set => {
      const canvas = detailEl.querySelector('#wf-canvas');
      const edges = detailEl.querySelector('#wf-edges');
      if (!canvas || !edges) return;
      const NW = 152, SVGNS = 'http://www.w3.org/2000/svg';
      set.wf.nodes.forEach((n, i) => {
        if (n.x === undefined) {
          const perRow = 3, row = Math.floor(i / perRow), col = i % perRow;
          n.x = 26 + (row % 2 ? perRow - 1 - col : col) * (NW + 42);
          n.y = 24 + row * 110;
        }
      });
      const drawEdges = () => {
        edges.innerHTML = '<defs><marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"/></marker></defs>';
        const els = [...canvas.querySelectorAll('.wf-node')];
        for (let i = 0; i < els.length - 1; i++) {
          const a = els[i], b = els[i + 1];
          const x1 = a.offsetLeft + a.offsetWidth, y1 = a.offsetTop + a.offsetHeight / 2;
          const x2 = b.offsetLeft, y2 = b.offsetTop + b.offsetHeight / 2;
          const mx = Math.max(42, Math.abs(x2 - x1) / 2);
          const p = document.createElementNS(SVGNS, 'path');
          p.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + (x1 + mx) + ',' + y1 + ' ' + (x2 - mx) + ',' + y2 + ' ' + x2 + ',' + y2);
          p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'var(--accent)');
          p.setAttribute('stroke-width', '1.6'); p.setAttribute('stroke-dasharray', '5 4');
          p.setAttribute('opacity', '.75'); p.setAttribute('marker-end', 'url(#wf-arrow)');
          edges.appendChild(p);
        }
      };
      set.wf.nodes.forEach((n, i) => {
        const el = document.createElement('div');
        el.className = 'wf-node';
        el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
        el.innerHTML = '<div class="wf-node-t"><span class="wf-node-idx">' + (i + 1) + '</span>' + UI.esc(n.t) + '</div>' +
          (n.d ? '<div class="wf-node-d">' + UI.esc(n.d) + '</div>' : '') +
          '<button class="wf-node-x" title="删除节点">×</button>';
        canvas.appendChild(el);
        el.addEventListener('pointerdown', e => {
          if (e.target.classList.contains('wf-node-x')) return;
          const sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y;
          let moved = false;
          el.classList.add('dragging');
          const mv = ev => {
            const dx = ev.clientX - sx, dy = ev.clientY - sy;
            if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
            n.x = Math.max(4, Math.min(canvas.clientWidth - NW - 4, ox + dx));
            n.y = Math.max(4, Math.min(canvas.clientHeight - 40, oy + dy));
            el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
            drawEdges();
          };
          const up = () => {
            el.classList.remove('dragging');
            window.removeEventListener('pointermove', mv);
            window.removeEventListener('pointerup', up);
            if (!moved) openNodeModal(set, n);
          };
          window.addEventListener('pointermove', mv);
          window.addEventListener('pointerup', up);
        });
        el.querySelector('.wf-node-x').addEventListener('click', () => {
          /* TODO: replace with fetch('.../sop-sets/' + set.id + '/nodes', {method:'DELETE'}) */
          set.wf.nodes = set.wf.nodes.filter(x => x !== n);
          set.updatedAt = '今天';
          paintDetail();
          UI.toast('节点已删除');
        });
      });
      drawEdges();
    };
    const openSopCfgModal = set => {
      UI.modal('工作流编排配置 · ' + set.name, `
        <div class="field"><label>数据源</label><textarea id="cf-source">${UI.esc(set.wf.source)}</textarea></div>
        <div class="field"><label>处理规则</label><textarea id="cf-rules">${UI.esc(set.wf.rules)}</textarea></div>
        <div class="field"><label>输入</label><textarea id="cf-input">${UI.esc(set.wf.input)}</textarea></div>
        <div class="field"><label>输出</label><textarea id="cf-output">${UI.esc(set.wf.output)}</textarea></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="cf-submit">保存配置</button></div>`, m => {
        m.querySelector('#cf-submit').addEventListener('click', () => {
          /* TODO: replace with fetch('.../sop-sets/' + set.id, {method:'PATCH'}) */
          set.wf.source = m.querySelector('#cf-source').value.trim();
          set.wf.rules = m.querySelector('#cf-rules').value.trim();
          set.wf.input = m.querySelector('#cf-input').value.trim();
          set.wf.output = m.querySelector('#cf-output').value.trim();
          set.updatedAt = '今天';
          UI.closeModal(); paintDetail(); UI.toast('编排配置已保存');
        });
      });
    };
    el.querySelector('#btn-sop-new').addEventListener('click', () => {
      UI.modal('新建 SOP 集', `
        <div class="field"><label>SOP 集名称</label><input id="ns-name" placeholder="如:合同起草流水线"></div>
        <div class="field"><label>形态</label><select id="ns-kind">
          <option value="workflow">工作流编排(配置数据源/处理规则/输入输出/节点)</option>
          <option value="process">标准化流程(参考素材/规范引用/操作步骤)</option>
        </select></div>
        <div class="field"><label>描述</label><textarea id="ns-desc" placeholder="该 SOP 集的适用场景与目标"></textarea></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="ns-submit">创建</button></div>`, m => {
        m.querySelector('#ns-submit').addEventListener('click', () => {
          const name = m.querySelector('#ns-name').value.trim();
          if (!name) { UI.toast('请填写 SOP 集名称', 'err'); return; }
          const kind = m.querySelector('#ns-kind').value;
          /* TODO: replace with fetch('/api/agents/' + a.id + '/sop-sets', {method:'POST'}) */
          const set = { id: 'sop-' + Date.now(), name, kind, desc: m.querySelector('#ns-desc').value.trim(), updatedAt: '今天' };
          if (kind === 'workflow') set.wf = { source: '', rules: '', input: '', output: '', nodes: [] };
          else set.proc = { materials: [], specRefs: [], steps: [] };
          sets().push(set);
          selId = set.id;
          UI.closeModal();
          Views.agent.render(el, a.id, { tab: 'sop' });
          UI.toast('SOP 集已创建');
        });
      });
    });
    selId = sets().length ? sets()[0].id : '';
    paintChips(); paintDetail();
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

  /* ---------- 规则库:业务规则创建/维护,支持规则场景集 ---------- */
  function agTabRules(a) {
    const rules = DB.agentRules[a.id] || [];
    return agHeadCard(a) + `
      <div class="card reveal reveal-1">
        <div class="tc-head" style="display:flex;align-items:center;justify-content:space-between">
          <span class="tc-title">${ICON('shield', 15)}业务规则库<span class="pill pill-dim" style="margin-left:8px">${rules.length}</span></span>
          <span style="display:flex;gap:8px">
            <button class="btn btn-ghost btn-sm" id="btn-ruleset-new">${ICON('plus', 13)}新建规则集</button>
            <button class="btn btn-primary btn-sm" id="btn-rule-new">${ICON('plus', 13)}新建规则</button>
          </span>
        </div>
        <div class="audit-filter" id="rule-scenes" style="position:static"></div>
        <div class="tc-body" id="rule-list"></div>
      </div>`;
  }

  function ruleRow(r) {
    return `
      <div class="file-row" style="align-items:flex-start">
        <span class="file-icon" style="color:var(--accent);background:var(--accent-dim)">${ICON('shield', 14)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${UI.esc(r.name)}<span class="pill pill-dim">${UI.esc(r.scene)}</span>${r.enabled ? '' : '<span class="pill pill-danger">已停用</span>'}</div>
          <div class="dim" style="font-size:11.5px;margin-top:3px;line-height:1.5">${UI.esc(r.content)}</div>
          <div class="dim mono" style="font-size:10.5px;margin-top:3px">命中 ${r.hits} 次 · 更新 ${r.updatedAt}</div>
        </div>
        <button class="cron-switch ${r.enabled ? 'on' : ''}" data-rule-tg="${r.id}" title="${r.enabled ? '停用' : '启用'}"></button>
        <button class="btn-icon" data-rule-edit="${r.id}" title="编辑">${ICON('pencil', 13)}</button>
        <button class="btn-icon" data-rule-del="${r.id}" title="删除" style="color:var(--danger)">${ICON('trash-2', 13)}</button>
      </div>`;
  }

  /* 规则编辑/新建弹窗(scene 为空串表示新建场景集) */
  function ruleSceneNames(a) {
    /* 规则集注册表 ∪ 规则中实际出现的场景集 */
    const reg = (DB.ruleSets[a.id] || []).map(s => s.name);
    const used = (DB.agentRules[a.id] || []).map(r => r.scene);
    return [...new Set(reg.concat(used))];
  }

  function openRuleModal(a, rule, onSaved) {
    const scenes = ruleSceneNames(a);
    const isEdit = !!rule;
    const body = `
      <div class="field"><label>规则名称</label><input id="rl-name" placeholder="如:违约金上限校验" value="${isEdit ? UI.esc(rule.name) : ''}"></div>
      <div class="field"><label>规则场景集</label>
        <select id="rl-scene">
          ${scenes.map(s => '<option' + (isEdit && rule.scene === s ? ' selected' : '') + '>' + UI.esc(s) + '</option>').join('')}
          <option value="__new__">+ 新建场景集</option>
        </select>
      </div>
      <div class="field" id="rl-scene-new-wrap" style="display:none"><label>新场景集名称</label><input id="rl-scene-new" placeholder="如:合规校验"></div>
      <div class="field"><label>规则内容</label><textarea id="rl-content" placeholder="用自然语言描述业务规则,执行时将作为约束注入专家提示词">${isEdit ? UI.esc(rule.content) : ''}</textarea></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="rl-submit">${isEdit ? '保存修改' : '创建规则'}</button>
      </div>`;
    UI.modal(isEdit ? '编辑规则' : '新建规则', body, m => {
      const sel = m.querySelector('#rl-scene');
      sel.addEventListener('change', () => {
        m.querySelector('#rl-scene-new-wrap').style.display = sel.value === '__new__' ? '' : 'none';
      });
      m.querySelector('#rl-submit').addEventListener('click', () => {
        const name = m.querySelector('#rl-name').value.trim();
        const scene = sel.value === '__new__' ? m.querySelector('#rl-scene-new').value.trim() : sel.value;
        const content = m.querySelector('#rl-content').value.trim();
        if (!name || !scene || !content) { UI.toast('请填写完整规则信息', 'err'); return; }
        /* TODO: replace with fetch('/api/agents/' + a.id + '/rules', {method:'POST'}) */
        if (isEdit) Object.assign(rule, { name, scene, content, updatedAt: '今天' });
        else (DB.agentRules[a.id] = DB.agentRules[a.id] || []).unshift({ id: 'r-' + Date.now(), name, scene, content, enabled: true, hits: 0, updatedAt: '今天' });
        UI.closeModal();
        onSaved();
        UI.toast(isEdit ? '规则已更新' : '规则已创建并启用');
      });
    });
  }

  function bindRulesTab(a, el) {
    const scenesEl = el.querySelector('#rule-scenes');
    const listEl = el.querySelector('#rule-list');
    if (!listEl) return;
    let scene = '';
    const rules = () => DB.agentRules[a.id] || [];
    const paintScenes = () => {
      const names = ruleSceneNames(a);
      scenesEl.innerHTML = '<button class="af-chip' + (scene === '' ? ' on' : '') + '" data-rscene="">全部 ' + rules().length + '</button>' +
        names.map(n => '<button class="af-chip' + (scene === n ? ' on' : '') + '" data-rscene="' + UI.esc(n) + '">' + UI.esc(n) + ' ' + rules().filter(r => r.scene === n).length + '</button>').join('');
      scenesEl.querySelectorAll('[data-rscene]').forEach(b => b.addEventListener('click', () => {
        scene = b.dataset.rscene;
        paintScenes(); paintList();
      }));
    };
    const paintList = () => {
      const list = rules().filter(r => !scene || r.scene === scene);
      listEl.innerHTML = list.length ? list.map(ruleRow).join('') : '<div class="empty" style="padding:26px">该场景集暂无规则,点击右上角「新建规则」创建</div>';
      listEl.querySelectorAll('[data-rule-tg]').forEach(b => b.addEventListener('click', () => {
        /* TODO: replace with fetch('/api/agents/.../rules/' + id, {method:'PATCH'}) */
        const r = rules().find(x => x.id === b.dataset.ruleTg);
        r.enabled = !r.enabled;
        paintList();
        UI.toast(r.enabled ? '规则已启用' : '规则已停用');
      }));
      listEl.querySelectorAll('[data-rule-edit]').forEach(b => b.addEventListener('click', () => {
        openRuleModal(a, rules().find(x => x.id === b.dataset.ruleEdit), () => { paintScenes(); paintList(); });
      }));
      listEl.querySelectorAll('[data-rule-del]').forEach(b => b.addEventListener('click', () => {
        /* TODO: replace with fetch('/api/agents/.../rules/' + id, {method:'DELETE'}) */
        DB.agentRules[a.id] = rules().filter(x => x.id !== b.dataset.ruleDel);
        if (scene && !ruleSceneNames(a).includes(scene)) scene = '';
        paintScenes(); paintList();
        UI.toast('规则已删除');
      }));
    };
    paintScenes(); paintList();
    el.querySelector('#btn-ruleset-new').addEventListener('click', () => {
      UI.modal('新建规则集', `
        <div class="field"><label>规则集名称</label><input id="rs-name" placeholder="如:合同文件审查规则"></div>
        <div class="field"><label>规则集说明</label><textarea id="rs-desc" placeholder="该规则集适用的业务场景"></textarea></div>
        <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="rs-submit">创建</button></div>`, m => {
        m.querySelector('#rs-submit').addEventListener('click', () => {
          const name = m.querySelector('#rs-name').value.trim();
          if (!name) { UI.toast('请填写规则集名称', 'err'); return; }
          if (ruleSceneNames(a).includes(name)) { UI.toast('规则集已存在', 'err'); return; }
          /* TODO: replace with fetch('/api/agents/' + a.id + '/rule-sets', {method:'POST'}) */
          (DB.ruleSets[a.id] = DB.ruleSets[a.id] || []).push({ id: 'rs-' + Date.now(), name, desc: m.querySelector('#rs-desc').value.trim() });
          UI.closeModal();
          scene = name;
          paintScenes(); paintList();
          UI.toast('规则集已创建,可开始添加规则');
        });
      });
    });
    el.querySelector('#btn-rule-new').addEventListener('click', () => {
      openRuleModal(a, null, () => { paintScenes(); paintList(); });
    });
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
      const counts = { kb: kbs.length, ext: exts.length, tasks: d.tasks.length, tpls: (DB.agentTpls[a.id] || []).length, rules: (DB.agentRules[a.id] || []).length };
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
        tpls: () => agTabTpls(a), rules: () => agTabRules(a)
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
      if (active === 'rules') bindRulesTab(a, el);
      if (active === 'sop') bindSopTab(a, el);
    }
  };
})();
