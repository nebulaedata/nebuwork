import { esc, lifetime } from '../knowledge/lifecycle.js';
import { mountWorkflowCanvas } from '../agents/workflowCanvas.js';
import { mountSopOverview } from './sopOverview.jsx';

const CREATION_POLL_LIMIT_MS = 5 * 60 * 1000;
const CREATION_WAIT_EXPIRED = '等待创建超过 5 分钟，已停止自动刷新。请点击“刷新工作流”；若仍持续等待，请联系管理员检查后台创建服务。';

export function remoteWorkflowGraph(definition) {
  return {
    nodes: Object.entries(definition.steps).map(([id, step]) => ({ id, t: id, d: step.code, ...definition.layout?.[id] })),
    edges: Object.entries(definition.steps).flatMap(([target, step]) => (step.needs || []).map(source => ({ id: `${source}->${target}`, source, target }))),
  };
}
export function applyRemoteWorkflowGraph(definition, graph) {
  const next = structuredClone(definition), ids = new Set(graph.nodes.map(node => node.id));
  for (const id of Object.keys(next.steps)) if (!ids.has(id)) { delete next.steps[id]; if (next.layout) delete next.layout[id]; }
  for (const node of graph.nodes) {
    if (!next.steps[node.id]) throw new Error('节点已变化，请重新加载工作流');
    next.steps[node.id].needs = graph.edges.filter(edge => edge.target === node.id).map(edge => edge.source);
    if (Number.isFinite(node.x) && Number.isFinite(node.y)) (next.layout ||= {})[node.id] = { x: node.x, y: node.y };
  }
  return next;
}

