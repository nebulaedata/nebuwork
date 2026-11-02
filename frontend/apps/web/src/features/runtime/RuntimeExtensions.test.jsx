// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RuntimeExtensions } from './RuntimeExtensions.jsx';

let root, host;
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const documentValue = () => ({ skills: [], mcp: [], files: [], extensionRefs: [{ installationId: 'local', required: true }] });
const installation = (installationId, name, inherited) => ({ installationId, name, inherited, extensionId: 'extension', kind: 'mcp', version: inherited ? 1 : 2, transport: 'stdio', sourceKind: 'workbench', sourceId: 'wb' });
async function render(doc, saved) { await act(async () => root.render(<RuntimeExtensions kind="project" id="project" doc={doc} saved={saved} credentials={[]} onReplace={vi.fn()} onSave={vi.fn()} onUpload={vi.fn()}/>)); }
it('shows one package override, its real pending-publication status and managed authentication', async () => {
  const doc = documentValue(), saved = { revision: 4, document: doc, publishedExtensionRefs: [], extensions: { enabled: true, items: [installation('local', 'Project MCP', false), installation('parent', 'Inherited MCP', true)] } };
  await render(doc, saved);
  expect(host.querySelectorAll('tbody tr')).toHaveLength(1); expect(host.textContent).toContain('Project MCP'); expect(host.textContent).not.toContain('Inherited MCP');
  expect(host.textContent).toContain('待发布'); expect(host.textContent).toContain('独立 MCP 容器'); expect(host.textContent).toContain('管理员统一认证');
});
it('restores a read-only inherited item when a local reference is removed from the draft', async () => {
  const saved = { revision: 4, document: documentValue(), extensions: { items: [installation('local', 'Project MCP', false), installation('parent', 'Inherited MCP', true)] } };
  await render({ ...documentValue(), extensionRefs: [] }, saved);
  expect(host.textContent).toContain('Inherited MCP'); expect(host.textContent).not.toContain('Project MCP'); expect(host.textContent).toContain('已继承');
  expect(host.querySelector('tbody a').getAttribute('href')).toBe('#/workbench?tab=pro&id=wb'); expect(host.querySelector('tbody button')).toBeNull();
});
it('labels historical bindings without making them executable or adding an approval action', async () => {
  const doc = { ...documentValue(), extensionRefs: [] };
  await render(doc, { revision: 0, document: doc, extensions: { items: [], legacyReferences: [{ id: 'old', name: 'Legacy reference', kind: 'plugin' }] } });
  expect(host.textContent).toContain('历史引用，未安装'); expect(host.textContent).toContain('Legacy reference'); expect(host.querySelectorAll('tbody tr')).toHaveLength(0); expect(host.textContent).not.toContain('使用审批');
});
