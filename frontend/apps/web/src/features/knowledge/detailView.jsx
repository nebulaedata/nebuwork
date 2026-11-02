import React from 'react';
import { createRoot } from 'react-dom/client';
import { esc, lifetime } from './lifecycle.js';
import { KnowledgeExplorer } from './KnowledgeExplorer.jsx';
import { knowledgeHref, knowledgeReturnTo, knowledgeTabs } from './routes.js';
import { openKnowledgeUpload, refreshAfterUploads } from './uploads.js';
import './detail.css';

const kinds = { document: '文档知识库', faq: '问答知识库', wiki: 'Wiki 知识库' };

export async function resolveKnowledgeDetail(query, signal) {
  if (query.reference) {
    if (!['expert', 'workbench', 'project'].includes(query.kind) || !query.scope) throw new Error('知识库引用地址无效');
    const { data } = await API.fetchKnowledgeScope(query.kind, query.scope, signal);
    const ref = data.knowledgeBases.find(item => item.id === query.reference);
    if (!ref) throw new Error('知识库引用不存在或已撤销');
    if (!ref.enabled) throw new Error('知识库引用或连接已停用');
    const reference = { ...ref, scopeKind: query.kind, scopeId: query.scope };
    return { reference, library: { ...ref, description: ref.description || '', type: ref.type },
      read: (payload, abort) => API.readKnowledgeReference(query.kind, query.scope, ref.id, payload, abort), canManage: false };
  }
  if (!query.connection || !query.collection) throw new Error('知识库地址无效');
  const [catalog, connections] = await Promise.all([
    API.fetchKnowledgeCollections(query.connection, signal), API.fetchKnowledgeConnections('user', '', signal),
  ]);
  const library = catalog.data.collections.find(item => item.id === query.collection);
  if (!library) throw new Error('知识库不存在或当前账号没有访问权限');
  const connection = connections.data.find(item => item.id === query.connection);
  const reference = { connectionId: query.connection, collectionId: library.id, name: library.name,
    driver: connection?.driver, connectionName: connection?.name, contentKind: library.type };
  return { reference, library, canManage: !!library.canManage,
    read: (payload, abort) => API.readKnowledgeCatalog(query.connection, library.id, payload, abort) };
}

