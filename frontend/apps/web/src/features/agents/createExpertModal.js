import { mountSavedModelSelect } from '../../shared/savedModelSelect.jsx';
import { authSession } from '../../services/authSession.js';
import { abilityField, mountExpertAbility } from './expertAbility.js';
import './expertSettings.css';

export function openCreateExpertModal({ api, ui, icon, sessionVersion = () => authSession.getSnapshot().version }) {
  ui.openModal(`
    <div class="modal-head">
      <div class="modal-title">创建专家智能体</div>
      <button class="btn-icon" onclick="UI.closeModal()">${icon('x', 16)}</button>
    </div>
    <div class="modal-body">
      <div class="field" id="f-aname"><label for="na-name">专家名称</label>
        <input id="na-name" maxlength="160" placeholder="例如:合同谈判专家 · 子衿"><div class="err">请输入专家名称</div></div>
      <div class="field"><label for="na-role">专业方向</label><input id="na-role" maxlength="240" placeholder="例如:合同谈判与条款博弈"></div>
      <div class="field"><label for="na-model">基础模型</label><div id="na-model-mount"></div>
        <div class="model-provider-note" id="na-model-status" role="status">正在加载当前账号的模型配置…</div>
        <button class="btn btn-ghost btn-sm" id="na-model-retry" type="button" hidden>重新加载模型</button>
        <button class="btn btn-ghost btn-sm" id="na-model-settings" type="button">前往模型设置</button></div>
      ${abilityField('na', icon)}
    </div>
    <div class="modal-foot"><button class="btn btn-ghost" onclick="UI.closeModal()">取消</button>
      <button class="btn btn-primary" id="na-submit" disabled>创建专家</button></div>`);
  const field = name => document.getElementById('na-' + name);
  const name = field('name'), role = field('role'), tagline = field('tagline');
  const submit = field('submit'), retry = field('model-retry'), settings = field('model-settings'), note = field('model-status');
  const version = sessionVersion();
  let disposed = false, loading = true, pending = false, generating = false, providers = [], ability;
  const live = () => !disposed && name.isConnected && sessionVersion() === version;
  const status = (text, error = false) => { note.textContent = text; note.className = 'model-provider-note' + (error ? ' error' : ''); };
  const picker = mountSavedModelSelect(field('model-mount'), { onChange: () => {
    status('仅使用当前账号已保存的模型配置。'); refresh();
  } });
  ability = mountExpertAbility({ root: name.closest('.modal-body'), prefix: 'na', api, live,
    read: () => ({ name: name.value.trim(), role: role.value.trim(), tagline: tagline.value.trim(), modelProviderId: picker.getValue() }),
    canGenerate: () => !loading && !pending && providers.some(provider => provider.id === picker.getValue()),
    blocked: () => pending,
    onBusy: value => { generating = value; refresh(); },
  });
  ui.setModalCleanup(() => { disposed = true; ability.dispose(); picker.destroy(); });
  function refresh() {
    submit.disabled = loading || pending || generating || !providers.some(provider => provider.id === picker.getValue());
    retry.disabled = loading || pending || generating;
    settings.disabled = pending || generating;
    picker.setDisabled(pending || generating);
    [name, role, tagline].forEach(input => { input.disabled = pending; });
    submit.textContent = pending ? '创建中…' : '创建专家';
    ability?.refresh();
  }
  async function load() {
    if (!live() || pending) return;
    loading = true; providers = []; retry.hidden = true;
    picker.setLoading(true); refresh();
    status('正在加载当前账号的模型配置…');
    try {
      const result = await api.fetchModelProviders();
      if (!live()) return;
      providers = result.data;
      picker.setProviders(providers);
      status(providers.length ? '仅使用当前账号已保存的模型配置。' : '当前账号尚未添加模型，请先前往模型设置添加。');
    } catch (error) {
      if (!live()) return;
      picker.setProviders([]); retry.hidden = false;
      status(error.message || '模型配置加载失败，请重试', true);
    } finally {
      if (live()) { loading = false; picker.setLoading(false); refresh(); }
    }
  }
  retry.addEventListener('click', load);
  settings.addEventListener('click', () => { ui.closeModal(); location.hash = '#/settings?tab=model'; });
  submit.addEventListener('click', async () => {
    if (!live() || submit.disabled) return;
    const expertName = name.value.trim();
    if (!expertName) { name.closest('.field').classList.add('invalid'); return; }
    const modelProviderId = picker.getValue();
    pending = true; refresh();
    try {
      const result = await api.createAgent({ name: expertName, role: role.value.trim(), modelProviderId, tagline: tagline.value.trim() });
      if (!live()) return;
      ui.closeModal(); ui.toast('专家「' + expertName + '」已创建');
      location.hash = '#/agent/' + result.data.id;
    } catch (error) {
      if (live()) { status(error.message || '创建失败，请重试', true); ui.toast(error.message || '创建失败，请重试', 'err'); retry.hidden = false; }
    } finally {
      pending = false;
      if (live()) refresh();
    }
  });
  void load();
}
