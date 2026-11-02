import { mountModelSelect } from '../../shared/modelSelect.jsx';
import { MODEL_VENDORS, modelVendorLabel } from '../../shared/modelVendors.js';

const CATALOG_PATH = '/v1/models';
const SWITCHES = [
  ['retainAuditTrail', '保留任务审计轨迹'],
  ['autoArchiveArtifacts', '任务产物自动归档到项目'],
  ['autoMemoryBackflow', '自动建议专家经验（审核后生效）'],
];
const message = error => error.message || '请求失败，请重试';
const testMessage = data => data.modelFound ? '目录可访问，模型已匹配' : '目录可访问，所填模型未匹配';
function busy(button, value, label = '处理中…') {
  button.dataset.original ??= button.innerHTML;
  button.disabled = value;
  button.innerHTML = value ? label : button.dataset.original;
}

function openAddModel({ api, ui, icon, valid }, onSaved) {
  ui.modal('添加模型', `
    <div class="model-provider-form">
      <div class="model-provider-form-grid">
        <div class="field"><label for="mp-type">厂商</label><select id="mp-type">${Object.entries(MODEL_VENDORS).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></div>
        <div class="field"><label for="mp-url">URL</label><input id="mp-url" type="url" placeholder="请输入模型服务地址"></div>
      </div>
      <div class="field"><label for="mp-key">API Key</label><input id="mp-key" type="password" autocomplete="new-password" placeholder="输入 API Key 后获取模型目录"></div>
      <div class="field"><label for="mp-model">模型名</label><div class="model-input-row">
        <div id="mp-model-mount"></div>
        <button class="btn btn-ghost btn-sm" id="mp-load-models" type="button">${icon('refresh-cw', 13)}获取模型</button>
      </div><div class="model-provider-note" id="mp-status" role="status"></div></div>
      <div class="model-provider-note">API Key 加密存储且不回传。测试仅查询目录，不执行推理；可直接保存手动填写的模型。</div>
      <div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-ghost" id="mp-test" type="button">${icon('zap', 13)}测试连接</button>
        <button class="btn btn-primary" id="mp-save" type="button">${icon('plus', 13)}添加模型</button></div>
    </div>`, box => {
    box.classList.add('model-provider-modal');
    const field = name => box.querySelector('#mp-' + name);
    const type = field('type'), url = field('url'), key = field('key');
    let disposed = false, generation = 0, pending = false;
    const live = () => !disposed && valid();
    const status = (text, state = '') => { field('status').textContent = text; field('status').className = 'model-provider-note ' + state; };
    const hint = () => `按 ${CATALOG_PATH} 查询模型目录，支持自定义代理路径及手动填写模型名。`;
    const model = mountModelSelect(field('model-mount'), { onChange: () => { generation++; status(hint()); } });
    ui.setModalCleanup(() => { disposed = true; key.value = ''; model.destroy(); box.classList.remove('model-provider-modal'); });
    function changed() { generation++; model.setModels([]); status(hint()); }
    status(hint());
    type.addEventListener('change', changed);
    [url, key].forEach(input => input.addEventListener('input', changed));
    async function submit(kind) {
      if (pending || !live()) return;
      const value = { type: type.value, baseUrl: url.value.trim(), apiKey: key.value.trim(), model: model.getValue().trim() };
      if (!value.baseUrl || !value.apiKey || (kind !== 'load-models' && !value.model)) {
        status('请填写 URL、API Key' + (kind !== 'load-models' ? ' 和模型名' : '') + '。', 'error'); return;
      }
      pending = true;
      const stamp = generation;
      let showModels = false;
      const controls = [...box.querySelectorAll('input, select, button')].filter(control => !field('model-mount').contains(control));
      controls.forEach(control => { control.disabled = true; });
      model.setDisabled(true);
      busy(field(kind), true, kind === 'save' ? '添加中…' : '查询中…');
      status(kind === 'save' ? '正在保存模型配置…' : `正在查询 ${CATALOG_PATH}…`, 'loading');
      try {
        const result = await (kind === 'save' ? api.createModelProvider(value) : kind === 'test' ? api.testModelProvider(value) : api.discoverModels(value));
        if (!live() || generation !== stamp) return;
        if (kind === 'save') { key.value = ''; ui.closeModal(); ui.toast('模型已添加'); await onSaved(); }
        else if (kind === 'test') status(`${testMessage(result.data)} · ${result.data.latencyMs} ms。仅代表目录访问结果。`, result.data.modelFound ? 'success' : '');
        else {
          model.setModels(result.data.models);
          showModels = true;
          status(`已获取 ${result.data.models.length} 个模型 · ${result.data.latencyMs} ms，可选择或手动填写。`, 'success');
        }
      } catch (error) { if (live() && generation === stamp) status(message(error), 'error'); }
      finally {
        pending = false;
        if (live()) {
          controls.forEach(control => { control.disabled = false; });
          model.setDisabled(false);
          busy(field(kind), false);
          if (showModels) model.open();
        }
      }
    }
    ['load-models', 'test', 'save'].forEach(kind => field(kind).addEventListener('click', () => submit(kind)));
    key.addEventListener('change', () => { if (key.value.trim()) submit('load-models'); });
  });
}

