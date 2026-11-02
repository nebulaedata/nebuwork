// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { KnowledgeExplorer } from './KnowledgeExplorer.jsx';
import { GraphView } from './GraphWorkspace.jsx';
import { wikiBodyText } from './markdown.js';

vi.mock('./source/renderSource.js',()=>({renderSource:vi.fn(async()=>()=>{})}));
let host,root;
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.stubGlobal('API',{knowledgeCatalogContent:vi.fn(async()=>({data:new Blob(['file'])}))});});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
const click=async text=>{const target=[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text||b.getAttribute('aria-label')===text);expect(target,`button ${text}`).toBeTruthy();await act(async()=>target.click());};
const flush=async()=>act(async()=>vi.advanceTimersByTimeAsync(300));
const reference={connectionId:'owned',collectionId:'kb',name:'知识库'};

it('keeps the Wiki directory and selected page when opening and closing its source original',async()=>{
  const read=vi.fn(async p=>({data:p.operation==='wiki.graph'?{nodes:[{slug:'page',title:'法规知识',page_type:'concept'}]}:p.operation==='wiki.folders'?{folders:p.parent_id?[]:[{id:'folder',name:'法规',page_count:1}]}:p.operation==='documents'?{documents:[{id:'page',title:'法规知识'}]}:p.contentKind==='wiki'?{document:{title:'法规知识',extractedText:'# 法规知识\n\n知识正文',version:3,sourceRefs:['doc|法规原文件']}}:p.operation==='document'?{document:{title:'法规原文件',fileName:'法条.docx',fileType:'docx',summary:'实际摘要',customMetadata:{分类:'法规'}},chunks:[]}:{} }));
  await act(async()=>root.render(<KnowledgeExplorer reference={{...reference,initialMode:'wiki'}} read={read} pageLayout hideTabs/>));await flush();
  await click('法规1');await click('法规知识');expect(host.querySelectorAll('.kw-wiki-article h1')).toHaveLength(1);
  const sidebar=host.querySelector('.kw-wiki-sidebar');await click('法规原文件');expect(host.querySelector('.kw-wiki-sidebar')).toBe(sidebar);expect(host.querySelector('.kw-document-panel').textContent).toContain('实际摘要');
  await click('关闭原文详情');expect(host.querySelector('.kw-wiki-sidebar')).toBe(sidebar);expect(host.querySelector('.kw-wiki-article h1').textContent).toBe('法规知识');expect(host.querySelector('.kw-tree-folder').getAttribute('aria-expanded')).toBe('true');
});

it('shows a Wiki node in the graph side reader, keeps it on hover, and focuses its actual neighbors',async()=>{
  const data={nodes:[{slug:'a',title:'制度',page_type:'entity',link_count:1},{slug:'b',title:'审查',page_type:'concept',link_count:1},{slug:'c',title:'孤立页面',page_type:'summary',link_count:0}],edges:[{source:'a',target:'b'}],meta:{total:3,truncated:false}};
  const transport={read:vi.fn(async()=>({document:{title:'制度',extractedText:'# 制度\n\n实际正文',version:2}}))},onPage=vi.fn();
  await act(async()=>root.render(<GraphView data={data} wiki transport={transport} onPage={onPage}/>));
  await act(async()=>host.querySelector('g[aria-label="制度"]').dispatchEvent(new MouseEvent('click',{bubbles:true})));
  expect(host.querySelector('.kw-graph-detail').textContent).toContain('实际正文');expect(onPage).not.toHaveBeenCalled();
  await act(async()=>host.querySelector('g[aria-label="审查"]').dispatchEvent(new Event('pointerover',{bubbles:true})));expect(transport.read).toHaveBeenCalledTimes(1);
  await click('展开邻居');expect(host.querySelectorAll('g[role=button]')).toHaveLength(2);expect(data.nodes).toHaveLength(3);
  await click('返回全图');expect(host.querySelectorAll('g[role=button]')).toHaveLength(3);await click('隐藏无关联页面（1）');expect(host.querySelectorAll('g[role=button]')).toHaveLength(2);
  await click('关闭节点详情');expect(host.querySelector('.kw-graph-detail')).toBeNull();
});

