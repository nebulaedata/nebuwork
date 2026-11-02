// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { ServicePublisher, normalizeServiceDraft } from './ServicePublisher.jsx';
const auth = vi.hoisted(() => ({ version: 1, listener: null }));
vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: () => ({ version: auth.version }), subscribe: fn => { auth.listener = fn; return () => {}; } } }));
vi.mock('../knowledge/KnowledgeControls.jsx', () => ({ KnowledgeControls: ({children}) => <>{children}</>, KnowledgeSelect: props => <select multiple={props.mode === 'multiple'} value={props.value || (props.mode === 'multiple' ? [] : '')} onChange={e => props.onChange?.(e.target.value)}>{props.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> }));
let root, host;
const definition = { name: '项目服务', description: '', capabilities: [], pages: [] };
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true; auth.version = 1; host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('API', { fetchWorkbenchService: vi.fn(async () => ({ data: { revision: 0, available: true, enabled: false, draft: structuredClone(definition), platformOperations: ['project.get'] } })), fetchServiceReleases: vi.fn(async () => ({ data: [] })), fetchServiceApps: vi.fn(async () => ({ data: [] })), fetchProjects: vi.fn(async () => ({ data: [] })), workflowRequest: vi.fn(async () => ({ items: [] })), serviceUrl: (wb, p) => '/api/workbench-services/' + wb + '/' + p, saveWorkbenchService: vi.fn(async (_wb, body) => ({ data: { revision: 1, draft: body.definition } })), publishWorkbenchService: vi.fn(async () => ({ data: { id: 'release' } })) });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function open() { await act(async () => root.render(<ServicePublisher workbenchId="wb"/>)); await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '配置服务').click()); }
it('saves the canonical draft before a deliberate publication', async () => {
  await open(); await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '保存并发布服务').click());
  expect(API.saveWorkbenchService).toHaveBeenCalledWith('wb', { revision: 0, definition }, expect.any(AbortSignal));
  expect(API.publishWorkbenchService).toHaveBeenCalledWith('wb', 1, expect.any(AbortSignal));
});
it('retains edits on revision conflict and does not publish', async () => {
  await open(); API.saveWorkbenchService.mockRejectedValue(new Error('服务草稿已变化'));
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '保存并发布服务').click());
  expect(host.querySelector('[role=alert]').textContent).toContain('已变化'); expect(API.publishWorkbenchService).not.toHaveBeenCalled();
});
it('aborts work and clears service data on identity changes', async () => {
  await open(); const signal = API.fetchWorkbenchService.mock.calls[0][1];
  await act(async () => { auth.version++; auth.listener(); });
  expect(signal.aborted).toBe(true); expect(host.textContent).not.toContain('项目服务');
});
it('parses schema editors without mutating the visible draft', () => {
  const draft = { ...definition, capabilities: [{ inputSchema: '{"type":"object"}', outputSchema: '{}', binding: { type: 'workflow', inputMapping: '{"q":"/query"}' } }] };
  expect(normalizeServiceDraft(draft).capabilities[0].binding.inputMapping).toEqual({ q: '/query' }); expect(typeof draft.capabilities[0].inputSchema).toBe('string');
  expect(() => normalizeServiceDraft({ ...draft, capabilities: [{ ...draft.capabilities[0], inputSchema: 'invalid' }] })).toThrow();
});
