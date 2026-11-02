/* views/projects.js — 项目列表(资源核心入口)+ 新建项目 */
(function () {
  window.Views = window.Views || {};

  Views.projects = {
    async render(el, param, query) {
      el.innerHTML = '<div class="page">' + UI.skeleton(4) + '</div>';
      const { data: all } = await API.fetchProjects(query.wb || null);
      const wbFilter = query.wb ? UI.wbById(query.wb) : null;
      const stFilter = query.status || 'all';
      const projects = stFilter === 'all' ? all : all.filter(p => p.status === stFilter);
      const stCount = st => all.filter(p => p.status === st).length;
      const wbParam = query.wb ? '&wb=' + query.wb : '';

      el.innerHTML = `
      <div class="page">
        <div class="pd-head reveal">
          <div>
            <div class="pd-title">项目</div>
            <div class="pd-sub">项目是资源核心:记忆、文件、知识库、数据库、定时任务与资源消耗均围绕项目独立构建。</div>
          </div>
          <button class="btn btn-primary" id="btn-new-proj">${ICON('plus', 14)}新建项目</button>
        </div>

        <div class="reveal reveal-1" style="display:flex;align-items:center;gap:8px;margin-bottom:18px;flex-wrap:wrap">
          <a class="af-chip ${stFilter === 'all' ? 'on' : ''}" href="#/projects?status=all${wbParam}">全部 ${all.length}</a>
          <a class="af-chip ${stFilter === 'active' ? 'on' : ''}" href="#/projects?status=active${wbParam}">进行中 ${stCount('active')}</a>
          <a class="af-chip ${stFilter === 'archived' ? 'on' : ''}" href="#/projects?status=archived${wbParam}">已归档 ${stCount('archived')}</a>
          ${wbFilter ? `<span style="flex:1"></span>
            <span class="pill pill-primary">${ICON('filter', 12)}${UI.esc(wbFilter.name)}</span>
            <a href="#/projects?status=${stFilter}" class="dim" style="font-size:12px">清除工作台筛选</a>` : ''}
        </div>

        ${projects.length === 0 ? `
          <div class="card empty reveal reveal-2">
            ${ICON('inbox', 34)}
            <div>当前筛选条件下暂无项目</div>
            <button class="btn btn-ghost btn-sm" id="btn-new-proj-2">${ICON('plus', 13)}创建第一个项目</button>
          </div>` : `
          <div class="grid grid-3 reveal reveal-2">
            ${projects.map((p, i) => {
              const wb = UI.wbById(p.workbenchId);
              const latest = DB.sessions.filter(s => s.projectId === p.id).slice(0, 3);
              return `
              <div class="card clickable proj-card" data-proj="${p.id}">
                <div class="proj-top">
                  <div>
                    <div class="proj-name">${UI.esc(p.name)}</div>
                    <div class="proj-wb">${UI.esc(wb.name)} · 创建于 ${p.createdAt}</div>
                  </div>
                  ${UI.statusPill(p.status)}
                </div>
                <div class="proj-desc">${UI.esc(p.desc)}</div>
                <div class="proj-sessions">
                  ${latest.length ? latest.map(s => `
                    <div class="ps-row" data-ps="${s.id}" title="${UI.esc(s.title)}">
                      ${UI.statusPill(s.status)}
                      <span class="ps-title">${UI.esc(s.title)}</span>
                      ${ICON('chevron-right', 12, 'dim')}
                    </div>`).join('')
                  : '<div class="ps-row" style="cursor:default"><span class="dim" style="font-size:12px">暂无任务</span></div>'}
                </div>
                <div class="proj-meta">
                  <span>任务 <b>${p.stats.tasks}</b></span>
                  <span>Tokens <b>${p.stats.tokens}</b></span>
                  <span>消耗 <b>${p.stats.cost}</b></span>
                  <span style="flex:1"></span>
                  <span class="agent-avatars">
                    ${p.agentIds.map(aid => '<span class="avatar" style="background:' + UI.agentById(aid).color + '" title="' + UI.esc(UI.agentById(aid).name) + '">' + UI.esc(UI.agentById(aid).initials) + '</span>').join('')}
                  </span>
                </div>
              </div>`;
            }).join('')}
          </div>`}
      </div>`;

      el.querySelectorAll('[data-proj]').forEach(c =>
        c.addEventListener('click', () => location.hash = '#/project/' + c.dataset.proj));
      el.querySelectorAll('[data-ps]').forEach(r => r.addEventListener('click', e => {
        e.stopPropagation();
        location.hash = '#/task/' + r.dataset.ps;
      }));

      const openCreate = () => this.openCreateModal();
      const b1 = el.querySelector('#btn-new-proj');
      const b2 = el.querySelector('#btn-new-proj-2');
      if (b1) b1.addEventListener('click', openCreate);
      if (b2) b2.addEventListener('click', openCreate);
    },

    openCreateModal() {
      UI.openModal(`
        <div class="modal-head">
          <div class="modal-title">新建项目</div>
          <button class="btn-icon" onclick="UI.closeModal()">${ICON('x', 16)}</button>
        </div>
        <div class="modal-body">
          <div class="field" id="f-name">
            <label>项目名称</label>
            <input id="np-name" placeholder="例如:供应商合同 Q3 审查">
            <div class="err">请输入项目名称</div>
          </div>
          <div class="field">
            <label>所属工作台</label>
            <select id="np-wb">
              ${DB.workbenches.map(w => '<option value="' + w.id + '">' + UI.esc(w.name) + '</option>').join('')}
            </select>
          </div>
          <div class="field">
            <label>项目说明</label>
            <textarea id="np-desc" rows="3" placeholder="该项目要解决什么问题?智能体将据此理解上下文。"></textarea>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" onclick="UI.closeModal()">取消</button>
          <button class="btn btn-primary" id="np-submit">创建项目</button>
        </div>`);

      document.getElementById('np-submit').addEventListener('click', async () => {
        const name = document.getElementById('np-name').value.trim();
        if (!name) { document.getElementById('f-name').classList.add('invalid'); return; }
        const btn = document.getElementById('np-submit');
        btn.disabled = true;
        btn.innerHTML = ICON('loader', 14, 'spin') + '创建中…';
        const res = await API.createProject({
          name,
          workbenchId: document.getElementById('np-wb').value,
          desc: document.getElementById('np-desc').value.trim()
        });
        UI.closeModal();
        UI.toast('项目「' + name + '」已创建');
        location.hash = '#/project/' + res.data.id;
      });
    }
  };
})();
