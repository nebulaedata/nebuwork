import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openCreateExpertModal } from './createExpertModal.js';
import { mountSavedModelSelect } from '../../shared/savedModelSelect.jsx';

vi.mock('../../shared/savedModelSelect.jsx', () => ({
  mountSavedModelSelect: vi.fn((container, { onChange }) => {
    const select = container.ownerDocument.createElement('select'); select.id = 'na-model'; container.appendChild(select);
    select.addEventListener('change', () => onChange(select.value));
    return {
      getValue: () => select.value,
      setProviders: vi.fn(providers => {
        select.replaceChildren();
        for (const provider of [{ id: '', model: '请选择' }, ...providers]) {
          const option = container.ownerDocument.createElement('option'); option.value = provider.id; option.textContent = provider.model;
          select.appendChild(option);
        }
      }),
      setLoading: vi.fn(), setDisabled: vi.fn(), destroy: vi.fn(),
    };
  }),
}));
vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: () => ({ version: 1 }) } }));

let dom, api, ui, providers, version, cleanup;
beforeEach(() => {
  vi.clearAllMocks();
  dom = new JSDOM('<div id="modal"></div>', { url: 'http://localhost/#/agents' });
  vi.stubGlobal('document', dom.window.document); vi.stubGlobal('location', dom.window.location);
  version = 1; cleanup = undefined;
  providers = [
    { id: 'mine-1', model: 'same-name', type: 'openai', baseUrl: 'https://one.example' },
    { id: 'mine-2', model: 'same-name', type: 'gemini', baseUrl: 'https://two.example' },
  ];
  api = {
    fetchModelProviders: vi.fn(async () => ({ data: providers })),
    createAgent: vi.fn(async payload => ({ data: { id: 'expert-1', ...payload } })),
    completeExpertAbility: vi.fn(async payload => ({ data: { tagline: '可协助合同核对和风险说明。', modelProviderId: payload.modelProviderId } })),
  };
  ui = {
    openModal: html => { cleanup?.(); document.querySelector('#modal').innerHTML = html; },
    setModalCleanup: fn => { cleanup = fn; }, toast: vi.fn(),
    closeModal: vi.fn(() => { cleanup?.(); document.querySelector('#modal').innerHTML = ''; }),
  };
});
afterEach(() => { cleanup?.(); dom.window.close(); vi.unstubAllGlobals(); });
const field = name => document.getElementById('na-' + name);
const open = () => openCreateExpertModal({ api, ui, icon: () => '', sessionVersion: () => version });
async function ready() {
  open();
  await vi.waitFor(() => expect(mountSavedModelSelect.mock.results.at(-1).value.setProviders).toHaveBeenCalledWith(providers));
}
function select(id) { field('model').value = id; field('model').dispatchEvent(new dom.window.Event('change')); }

