import { createUuid } from '../../lib/uuid.js';
import { lifetime, esc } from '../knowledge/lifecycle.js';
import './memorySettings.css';

export async function renderMemorySettings(el, api = API) {
  el.innerHTML = '<div class="page settings-page"><section class="card memory-settings"><h2>记忆设置</h2><div data-memory-settings-body aria-live="polite">正在加载配置…</div></section></div>';
  const host = el.querySelector('.memory-settings'), life = lifetime(host), body = host.querySelector('[data-memory-settings-body]');
  let pending = false, attemptKey;
  life.cleanup(() => {
    const password = host.querySelector('[name="apiKey"]'); if (password) password.value = '';
    attemptKey = undefined;
    // Drop old-account service metadata as soon as the session/route is disposed.
    body.replaceChildren();
  });
  async function load() {
    if (pending || !life.live()) return;
    pending = true; attemptKey = undefined;
    body.textContent = '正在加载配置…';
    try {
      const response = await api.fetchMemorySettings(life.signal);
      if (life.live()) paint(response.data);
    } catch (error) {
      if (life.live()) {
        body.innerHTML = `<div class="memory-settings-error" role="alert">${esc(error.message || '配置加载失败')}</div><button class="btn btn-ghost" data-reload>重新加载</button>`;
        body.querySelector('[data-reload]').onclick = load;
      }
    } finally { pending = false; }
  }
  function paint(config) {
    if (!config.canEdit) {
      body.innerHTML = `<p>全系统记忆：<strong>${config.enabled ? '已启用' : '未启用'}</strong></p>
        <p class="dim">仅指定管理员可以配置记忆服务。你仍可在“我的记忆”和各业务页面维护有权限的记忆。</p>
        <p class="dim">当前账号 ID：<code>${esc(config.actorId)}</code></p>
        <a class="btn btn-ghost" href="#/settings?tab=memory">我的记忆</a>`;
      return;
    }
    body.innerHTML = `<p class="dim">配置作用于所有账号的五类记忆，各账号内容仍独立隔离。保存后供后续请求使用，本轮已保存的记忆快照保持不变。</p>
      <div class="memory-settings-status">${config.configured ? '正在使用页面保存的配置' : '尚未保存页面配置，当前使用部署默认值'}${config.updatedAt ? ` · 更新于 ${esc(new Date(config.updatedAt).toLocaleString())}` : ''}</div>
      <form autocomplete="off">
        <fieldset>
          <label class="memory-settings-toggle"><input type="checkbox" name="enabled" ${config.enabled ? 'checked' : ''}>启用全系统记忆</label>
          <p class="dim">关闭后暂停自动召回和同步，普通任务继续执行；已保存内容保留。</p>
          <div class="memory-settings-grid">
            <label class="field">服务地址<input name="baseUrl" type="url" required maxlength="2048" value="${esc(config.baseUrl)}" ${config.originLocked ? 'readonly' : ''} placeholder="http://192.168.77.152:8888">
              <span class="dim">${config.originLocked ? '已有记忆数据，地址已固定；更换服务需要先迁移原有记忆。' : '填写 Hindsight API 根地址，例如 http://192.168.77.152:8888。'}</span></label>
            <label class="field">访问密钥（可选）<input name="apiKey" type="password" autocomplete="new-password" maxlength="8192" placeholder="${config.hasApiKey ? '已保存，留空保留' : '当前无访问认证可留空'}">
              <span class="dim">使用连接 Hindsight 的访问密钥；不要填写它调用模型的密钥。</span></label>
            <label class="field">自动召回总超时（毫秒）<input name="recallTimeoutMs" type="number" min="500" max="10000" step="1" required value="${config.recallTimeoutMs}"><span class="dim">默认 3000，范围 500–10000。</span></label>
            <label class="field">同步请求超时（毫秒）<input name="requestTimeoutMs" type="number" min="1000" max="30000" step="1" required value="${config.requestTimeoutMs}"><span class="dim">默认 15000，范围 1000–30000。</span></label>
            <label class="field">召回内容预算（tokens）<input name="recallMaxTokens" type="number" min="100" max="6000" step="1" required value="${config.recallMaxTokens}"><span class="dim">默认 3000，范围 100–6000。</span></label>
          </div>
          <label class="memory-settings-toggle"><input type="checkbox" name="clearApiKey" ${config.hasApiKey ? '' : 'disabled'}>清除已保存的访问密钥</label>
          <div class="memory-settings-actions"><button type="button" class="btn btn-ghost" data-test>测试连接</button><button type="submit" class="btn btn-primary">保存配置</button><button type="button" class="btn btn-ghost" data-reload>重新加载（放弃修改）</button></div>
        </fieldset>
        <div data-result role="status" aria-live="polite"></div>
        <div class="memory-settings-error" data-error role="alert"></div>
      </form>`;
    const form = body.querySelector('form'), fieldset = form.querySelector('fieldset');
    const field = name => form.elements.namedItem(name);
    const note = form.querySelector('[data-result]'), errorBox = form.querySelector('[data-error]');
    const dirty = () => { attemptKey = undefined; note.textContent = ''; errorBox.textContent = ''; };
    form.addEventListener('input', dirty); form.addEventListener('change', dirty);
    const clear = field('clearApiKey'), password = field('apiKey');
    clear.addEventListener('change', () => { password.disabled = clear.checked; if (clear.checked) password.value = ''; });
    function draft() {
      return { revision: config.revision, enabled: field('enabled').checked, baseUrl: field('baseUrl').value.trim(),
        apiKey: password.value, clearApiKey: clear.checked, recallTimeoutMs: Number(field('recallTimeoutMs').value),
        requestTimeoutMs: Number(field('requestTimeoutMs').value), recallMaxTokens: Number(field('recallMaxTokens').value) };
    }
    async function action(save) {
      if (pending || !life.live() || !form.reportValidity()) return;
      pending = true; fieldset.disabled = true; errorBox.textContent = ''; note.textContent = save ? '正在保存…' : '正在测试健康接口…';
      try {
        if (save) {
          attemptKey ||= createUuid();
          const response = await api.saveMemorySettings(draft(), attemptKey, life.signal);
          if (!life.live()) return;
          password.value = ''; attemptKey = undefined; paint(response.data);
          const status = body.querySelector('[data-result]');
          if (status) status.textContent = '配置已保存，后续请求使用新配置。';
        } else {
          const response = await api.testMemorySettings(draft(), life.signal);
          if (life.live()) note.textContent = `${response.data.message}（${response.data.latencyMs} 毫秒）。配置尚未保存。`;
        }
      } catch (error) {
        if (life.live()) { note.textContent = ''; errorBox.textContent = error.message || '操作失败，请重试'; }
      } finally { pending = false; if (life.live()) fieldset.disabled = false; }
    }
    form.onsubmit = event => { event.preventDefault(); action(true); };
    form.querySelector('[data-test]').onclick = () => action(false);
    form.querySelector('[data-reload]').onclick = load;
  }
  await load();
}
