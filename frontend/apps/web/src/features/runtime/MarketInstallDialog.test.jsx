// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarketInstallDialog } from './MarketInstallDialog.jsx';

const auth = vi.hoisted(() => ({ version: 1, listeners: new Set() }));
vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: () => ({ version: auth.version }), subscribe: fn => { auth.listeners.add(fn); return () => auth.listeners.delete(fn); } } }));
vi.mock('antd', () => ({
  Modal: ({ children, title, onCancel, closable }) => <section role="dialog" aria-label={title}>{closable && <button aria-label="关闭弹框" onClick={onCancel}>×</button>}{children}</section>,
  Input: ({ prefix, ...props }) => <input {...props}/>,
  Select: ({ options, onChange, value, ...props }) => <select {...props} value={value ?? ''} onChange={event => onChange(event.target.value)}>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>,
}));
const entry = { id: 'extension', name: 'Document Skill', description: 'Format documents', kind: 'skill', listed: true, versionId: 'v2', version: 2,
  versions: [{ id: 'v2', version: 2, notes: 'Latest release', payload: { files: [{ path: 'SKILL.md' }] } }, { id: 'v1', version: 1, notes: 'Earlier release', payload: { files: [{ path: 'SKILL.md' }] } }] };
const runtime = revision => ({ revision, document: { modelProviderId: 'personal-model', instructions: [{ content: 'Keep instructions' }], files: [], skills: [], mcp: [], extensionRefs: [] }, extensions: { enabled: true, items: [] }, published: null });
const receipt = (kind = 'project', state = 'succeeded') => ({ id: 'original-operation', extensionId: entry.id, versionId: 'v2', extensionName: entry.name, targetKind: kind, targetId: 'current', state, copiedFiles: state === 'succeeded' ? 1 : 0, result: state === 'succeeded' ? { installationId: 'installed', runtimeRevision: 4 } : null });
const installed = revision => ({ ...runtime(revision), document: { ...runtime(revision).document, extensionRefs: [{ installationId: 'installed', required: false }] }, extensions: { enabled: true, items: [{ installationId: 'installed', extensionId: entry.id, kind: 'skill', versionId: 'v2', version: 2 }] } });
let root, host, save, reload, sessions, close;
function Harness({ kind = 'project', initial = runtime(3), dirty = false, session, initialExtensionId }) {
  const [saved, setSaved] = useState(initial), [unsaved, setUnsaved] = useState(dirty);
  return <MarketInstallDialog kind={kind} id="current" saved={saved} references={saved.document.extensionRefs} dirty={unsaved} initialExtensionId={initialExtensionId} session={session} onSessionChange={value => sessions.push(value)} onClose={close}
    onSave={async publish => { const data = await save(publish); if (data) { setSaved(data); setUnsaved(false); } return data; }}
    onReload={async signal => { const data = await reload(signal); setSaved(data); setUnsaved(false); return data; }}/>;
}
beforeEach(() => {
  vi.useFakeTimers(); globalThis.IS_REACT_ACT_ENVIRONMENT = true; auth.version = 1; auth.listeners.clear();
  history.replaceState(null, '', '#/project/current?tab=runtime'); host = document.createElement('div'); document.body.append(host); root = createRoot(host); sessions = []; close = vi.fn();
  save = vi.fn(async publish => publish ? { ...installed(5), published: { revision: 5 } } : runtime(4)); reload = vi.fn(async () => installed(4));
  vi.stubGlobal('API', { fetchExtensionMarket: vi.fn(async () => ({ data: { enabled: true, items: [entry], total: 1, hasMore: false } })), fetchMarketExtension: vi.fn(async () => ({ data: entry })), fetchMarketOperations: vi.fn(async () => ({ data: [] })), installMarketExtension: vi.fn(async () => ({ data: receipt() })), fetchMarketOperation: vi.fn(async () => ({ data: receipt() })), retryMarketOperation: vi.fn(async () => ({ data: receipt() })) });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(props = {}) { await act(async () => root.render(<Harness {...props}/>)); await act(async () => vi.advanceTimersByTimeAsync(200)); }
async function click(text) { const button = [...host.querySelectorAll('button')].find(item => item.textContent === text); expect(button).toBeTruthy(); await act(async () => button.click()); }
it.each(['expert', 'workbench', 'project'])('installs into the current %s and refreshes the page list without navigation', async kind => {
  API.installMarketExtension.mockResolvedValue({ data: receipt(kind) }); await render({ kind });
  const route = location.hash; await click('安装到当前' + { expert: '专家', workbench: '工作台', project: '项目' }[kind]);
  expect(API.installMarketExtension).toHaveBeenCalledWith('extension', { targetKind: kind, targetId: 'current', versionId: 'v2', runtimeRevision: 3 });
  expect(reload).toHaveBeenCalledWith(expect.any(AbortSignal)); expect(save).not.toHaveBeenCalled(); expect(location.hash).toBe(route);
  expect(host.textContent).toContain('当前扩展列表已更新'); await click('保存并发布资源'); expect(save).toHaveBeenCalledWith(true); expect(host.textContent).toContain('运行资源已发布'); expect(location.hash).toBe(route);
});
it('saves unsaved runtime changes before submitting the fixed-version installation', async () => {
  await render({ dirty: true }); await click('保存草稿并安装');
  expect(save).toHaveBeenCalledWith(false); expect(save.mock.invocationCallOrder[0]).toBeLessThan(API.installMarketExtension.mock.invocationCallOrder[0]);
  expect(API.installMarketExtension.mock.calls[0][1].runtimeRevision).toBe(4);
});
it('does not install when saving the current draft fails', async () => {
  save.mockResolvedValue(false); await render({ dirty: true }); await click('保存草稿并安装');
  expect(API.installMarketExtension).not.toHaveBeenCalled(); expect(host.textContent).toContain('当前草稿未能保存');
});
it('retains an uncertain request across close/reopen and reconciles the original revision only after a click', async () => {
  API.installMarketExtension.mockRejectedValueOnce(Error('Connection lost')); await render(); await click('安装到当前项目');
  const body = API.installMarketExtension.mock.calls[0][1], session = sessions.at(-1), signal = API.fetchExtensionMarket.mock.calls[0][1];
  await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(API.installMarketExtension).toHaveBeenCalledTimes(1);
  await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
  await render({ session, initial: runtime(99) }); expect(API.installMarketExtension).toHaveBeenCalledTimes(1);
  await click('核对原安装请求'); expect(API.installMarketExtension.mock.calls[1][1]).toEqual(body); expect(API.installMarketExtension.mock.calls[1][1].runtimeRevision).toBe(3);
});
it('stops polling on close and resumes the stored operation without another installation write', async () => {
  API.installMarketExtension.mockResolvedValue({ data: receipt('project', 'pending') }); API.fetchMarketOperation.mockResolvedValue({ data: receipt('project', 'running') });
  await render(); await click('安装到当前项目'); await act(async () => vi.advanceTimersByTimeAsync(1100));
  const session = sessions.at(-1), signal = API.fetchMarketOperation.mock.calls[0][1], count = API.fetchMarketOperation.mock.calls.length;
  await act(async () => root.render(null)); expect(signal.aborted).toBe(true); await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(API.fetchMarketOperation).toHaveBeenCalledTimes(count);
  API.fetchMarketOperation.mockResolvedValue({ data: receipt() }); await render({ session }); await act(async () => vi.advanceTimersByTimeAsync(1100));
  expect(API.installMarketExtension).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('已加入运行资源草稿');
});
it('does not replace unsaved edits when viewing a successful historical operation', async () => {
  API.fetchMarketOperations.mockResolvedValue({ data: [receipt()] }); await render({ dirty: true }); await click('查看操作');
  expect(reload).not.toHaveBeenCalled(); expect(host.textContent).toContain('本页有未保存的更改，已为你保留');
  await click('重新载入草稿并重选'); expect(reload).not.toHaveBeenCalled(); await click('确认重新载入'); expect(reload).toHaveBeenCalledTimes(1);
});
it('clears the dialog and never installs after the account changes during draft saving', async () => {
  let complete; save.mockImplementation(() => new Promise(resolve => { complete = resolve; })); await render({ dirty: true });
  await click('保存草稿并安装'); await act(async () => { auth.version++; for (const listener of auth.listeners) listener(); complete(runtime(4)); });
  expect(host.querySelector('[role=dialog]')).toBeNull(); expect(API.installMarketExtension).not.toHaveBeenCalled();
});
