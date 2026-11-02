// @vitest-environment jsdom
import React, { act } from 'react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { knowledgeHref, knowledgeReturnTo } from './routes.js';
import { renderKnowledgeDetail, resolveKnowledgeDetail } from './detailView.jsx';
import { openKnowledgeBrowser } from './browser.js';

vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: () => ({ version: 1 }), subscribe: () => () => {} } }));
vi.mock('./source/renderSource.js', () => ({ renderSource: vi.fn(async () => () => {}) }));
let host;
const ok = data => ({ data });
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<header class="app-topbar"><span id="topbar-title"></span><span id="topbar-crumb"></span><div id="topbar-tabs"></div></header><main></main>';
  host = document.querySelector('main');history.replaceState(null, '', '#/agent/owned?tab=kb');
  vi.stubGlobal('ICON', () => '');vi.stubGlobal('UI', { modal: vi.fn(), toast: vi.fn() });
  vi.stubGlobal('API', {
    fetchKnowledgeScope: vi.fn(async () => ok({ knowledgeBases: [{ id: 'ref', name: '法规资料', enabled: true, connectionId: 'c', collectionId: 'kb', driver: 'nebulae-v100-rest' }] })),
    fetchKnowledgeCollections: vi.fn(async () => ok({ collections: [{ id: 'kb', name: '法规资料', description: '法律法规原文与关联资料', canManage: true, type: 'document' }] })),
    fetchKnowledgeConnections: vi.fn(async () => ok([{ id: 'c', name: '统一知识库', driver: 'nebulae-v100-rest' }])),
    readKnowledgeReference: vi.fn(async () => ok({ capabilities: {} })),
    readKnowledgeCatalog: vi.fn(async () => ok({ capabilities: {} })),
  });
});
afterEach(() => { act(() => host.firstElementChild?.viewCleanup?.());document.body.replaceChildren();vi.unstubAllGlobals(); });

it('navigates to a reloadable scoped page without opening a modal or promoting its permission', () => {
  openKnowledgeBrowser({ scopeKind: 'expert', scopeId: 'owned', id: 'opaque:/ref?x=1', connectionId: 'c', collectionId: 'kb' }, vi.fn());
  const query = new URLSearchParams(location.hash.split('?')[1]);
  expect(location.hash).toMatch(/^#\/knowledge\?/);expect(query.get('reference')).toBe('opaque:/ref?x=1');expect(query.get('from')).toBe('#/agent/owned?tab=kb');expect(query.has('connection')).toBe(false);expect(UI.modal).not.toHaveBeenCalled();
});
it('keeps an initial Wiki document and rejects external return targets', () => {
  const query = new URLSearchParams(knowledgeHref({ connectionId: 'c', collectionId: 'kb/A?x=1', initialDocumentId: 'pages/nested', contentKind: 'wiki' }, { from: 'https://external.invalid' }).split('?')[1]);
  expect(query.get('collection')).toBe('kb/A?x=1');expect(query.get('document')).toBe('pages/nested');expect(query.get('tab')).toBe('wiki');expect(query.get('content')).toBe('wiki');expect(query.get('from')).toBe('#/settings?tab=knowledge');expect(knowledgeReturnTo('#/project/p?tab=kb')).toBe('#/project/p?tab=kb');
});
it('resolves a reference through its original scoped API and never fetches the broader catalog', async () => {
  const signal = new AbortController().signal;
  const result = await resolveKnowledgeDetail({ kind: 'expert', scope: 'owned', reference: 'ref' }, signal);
  await result.read({ operation: 'search', query: '合同' }, signal);
  expect(result.canManage).toBe(false);expect(API.fetchKnowledgeCollections).not.toHaveBeenCalled();expect(API.readKnowledgeReference).toHaveBeenCalledWith('expert','owned','ref',{ operation: 'search', query: '合同' },signal);
});
it('renders system topbar tabs and the image label outside a dialog', async () => {
  await act(async () => renderKnowledgeDetail(host,null,{ connection: 'c', collection: 'kb', from: '#/project/p?tab=kb' }));
  const labels = [...document.querySelectorAll('#topbar-tabs a')].map(a => a.textContent);
  expect(labels).toEqual(['检索','原文','Wiki','图谱','图片']);expect(host.textContent).not.toContain('画廊');expect(host.querySelector('.knowledge-explorer-tabs')).toBeNull();expect(host.querySelector('.knowledge-detail-title h1').textContent).toBe('法规资料');expect(document.querySelector('#topbar-title a').hash).toBe('#/project/p?tab=kb');expect(host.querySelector('.knowledge-detail-actions').textContent).toContain('内容管理');expect(UI.modal).not.toHaveBeenCalled();
});
it('does not expose read or management actions for a revoked reference', async () => {
  API.fetchKnowledgeScope.mockResolvedValue(ok({ knowledgeBases: [{ id: 'ref', enabled: false }] }));
  await act(async () => renderKnowledgeDetail(host,null,{ kind: 'expert', scope: 'owned', reference: 'ref' }));
  expect(host.textContent).toContain('已停用');expect(API.readKnowledgeReference).not.toHaveBeenCalled();expect(host.querySelector('[data-knowledge-upload]')).toBeNull();
});
it('disposes the previous page before replacing its topbar and keeps the new tab styling', async () => {
  await act(async () => renderKnowledgeDetail(host,null,{ connection: 'c', collection: 'kb' }));
  const oldSignal=API.fetchKnowledgeCollections.mock.calls[0][1];
  await act(async () => renderKnowledgeDetail(host,null,{ connection: 'c', collection: 'kb', tab: 'document' }));
  expect(oldSignal.aborted).toBe(true);expect(document.querySelector('.app-topbar').classList.contains('knowledge-topbar')).toBe(true);expect(document.querySelector('#topbar-tabs [aria-current=page]').textContent).toBe('原文');
});
it('ignores a detail response arriving after the page is disposed', async () => {
  let resolve;API.fetchKnowledgeScope.mockImplementation(() => new Promise(done => { resolve = done; }));
  const pending = renderKnowledgeDetail(host,null,{ kind: 'expert', scope: 'owned', reference: 'ref' });
  host.firstElementChild.viewCleanup();host.textContent = '新页面';
  await act(async () => { resolve(ok({ knowledgeBases: [{ id: 'ref', name: '旧页面', enabled: true }] }));await pending; });
  expect(API.fetchKnowledgeScope.mock.calls[0][2].aborted).toBe(true);expect(host.textContent).toBe('新页面');
});
