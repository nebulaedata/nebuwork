import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderModelSettings } from './modelSettings.js';
import { mountModelSelect } from '../../shared/modelSelect.jsx';

// Page/API tests isolate the framework mount; the real picker is rendered by Ant Design.
vi.mock('../../shared/modelSelect.jsx', () => ({
  mountModelSelect: vi.fn((container, { onChange }) => {
    const input = container.ownerDocument.createElement('input'); input.id = 'mp-model'; container.appendChild(input);
    input.addEventListener('input', () => onChange(input.value));
    return {
      getValue: () => input.value,
      setModels: vi.fn(),
      setDisabled: disabled => { input.disabled = disabled; },
      open: vi.fn(),
      destroy: vi.fn(() => container.replaceChildren()),
    };
  }),
}));

let dom, el, api, ui, settings, providers, version, cleanup;
beforeEach(() => {
  vi.clearAllMocks();
  dom = new JSDOM('<main></main><div id="modal"></div>');
  el = dom.window.document.querySelector('main'); version = 1; cleanup = undefined;
  settings = { revision: 0, defaultProviderId: null, auditFallbackProviderId: null, retainAuditTrail: true, autoArchiveArtifacts: true, autoMemoryBackflow: true };
  providers = [{ id: 'p1', type: 'mrtoken', model: 'same-name', baseUrl: 'https://one.example', status: 'untested', hasApiKey: true }, { id: 'p2', type: 'custom', model: 'same-name', baseUrl: 'https://two.example', status: 'untested', hasApiKey: true }];
  api = {
    fetchModelProviders: vi.fn(async () => ({ data: providers })), fetchModelSettings: vi.fn(async () => ({ data: settings })),
    saveModelSettings: vi.fn(async patch => ({ data: settings = { ...settings, ...patch, revision: settings.revision + 1 } })),
    createModelProvider: vi.fn(), testModelProvider: vi.fn(), discoverModels: vi.fn(), deleteModelProvider: vi.fn(),
  };
  ui = {
    esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    toast: vi.fn(), setModalCleanup: fn => { cleanup = fn; },
    closeModal: vi.fn(() => { cleanup?.(); dom.window.document.querySelector('#modal').innerHTML = ''; }),
    modal: (_title, html, mount) => { const box = dom.window.document.querySelector('#modal'); box.innerHTML = html; mount(box); },
  };
});
afterEach(() => { dom.window.close(); });
const render = () => renderModelSettings(el, { api, db: {}, ui, icon: () => '', sessionVersion: () => version });

