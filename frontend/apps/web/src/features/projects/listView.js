import { usageText } from '../tasks/usage.js';
import { esc, date, viewScope, showError } from '../workbench/ui.js';
import { editProject } from './editor.js';

const labels = { active: '进行中', paused: '已暂停', archived: '已归档' };
const statusStyles = { active: 'pill-success', paused: 'pill-warning', archived: 'pill-dim' };
window.Views = window.Views || {};
window.Views.projects = {
  async render(el, param, query = {}) {
    const valid = viewScope(el), reload = () => this.render(el,param,query);
    el.innerHTML = '<div class="page">' + UI.skeleton(4) + '</div>';
    try {
      const [wbResult,result] = await Promise.all([API.fetchWorkbenches(),API.fetchProjects(query.wb || null)]);
      if (!valid()) return;
      const workbenches = wbResult.data, projects = result.data, wb = workbenches.find(w => w.id === query.wb);
      if (query.wb && !wb) throw new Error('工作台不存在');
      const status = ['all',...Object.keys(labels)].includes(query.status) ? query.status : 'all';
      const wbParam = query.wb ? '&wb=' + encodeURIComponent(query.wb) : '';
      el.innerHTML = `<div class="page projects-page"><div class="pd-head"><div><div class="pd-title">项目</div><div class="pd-sub">项目固定创建时的工作台配置版本。任务由工作台智能体执行，运行记录与成果按项目汇总。</div></div><button class="btn btn-primary" id="btn-new-proj">${ICON('plus',14)}新建项目</button></div>
        ${wb ? `<section class="project-workbench-context" aria-label="当前工作台">
          <span class="project-context-icon">${ICON('layout-dashboard',20)}</span>
          <div class="project-context-main"><div class="project-context-label">当前工作台 · 仅显示此工作台下的项目</div><div class="project-context-name">${esc(wb.name)}</div></div>
          <div class="config-actions"><a class="btn btn-ghost btn-sm project-action" href="#/projects?status=${status}">${ICON('x',14)}清除工作台筛选</a><a class="btn btn-ghost btn-sm project-action project-action-accent" href="#/workbench?tab=pro&id=${encodeURIComponent(wb.id)}">${ICON('settings',14)}工作台配置${ICON('chevron-right',13)}</a></div>
        </section>` : '<div class="project-scope-caption">当前范围：全部工作台的项目</div>'}
        <div class="config-actions project-status-filters">${[['all','全部'],...Object.entries(labels)].map(([key,label]) => `<a class="af-chip ${status === key ? 'on' : ''}" href="#/projects?status=${key}${wbParam}">${label} ${key === 'all' ? projects.length : projects.filter(p => p.status === key).length}</a>`).join('')}</div>
        <div class="field project-search">${ICON('search',16)}<input type="search" id="project-search" aria-label="搜索项目" placeholder="搜索项目名称或说明"></div><div class="config-page-error" role="alert"></div><div id="project-list"></div></div>`;
      const list = el.querySelector('#project-list');
      const paint = () => {
        const term = el.querySelector('#project-search').value.trim().toLocaleLowerCase();
        const shown = projects.filter(p => (status === 'all' || p.status === status) && (p.name + '\n' + p.desc).toLocaleLowerCase().includes(term));
        list.innerHTML = shown.length ? `<div class="grid project-grid">${shown.map(p => `
          <a class="card proj-card" href="#/project/${encodeURIComponent(p.id)}">
            <div class="proj-top">
              <span class="proj-icon">${ICON('folder-kanban',20)}</span>
              <div class="proj-heading">
                <div class="proj-name">${esc(p.name)}</div>
              </div>
              <span class="pill ${statusStyles[p.status] || 'pill-dim'}"><span class="dot"></span>${labels[p.status] || '未知状态'}</span>
            </div>
            <div class="proj-workbench">
              <div class="proj-workbench-label">${ICON('layout-dashboard',13)}所属工作台</div>
              <div class="proj-workbench-value"><strong>${esc(p.workbenchName) || '工作台名称未提供'}</strong><span class="proj-version">固定配置 v${esc(p.ontologyVersion)}</span></div>
            </div>
            <div class="proj-desc">${esc(p.desc) || '<span class="dim">暂无项目说明</span>'}</div>
            <div class="proj-details">
              <span>${ICON('clock',12)}<span>创建于 ${date(p.createdAt)}</span></span>
              <span>${ICON('package',12)}<span>业务配置 v${esc(p.ontologyVersion)}</span></span>
            </div>
            ${p.agents?.length ? `<div class="chip-row">${p.agents.map(a => `<span class="chip">${ICON('bot',12)}${esc(a.name)}</span>`).join('')}</div>` : ''}
            <div class="proj-sessions"><div class="proj-empty">${ICON('list-todo',14)}<span>${p.stats?.tasks ? p.stats.tasks + ' 个任务 · 查看详情' : '暂无任务'}</span></div></div>
            <div class="proj-meta"><span>任务 <b>${p.stats?.tasks || 0}</b></span><span>消耗 <b>${esc(usageText(p.stats))}</b></span></div>
          </a>`).join('')}</div>` : '<div class="card empty">当前筛选条件下暂无项目。</div>';
      };
      paint(); el.querySelector('#project-search').addEventListener('input',paint);
      el.querySelector('#btn-new-proj').addEventListener('click', async event => {
        const button = event.currentTarget; if (button.disabled) return; button.disabled = true;
        try { const result = await API.fetchWorkbenches(); if (valid()) editProject(null,result.data,query.wb,valid,p => { location.hash = '#/project/' + p.id; }); }
        catch (error) { if (valid()) el.querySelector('[role=alert]').textContent = error.message; }
        finally { if (valid()) button.disabled = false; }
      });
    } catch (error) { if (valid()) showError(el,error,reload); }
  },
};