export async function renderKnowledgeDetail(el, _id, query = {}) {
  if(query.workspace === "1"){el.viewCleanup?.();const {renderV101Workspace}=await import("./v101Workspace.js");return renderV101Workspace(el,query);}
  el.viewCleanup?.();
  const from = knowledgeReturnTo(query.from), tab = knowledgeTabs.some(([key]) => key === query.tab) || query.tab === 'manage' ? query.tab : 'search';
  el.innerHTML = '<div class="page knowledge-detail-page"><div data-knowledge-page><div class="knowledge-page-loading" role="status">正在读取知识库…</div></div></div>';
  const host = el.firstElementChild, life = lifetime(host);
  host.viewCleanup = life.dispose;el.viewCleanup = life.dispose;
  const title = document.getElementById('topbar-title'), crumb = document.getElementById('topbar-crumb'), topTabs = document.getElementById('topbar-tabs');
  const topbar = topTabs?.closest('.app-topbar'), owner = {};
  if (topbar) { topbar.knowledgeOwner = owner;topbar.classList.add('knowledge-topbar'); }
  life.cleanup(() => { if (topbar?.knowledgeOwner === owner) { topbar.classList.remove('knowledge-topbar');delete topbar.knowledgeOwner; } });
  if (title) title.innerHTML = '<a href="' + esc(from) + '">知识库</a>';
  const pane = host.querySelector('[data-knowledge-page]');
  try {
    const { reference, library, read, canManage } = await resolveKnowledgeDetail(query, life.signal);
    if (!life.live()) return;
    if (crumb) crumb.textContent = ' / ' + library.name;
    if (topTabs) topTabs.innerHTML = '<nav class="tabs knowledge-page-tabs" aria-label="知识库内容类型">' + knowledgeTabs.map(([key, label, icon]) =>
      '<a class="tab ' + (tab === key ? 'active' : '') + '" href="' + esc(knowledgeHref(reference, { tab: key, from })) + '"' + (tab === key ? ' aria-current="page"' : '') + '>' + ICON(icon, 14) + label + '</a>').join('') + '</nav>';
    pane.innerHTML = '<header class="knowledge-detail-header"><div class="knowledge-detail-heading"><a class="knowledge-detail-back" href="' + esc(from) + '">' + ICON('chevron-left', 14) + '返回</a><div class="knowledge-detail-title"><h1>' + esc(library.name) + '</h1><span class="pill pill-dim">' + (canManage ? '可维护' : '只读') + '</span></div><p>' + esc(library.description || '在这里检索知识、阅读原文并查看关联内容。') + '</p><div class="knowledge-detail-meta">' + ICON('book-open', 13) + esc(reference.connectionName || '已授权知识库') + (kinds[library.type] ? ' · ' + kinds[library.type] : '') + (library.documentCount != null ? ' · ' + library.documentCount + ' 篇资料' : '') + '</div></div><div class="knowledge-detail-actions"></div></header><div data-knowledge-content></div>';
    const actions = pane.querySelector('.knowledge-detail-actions');
    if (canManage) {
      actions.innerHTML = '<a class="btn btn-ghost" href="' + esc(knowledgeHref(reference, { tab: tab === 'manage' ? 'document' : 'manage', from })) + '">' + ICON(tab === 'manage' ? 'file-text' : 'settings', 14) + (tab === 'manage' ? '返回原文' : '内容管理') + '</a>' + (library.type !== 'faq' ? '<button class="btn btn-primary" data-knowledge-upload>' + ICON('upload', 14) + '上传资料</button>' : '');
      actions.querySelector('[data-knowledge-upload]')?.addEventListener('click', () => openKnowledgeUpload({ target: { ...reference, type: library.type }, valid: life.live }));
    }
    const content = pane.querySelector('[data-knowledge-content]');
    if(reference.driver === "nebulae-v101-rest" && canManage){const {v101WorkspaceHref}=await import("./v101Workspace.js");actions.insertAdjacentHTML("beforeend",`<a class="btn btn-primary" href="${esc(v101WorkspaceHref(reference.connectionId,"/knowledge-bases/"+reference.collectionId))}">V101 完整工作区</a>`);if(tab === "manage"){location.hash=v101WorkspaceHref(reference.connectionId,"/knowledge-bases/"+reference.collectionId);return;}}
    if (tab === 'manage') {
      if (!canManage) throw new Error('当前引用仅允许浏览，请从有维护权限的知识库入口管理内容');
      const { renderLibraryDetail } = await import('./management.js');
      if (life.live()) await renderLibraryDetail(content, reference.connectionId, reference.collectionId, { embedded: true });
      return;
    }
    const root = createRoot(content);life.cleanup(() => root.unmount());
    root.render(<KnowledgeExplorer reference={{ ...reference, initialMode: tab, initialDocumentId: query.document, contentKind: query.document && ['document','faq','wiki'].includes(query.content) ? query.content : reference.contentKind }} read={read} parentSignal={life.signal} pageLayout hideTabs />);
    refreshAfterUploads(life, () => { if (life.live()) return renderKnowledgeDetail(el, _id, query); }, target => target.connectionId === reference.connectionId && target.collectionId === reference.collectionId);
  } catch (error) {
    if (life.live() && error.name !== 'AbortError') pane.innerHTML = '<section class="card knowledge-page-error"><h2>知识库暂时无法读取</h2><p role="alert">' + esc(error.message) + '</p><a class="btn btn-ghost" href="' + esc(from) + '">返回上一级</a><button class="btn btn-ghost" data-retry>重新加载</button></section>';
    pane.querySelector('[data-retry]')?.addEventListener('click', () => renderKnowledgeDetail(el, _id, query));
  }
}

window.Views ||= {};
window.Views.knowledge = { render: renderKnowledgeDetail };
