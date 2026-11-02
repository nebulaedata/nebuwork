// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RuntimeExtensions } from './RuntimeExtensions.jsx';
vi.mock('antd', () => ({ ConfigProvider: ({ children }) => children,
  Dropdown: ({ children, menu }) => <div>{children}{menu.items.map(item => <button key={item.key} onClick={() => menu.onClick({ key: item.key })}>{item.label}</button>)}</div>,
  Modal: ({ children }) => <section role="dialog">{children}</section>, Checkbox: ({ children }) => <label>{children}</label>, Input: () => null, Select: () => null,
}));
vi.mock('./MarketInstallDialog.jsx', () => ({ MarketInstallDialog: props => <div data-market-dialog data-target={props.kind + ':' + props.id} data-extension={props.initialExtensionId} data-dirty={String(props.dirty)}/> }));
let root, host;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; history.replaceState(null, '', '#/agent/expert?tab=ext'); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const blank = () => ({ skills: [], mcp: [], files: [], extensionRefs: [] });
it('opens the chooser immediately on the current page, including when there are unsaved changes', async () => {
  const doc = { ...blank(), instructions: [{ content: 'Unsaved' }] }, save = vi.fn(), route = location.hash;
  await act(async () => root.render(<RuntimeExtensions kind="expert" id="expert" doc={doc} saved={{ revision: 2, document: blank(), extensions: { enabled: true, items: [] } }} credentials={[]} onSave={save}/>));
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '从市场安装').click());
  expect(host.querySelector('[data-market-dialog]').dataset).toMatchObject({ target: 'expert:expert', dirty: 'true' }); expect(save).not.toHaveBeenCalled(); expect(location.hash).toBe(route); expect(host.textContent).not.toContain('保存草稿后前往市场');
});
it('opens version selection in the same chooser when upgrading a market extension', async () => {
  const doc = { ...blank(), extensionRefs: [{ installationId: 'installed', required: false }] }, item = { installationId: 'installed', extensionId: 'extension', name: 'Installed MCP', kind: 'mcp', version: 1, canUpgrade: true };
  await act(async () => root.render(<RuntimeExtensions kind="expert" id="expert" doc={doc} saved={{ revision: 2, document: doc, extensions: { enabled: true, items: [item] } }} credentials={[]}/>));
  const route = location.hash; await act(async () => host.querySelector('[aria-label="配置 Installed MCP"]').click());
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === '选择升级版本').click());
  expect(host.querySelector('[data-market-dialog]').dataset.extension).toBe('extension'); expect(location.hash).toBe(route); expect(host.querySelector('[role=dialog]')).toBeNull();
});
