import { esc, lifetime } from '../knowledge/lifecycle.js';
import { workflowKey } from '../../services/workflowKey.js';
import { mountRemoteSopCanvas } from './sopWorkflowCanvas.js';
export const workflowStatus = state => ({ pending: '等待创建', syncing: '正在创建', ready: '已创建', failed: '创建失败' }[state] || state);
export const workflowRoute = (id, expert) => `#/workflow/${encodeURIComponent(id)}${expert ? '?expert=' + encodeURIComponent(expert) : ''}`;
export function sopWorkflowSummary(set, expert) {
  const workflow = set.workflow;
  const previous = set.wf || {}, nodes = previous.nodes || [];
  const labels = { source: '数据源', rules: '处理规则', input: '输入', output: '输出' };
  const hasHistory = nodes.length || Object.keys(labels).some(name => previous[name]);
  const history = workflow && hasHistory ? `<details class="sop-workflow-history"><summary>历史 SOP 配置（仅参考）</summary>
    ${Object.entries(labels).filter(([name]) => previous[name]).map(([name, label]) => `<h4>${label}</h4><pre>${esc(previous[name])}</pre>`).join('')}
    <ol>${nodes.map(node => `<li><strong>${esc(node.t)}</strong><p>${esc(node.d)}</p></li>`).join('')}</ol>
    <p>历史连接：${(previous.edges || []).map(edge => `${esc(nodes.find(node => node.id === edge.source)?.t || edge.source)} → ${esc(nodes.find(node => node.id === edge.target)?.t || edge.target)}`).join('；') || '无连接'}</p>
  </details>` : '';
  return `<div class="card-pad" data-sop-workflow>
    <p>${workflow ? '当前账号的真实工作流：<strong data-workflow-status>' + esc(workflowStatus(workflow.status)) + '</strong>' : '在 Workflow 中新建真实工作流，配置步骤代码后运行。旧画布内容保留为历史配置。'}</p>
    ${workflow ? `<p class="dim" data-workflow-error>${esc(workflow.error)}</p><a class="btn btn-ghost btn-sm" href="${workflowRoute(workflow.id, expert)}">配置工作流</a> <a class="btn btn-primary btn-sm" data-workflow-run href="${workflowRoute(workflow.id, expert)}&run=1">运行</a>` : '<button class="btn btn-primary btn-sm" data-create-sop-workflow>新建真实工作流</button>'}
  </div>${history}`;
}
export function mountSopWorkflow(el, set, expert, api, ui) {
  if (set.workflow && el.querySelector('#wf-canvas')) return mountRemoteSopCanvas(el, set, expert, api, ui, workflowStatus);
  const host = el.querySelector('[data-sop-workflow]');
  if (!host) return;
  const life = lifetime(host);
  const create = host.querySelector('[data-create-sop-workflow]');
  if (create) {
    const key = workflowKey();
    create.onclick = async () => {
      if (create.disabled || !life.live()) return;
      create.disabled = true;
      try {
        const { data } = await api.createSopWorkflow(expert, set.id, key);
        if (life.live()) location.hash = workflowRoute(data.workflow.id, expert);
      } catch (error) { if (life.live()) ui.toast(error.message || '创建失败，请重试', 'err'); }
      finally { if (life.live()) create.disabled = false; }
    };
  }
  let timer;
  life.cleanup(() => clearTimeout(timer));
  async function refresh() {
    if (!life.live() || !set.workflow || !api.workflowRequest) return;
    try {
      const state = await api.workflowRequest(`/workflows/${encodeURIComponent(set.workflow.id)}`, 'GET', undefined, { signal: life.signal });
      if (!life.live()) return;
      set.workflow = state;
      host.querySelector('[data-workflow-status]').textContent = workflowStatus(state.status);
      host.querySelector('[data-workflow-error]').textContent = state.error || '';
      if (state.enabled && ['pending', 'syncing'].includes(state.status)) timer = setTimeout(refresh, 2000);
    } catch (error) { if (life.live()) host.querySelector('[data-workflow-error]').textContent = error.message; }
  }
  if (set.workflow) void refresh();
  return life.dispose;
}
