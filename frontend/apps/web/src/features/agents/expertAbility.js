import { authSession } from '../../services/authSession.js';

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function abilityField(prefix, icon, value = '') {
  return `<div class="field expert-ability-field"><div class="expert-ability-heading"><label for="${prefix}-tagline">能力简介</label><div class="expert-ability-actions"><button class="btn btn-ghost btn-sm" type="button" id="${prefix}-ai-undo" hidden>撤销补全</button><button class="btn btn-ghost btn-sm" type="button" id="${prefix}-ai" disabled>${icon('sparkles', 12)}<span data-ai-label>AI 补全</span></button></div></div>
    <textarea id="${prefix}-tagline" rows="4" maxlength="2000" placeholder="说明这位专家擅长什么，也可根据名称、专业方向和已选模型进行 AI 补全">${esc(value)}</textarea>
    <div class="expert-ability-note" id="${prefix}-ai-status" role="status" aria-live="polite">使用所选基础模型补全，生成后可继续编辑。</div>
    <div class="expert-ability-suggestion" id="${prefix}-ai-suggestion" hidden><p>表单已修改，补全结果未自动替换。确认后可应用：</p><pre></pre><button class="btn btn-ghost btn-sm" type="button" id="${prefix}-ai-apply">应用补全</button></div></div>`;
}

export function mountExpertAbility({ root, prefix, api, read, live, canGenerate, blocked = () => false, onBusy = () => {} }) {
  const find = name => root.querySelector('#' + prefix + '-' + name);
  const button = find('ai'), textarea = find('tagline'), note = find('ai-status'), suggestion = find('ai-suggestion'), undo = find('ai-undo'), apply = find('ai-apply');
  const win = root.ownerDocument.defaultView, route = win.location.hash;
  let disposed = false, pending = false, controller, draft = null, previous = null;
  const valid = () => !disposed && live() && win.location.hash === route;
  const fingerprint = value => JSON.stringify(value);
  function refresh() {
    if (!valid()) return;
    button.disabled = pending || blocked() || !canGenerate() || !read().name.trim();
    button.querySelector('[data-ai-label]').textContent = pending ? '正在补全…' : 'AI 补全';
    undo.hidden = !previous || textarea.value !== previous.result;
    undo.disabled = pending || blocked(); apply.disabled = pending || blocked();
  }
  function use(value) {
    previous = { value: textarea.value, result: value }; textarea.value = value;
    suggestion.hidden = true; draft = null;
    textarea.dispatchEvent(new win.Event('input', { bubbles: true }));
    note.textContent = 'AI 补全已填入，可继续编辑，保存后生效。'; note.classList.remove('error'); refresh();
  }
  async function generate() {
    if (!valid() || button.disabled) return;
    const snapshot = read(); pending = true; controller = new AbortController(); draft = null; suggestion.hidden = true;
    note.textContent = '正在使用所选基础模型补全能力简介…'; note.classList.remove('error'); onBusy(true); refresh();
    try {
      const { data } = await api.completeExpertAbility(snapshot, { signal: controller.signal });
      if (!valid() || controller.signal.aborted) return;
      if (!data || typeof data.tagline !== 'string' || !data.tagline.trim() || data.tagline.length > 2000 || data.modelProviderId !== snapshot.modelProviderId) throw new Error('AI 返回的能力简介无效，请重试');
      if (fingerprint(read()) === fingerprint(snapshot)) use(data.tagline);
      else { draft = data.tagline; suggestion.querySelector('pre').textContent = draft; suggestion.hidden = false; note.textContent = 'AI 补全完成，请确认结果后应用。'; }
    } catch (error) { if (valid() && error.name !== 'AbortError') { note.textContent = error.message || 'AI 补全失败，请重试'; note.classList.add('error'); } }
    finally { pending = false; if (valid()) { onBusy(false); refresh(); } }
  }
  const restore = () => { if (valid() && !pending && !blocked() && previous && textarea.value === previous.result) { textarea.value = previous.value; previous = null; textarea.dispatchEvent(new win.Event('input', { bubbles: true })); note.textContent = '已恢复补全前的内容。'; refresh(); } };
  const accept = () => { if (valid() && !pending && !blocked() && draft) use(draft); };
  button.addEventListener('click', generate); undo.addEventListener('click', restore); apply.addEventListener('click', accept);
  const inputs = [find('name'), find('role'), textarea]; inputs.forEach(input => input.addEventListener('input', refresh));
  const dispose = () => { if (disposed) return; disposed = true; controller?.abort(); unsubscribe?.(); win.removeEventListener('hashchange', dispose); button.removeEventListener('click', generate); undo.removeEventListener('click', restore); apply.removeEventListener('click', accept); inputs.forEach(input => input.removeEventListener('input', refresh)); };
  const unsubscribe = authSession.subscribe?.(() => { if (!live()) dispose(); });
  win.addEventListener('hashchange', dispose); refresh();
  return { refresh, dispose };
}
