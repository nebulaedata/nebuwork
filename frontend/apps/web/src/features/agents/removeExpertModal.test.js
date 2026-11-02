import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openRemoveExpertModal } from './removeExpertModal.js';

vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: () => ({ version: 1 }) } }));
let dom, api, ui, version, cleanup, onRemoved;
const expert = { id: 'expert', name: '<测试专家>', revision: 7, membershipRevision: 2 };
beforeEach(() => {
  dom = new JSDOM('<div id="modal"></div>', { url: 'http://localhost/#/plaza?tab=agent' });
  vi.stubGlobal('document', dom.window.document); vi.stubGlobal('location', dom.window.location);
  version = 1; cleanup = undefined; onRemoved = vi.fn();
  api = { removeExpert: vi.fn(async () => ({ data: { removed: true } })) };
  ui = { esc: value => value.replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    openModal: html => { cleanup?.(); document.querySelector('#modal').innerHTML = html; },
    setModalCleanup: fn => { cleanup = fn; }, toast: vi.fn(),
    closeModal: vi.fn(() => { cleanup?.(); document.querySelector('#modal').innerHTML = ''; }) };
});
afterEach(() => { cleanup?.(); dom.window.close(); vi.unstubAllGlobals(); });
const submit = () => document.querySelector('#remove-expert-submit');
const open = (mode = 'remove') => openRemoveExpertModal({ expert, api, ui, icon: () => '', onRemoved, mode, sessionVersion: () => version });

describe('remove expert confirmation', () => {
  it('explains retention, escapes names and does not remove before confirmation', () => {
    open(); expect(document.body.textContent).toContain('<测试专家>'); expect(document.body.textContent).toContain('重新添加时恢复');
    expect(document.querySelector('测试专家')).toBeNull(); expect(api.removeExpert).not.toHaveBeenCalled();
    document.querySelector('[data-remove-cancel]').click(); expect(ui.closeModal).toHaveBeenCalledOnce();
    expect(api.removeExpert).not.toHaveBeenCalled();
  });
  it('explains account deletion without promising market restoration, and permits cancellation', () => {
    open('delete');
    expect(document.querySelector('.modal-title').textContent).toBe('删除专家');
    expect(submit().textContent).toBe('确认删除');
    expect(document.body.textContent).toContain('此操作不提供恢复入口');
    expect(document.body.textContent).not.toContain('市场重新添加');
    expect(api.removeExpert).not.toHaveBeenCalled();
    document.querySelector('[data-remove-cancel]').click();
    expect(ui.closeModal).toHaveBeenCalledOnce(); expect(api.removeExpert).not.toHaveBeenCalled();
  });
  it('disables deletion when the required revision is missing', () => {
    openRemoveExpertModal({ expert: { ...expert, membershipRevision: undefined }, api, ui, icon: () => '', mode: 'delete' });
    expect(submit().disabled).toBe(true);
    expect(document.querySelector('[role="alert"]').textContent).toContain('请刷新页面后重试');
    submit().click(); expect(api.removeExpert).not.toHaveBeenCalled();
  });
  it.each(['remove', 'delete'])('suppresses repeated clicks for %s and refreshes only after persistence', async mode => {
    let resolve; api.removeExpert.mockImplementation(() => new Promise(done => { resolve = done; }));
    open(mode); submit().click(); submit().click();
    expect(api.removeExpert).toHaveBeenCalledExactlyOnceWith('expert', 7, 2);
    expect(submit().disabled).toBe(true); expect(onRemoved).not.toHaveBeenCalled();
    resolve({ data: { removed: true } });
    await vi.waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
    expect(ui.closeModal).toHaveBeenCalledOnce(); expect(ui.toast).toHaveBeenCalledWith(expect.stringContaining(mode === 'delete' ? '专家已从当前账号删除' : '已从我的专家移除'));
  });
  it.each(['remove', 'delete'])('keeps the %s dialog and displays reference errors without pretending success', async mode => {
    api.removeExpert.mockRejectedValueOnce(new Error('请先在工作台解除该专家引用：合同审查'));
    open(mode); submit().click();
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]').textContent).toContain('合同审查'));
    expect(submit().disabled).toBe(false); expect(onRemoved).not.toHaveBeenCalled(); expect(ui.closeModal).not.toHaveBeenCalled();
    expect(submit().textContent).toBe(mode === 'delete' ? '重试删除' : '重试移除');
    submit().click(); await vi.waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
  });
  it.each(['account', 'route', 'close'].flatMap(kind => ['remove', 'delete'].map(mode => ({ kind, mode }))))('ignores late $mode success after a $kind change', async ({ kind, mode }) => {
    let resolve; api.removeExpert.mockImplementation(() => new Promise(done => { resolve = done; }));
    open(mode); submit().click();
    if (kind === 'account') version++;
    else if (kind === 'route') location.hash = '#/agents';
    else ui.closeModal();
    resolve({ data: { removed: true } }); await Promise.resolve(); await Promise.resolve();
    expect(ui.toast).not.toHaveBeenCalled(); expect(onRemoved).not.toHaveBeenCalled();
  });
});