it('retains the document list while previewing, reading chunks and expanding the source panel',async()=>{
  const read=vi.fn(async p=>({data:p.operation==='documents'?{documents:[{id:'d',title:'原文件.docx',fileName:'原文件.docx'}],total:1}:p.operation==='document'?{document:{title:'原文件.docx',fileName:'原文件.docx',fileType:'docx',fileSize:2048,createdAt:'2026-10-16T02:00:00Z',customMetadata:{分类:'<img onerror=x>'},summary:'接口返回的摘要'},chunks:[{id:'c',content:'正文分块'}],total:1}:{} }));
  await act(async()=>root.render(<KnowledgeExplorer reference={{...reference,initialMode:'document'}} read={read} pageLayout hideTabs/>));
  const list=host.querySelector('.kw-document-list');await click('阅读');expect(host.querySelector('.kw-document-list')).toBe(list);expect(host.querySelector('.kw-document-panel').textContent).toContain('接口返回的摘要');expect(host.querySelector('.kw-document-panel').textContent).toContain('2.0 KB');expect(host.querySelector('.kw-document-panel img')).toBeNull();
  await click('查看分块');expect(host.querySelector('.knowledge-parsed').textContent).toContain('正文分块');
  await click('展开原文预览');expect(host.querySelector('.kw-document-workspace').classList.contains('document-expanded')).toBe(true);
  await click('关闭原文详情');expect(host.querySelector('.kw-document-panel')).toBeNull();expect(host.querySelector('.kw-document-list')).toBe(list);
});

it('cancels lazy Wiki tree requests after leaving the view and ignores their late completion',async()=>{
  let finish;const read=vi.fn(p=>p.operation==='wiki.folders'?new Promise(resolve=>{finish=resolve;}):Promise.resolve({data:{documents:[],nodes:[]}}));
  await act(async()=>root.render(<KnowledgeExplorer reference={{...reference,initialMode:'wiki'}} read={read} pageLayout hideTabs/>));const signal=read.mock.calls.find(([p])=>p.operation==='wiki.folders')[1];
  await act(async()=>root.render(<p>其他页面</p>));expect(signal.aborted).toBe(true);await act(async()=>finish({data:{folders:[{id:'late',name:'迟到目录'}]}}));expect(host.textContent).toBe('其他页面');
});

it('removes only the duplicate Wiki title while preserving a different content heading',()=>{
  expect(wikiBodyText('# 同一标题\n\n正文','同一标题')).toBe('正文');expect(wikiBodyText('# 章节标题\n\n正文','页面标题')).toBe('# 章节标题\n\n正文');
});

it('shows V101 unfiled Wiki pages in the tree and follows their immutable source references',async()=>{
 const sid='12345678-1234-1234-1234-123456789012';
 const read=vi.fn(async p=>({data:p.operation==='wiki.folders'?{folders:[]}:p.operation==='wiki.graph'?{nodes:[]}:p.operation==='documents'?{documents:[{id:'wiki',title:'根目录页面',folderId:null}]}:p.operation==='source'?{citation:{documentId:'d',sourceRefId:sid,fileVersionId:'old-file',parseVersionId:'old-parse'},text:'原文'}:p.contentKind==='wiki'?{document:{title:'根目录页面',extractedText:'[依据](source:'+sid+')'}}:{document:{title:'原文件',fileType:'txt'},chunks:[]}}));
 await act(async()=>root.render(<KnowledgeExplorer reference={{...reference,driver:'nebulae-v101-rest',initialMode:'wiki'}} read={read} pageLayout hideTabs/>));await flush();
 expect(host.querySelector('.kw-tree-page').textContent).toBe('根目录页面');expect([...host.querySelectorAll('.kw-sidebar-tabs button')].map(b=>b.textContent)).not.toContain('摘要 ');
 await act(async()=>host.querySelector('[data-source-ref]').click());
 expect(read.mock.calls.some(([p])=>p.operation==='chunk'&&p.sourceRefId===sid&&p.fileVersionId==='old-file'&&p.parseVersionId==='old-parse')).toBe(true);
});
