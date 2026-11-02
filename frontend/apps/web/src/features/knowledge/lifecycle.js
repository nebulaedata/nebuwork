import { authSession } from '../../services/authSession.js';
import { mountConfigSelect } from '../../shared/configSelect.jsx';
export const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export const statusLabel = value => ({ ready: '已就绪', untested: '未测试', failed: '连接异常', disabled: '已禁用', missing: '连接失效', indexing: '索引中', pending: '等待索引', error: '索引异常', unknown: '状态未知' }[value] || value || '状态未知');
export function lifetime(element, parentValid = () => true) {
  element.knowledgeCleanup?.();
  const controller = new AbortController(), version = authSession.getSnapshot().version, route = location.hash;
  let disposed = false;
  const callbacks = [];
  const live = () => !disposed && element.isConnected && location.hash === route && authSession.getSnapshot().version === version && parentValid();
  const dispose = () => {
    if (disposed) return;
    disposed = true; controller.abort();
    window.removeEventListener('hashchange', dispose);
    observer.disconnect(); unsubscribe(); callbacks.splice(0).forEach(fn => fn());
  };
  // A page mounted during auth notification can receive that same notification.
  const unsubscribe = authSession.subscribe(() => {
    if (authSession.getSnapshot().version !== version) dispose();
  });
  const observer = new MutationObserver(() => { if (!element.isConnected) dispose(); });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', dispose, { once: true });
  element.knowledgeCleanup = dispose;
  return { live, signal: controller.signal, dispose, cleanup: fn => callbacks.push(fn) };
}
export function knowledgeModal(title, content, valid, mount) {
  UI.modal(title, content, box => {
    box.classList.add('knowledge-modal', 'workbench-config-modal');
    const life = lifetime(box, valid), pickers = [];
    const note = document.createElement('div'); note.className = 'knowledge-error'; note.setAttribute('role', 'alert');
    box.querySelector('.modal-body').prepend(note);
    UI.setModalCleanup(() => { life.dispose(); box.classList.remove('knowledge-modal', 'workbench-config-modal'); });
    let pending = false;
    const context = {
      ...life, box,
      error: error => { if (life.live()) note.textContent = error.message || String(error); },
      clear: () => { note.textContent = ''; },
      select: (selector, props) => {
        const picker = mountConfigSelect(box.querySelector(selector), props);
        pickers.push(picker); life.cleanup(picker.destroy); return picker;
      },
      action: (selector, fn) => box.querySelector(selector)?.addEventListener('click', async event => {
        event.preventDefault();
        if (pending || !life.live()) return;
        pending = true; note.textContent = '';
        const controls = [...box.querySelectorAll('button:not([data-close]),input,textarea')].map(node => [node, node.disabled]);
        controls.forEach(([node]) => { node.disabled = true; }); pickers.forEach(p => p.setDisabled(true));
        try { await fn(context); } catch (error) { if (error.name !== 'AbortError') context.error(error); }
        finally { pending = false; if (life.live()) { controls.forEach(([node, disabled]) => { node.disabled = disabled; }); pickers.forEach(p => p.setDisabled(false)); } }
      }),
    };
    mount(context);
  });
}
export const modalFooter = label => '<div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" data-save>' + esc(label) + '</button></div>';
