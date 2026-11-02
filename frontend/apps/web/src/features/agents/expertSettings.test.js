import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { expertSettingsForm, mountExpertSettings } from './expertSettings.js';
import { authSession } from '../../services/authSession.js';

vi.mock('../../shared/savedModelSelect.jsx', () => ({ mountSavedModelSelect: (container, { onChange, id }) => {
  const select = container.ownerDocument.createElement('select'); select.id = id; container.append(select);
  select.addEventListener('change', () => onChange(select.value));
  return { getValue: () => select.value, setValue: value => { select.value = value || ''; },
    setProviders: providers => { select.replaceChildren(); for (const provider of [{ id: '', model: '请选择' }, ...providers]) { const option = container.ownerDocument.createElement('option'); option.value = provider.id; option.textContent = provider.model; select.append(option); } },
    setDisabled: value => { select.disabled = value; }, setLoading: vi.fn(), destroy: vi.fn() };
} }));
vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: vi.fn(), subscribe: vi.fn() } }));
let dom, api, ui, expert, cleanup, listeners, version;
const find = name => document.querySelector('#es-' + name);
beforeEach(() => {
  dom = new JSDOM('<main></main>', { url: 'http://localhost/#/agent/a?tab=settings' });
  vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document); vi.stubGlobal('location', dom.window.location); vi.stubGlobal('MutationObserver', dom.window.MutationObserver);
  version = 1; listeners = new Set(); authSession.getSnapshot.mockImplementation(() => ({ version })); authSession.subscribe.mockImplementation(fn => { listeners.add(fn); return () => listeners.delete(fn); });
  expert = { id: 'a', revision: 5, name: '合同专家', role: '合同审查', tagline: '原稿', model: 'm', modelProviderId: 'mine' };
  api = { fetchModelProviders: vi.fn(async () => ({ data: [{ id: 'mine', model: 'm' }, { id: 'another', model: 'm' }] })),
    updateAgent: vi.fn(async (id, payload) => ({ data: { id, ...payload, revision: 6 } })),
    completeExpertAbility: vi.fn(async payload => ({ data: { tagline: '合同核对与风险提示', modelProviderId: payload.modelProviderId } })) };
  ui = { esc: String, toast: vi.fn() };
});
afterEach(() => { cleanup?.(); dom.window.close(); vi.unstubAllGlobals(); });
async function mount(onSaved = vi.fn()) {
  const host = document.querySelector('main'); host.innerHTML = expertSettingsForm(expert, ui, () => '');
  cleanup = mountExpertSettings(host, expert, { api, ui, onSaved });
  await vi.waitFor(() => expect(api.fetchModelProviders).toHaveBeenCalled()); await Promise.resolve(); return onSaved;
}
function select(value) { find('model').value = value; find('model').dispatchEvent(new dom.window.Event('change')); }
function submit() { document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); }
describe('expert basic settings', () => {
  it('prefills the owned model, saves all fields and selected provider ID using the displayed revision', async () => {
    const saved = await mount(); expect(find('model').value).toBe('mine'); find('name').value = '新专家'; select('another'); submit();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.updateAgent).toHaveBeenCalledWith('a', { revision: 5, name: '新专家', role: '合同审查', tagline: '原稿', modelProviderId: 'another' }, { signal: expect.any(AbortSignal) });
  });
  it('allows editing descriptions while preserving a model unavailable to the current account', async () => {
    expert.modelProviderId = 'foreign'; await mount(); expect(find('model').value).toBe(''); expect(find('ai').disabled).toBe(true);
    find('tagline').value = '人工修改'; submit(); await vi.waitFor(() => expect(api.updateAgent).toHaveBeenCalledOnce());
    expect(api.updateAgent.mock.calls[0][1]).not.toHaveProperty('modelProviderId'); expect(api.updateAgent.mock.calls[0][1].tagline).toBe('人工修改');
  });
  it('retains inputs and revision on conflict, and does not generate or save automatically', async () => {
    api.updateAgent.mockRejectedValue(new Error('配置已被其他操作修改，请重新加载后再保存'));
    const saved = await mount(); expect(api.completeExpertAbility).not.toHaveBeenCalled(); expect(api.updateAgent).not.toHaveBeenCalled();
    find('name').value = '未保存名称'; find('tagline').value = '未保存简介'; submit();
    await vi.waitFor(() => expect(find('error').textContent).toContain('其他操作修改'));
    expect(find('name').value).toBe('未保存名称'); expect(find('tagline').value).toBe('未保存简介'); expect(find('submit').disabled).toBe(false); expect(saved).not.toHaveBeenCalled();
    expect(api.updateAgent.mock.calls[0][1].revision).toBe(5);
  });
  it('completes with the form model and saves the generated draft only on explicit save', async () => {
    await mount(); select('another'); find('ai').click(); await vi.waitFor(() => expect(find('tagline').value).toBe('合同核对与风险提示'));
    expect(api.completeExpertAbility.mock.calls[0][0].modelProviderId).toBe('another'); expect(api.updateAgent).not.toHaveBeenCalled(); submit();
    await vi.waitFor(() => expect(api.updateAgent).toHaveBeenCalledOnce()); expect(api.updateAgent.mock.calls[0][1].tagline).toBe('合同核对与风险提示');
  });
  it('aborts completion on account changes and discards late content', async () => {
    let resolve; api.completeExpertAbility.mockImplementation(() => new Promise(done => { resolve = done; })); await mount(); find('ai').click();
    const signal = api.completeExpertAbility.mock.calls[0][1].signal; version++; [...listeners].forEach(fn => fn()); expect(signal.aborted).toBe(true);
    resolve({ data: { tagline: '旧账号结果', modelProviderId: 'mine' } }); await Promise.resolve(); await Promise.resolve(); expect(find('tagline').value).toBe('原稿');
  });
});