export function mountRemoteSopCanvas(host, set, expert, api, ui, statusName) {
  const life = lifetime(host), canvas = host.querySelector('#wf-canvas'), add = host.querySelector('[data-sop-add-node]');
  const status = host.querySelector('[data-workflow-status]'), errorBox = host.querySelector('[data-workflow-error]');
  let remote = null, timer, cleanupCanvas, loading = false, saving = false, pollingSince = Date.now();
  const call = (path, method, body, signal = life.signal) => api.workflowRequest(path, method, body, { signal });
  const path = `/workflows/${encodeURIComponent(set.workflow.id)}`;
  const overview = mountSopOverview(host, { id: set.workflow.id, expert, api, life });
  overview.message('正在加载真实工作流…');
  const controls = disabled => {
    if (add) add.disabled = disabled;
    const run = host.querySelector('[data-workflow-run]');
    if (run) { run.setAttribute('aria-disabled', String(disabled)); run.onclick = event => { if (disabled) event.preventDefault(); }; }
  };
  const message = (text, retryable = false) => {
    overview.message(text);
    cleanupCanvas?.(); cleanupCanvas = undefined;
    canvas.innerHTML = `<div class="sop-canvas-message"><div><p>${esc(text)}</p>${retryable ? '<button class="btn btn-ghost btn-sm" data-workflow-retry>重试原操作</button>' : ''}</div></div>`;
    const retry = canvas.querySelector('[data-workflow-retry]');
    if (retry) retry.onclick = async () => {
      if (!life.live() || loading || saving) return;
      saving = true; retry.disabled = true; clearTimeout(timer); errorBox.textContent = '';
      let submitted = false;
      try { await call(path + '/retry', 'POST'); submitted = true; pollingSince = Date.now(); }
      catch (error) { if (life.live() && error.name !== 'AbortError') errorBox.textContent = error.message || '重试失败，请刷新状态'; }
      finally { saving = false; if (life.live()) retry.disabled = false; }
      if (submitted && life.live()) void load();
    };
  };
  life.cleanup(() => { clearTimeout(timer); cleanupCanvas?.(); });
  async function load() {
    if (!life.live() || loading || saving) return;
    loading = true; clearTimeout(timer); controls(true);
    try {
      const data = await call(path);
      if (!life.live()) return;
      set.workflow = { id: data.id, status: data.status, error: data.error || null }; status.textContent = statusName(data.status); errorBox.textContent = data.error || '';
      if (!data.enabled) { remote = null; message('Workflow 接入已关闭，请联系管理员。'); return; }
      if (data.status !== 'ready') {
        remote = null;
        if (data.status === 'failed') { message(data.error || '工作流创建失败，可重试原操作。', true); return; }
        if (['pending', 'syncing'].includes(data.status)) {
          const remaining = CREATION_POLL_LIMIT_MS - (Date.now() - pollingSince);
          if (remaining <= 0) { errorBox.textContent = CREATION_WAIT_EXPIRED; message(CREATION_WAIT_EXPIRED); return; }
          message(data.status === 'pending' ? '等待后台创建真实工作流…' : '正在创建真实工作流…');
          timer = setTimeout(load, Math.min(2000, remaining));
        } else message('工作流创建状态未知，请刷新状态。');
        return;
      }
      remote = data.workflow;
      if (!remote) { message('工作流暂不可用，请刷新重试。'); return; }
      errorBox.textContent = remote.error || '';
      if (remote.error) { message('工作流定义或代码存在错误，请在“编辑代码”中修复。'); overview.update(remote); return; }
      overview.update(remote);
      const viewport = canvas.querySelector('.wf-viewport');
      const scroll = viewport ? { x: viewport.scrollLeft, y: viewport.scrollTop } : null;
      cleanupCanvas?.();
      const graph = remoteWorkflowGraph(remote.definition);
      cleanupCanvas = mountWorkflowCanvas(canvas, { wf: graph }, {
        ui, refresh: load, editNode: node => editStep(node.id), readOnly: remote.archived,
        save: async mutate => {
          if (!life.live() || saving) throw new Error('工作流正在保存，请稍候');
          const draft = { wf: structuredClone(graph) }; mutate(draft);
          saving = true; controls(true);
          try { remote = await call(path + '/definition', 'POST', { definition: applyRemoteWorkflowGraph(remote.definition, draft.wf), expected_revision: remote.revision }); overview.update(remote); }
          finally { saving = false; if (life.live()) controls(false); }
        },
      });
      if (scroll) { const next = canvas.querySelector('.wf-viewport'); next.scrollLeft = scroll.x; next.scrollTop = scroll.y; }
      controls(!!remote.archived);
    } catch (error) {
      if (life.live() && error.name !== 'AbortError') { errorBox.textContent = error.message; remote = null; message('真实工作流加载失败，请刷新重试。'); }
    } finally { loading = false; }
  }
  function editStep(id) {
    if (!remote || remote.archived || remote.error || saving || !life.live()) return;
    const edit = !!id, snapshot = structuredClone(remote), step = edit ? snapshot.definition.steps[id] : null;
    if (edit && !step) { ui.toast('节点已不存在，请刷新', 'err'); return; }
    const proposed = id || `step_${Object.keys(snapshot.definition.steps).length + 1}`;
    ui.modal(edit ? '编辑工作流节点' : '添加工作流节点', `
      <div class="field"><label>节点 ID</label><input data-step-id required maxlength="100" value="${esc(proposed)}" ${edit ? 'readonly' : ''}></div>
      ${edit ? `<div class="field"><label>代码入口</label><input data-step-code value="${esc(step.code)}"></div>` : '<p class="dim">创建对应的 Python 文件，随后可在“编辑代码”中配置处理逻辑。</p>'}
      <div class="field"><label>自动重试次数</label><input data-step-retries type="number" min="0" step="1" value="${step?.retries ?? 0}"></div>
      <div class="field"><label>重试间隔（秒）</label><input data-step-delay type="number" min="0" step="any" value="${step?.retry_delay ?? 1}"></div>
      <div class="field"><label>超时（秒，可留空）</label><input data-step-timeout type="number" min="0.001" step="any" value="${step?.timeout ?? ''}"></div>
      <div class="sop-workflow-error" data-step-error role="alert"></div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" data-step-save>${edit ? '保存' : '添加'}</button></div>`, box => {
      const modal = lifetime(box, life.live); ui.setModalCleanup(modal.dispose);
      const signal = AbortSignal.any([life.signal, modal.signal]);
      const button = box.querySelector('[data-step-save]'), error = box.querySelector('[data-step-error]');
      button.onclick = async () => {
        if (button.disabled || saving || !modal.live()) return;
        const nodeId = box.querySelector('[data-step-id]').value.trim();
        const retries = Number(box.querySelector('[data-step-retries]').value), delay = Number(box.querySelector('[data-step-delay]').value), rawTimeout = box.querySelector('[data-step-timeout]').value;
        const timeout = rawTimeout === '' ? null : Number(rawTimeout);
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(nodeId) || !edit && snapshot.definition.steps[nodeId]) { error.textContent = '节点 ID 必须是字母、数字、下划线或短横线，且不能重复。'; return; }
        if (!Number.isInteger(retries) || retries < 0 || !Number.isFinite(delay) || delay < 0 || timeout !== null && (!Number.isFinite(timeout) || timeout <= 0)) { error.textContent = '请填写有效的重试和超时参数。'; return; }
        button.disabled = true; saving = true; controls(true); error.textContent = '';
        try {
          let code = edit ? box.querySelector('[data-step-code]').value.trim() : `steps/${nodeId}.py:run`;
          if (!edit) {
            const sourcePath = `steps/${nodeId}.py`, content = 'def run(ctx):\n    ctx.task.save_json("result", ctx.input)\n';
            try { await call(path + '/source?path=' + encodeURIComponent(sourcePath), 'POST', { content, expected_revision: null }, signal); }
            catch (failure) {
              if (signal.aborted) throw failure;
              const existing = await call(path + '/source?path=' + encodeURIComponent(sourcePath), 'GET', undefined, signal);
              if (existing.content !== content) throw failure;
            }
          }
          const definition = structuredClone(snapshot.definition);
          definition.steps[nodeId] = { ...(step || { needs: [] }), code, retries, retry_delay: delay, timeout };
          const result = await call(path + '/definition', 'POST', { definition, expected_revision: snapshot.revision }, signal);
          if (!modal.live()) return;
          remote = result; ui.closeModal(); ui.toast(edit ? '节点已保存' : '节点已添加');
        } catch (failure) { if (modal.live() && failure.name !== 'AbortError') error.textContent = failure.message || '保存失败，请重试'; }
        finally { saving = false; if (life.live()) controls(false); if (modal.live()) button.disabled = false; else if (life.live()) void load(); }
      };
    });
  }
  if (add) add.onclick = () => editStep(null);
  const refresh = host.querySelector('[data-workflow-refresh]');
  if (refresh) refresh.onclick = () => { pollingSince = Date.now(); void load(); };
  if (api.workflowRequest) void load(); else message('工作流接口暂不可用。');
  return life.dispose;
}