/** Keep configuration drafts in this mounted page, never in localStorage or another account's cache. */
export async function renderModelSettings(el, { api, db, ui, icon, sessionVersion = () => 0 }) {
  const version = sessionVersion();
  const mount = {};
  el.modelSettingsMount = mount;
  const valid = () => el.isConnected && el.modelSettingsMount === mount && sessionVersion() === version;
  let draft, providers = [], settings, loadError = '', busyPage = false, dataReady = false;
  const captureDraft = () => {
    if (dataReady && el.querySelector('#st-model')) draft = {
      defaultProviderId: el.querySelector('#st-model').value || null,
      auditFallbackProviderId: el.querySelector('#st-fallback-model').value || null,
    };
  };
  function setBusy(value) {
    busyPage = value;
    el.querySelectorAll('[data-model-control]').forEach(button => { button.disabled = value || !dataReady; });
    const retry = el.querySelector('#retry-model-settings');
    if (retry) retry.disabled = value;
  }
  function showError(error) {
    loadError = message(error);
    const errorBox = el.querySelector('#model-settings-error');
    errorBox.hidden = false;
    errorBox.querySelector('[role=alert]').textContent = loadError;
    setBusy(busyPage);
  }
  async function reload() {
    captureDraft();
    setBusy(true);
    const results = await Promise.allSettled([api.fetchModelProviders(), api.fetchModelSettings()]);
    if (!valid()) return;
    loadError = results.filter(result => result.status === 'rejected').map(result => message(result.reason)).join('；');
    providers = results[0].status === 'fulfilled' ? results[0].value.data : [];
    settings = results[1].status === 'fulfilled' ? results[1].value.data : null;
    dataReady = results.every(result => result.status === 'fulfilled');
    if (!draft && settings) draft = { defaultProviderId: settings.defaultProviderId, auditFallbackProviderId: settings.auditFallbackProviderId };
    draw(results[0].status === 'fulfilled');
    setBusy(false);
  }
  function draw(listLoaded) {
    const options = selected => '<option value="">未选择</option>' + providers.map(provider =>
      `<option value="${ui.esc(provider.id)}"${provider.id === selected ? ' selected' : ''}>${ui.esc(provider.model + ' · ' + modelVendorLabel(provider.type) + ' / ' + provider.baseUrl)}</option>`).join('');
    el.innerHTML = `<div class="page settings-page">
      <div id="model-settings-error" class="model-provider-load-error" ${loadError ? '' : 'hidden'}><span role="alert">${ui.esc(loadError)}</span><button class="btn btn-ghost btn-sm" id="retry-model-settings">重新加载</button></div>
      <div class="card model-provider-card" style="margin-bottom:16px">
        <div class="tc-head model-provider-head"><div>
          <div class="tc-title">${icon('database', 15)}模型列表<span class="pill pill-dim">${listLoaded ? providers.length : '—'}</span></div>
          <div class="model-provider-sub">管理 mrtoken 和自定义模型服务。API Key 加密存储在服务端，不会回传页面。</div>
        </div><button class="btn btn-primary btn-sm" id="btn-add-model" data-model-control>${icon('plus', 13)}添加模型</button></div>
        <div class="model-provider-list">${providers.map(provider => {
          const state = provider.status === 'connected' ? [provider.lastModelFound ? 'pill-success' : 'pill-warning', provider.lastModelFound ? '目录已匹配' : '目录可访问，模型未匹配'] : provider.status === 'error' ? ['pill-danger', '目录查询失败'] : ['pill-dim', '未测试'];
          const time = provider.lastTestedAt ? new Date(provider.lastTestedAt).toLocaleString('zh-CN') : '尚未测试';
          return `<div class="model-provider-row" data-model-row="${ui.esc(provider.id)}">
            <span class="model-provider-icon">${icon('cpu', 16)}</span><div class="model-provider-main">
              <div class="model-provider-name">${ui.esc(provider.model)}<span class="pill ${state[0]}">${state[1]}</span></div>
              <div class="model-provider-meta"><span>${ui.esc(modelVendorLabel(provider.type))}</span><code>${ui.esc(provider.baseUrl)}</code><span>${provider.hasApiKey ? 'Key 已配置' : 'Key 未配置'}</span></div>
            </div><div class="model-provider-test-meta">${provider.lastLatencyMs == null ? '' : ui.esc(provider.lastLatencyMs) + ' ms · '}${ui.esc(time)}</div>
            <button class="btn btn-ghost btn-sm" data-test-model="${ui.esc(provider.id)}" data-model-control>${icon('zap', 12)}测试</button>
            <button class="btn-icon model-provider-delete" data-delete-model="${ui.esc(provider.id)}" data-model-control title="删除模型">${icon('trash-2', 13)}</button></div>`;
        }).join('') || (listLoaded ? `<div class="model-provider-empty">${icon('database', 24)}<div><strong>还没有自定义模型</strong><span>添加后可选择为默认或备用模型配置。</span></div></div>` : '<div class="model-provider-empty">模型列表加载失败，请重新加载。</div>')}</div>
      </div>
      <div class="grid grid-2"><div class="card card-pad">
        <div class="tc-title" style="margin-bottom:14px">${icon('cpu', 15)}默认模型</div>
        <div class="field"><label for="st-model">新任务默认模型</label><select id="st-model" data-model-control>${options(draft?.defaultProviderId)}</select></div>
        <div class="field"><label for="st-fallback-model">审计检索备用模型</label><select id="st-fallback-model" data-model-control>${options(draft?.auditFallbackProviderId)}</select></div>
        <div style="margin-top:14px"><button class="btn btn-primary btn-sm" id="btn-save-set" data-model-control>保存</button></div>
      </div><div class="card card-pad">
        <div class="tc-title" style="margin-bottom:14px">${icon('shield', 15)}审计与合规</div>
        ${SWITCHES.map(([field, label]) => `<div class="file-row"><div style="flex:1;font-size:13px">${label}</div><button class="cron-switch ${settings?.[field] ? 'on' : ''}" data-set="${field}" data-model-control role="switch" aria-label="${label}" aria-checked="${!!settings?.[field]}"></button></div>`).join('')}
        <div class="model-provider-note">记忆功能启用后，任务与项目按规则自动沉淀；专家经验只自动建议，审核后生效。自动归档仍为配置偏好。</div>
      </div></div></div>`;
    el.querySelector('#retry-model-settings').addEventListener('click', reload);
    el.querySelector('#btn-add-model').addEventListener('click', () => {
      captureDraft(); openAddModel({ api, ui, icon, valid }, reload);
    });
    el.querySelectorAll('select').forEach(select => select.addEventListener('change', captureDraft));
    el.querySelector('#btn-save-set').addEventListener('click', async () => {
      if (busyPage || !dataReady) return;
      captureDraft(); setBusy(true);
      try { const result = await api.saveModelSettings(draft); if (valid()) { settings = result.data; ui.toast('默认模型已保存'); } }
      catch (error) { if (valid()) showError(error); }
      finally { if (valid()) setBusy(false); }
    });
    el.querySelectorAll('[data-set]').forEach(button => button.addEventListener('click', async () => {
      if (busyPage || !dataReady) return;
      const field = button.dataset.set, previous = !!settings[field];
      button.classList.toggle('on', !previous); button.setAttribute('aria-checked', String(!previous)); setBusy(true);
      try { const result = await api.saveModelSettings({ [field]: !previous }); if (valid()) { settings = result.data; ui.toast('配置偏好已保存'); } }
      catch (error) {
        if (valid()) { button.classList.toggle('on', previous); button.setAttribute('aria-checked', String(previous)); showError(error); }
      } finally { if (valid()) setBusy(false); }
    }));
    el.querySelectorAll('[data-test-model]').forEach(button => button.addEventListener('click', async () => {
      if (busyPage) return;
      setBusy(true);
      try { const result = await api.testSavedModelProvider(button.dataset.testModel); if (valid()) ui.toast(testMessage(result.data)); }
      catch (error) { if (valid()) ui.toast(message(error), 'err'); }
      finally { if (valid()) await reload(); }
    }));
    el.querySelectorAll('[data-delete-model]').forEach(button => button.addEventListener('click', () => {
      const provider = providers.find(item => item.id === button.dataset.deleteModel);
      captureDraft();
      ui.modal('删除模型', `<div class="model-provider-delete-copy">确定删除「${ui.esc(provider.model)}」吗？如果它已被设为默认或备用模型，相应选择会一并清空；引用此配置的专家也会解除模型关联，保留原模型名称。</div><div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-primary" id="mp-confirm-delete" style="background:var(--danger)">删除</button></div>`, modal => {
        modal.querySelector('#mp-confirm-delete').addEventListener('click', async event => {
          const confirm = event.currentTarget;
          if (confirm.disabled || !valid()) return;
          busy(confirm, true, '删除中…'); setBusy(true);
          try {
            await api.deleteModelProvider(provider.id);
            if (!valid()) return;
            for (const field of ['defaultProviderId', 'auditFallbackProviderId']) if (draft[field] === provider.id) draft[field] = null;
            // Keep the draft selection consistent before reload captures it again.
            for (const select of el.querySelectorAll('select')) if (select.value === provider.id) select.value = '';
            ui.closeModal(); ui.toast('模型已删除'); await reload();
          } catch (error) { if (valid()) { ui.toast(message(error), 'err'); showError(error); } }
          finally { if (valid()) { busy(confirm, false); setBusy(false); } }
        });
      });
    }));
  }
  el.innerHTML = '<div class="page settings-page"><div class="card empty" role="status">正在加载模型配置…</div></div>';
  await reload();
}
