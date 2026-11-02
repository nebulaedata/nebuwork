import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mountWorkflowCanvas } from './workflowCanvas.js';

let dom, canvas, set, save, refresh, ui, editNode, cleanup, version, listeners;
function mount() {
  cleanup?.();
  cleanup = mountWorkflowCanvas(canvas, set, { save, refresh, ui, editNode,
    session: { getSnapshot: () => ({ version }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } } });
  for (const el of canvas.querySelectorAll('.wf-node')) {
    Object.defineProperties(el, { offsetWidth: { value: 152 }, offsetHeight: { value: 58 } });
  }
  Object.defineProperties(canvas.querySelector('.wf-stage'), { clientWidth: { value: 800 }, clientHeight: { value: 340 } });
}
const port = (id, direction) => canvas.querySelector(`[data-node-id="${id}"] .wf-port-${direction}`);
function pointer(el, type, x, y) {
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 }); el.dispatchEvent(event);
}
function clickEdge(index = 0) { canvas.querySelectorAll('.wf-edge-hit')[index].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); }
beforeEach(() => {
  dom = new JSDOM('<div id="canvas"></div>', { url: 'http://localhost/#/agent/a?tab=sop' });
  canvas = dom.window.document.querySelector('#canvas'); version = 1; listeners = new Set();
  set = { wf: { nodes: ['a', 'b', 'c'].map((id, index) => ({ id, t: id, d: '', x: 26 + index * 194, y: 24 })) } };
  ui = { esc: value => value, toast: vi.fn() }; editNode = vi.fn();
  save = vi.fn(async mutate => { const draft = structuredClone(set); mutate(draft); set = draft; });
  refresh = vi.fn(mount); mount();
});
afterEach(() => { cleanup?.(); dom.window.close(); cleanup = null; });

describe('custom SOP connections', () => {
  it('persists a dragged branch without moving or editing either node', async () => {
    dom.window.document.elementFromPoint = vi.fn(() => port('c', 'in'));
    const start = port('a', 'out');
    pointer(start, 'pointerdown', 178, 53); pointer(start, 'pointermove', 414, 53); pointer(start, 'pointerup', 414, 53);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(set.wf.edges).toHaveLength(3);
    expect(set.wf.edges[2]).toMatchObject({ source: 'a', target: 'c' });
    expect(set.wf.nodes[0]).toMatchObject({ x: 26, y: 24 }); expect(editNode).not.toHaveBeenCalled();
  });
  it('keeps zero edges after deleting the final connection and remounting', async () => {
    set.wf.nodes.pop(); mount(); clickEdge(); canvas.querySelector('.wf-edge-actions button').click();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    mount(); expect(set.wf.edges).toEqual([]); expect(canvas.querySelectorAll('.wf-edge')).toHaveLength(0);
  });
  it('supports selecting a line with the keyboard and deleting only that line', async () => {
    canvas.querySelector('.wf-edge').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    canvas.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(set.wf.edges).toEqual([{ id: 'legacy-edge-2', source: 'b', target: 'c' }]);
  });
  it('rejects duplicate and self connections without writing', () => {
    port('a', 'out').click(); port('b', 'in').click(); expect(ui.toast).toHaveBeenLastCalledWith('这条连线已存在', 'err');
    port('a', 'out').click(); port('a', 'in').click(); expect(ui.toast).toHaveBeenLastCalledWith('不能连接节点自身', 'err');
    expect(save).not.toHaveBeenCalled();
  });
  it('restores saved lines after a failed write and allows retry', async () => {
    save.mockRejectedValueOnce(new Error('配置已被其他操作修改，请重新加载后再保存'));
    clickEdge(); canvas.querySelector('.wf-edge-actions button').click();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(canvas.querySelectorAll('.wf-edge')).toHaveLength(2);
    expect(ui.toast).toHaveBeenCalledWith('配置已被其他操作修改，请重新加载后再保存', 'err');
    clickEdge(); canvas.querySelector('.wf-edge-actions button').click();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(canvas.querySelectorAll('.wf-edge')).toHaveLength(1);
  });
  it('cancels an unfinished drag without saving and saves node movement without changing links', async () => {
    const node = canvas.querySelector('.wf-node');
    pointer(node, 'pointerdown', 30, 30); pointer(node, 'pointermove', 90, 60); pointer(node, 'pointercancel', 90, 60);
    expect(node.style.left).toBe('26px'); expect(save).not.toHaveBeenCalled();
    pointer(node, 'pointerdown', 30, 30); pointer(node, 'pointermove', 90, 60); pointer(node, 'pointerup', 90, 60);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(set.wf.nodes[0]).toMatchObject({ x: 86, y: 54 }); expect(set.wf.edges).toHaveLength(2);
  });
  it('does not connect when dropped on empty canvas', () => {
    dom.window.document.elementFromPoint = () => canvas;
    const start = port('a', 'out');
    pointer(start, 'pointerdown', 178, 53); pointer(start, 'pointermove', 250, 200); pointer(start, 'pointerup', 250, 200);
    expect(save).not.toHaveBeenCalled(); expect(canvas.querySelector('.wf-edge-preview')).toBeNull();
  });
  it('ignores a completed save after account change and disposes its subscription', async () => {
    let resolve; save.mockImplementation(() => new Promise(r => { resolve = r; }));
    port('a', 'out').click(); port('c', 'in').click();
    version++; listeners.forEach(fn => fn()); resolve(); await Promise.resolve(); await Promise.resolve();
    expect(refresh).not.toHaveBeenCalled(); expect(ui.toast).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
  });
  it('cancels a gesture when the canvas is removed', async () => {
    const start = port('a', 'out'); pointer(start, 'pointerdown', 178, 53);
    canvas.remove(); await Promise.resolve(); pointer(start, 'pointerup', 414, 53);
    expect(save).not.toHaveBeenCalled(); expect(listeners.size).toBe(0);
  });
});
