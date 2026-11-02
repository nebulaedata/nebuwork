import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { mountProcessCanvas } from './processCanvas.js';

let dom, cleanup;
afterEach(() => { cleanup?.(); dom?.window.close(); });
describe('standard process positions', () => {
  it('persists a drag without changing step order or introducing workflow dependencies', async () => {
    dom = new JSDOM('<div id="canvas"></div>', { url: 'http://localhost/#/agent/a?tab=sop' });
    const canvas = dom.window.document.querySelector('#canvas');
    const set = { proc: { input: '周期', steps: ['a', 'b'].map((id, index) => ({ id, t: id, d: '', sys: 'ERP', rpa: true, x: 26 + index * 194, y: 24 })) } };
    const refresh = vi.fn(), save = vi.fn(async mutate => mutate(set));
    cleanup = mountProcessCanvas(canvas, set, { save, refresh, editNode: vi.fn(), ui: { esc: String, toast: vi.fn() }, session: { getSnapshot: () => ({ version: 1 }), subscribe: () => () => {} } });
    const node = canvas.querySelector('[data-node-id="a"]');
    Object.defineProperties(node, { offsetWidth: { value: 152 }, offsetHeight: { value: 80 } });
    Object.defineProperties(canvas.querySelector('.wf-stage'), { clientWidth: { value: 800 }, clientHeight: { value: 340 } });
    for (const [type, x, y] of [['pointerdown', 30, 30], ['pointermove', 70, 60], ['pointerup', 70, 60]]) {
      const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(event, 'pointerId', { value: 1 }); node.dispatchEvent(event);
    }
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(set.proc.steps.map(step => step.id)).toEqual(['a', 'b']);
    expect(set.proc.steps[0]).toMatchObject({ x: 66, y: 54, sys: 'ERP', rpa: true });
    expect(set.proc.input).toBe('周期'); expect(set.proc.edges).toBeUndefined();
  });
});
