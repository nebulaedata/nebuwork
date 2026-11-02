import { authSession } from '../../services/authSession.js';

export function openRemoveExpertModal({ expert, api, ui, icon, onRemoved, mode = 'remove', sessionVersion = () => authSession.getSnapshot().version }) {
  const deleting = mode === 'delete', action = deleting ? '删除' : '移除';
  ui.openModal(`
    <div class="modal-head"><div class="modal-title">${deleting ? '删除专家' : '从我的专家移除'}</div>
      <button class="btn-icon" data-remove-cancel aria-label="关闭">${icon('x', 16)}</button></div>
    <div class="modal-body expert-delete-confirm">
      <p>确认${action}「${ui.esc(expert.name)}」？</p>
      <p class="sub">${deleting ? '删除后，该专家将从当前账号的列表中移除，无法再查看或配置。此操作不提供恢复入口。' : '移除后可从专家智能体市场重新添加。已有 SOP、规则和素材会保留，重新添加时恢复。'}</p>
      <p class="dim">仅影响当前账号的专家列表。若工作台仍在引用，请先在工作台配置中解除引用；历史发布版本和项目快照保持不变。</p>
      <div id="remove-expert-error" class="model-provider-note error" role="alert" hidden></div>
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" data-remove-cancel>取消</button>
      <button class="btn btn-danger" id="remove-expert-submit">确认${action}</button></div>`);
  const submit = document.getElementById('remove-expert-submit');
  const errorBox = document.getElementById('remove-expert-error');
  const version = sessionVersion(), route = location.hash;
  let disposed = false, pending = false;
  const live = () => !disposed && submit.isConnected && sessionVersion() === version && location.hash === route;
  ui.setModalCleanup(() => { disposed = true; });
  document.querySelectorAll('[data-remove-cancel]').forEach(button => button.addEventListener('click', () => ui.closeModal()));
  if (!Number.isSafeInteger(expert.revision) || !Number.isSafeInteger(expert.membershipRevision)) {
    errorBox.hidden = false; errorBox.textContent = '专家状态尚未加载，请刷新页面后重试。'; submit.disabled = true;
  }
  submit.addEventListener('click', async () => {
    if (!live() || pending || submit.disabled) return;
    pending = true; submit.disabled = true; submit.textContent = action + '中…'; errorBox.hidden = true;
    try {
      await api.removeExpert(expert.id, expert.revision, expert.membershipRevision);
    } catch (error) {
      if (live()) {
        errorBox.hidden = false; errorBox.textContent = error.message || action + '失败，请重试';
        submit.disabled = false; submit.textContent = '重试' + action;
      }
      pending = false;
      return;
    }
    if (!live()) return;
    ui.closeModal(); ui.toast(deleting ? '专家已从当前账号删除' : '已从我的专家移除，可在市场重新添加');
    try { await onRemoved?.(); }
    catch (error) { if (sessionVersion() === version && location.hash === route) ui.toast(error.message || '列表刷新失败，请刷新页面', 'err'); }
  });
}
