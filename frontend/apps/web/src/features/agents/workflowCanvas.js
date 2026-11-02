import { authSession } from '../../services/authSession.js';
import { connectWorkflowNodes, materializeWorkflowEdges, removeWorkflowNode, workflowEdges } from './workflowGraph.js';
import { workflowKey } from '../../services/workflowKey.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HINT = '拖拽节点调整位置 · 右侧圆点连到目标左侧圆点 · 点击连线可删除';

export function mountWorkflowCanvas(canvas, set, { save, editNode, refresh, ui, session = authSession, allowConnections = true, readOnly = false, ariaLabel = '工作流节点和连线画布' }) {
  const hintText = readOnly ? '工作流已归档，节点仅供查看' : allowConnections ? HINT : '拖拽步骤调整位置 · 点击步骤编辑 · 悬停步骤右上角删除 · 连线表示操作顺序';
  const doc = canvas.ownerDocument, win = doc.defaultView;
  const events = new win.AbortController();
  const route = win.location.hash, version = session.getSnapshot().version;
  let disposed = false, pending = false, selected = null, source = null, preview = null, cancelGesture = null;
  const nodes = structuredClone(set.wf.nodes), edges = workflowEdges(set.wf);
  const elements = new Map();
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.classList.add('wf-edges');
  const stage = doc.createElement('div'); stage.className = 'wf-stage'; stage.append(svg);
  const viewport = doc.createElement('div'); viewport.className = 'wf-viewport'; viewport.append(stage);
  canvas.replaceChildren(viewport);
  canvas.classList.remove('wf-saving'); canvas.setAttribute('aria-busy', 'false');
  canvas.classList.toggle('wf-sequential', !allowConnections);
  canvas.classList.toggle('wf-readonly', readOnly);
  canvas.tabIndex = 0; canvas.setAttribute('aria-label', ariaLabel);
  const actions = doc.createElement('div'); actions.className = 'wf-edge-actions'; actions.hidden = true;
  const selectedLabel = doc.createElement('span');
  const remove = doc.createElement('button'); remove.type = 'button'; remove.className = 'btn btn-ghost btn-sm'; remove.textContent = '删除连线';
  actions.append(selectedLabel, remove);
  const hint = doc.createElement('div'); hint.className = 'wf-canvas-hint'; hint.textContent = hintText; hint.setAttribute('aria-live', 'polite');
  canvas.append(actions, hint);
  const live = () => !disposed && canvas.isConnected && win.location.hash === route && session.getSnapshot().version === version;
  const ready = () => live() && !pending && !readOnly;
  const observer = new win.MutationObserver(() => { if (!live()) cleanup(); });
  const unsubscribe = session.subscribe(() => { if (!live()) cleanup(); });
  const onNavigation = () => { if (!live()) cleanup(); };
  function cleanup() {
    if (disposed) return;
    disposed = true; cancelGesture?.(); events.abort(); observer.disconnect(); unsubscribe();
    win.removeEventListener('hashchange', onNavigation);
  }
  observer.observe(doc.body, { childList: true, subtree: true });
  win.addEventListener('hashchange', onNavigation);

  async function persist(mutate, message) {
    if (!ready()) return;
    pending = true; source = null; preview = null; cancelGesture?.();
    canvas.setAttribute('aria-busy', 'true'); canvas.classList.add('wf-saving');
    hint.textContent = '正在保存…';
    try {
      await save(mutate);
      if (live() && message) ui.toast(message);
    } catch (error) {
      if (live()) ui.toast(error.message || '保存失败，请重试', 'err');
    } finally {
      // Redraw from the API cache on either outcome; failed writes never become local truth.
      if (live()) refresh();
    }
  }
  function point(id, output) {
    const node = elements.get(id);
    return { x: parseFloat(node.style.left) + (output ? node.offsetWidth : 0), y: parseFloat(node.style.top) + node.offsetHeight / 2 };
  }
  function curve(a, b) {
    const bend = Math.max(42, Math.abs(b.x - a.x) / 2);
    return `M${a.x},${a.y} C${a.x + bend},${a.y} ${b.x - bend},${b.y} ${b.x},${b.y}`;
  }
  function path(d, className) {
    const p = doc.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); p.setAttribute('class', className); return p;
  }
  function draw() {
    svg.innerHTML = '<defs><marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--accent)"/></marker></defs>';
    for (const edge of edges) {
      if (!elements.has(edge.source) || !elements.has(edge.target)) continue;
      const d = curve(point(edge.source, true), point(edge.target, false));
      const group = doc.createElementNS(SVG_NS, 'g');
      group.dataset.edgeId = edge.id; group.setAttribute('class', `wf-edge${selected === edge.id ? ' selected' : ''}`);
      group.setAttribute('tabindex', '0'); group.setAttribute('role', 'button');
      const label = `${nodes.find(n => n.id === edge.source).t} → ${nodes.find(n => n.id === edge.target).t}`;
      group.setAttribute('aria-label', `选择连线：${label}`);
      group.setAttribute('aria-pressed', String(selected === edge.id));
      if (!allowConnections || readOnly) { group.removeAttribute('tabindex'); group.removeAttribute('aria-pressed'); group.setAttribute('role', 'img'); group.setAttribute('aria-label', `${allowConnections ? '依赖' : '步骤顺序'}：${label}`); }
      const line = path(d, 'wf-edge-line'); line.setAttribute('marker-end', 'url(#wf-arrow)');
      group.append(path(d, 'wf-edge-hit'), line);
      const select = () => {
        if (!ready()) return;
        cancelGesture?.(); source = null; preview = null; selected = edge.id; draw();
        selectedLabel.textContent = label; actions.hidden = false; hint.textContent = '点击“删除连线”或按 Delete 删除 · Esc 取消选择';
        canvas.focus({ preventScroll: true });
      };
      if (allowConnections) {
        group.addEventListener('click', event => { event.stopPropagation(); select(); });
        group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); select(); } });
      }
      svg.append(group);
    }
    if (source && preview) svg.append(path(curve(point(source, true), preview), 'wf-edge-preview'));
    elements.forEach((el, id) => el.classList.toggle('wf-connecting', id === source));
  }
  function clearSelection() {
    cancelGesture?.(); selected = null; source = null; preview = null;
    actions.hidden = true; hint.textContent = hintText; draw();
  }
  function chooseSource(id) {
    cancelGesture?.();
    selected = null; actions.hidden = true; source = id; preview = null;
    elements.get(id).querySelector('.wf-port-out').focus({ preventScroll: true });
    hint.textContent = '连接到目标节点左侧圆点（也可依次点击两个圆点）· Esc 取消'; draw();
  }
  function connect(target) {
    if (!ready() || !source) return;
    const from = source, id = `edge-${workflowKey()}`;
    try { connectWorkflowNodes(structuredClone(set.wf), from, target, id); }
    catch (error) { ui.toast(error.message, 'err'); clearSelection(); return; }
    void persist(draft => connectWorkflowNodes(draft.wf, from, target, id), '连线已保存');
  }
  function deleteEdge() {
    if (!selected) return;
    const id = selected;
    void persist(draft => { draft.wf.edges = materializeWorkflowEdges(draft.wf).filter(edge => edge.id !== id); }, '连线已删除');
  }
  remove.addEventListener('click', deleteEdge);
  canvas.addEventListener('keydown', event => {
    if (!ready() || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'Escape') { event.preventDefault(); clearSelection(); }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected) { event.preventDefault(); deleteEdge(); }
  }, { signal: events.signal });
  canvas.addEventListener('click', event => { if (ready() && (event.target === canvas || event.target === stage || event.target === svg)) clearSelection(); }, { signal: events.signal });

  // Pointer capture keeps drags reliable outside the canvas; cancellation never saves a partial move.
  function gesture(handle, start, move, end, cancel) {
    cancelGesture?.();
    handle.setPointerCapture?.(start.pointerId);
    const finish = () => {
      handle.removeEventListener('pointermove', onMove); handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel); handle.removeEventListener('lostpointercapture', onCancel);
      if (handle.hasPointerCapture?.(start.pointerId)) handle.releasePointerCapture(start.pointerId);
      cancelGesture = null;
    };
    const onMove = e => { if (e.pointerId === start.pointerId) { if (ready()) move(e); else onCancel(); } };
    const onUp = e => { if (e.pointerId === start.pointerId) { finish(); if (ready()) end(e); else cancel(); } };
    const onCancel = () => { finish(); cancel(); };
    cancelGesture = onCancel;
    handle.addEventListener('pointermove', onMove); handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel); handle.addEventListener('lostpointercapture', onCancel);
  }
  nodes.forEach((node, index) => {
    const row = Math.floor(index / 3), col = index % 3;
    node.x ??= 26 + (row % 2 ? 2 - col : col) * 194; node.y ??= 24 + row * (allowConnections ? 110 : 130);
    const el = doc.createElement('div'); el.className = 'wf-node'; el.dataset.nodeId = node.id;
    el.style.left = `${node.x}px`; el.style.top = `${node.y}px`;
    el.innerHTML = `<button type="button" class="wf-node-t" title="编辑节点"><span class="wf-node-idx">${index + 1}</span><span>${ui.esc(node.t)}</span></button>` +
      (node.d ? `<div class="wf-node-d">${ui.esc(node.d)}</div>` : '') +
      (node.sys || node.rpa ? `<div class="wf-node-meta">${node.sys ? `<span class="pill pill-warning" title="${ui.esc(node.sys)}">业务系统 · ${ui.esc(node.sys)}</span>` : ''}${node.rpa ? '<span class="pill pill-dim">RPA 标记</span>' : ''}</div>` : '') +
      '<button type="button" class="wf-node-x" title="删除节点">×</button>';
    const input = doc.createElement('button'), output = doc.createElement('button');
    for (const [port, direction, label] of [[input, 'in', '输入'], [output, 'out', '输出']]) {
      port.type = 'button'; port.className = `wf-port wf-port-${direction}`; port.dataset.nodeId = node.id;
      port.setAttribute('aria-label', `${node.t}：${label}连接点`); port.title = `${label}连接点`; if (allowConnections && !readOnly) el.append(port);
    }
    if (readOnly) el.querySelectorAll('button').forEach(button => { button.disabled = true; });
    let suppressClick = false;
    input.addEventListener('click', () => { if (ready()) { if (source) connect(node.id); else ui.toast('请先选择起点节点右侧圆点'); } });
    output.addEventListener('click', event => {
      const ignore = suppressClick && event.detail !== 0; suppressClick = false;
      if (!ignore && ready()) chooseSource(node.id);
    });
    output.addEventListener('pointerdown', event => {
      if (!ready() || event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault(); event.stopPropagation(); suppressClick = false; chooseSource(node.id);
      let moved = false;
      gesture(output, event, e => {
        moved ||= Math.abs(e.clientX - event.clientX) + Math.abs(e.clientY - event.clientY) > 4;
        const rect = stage.getBoundingClientRect(); preview = { x: e.clientX - rect.left, y: e.clientY - rect.top }; draw();
      }, e => {
        suppressClick = moved;
        if (!moved) return;
        const target = doc.elementFromPoint(e.clientX, e.clientY)?.closest('.wf-port-in');
        if (target && stage.contains(target)) connect(target.dataset.nodeId); else clearSelection();
      }, () => { suppressClick = true; source = null; preview = null; hint.textContent = hintText; draw(); });
    });
    let dragged = false;
    el.addEventListener('pointerdown', event => {
      if (!ready() || event.button !== 0 || event.isPrimary === false || event.target.closest('.wf-port, .wf-node-x')) return;
      event.preventDefault(); canvas.focus({ preventScroll: true });
      clearSelection(); dragged = false;
      const ox = node.x, oy = node.y; el.classList.add('dragging');
      const reset = () => { node.x = ox; node.y = oy; el.style.left = `${ox}px`; el.style.top = `${oy}px`; el.classList.remove('dragging'); draw(); };
      gesture(el, event, e => {
        const dx = e.clientX - event.clientX, dy = e.clientY - event.clientY;
        dragged ||= Math.abs(dx) + Math.abs(dy) > 4;
        if (!dragged) return;
        node.x = Math.max(12, Math.min(stage.clientWidth - el.offsetWidth - 12, ox + dx));
        node.y = Math.max(12, Math.min(stage.clientHeight - el.offsetHeight - 12, oy + dy));
        el.style.left = `${node.x}px`; el.style.top = `${node.y}px`; draw();
      }, () => {
        el.classList.remove('dragging');
        if (!dragged) return;
        const position = { x: node.x, y: node.y };
        void persist(draft => {
          const current = draft.wf.nodes.find(item => item.id === node.id);
          if (!current) throw new Error('节点已不存在，请重新加载');
          materializeWorkflowEdges(draft.wf); Object.assign(current, position);
        });
      }, reset);
    });
    el.addEventListener('click', event => {
      if (event.target.closest('.wf-port, .wf-node-x')) return;
      const ignore = dragged && event.detail !== 0; dragged = false;
      if (ignore) return;
      if (ready()) editNode(node);
    });
    el.querySelector('.wf-node-x').addEventListener('click', () => {
      void persist(draft => removeWorkflowNode(draft.wf, node.id), '节点及相关连线已删除');
    });
    elements.set(node.id, el); stage.append(el);
  });
  stage.style.width = `${Math.max(640, ...nodes.map(node => node.x + 230))}px`;
  stage.style.height = `${Math.max(320, ...nodes.map(node => node.y + elements.get(node.id).offsetHeight + 70))}px`;
  draw();
  return cleanup;
}