describe('model settings page', () => {
  it('shows only saved configurations and submits IDs, with unselected defaults', async () => {
    await render();
    const select = el.querySelector('#st-model');
    expect(select.value).toBe(''); expect(select.options).toHaveLength(3);
    expect(select.options[1].textContent).toContain('https://one.example');
    expect(select.options[1].textContent).toContain('mrtoken');
    expect(select.options[2].textContent).toContain('自定义');
    select.value = 'p2'; el.querySelector('#btn-save-set').click();
    await vi.waitFor(() => expect(api.saveModelSettings).toHaveBeenCalledWith({ defaultProviderId: 'p2', auditFallbackProviderId: null }));
  });
  it('keeps failed default selections and restores switches on a failed write', async () => {
    api.saveModelSettings.mockRejectedValue(Object.assign(new Error('配置版本冲突'), { status: 409 }));
    await render();
    el.querySelector('#st-model').value = 'p2'; el.querySelector('#btn-save-set').click();
    await vi.waitFor(() => expect(el.textContent).toContain('配置版本冲突'));
    expect(el.querySelector('#st-model').value).toBe('p2'); expect(ui.toast).not.toHaveBeenCalled();
    expect(el.querySelector('#btn-save-set').disabled).toBe(false);
    el.querySelector('#retry-model-settings').click();
    await vi.waitFor(() => expect(el.querySelector('#btn-save-set').disabled).toBe(false));
    const toggle = el.querySelector('[data-set="retainAuditTrail"]'); toggle.click();
    await vi.waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    expect(toggle.classList.contains('on')).toBe(true);
    expect(el.querySelector('#st-model').value).toBe('p2');
  });
  it('renders load errors with retry without claiming an empty model list', async () => {
    api.fetchModelProviders.mockRejectedValue(new Error('网关不可用'));
    await render();
    expect(el.textContent).toContain('网关不可用');
    expect(el.textContent).not.toContain('还没有自定义模型');
    expect(el.querySelector('#btn-save-set').disabled).toBe(true);
  });
  it.each(['mrtoken', 'custom'])('submits vendor %s and preserves inputs on creation failure', async vendor => {
    api.createModelProvider.mockRejectedValue(new Error('相同模型已存在'));
    await render(); el.querySelector('#btn-add-model').click();
    const box = dom.window.document.querySelector('#modal');
    expect(box.querySelector('label[for="mp-type"]').textContent).toBe('厂商');
    expect([...box.querySelector('#mp-type').options].map(option => [option.value, option.textContent])).toEqual([['mrtoken', 'mrtoken'], ['custom', '自定义']]);
    expect(box.querySelector('#mp-url').value).toBe('');
    box.querySelector('#mp-url').value = 'https://models.example/proxy';
    box.querySelector('#mp-type').value = vendor; box.querySelector('#mp-type').dispatchEvent(new dom.window.Event('change'));
    expect(box.querySelector('#mp-url').value).toBe('https://models.example/proxy');
    expect(box.textContent).toContain('/v1/models');
    box.querySelector('#mp-key').value = 'private-key'; box.querySelector('#mp-model').value = 'custom-model';
    box.querySelector('#mp-save').click();
    await vi.waitFor(() => expect(box.textContent).toContain('相同模型已存在'));
    expect(api.createModelProvider).toHaveBeenCalledWith({ type: vendor, baseUrl: 'https://models.example/proxy', apiKey: 'private-key', model: 'custom-model' });
    expect(box.querySelector('#mp-key').value).toBe('private-key');
    expect(box.querySelector('#mp-model').value).toBe('custom-model');
    expect(box.querySelector('#mp-save').disabled).toBe(false); expect(ui.closeModal).not.toHaveBeenCalled();
  });
  it('keeps the fetched catalog when selecting a model and submits that model', async () => {
    api.discoverModels.mockResolvedValue({ data: { models: ['model-a', 'model-b'], latencyMs: 10 } });
    api.createModelProvider.mockRejectedValue(new Error('保存失败'));
    await render(); el.querySelector('#btn-add-model').click();
    const box = dom.window.document.querySelector('#modal');
    const picker = mountModelSelect.mock.results[0].value;
    box.querySelector('#mp-url').value = 'https://models.example';
    box.querySelector('#mp-key').value = 'private-key';
    box.querySelector('#mp-load-models').click();
    await vi.waitFor(() => expect(picker.open).toHaveBeenCalledOnce());
    expect(api.discoverModels).toHaveBeenCalledWith(expect.objectContaining({ type: 'mrtoken', baseUrl: 'https://models.example' }));
    expect(picker.setModels).toHaveBeenLastCalledWith(['model-a', 'model-b']);
    const updateCount = picker.setModels.mock.calls.length;
    box.querySelector('#mp-model').value = 'model-b';
    box.querySelector('#mp-model').dispatchEvent(new dom.window.Event('input'));
    expect(picker.setModels).toHaveBeenCalledTimes(updateCount);
    box.querySelector('#mp-save').click();
    await vi.waitFor(() => expect(api.createModelProvider).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-b' })));
    await vi.waitFor(() => expect(box.querySelector('#mp-save').disabled).toBe(false));
    expect(box.querySelector('#mp-model').value).toBe('model-b');
    ui.closeModal(); expect(picker.destroy).toHaveBeenCalledOnce();
  });
  it('does not render a response after the authenticated account changes', async () => {
    let resolve;
    api.fetchModelProviders.mockImplementation(() => new Promise(done => { resolve = done; }));
    const pending = render(); version++;
    resolve({ data: providers }); await pending;
    expect(el.querySelector('#st-model')).toBeNull(); expect(el.textContent).not.toContain('same-name');
  });
});
