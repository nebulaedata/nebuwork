// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { HtmlServicePublisher } from './HtmlServicePublisher.jsx';
const auth=vi.hoisted(()=>({version:1,listener:null}));
vi.mock('../../services/authSession.js',()=>({authSession:{getSnapshot:()=>({version:auth.version}),subscribe:fn=>{auth.listener=fn;return()=>{};}}}));
vi.mock('../knowledge/KnowledgeControls.jsx',()=>({KnowledgeControls:({children})=><>{children}</>,KnowledgeSelect:props=><select aria-label={props['aria-label']} multiple value={props.value} onChange={e=>props.onChange([...e.target.selectedOptions].map(o=>o.value))}>{props.options?.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>}));
let root,host;
const entry={id:'entry',version:2,name:'report.html',size:25,sessionId:'task'},css={id:'css',version:3,name:'style.css',size:30,sessionId:'task'};
const definition={name:'已有服务',description:'keep',capabilities:[],pages:[{key:'old',name:'旧页面',assetId:'old-asset',projectIds:['project'],capabilities:[]}]};
const click=async label=>act(async()=>{[...host.querySelectorAll('button')].find(b=>b.textContent===label).click();});
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;auth.version=1;host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.stubGlobal('API',{fetchProjectDetail:vi.fn(async()=>({data:{project:{id:'project',name:'项目',workbenchId:'wb'}}})),fetchProjectArtifacts:vi.fn(async()=>({data:{items:[entry,css]}})),fetchWorkbenchService:vi.fn(async()=>({data:{revision:4,available:true,draft:structuredClone(definition)}})),fetchServiceReleases:vi.fn(async()=>({data:[]})),artifactContent:vi.fn(async(_p,f)=>({data:{text:async()=>f.id==='entry'?'<link href="style.css">':'body{color:purple}'}})),createServiceAsset:vi.fn(async()=>({data:{id:'asset',source:{files:[{artifactId:'entry',version:2},{artifactId:'css',version:3}]}}})),saveWorkbenchService:vi.fn(async(_w,b)=>({data:{revision:b.revision+1,draft:b.definition}})),previewWorkbenchService:vi.fn(async()=>({data:{id:'preview'}})),publishWorkbenchService:vi.fn(async()=>({data:{id:'release'}})),serviceUrl:(w,p)=>'/api/workbench-services/'+w+'/'+p});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const open=async()=>act(async()=>root.render(<HtmlServicePublisher projectId="project" file={entry} close={()=>{}}/>));
it('saves exact file versions, preserves other pages, previews and publishes only on an explicit click',async()=>{
  await open();await click('保存并预览');
  expect(API.createServiceAsset).toHaveBeenCalledWith('wb',{projectId:'project',artifactId:'entry',version:2,entryPath:'report.html',resources:[{path:'style.css',artifactId:'css',version:3}]},expect.any(AbortSignal));
  const saved=API.saveWorkbenchService.mock.calls[0][1];expect(saved.revision).toBe(4);expect(saved.definition.pages[0]).toEqual(definition.pages[0]);expect(saved.definition.pages[1].projectIds).toEqual(['project']);
  expect(host.querySelector('iframe').src).toContain('projectId=project&releaseId=preview');expect(API.publishWorkbenchService).not.toHaveBeenCalled();
  await click('发布新版本');expect(API.publishWorkbenchService).toHaveBeenCalledWith('wb',5,expect.any(AbortSignal));expect(host.textContent).toContain('打开已发布页面');
});
it('keeps edits on save conflict and requires saving again after edits',async()=>{
  await open();API.saveWorkbenchService.mockRejectedValueOnce(Error('服务草稿已变化'));
  await click('保存页面草稿');expect(host.querySelector('[role=alert]').textContent).toContain('已变化');expect(host.querySelector('input[aria-label="页面名称"]').value).toBe('report');expect(API.publishWorkbenchService).not.toHaveBeenCalled();
  await click('保存页面草稿');expect(host.textContent).toContain('发布新版本');
  await act(async()=>{const input=host.querySelector('input[aria-label="页面名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'修改名称');input.dispatchEvent(new Event('input',{bubbles:true}));});
  expect([...host.querySelectorAll('button')].some(b=>b.textContent==='发布新版本')).toBe(false);
});
it('aborts pending reads and removes service data and previews after identity changes',async()=>{
  await open();await click('保存并预览');const signal=API.fetchWorkbenchService.mock.calls[0][1];
  await act(async()=>{auth.version++;auth.listener();});expect(signal.aborted).toBe(true);expect(host.querySelector('iframe')).toBe(null);expect(host.textContent).not.toContain('已有服务');
});
