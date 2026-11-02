import { workflowRoute, workflowStatus } from '../workflows/sopWorkflow.js';

export const SOP_CONFIG_FIELDS = [['source', '数据源', 'database'], ['rules', '处理规则', 'filter'], ['input', '输入', 'log-in'], ['output', '输出', 'log-out']];
export function sopConfigValues(set) {
  const definition = set.kind === 'workflow' ? set.wf : set.proc;
  return {
    source: definition.source ?? (set.kind === 'process' ? (set.materialRefs || []).map(ref => ref.name + (ref.status === 'missing' ? '（待补充文件）' : '')).join('\n') : ''),
    rules: definition.rules ?? (set.kind === 'process' ? (definition.specRefs || []).join('\n') : ''),
    input: definition.input || '', output: definition.output || '',
  };
}
export function renderSopLayout(set, expert, { ui, icon, api }) {
  const values = sopConfigValues(set), real = set.kind === 'workflow' && set.workflow;
  return `<div class="sop-detail-layout">
    ${real ? '<div data-workflow-overview></div>' : `<div class="sop-config-grid">${SOP_CONFIG_FIELDS.map(([name, label, glyph]) => `<section class="sop-config-card"><div class="sop-config-label">${icon(glyph, 12)}${label}</div><div class="sop-config-value" data-sop-config="${name}">${ui.esc(values[name] || '未配置')}</div></section>`).join('')}</div>`}
    <div class="sop-canvas-toolbar"><span>${icon('workflow', 12)} ${set.kind === 'workflow' ? '工作流节点编排' : '标准化流程节点编排'}（画布模式）</span><div class="sop-canvas-actions">
      ${real ? `<a class="btn btn-ghost btn-sm" href="${workflowRoute(real.id, expert)}&tab=code">${icon('code', 12)}编辑代码</a><a class="btn btn-ghost btn-sm" data-workflow-run href="${workflowRoute(real.id, expert)}&run=1">${icon('play', 12)}运行</a>` : ''}
      <button class="btn btn-ghost btn-sm" ${set.kind === 'workflow' ? 'data-sop-add-node' : 'data-sop-add-step'}="${set.id}" ${real ? 'disabled' : ''}>${icon('plus', 12)}节点</button>
    </div></div>
    ${set.kind === 'workflow' ? `<div class="sop-workflow-state" data-sop-workflow>${real ? `<span class="pill pill-dim" data-workflow-status>${ui.esc(workflowStatus(real.status))}</span><span class="sop-workflow-error" data-workflow-error>${ui.esc(real.error)}</span><button class="btn btn-ghost btn-sm" data-workflow-refresh>刷新工作流</button>` : '<span class="dim">当前账号尚未创建真实工作流；下方保留历史配置。</span><button class="btn btn-ghost btn-sm" data-create-sop-workflow>新建真实工作流</button>'}</div>` : ''}
    <div class="wf-canvas sop-node-canvas" id="wf-canvas">${real ? '<div class="sop-canvas-message">正在加载真实工作流…</div>' : ''}</div>
    ${set.kind === 'process' ? processResources(set, expert, { ui, icon, api }) : ''}
    ${real && set.wf.nodes?.length ? `<details class="sop-resource sop-history"><summary>${icon('history', 12)}历史 SOP 节点（仅参考）<span class="sop-resource-chevron">${icon('chevron-down', 12)}</span></summary><div class="sop-resource-body"><ol>${set.wf.nodes.map(node => `<li><strong>${ui.esc(node.t)}</strong><p>${ui.esc(node.d)}</p></li>`).join('')}</ol><p class="dim">历史连接：${(set.wf.edges || []).map(edge => `${ui.esc(set.wf.nodes.find(node => node.id === edge.source)?.t || edge.source)} → ${ui.esc(set.wf.nodes.find(node => node.id === edge.target)?.t || edge.target)}`).join('；') || (Array.isArray(set.wf.edges) ? '无连接' : '按原节点顺序')}</p></div></details>` : ''}
  </div>`;
}
function processResources(set, expert, { ui, icon, api }) {
  const materials = set.materialRefs || [], specs = set.proc.specRefs || [];
  return `<div class="sop-resources">
    <details class="sop-resource"><summary>${icon('paperclip', 12)}参考素材文件<span class="pill pill-dim">${materials.length}</span><span class="sop-resource-chevron">${icon('chevron-down', 12)}</span></summary><div class="sop-resource-body">
      <div class="sop-resource-actions"><button class="btn btn-ghost btn-sm" data-sop-upload="${set.id}">${icon('upload', 12)}上传素材</button></div>
      ${materials.map(ref => `<div class="file-row"><span class="file-icon">${icon('file-text', 14)}</span><div class="sop-material-name">${ref.status === 'available' ? `<a href="${ui.esc(api.sopMaterialUrl(expert, set.id, ref.id))}" download>${ui.esc(ref.name)}</a>` : `${ui.esc(ref.name)} <span class="pill pill-warning">待补充文件</span>`}</div><button class="btn-icon" data-sop-rm-mat="${ref.id}" title="移除" style="color:var(--danger)">${icon('trash-2', 12)}</button></div>`).join('') || '<p class="dim">暂无参考素材，可上传模板、范例等文件。</p>'}
    </div></details>
    <details class="sop-resource"><summary>${icon('book-open', 12)}流程规范引用<span class="pill pill-dim">${specs.length}</span><span class="sop-resource-chevron">${icon('chevron-down', 12)}</span></summary><div class="sop-resource-body"><div class="sop-resource-actions"><button class="btn btn-ghost btn-sm" data-sop-add-spec="${set.id}">${icon('plus', 12)}引用规范</button></div><div class="chip-row">${specs.map(name => `<span class="chip">${icon('file-check', 11)}${ui.esc(name)}</span>`).join('') || '<span class="dim">未引用规范</span>'}</div></div></details>
  </div>`;
}
