// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkbenchHub } from './WorkbenchHub.jsx';
const auth = vi.hoisted(() => { const listeners = new Set(); let state = { version: 1, user: { id: 'a' } }; return { getSnapshot: () => state, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, change: () => { state = { version: 2, user: { id: 'b' } }; listeners.forEach(fn => fn()); } }; });
vi.mock('../../services/authSession.js', () => ({ authSession: auth }));
vi.mock('../knowledge/KnowledgeControls.jsx', () => ({ KnowledgeControls: ({ children }) => children, KnowledgeSelect: ({ options, onChange, showSearch, optionFilterProp, ...p }) => <select {...p} onChange={e => onChange(e.target.value)}><option value=""/>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
vi.mock('./commander/Commander.jsx', () => ({ Commander: ({ project }) => <p>会话项目 {project.id}</p> }));
vi.mock('./intelligence/Intelligence.jsx', () => ({ Intelligence: () => <p>情报</p> }));
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it('aborts old mounts and ignores a late catalog response on account change', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear();
  document.body.innerHTML = '<div class="app-topbar"></div><div id="test"></div>';
  let resolveOld;
  vi.stubGlobal('API', { fetchWorkbenches: vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; })).mockResolvedValue({ data: [] }), fetchProjects: vi.fn(async () => ({ data: [{ id: 'old-project', workbenchId: 'old-w' }] })) });
  const host = document.getElementById('test'); root = createRoot(host);
  await act(async () => root.render(<WorkbenchHub role="commander"/>));
  await act(async () => auth.change());
  await act(async () => resolveOld({ data: [{ id: 'old-w', name: '指挥官' }] }));
  expect(host.textContent).not.toContain('old-project'); expect(host.querySelector('[aria-label="指挥工作台"]').textContent).not.toContain('指挥官');
  expect(localStorage.getItem('nw-hub:b:commander')).toBeNull();
});
