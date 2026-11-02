import { mountSavedModelSelect } from '../../shared/savedModelSelect.jsx';
import { lifetime } from '../knowledge/lifecycle.js';
import { abilityField, mountExpertAbility } from './expertAbility.js';
import './expertSettings.css';

export function expertSettingsForm(expert, ui, icon) {
  return `<form class="expert-profile-form" data-expert-form><h3 class="expert-profile-title">基本信息</h3><div class="expert-profile-grid">
    <div class="field"><label for="es-name">专家名称</label><input id="es-name" required maxlength="160" value="${ui.esc(expert.name)}"></div>
    <div class="field"><label for="es-role">专业方向</label><input id="es-role" maxlength="240" value="${ui.esc(expert.role)}"></div>
    <div class="field expert-profile-wide"><label for="es-model">基础模型</label><div id="es-model-mount"></div><div class="model-provider-note" id="es-model-status" role="status">正在加载当前账号的模型配置…</div><div class="expert-model-actions"><button class="btn btn-ghost btn-sm" type="button" id="es-model-retry">重新加载模型</button><a class="btn btn-ghost btn-sm" href="#/settings?tab=model">前往模型设置</a></div></div>
    <div class="expert-profile-wide">${abilityField('es', icon, expert.tagline)}</div>
  </div><div class="expert-profile-error" id="es-error" role="alert"></div><div class="expert-profile-footer"><span class="dim">基本信息保存后生效。</span><button class="btn btn-primary" type="submit" id="es-submit">保存基本信息</button></div></form>`;
}

export function mountExpertSettings(host, expert, { api, ui, onSaved }) {
  const life = lifetime(host), find = name => host.querySelector('#es-' + name);
  const name = find('name'), role = find('role'), tagline = find('tagline'), submit = find('submit'), retry = find('model-retry'), note = find('model-status'), error = find('error');
  let pending = false, loading = true, generating = false, providers = [], modelTouched = false, loaded = false, ability;
  const chosen = () => providers.some(provider => provider.id === picker.getValue());
  const picker = mountSavedModelSelect(find('model-mount'), { id: 'es-model', describedBy: 'es-model-status', onChange: () => {
    modelTouched = true; note.textContent = picker.getValue() ? '使用当前账号已保存的模型配置。' : '请选择基础模型配置后保存。'; note.classList.remove('error'); refresh();
  } });
  const read = () => ({ name: name.value.trim(), role: role.value.trim(), tagline: tagline.value.trim(), modelProviderId: picker.getValue() });
  ability = mountExpertAbility({ root: host, prefix: 'es', api, read, live: life.live, canGenerate: () => !loading && !pending && chosen(), blocked: () => pending, onBusy: value => { generating = value; refresh(); } });
  life.cleanup(() => { ability.dispose(); picker.destroy(); });
  function refresh() {
    submit.disabled = pending || generating || modelTouched && (loading || !chosen());
    retry.disabled = loading || pending || generating; picker.setDisabled(pending || generating);
    [name, role, tagline].forEach(input => { input.disabled = pending; });
    submit.textContent = pending ? '正在保存…' : '保存基本信息'; ability?.refresh();
  }
  async function load() {
    if (!life.live() || pending || generating) return;
    const prior = loaded ? picker.getValue() : expert.modelProviderId;
    loading = true; picker.setLoading(true); note.textContent = '正在加载当前账号的模型配置…'; note.classList.remove('error'); refresh();
    try {
      const { data } = await api.fetchModelProviders({ signal: life.signal }); if (!life.live()) return;
      providers = data; picker.setProviders(providers); picker.setValue(providers.some(provider => provider.id === prior) ? prior : undefined); loaded = true;
      note.textContent = chosen() ? '使用当前账号已保存的模型配置。' : `现有模型：${expert.model || '未绑定'}。可保留现有模型保存其他信息；AI 补全需先选择当前账号的模型配置。`;
    } catch (failure) { if (life.live() && failure.name !== 'AbortError') { note.textContent = failure.message || '模型配置加载失败'; note.classList.add('error'); } }
    finally { if (life.live()) { loading = false; picker.setLoading(false); refresh(); } }
  }
  host.querySelector('[data-expert-form]').addEventListener('submit', async event => {
    event.preventDefault(); if (!life.live() || submit.disabled) return;
    if (!name.value.trim()) { error.textContent = '请填写专家名称'; name.focus(); return; }
    const payload = { revision: expert.revision, name: name.value.trim(), role: role.value.trim(), tagline: tagline.value.trim(), ...(modelTouched ? { modelProviderId: picker.getValue() } : {}) };
    pending = true; error.textContent = ''; refresh();
    try {
      const { data } = await api.updateAgent(expert.id, payload, { signal: life.signal });
      if (!life.live()) return;
      ui.toast('专家基本信息已保存'); await onSaved(data);
    } catch (failure) { if (life.live() && failure.name !== 'AbortError') error.textContent = failure.message || '保存失败，请重试'; }
    finally { pending = false; if (life.live()) refresh(); }
  });
  retry.addEventListener('click', load); void load(); return life.dispose;
}
