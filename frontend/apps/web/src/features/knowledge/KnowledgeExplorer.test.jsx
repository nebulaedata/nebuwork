// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KnowledgeExplorer } from './KnowledgeExplorer.jsx';
import { SourceReader, SourceNavigator } from './SourceReader.jsx';
import { evidenceLinks } from '../tasks/knowledgeEvidence.js';

vi.mock('./source/renderSource.js',()=>({renderSource:vi.fn(async()=>()=>{})}));
let host,root;
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.stubGlobal('ResizeObserver',class {observe(){} unobserve(){} disconnect(){}});vi.stubGlobal('API',{knowledgeCatalogContent:vi.fn(async()=>({data:new Blob(['file'])}))});vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=>'blob:test'),revokeObjectURL:vi.fn()}));});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const click=async text=>{const button=[...host.querySelectorAll('button')].find(b=>b.textContent.includes(text));expect(button).toBeTruthy();await act(async()=>button.click());};
const input=async(selector,value)=>{const element=host.querySelector(selector);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));});};
const reference={connectionId:'connection',collectionId:'kb',name:'测试库'};
const caps={capabilities:{wiki:{supported:true,enabled:true,available:'unknown'}}};

it('loads a hit directly by chunk id and preserves its source locator',async()=>{
  const read=vi.fn(async payload=>payload.operation==='capabilities'?{data:caps}:payload.operation==='search'?{data:{results:[{text:'命中段落',citation:{documentId:'doc',chunkId:'chunk-67',title:'原始制度',contentKind:'document',sourceLocators:[{type:'pdf',page:20}]}}]}}:{data:{document:{title:'原始制度',fileName:'source.pdf'},chunk:{id:'chunk-67',content:'命中段落',source_locators:[{type:'pdf',page:20}]},chunks:[]}});
  await act(async()=>root.render(<KnowledgeExplorer reference={reference} read={read}/>));await input('input','制度');await act(async()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await click('查看原文并定位');
  expect(read).toHaveBeenCalledWith(expect.objectContaining({operation:'chunk',chunkId:'chunk-67',documentId:'doc'}),expect.any(AbortSignal));expect(host.textContent).toContain('原始制度');expect(API.knowledgeCatalogContent).toHaveBeenCalledWith('connection','kb','preview',expect.objectContaining({documentId:'doc'}),expect.any(AbortSignal));
});

it('reads wiki backlinks and follows source documents through the same scoped transport',async()=>{
  const transport={read:vi.fn(async payload=>payload.contentKind==='wiki'?{document:{title:'Wiki 页面',extractedText:'整理内容',sourceRefs:['doc|来源文件'],outLinks:['next/page'],inLinks:['previous'],inLinkTitles:{previous:'前一页'}}}:{document:{title:'来源文件'}}),binary:vi.fn()};const onNavigate=vi.fn();
  await act(async()=>root.render(<SourceReader source={{documentId:'wiki/page',contentKind:'wiki'}} transport={transport} onNavigate={onNavigate}/>));
  await click('来源文件');expect(onNavigate).toHaveBeenCalledWith({documentId:'doc',title:'来源文件',contentKind:'document'});await click('前一页');expect(onNavigate).toHaveBeenCalledWith({documentId:'previous',title:'前一页',contentKind:'wiki'});expect(transport.binary).not.toHaveBeenCalled();
});

it('follows inline Wiki evidence links through the authorized reference and can return to the pinned evidence',async()=>{
  const pinned={read:vi.fn(async()=>({document:{title:'已存引用',extractedText:'参见 [[equipment/pump|水泵]]。'}})),binary:vi.fn()};
  const navigation={read:vi.fn(async()=>({document:{title:'水泵页面',extractedText:'设备说明'}})),binary:vi.fn()};
  await act(async()=>root.render(<SourceNavigator source={{documentId:'wiki/overview',contentKind:'wiki'}} transport={pinned} navigationTransport={navigation}/>));
  await act(async()=>host.querySelector('a[data-wiki-page]').click());
  expect(navigation.read).toHaveBeenCalledWith(expect.objectContaining({documentId:'equipment/pump',contentKind:'wiki'}),expect.any(AbortSignal));expect(host.textContent).toContain('水泵页面');expect(pinned.read).toHaveBeenCalledTimes(1);
  await click('返回引用依据');expect(host.textContent).toContain('已存引用');expect(pinned.read).toHaveBeenCalledTimes(2);expect(navigation.binary).not.toHaveBeenCalled();
});

it('expands graph nodes by their instance identity without merging equal names',async()=>{
  const read=vi.fn(async payload=>payload.operation==='capabilities'?{data:caps}:{data:{nodes:[{id:'a',name:'设备',knowledge_id:'d1',chunk_ids:['c1']},{id:'b',name:'设备',knowledge_id:'d2',chunk_ids:['c2']}],edges:[{id:'r',source:'a',target:'b',type:'关联'}],sources:[],truncated:true}});
  await act(async()=>root.render(<KnowledgeExplorer reference={{...reference,initialMode:'graph'}} read={read}/>));const nodes=host.querySelectorAll('svg g[role=button]');expect(nodes).toHaveLength(2);await act(async()=>nodes[1].dispatchEvent(new MouseEvent('click',{bubbles:true})));await click('展开邻域');expect(read).toHaveBeenLastCalledWith(expect.objectContaining({operation:'graph',mode:'expand',nodeId:'b'}),expect.any(AbortSignal));expect(host.textContent).toContain('子图');
});

it('shows stored document paths as text in page rows without injecting markup',async()=>{
  const read=vi.fn(async p=>p.operation==='capabilities'?{data:caps}:{data:{documents:[{id:'doc',title:'a.md',fileName:'a.md',folderPath:'<img>/部门'}]}});
  await act(async()=>root.render(<KnowledgeExplorer reference={{...reference,initialMode:'document'}} read={read} pageLayout hideTabs/>));
  expect(host.textContent).toContain('<img>/部门/a.md');expect(host.querySelector('img')).toBeNull();expect(host.querySelector('.knowledge-explorer-tabs')).toBeNull();
});

it('defaults a scoped FAQ library to its actual search kind after resolving capabilities',async()=>{
  const read=vi.fn(async()=>({data:{type:'faq',capabilities:{}}}));
  await act(async()=>root.render(<KnowledgeExplorer reference={reference} read={read} pageLayout hideTabs/>));
  expect(host.querySelector('.knowledge-query-kind').textContent).toContain('问答');
  await input('.knowledge-query-field input','退货流程');await act(async()=>host.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  expect(read).toHaveBeenLastCalledWith(expect.objectContaining({operation:'search',contentKind:'faq',query:'退货流程'}),expect.any(AbortSignal));
});

it('applies a themed gallery filter and resets its actual request without changing resource scope',async()=>{
  const gallery={config:{attributes:[{id:'builtin:is_enabled',name:'is_enabled',usage:{in_filter:true},values:[{value:'true'},{value:'false'}]}]},items:[],total:0};let finish;
  const read=vi.fn(p=>p.operation==='gallery'&&p.attrFilters?.['builtin:is_enabled']?.length?new Promise(resolve=>{finish=resolve;}):Promise.resolve({data:p.operation==='capabilities'?caps:p.operation==='documents'?{documents:[]}:gallery}));
  await act(async()=>root.render(<KnowledgeExplorer reference={{...reference,initialMode:'gallery'}} read={read} pageLayout hideTabs/>));
  const select=host.querySelector('[aria-label="参与检索"]');expect(select).toBeTruthy();
  await act(async()=>select.dispatchEvent(new MouseEvent('mousedown',{bubbles:true})));
  const option=document.body.querySelector('.ant-select-item-option[title="参与检索"]');expect(option).toBeTruthy();await act(async()=>option.click());
  expect(read).toHaveBeenLastCalledWith(expect.objectContaining({operation:'gallery',attrFilters:{'builtin:is_enabled':['true']},page:1}),expect.any(AbortSignal));
  expect(host.querySelector('[aria-label="参与检索"]')).toBeTruthy();await act(async()=>finish({data:gallery}));
  await click('重置筛选');expect(read).toHaveBeenLastCalledWith(expect.objectContaining({operation:'gallery',attrFilters:{},documentIds:undefined,searchIn:undefined,page:1}),expect.any(AbortSignal));expect(host.querySelector('.knowledge-pagination')).toBeNull();
});

it('renders gallery filter fields from the remote contract and never loads a remote image URL',async()=>{
  const read=vi.fn(async p=>p.operation==='capabilities'?{data:caps}:{data:{config:{attributes:[{id:'custom:category',label:'资料类型',usage:{in_filter:true},values:[{value:'diagram',label:'流程图'}]}]},items:[{id:'c#0',chunkId:'c',documentId:'d',title:'图示',caption:'派生描述',citation:{documentId:'d',chunkId:'c',contentKind:'document'}}]}});
  await act(async()=>root.render(<KnowledgeExplorer reference={{...reference,initialMode:'gallery'}} read={read}/>));expect(host.textContent).toContain('资料类型');expect(host.querySelector('img')?.src).toBe('blob:test');expect(API.knowledgeCatalogContent).toHaveBeenCalledWith('connection','kb','media',expect.objectContaining({imageId:'c#0'}),expect.any(AbortSignal));await click('核验来源');expect(read).toHaveBeenLastCalledWith(expect.objectContaining({operation:'chunk',documentId:'d',chunkId:'c'}),expect.any(AbortSignal));
});

it('ignores an explorer response arriving after unmount',async()=>{
  let resolve;const read=vi.fn(p=>p.operation==='capabilities'?Promise.resolve({data:caps}):new Promise(r=>resolve=r));await act(async()=>root.render(<KnowledgeExplorer reference={{...reference,initialMode:'graph'}} read={read}/>));const signal=read.mock.calls.find(([p])=>p.operation==='graph')[1];await act(async()=>root.render(<p>已切换</p>));expect(signal.aborted).toBe(true);await act(async()=>resolve({data:{nodes:[{id:'late',name:'迟到内容'}]}}));expect(host.textContent).toBe('已切换');
});

it('extracts stable evidence links from persisted tool text and rejects arbitrary IDs',()=>{
  const c={evidenceId:'ke_valid',documentId:'doc',title:'来源'};expect(evidenceLinks({result:{content:[{type:'text',text:JSON.stringify({results:[{citation:c}]})}]},output:JSON.stringify({citation:c})})).toEqual([c]);expect(evidenceLinks({result:{evidenceId:'https://external.invalid'}})).toEqual([]);
});