describe('expert creation with saved model configurations', () => {
  it('completes with the selected saved model, supports undo and creates only on explicit submit', async () => {
    await ready(); field('name').value = '合同专家'; field('role').value = '合同审查'; field('tagline').value = '原稿'; select('mine-1');
    field('ai').click(); await vi.waitFor(() => expect(field('tagline').value).toBe('可协助合同核对和风险说明。'));
    expect(api.completeExpertAbility).toHaveBeenCalledWith({ name: '合同专家', role: '合同审查', tagline: '原稿', modelProviderId: 'mine-1' }, { signal: expect.any(AbortSignal) });
    expect(api.createAgent).not.toHaveBeenCalled(); field('ai-undo').click(); expect(field('tagline').value).toBe('原稿');
  });
  it('preserves human edits made during generation and requires applying the suggestion', async () => {
    let resolve; api.completeExpertAbility.mockImplementation(() => new Promise(done => { resolve = done; }));
    await ready(); field('name').value = '合同专家'; select('mine-1'); field('ai').click();
    field('tagline').value = '人工新稿'; field('tagline').dispatchEvent(new dom.window.Event('input'));
    resolve({ data: { tagline: 'AI 建议', modelProviderId: 'mine-1' } });
    await vi.waitFor(() => expect(field('ai-suggestion').hidden).toBe(false));
    expect(field('tagline').value).toBe('人工新稿'); field('ai-apply').click(); expect(field('tagline').value).toBe('AI 建议');
    field('ai-undo').click(); expect(field('tagline').value).toBe('人工新稿');
  });
  it('keeps the original description on failure and aborts completion when the modal closes', async () => {
    api.completeExpertAbility.mockRejectedValueOnce(new Error('模型服务拒绝凭据或权限'));
    await ready(); field('name').value = '专家'; field('tagline').value = '原稿'; select('mine-1'); field('ai').click();
    await vi.waitFor(() => expect(field('ai-status').textContent).toContain('拒绝凭据'));
    expect(field('tagline').value).toBe('原稿');
    let resolve; api.completeExpertAbility.mockImplementation(() => new Promise(done => { resolve = done; })); field('ai').click();
    const signal = api.completeExpertAbility.mock.calls.at(-1)[1].signal; ui.closeModal(); expect(signal.aborted).toBe(true);
    resolve({ data: { tagline: '迟到结果', modelProviderId: 'mine-1' } }); await Promise.resolve(); await Promise.resolve();
    expect(document.querySelector('#na-tagline')).toBeNull(); expect(api.createAgent).not.toHaveBeenCalled();
  });
  it('loads saved configurations on every open and submits the selected ID instead of a name', async () => {
    await ready();
    expect(field('submit').disabled).toBe(true);
    expect(document.body.textContent).not.toContain('DeepSeek-V3.2');
    field('name').value = ' 专家 '; select('mine-2'); field('submit').click();
    await vi.waitFor(() => expect(ui.closeModal).toHaveBeenCalledOnce());
    expect(api.createAgent).toHaveBeenCalledWith({ name: '专家', role: '', tagline: '', modelProviderId: 'mine-2' });
    expect(location.hash).toBe('#/agent/expert-1');
    expect(mountSavedModelSelect.mock.results[0].value.destroy).toHaveBeenCalledOnce();
    await ready(); expect(api.fetchModelProviders).toHaveBeenCalledTimes(2);
  });
  it('blocks creation for an empty list and links to model settings', async () => {
    providers = []; await ready();
    expect(field('submit').disabled).toBe(true);
    expect(field('model-status').textContent).toContain('尚未添加模型');
    field('model-settings').click();
    expect(location.hash).toBe('#/settings?tab=model');
    expect(api.createAgent).not.toHaveBeenCalled();
  });
  it('keeps entered fields when loading fails and supports a real retry', async () => {
    api.fetchModelProviders.mockRejectedValueOnce(new Error('服务不可用'));
    open(); field('name').value = '保留输入';
    await vi.waitFor(() => expect(field('model-retry').hidden).toBe(false));
    expect(field('model-status').textContent).toBe('服务不可用');
    expect(field('submit').disabled).toBe(true);
    field('model-retry').click();
    await vi.waitFor(() => expect(mountSavedModelSelect.mock.results[0].value.setProviders).toHaveBeenLastCalledWith(providers));
    expect(field('name').value).toBe('保留输入');
  });
  it('keeps the selected ID and form open when creation fails', async () => {
    api.createAgent.mockRejectedValue(new Error('模型配置不存在'));
    await ready(); field('name').value = '尚未保存'; select('mine-1'); field('submit').click();
    await vi.waitFor(() => expect(ui.toast).toHaveBeenCalledWith('模型配置不存在', 'err'));
    expect(field('name').value).toBe('尚未保存'); expect(field('model').value).toBe('mine-1');
    expect(field('submit').disabled).toBe(false); expect(ui.closeModal).not.toHaveBeenCalled();
  });
  it('ignores a late model list after an account change', async () => {
    let resolve; api.fetchModelProviders.mockImplementation(() => new Promise(done => { resolve = done; }));
    open(); version++; resolve({ data: providers });
    await Promise.resolve(); await Promise.resolve();
    expect(mountSavedModelSelect.mock.results[0].value.setProviders).not.toHaveBeenCalled();
    expect(field('submit').disabled).toBe(true);
  });
  it('ignores a creation response after the modal closes', async () => {
    let resolve; api.createAgent.mockImplementation(() => new Promise(done => { resolve = done; }));
    await ready(); field('name').value = '专家'; select('mine-1'); field('submit').click();
    ui.closeModal(); resolve({ data: { id: 'old' } });
    await Promise.resolve(); await Promise.resolve();
    expect(ui.toast).not.toHaveBeenCalled(); expect(location.hash).toBe('#/agents');
  });
});
