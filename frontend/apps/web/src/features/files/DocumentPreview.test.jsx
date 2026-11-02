// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { File, Blob } from 'node:buffer';
import { DocumentPreview } from './DocumentPreview.jsx';
import { documentType, sniffDocument } from './previewModel.js';
import JSZip from 'jszip';
import {renderKnowledgeMarkdown} from '../knowledge/markdown.js';
const {render,dispose}=vi.hoisted(()=>({render:vi.fn(async()=>dispose),dispose:vi.fn()}));
vi.mock('../knowledge/source/renderSource.js',()=>({renderSource:render}));
vi.mock('../../services/authSession.js',()=>({authSession:{getSnapshot:()=>({version:1}),subscribe:()=>()=>{}}}));
let host,root;
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);render.mockClear();dispose.mockClear();vi.stubGlobal('API',{});vi.stubGlobal('URL',class extends URL{static createObjectURL=vi.fn(()=> 'blob:preview');static revokeObjectURL=vi.fn();});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const source={kind:'artifact',projectId:'p',artifactId:'file',version:1};
it('renders converted knowledge Office previews as PDF while preserving source citation identity',async()=>{
  const pdf=new Blob(['%PDF-1.6\nconverted preview'],{type:'application/pdf'});
  expect(await sniffDocument(pdf,{kind:'docx',ext:'docx'})).toEqual({kind:'pdf',ext:'pdf'});
  const request={locators:[{type:'docx',block:3,mapping:'exact'}],quotes:['依据原文']};
  await act(async()=>root.render(<DocumentPreview source={{kind:'knowledge',documentId:'original',fileVersionId:'frozen'}} fileName="original.docx" fileType="docx" size={40} request={request} loadBlob={async()=>pdf}/>));
  await vi.waitFor(()=>expect(render).toHaveBeenCalled());
  expect(render.mock.calls[0][2].fileType).toBe('pdf');
  expect(render.mock.calls[0][2].request).toEqual(request);
});
it('renders converted PDF pages without depending on a browser PDF plug-in',async()=>{
 await act(async()=>root.render(<DocumentPreview source={source} fileName="original.docx" fileType="docx" size={40} loadBlob={async()=>new Blob(['%PDF-1.6\nconverted'],{type:'application/pdf'})}/>));
 await vi.waitFor(()=>expect(render).toHaveBeenCalled());
 expect(render.mock.calls[0][2].fileType).toBe('pdf');expect(host.querySelector('iframe')).toBeNull();
});
it('resolves MIME types, uppercase extensions and extensionless OOXML',async()=>{expect(documentType('REPORT.DOCX','','application/octet-stream').kind).toBe('docx');expect(documentType('file','application/pdf').kind).toBe('pdf');const zip=new JSZip();zip.file('ppt/presentation.xml','<p:presentation/>');const bytes=await zip.generateAsync({type:'uint8array'});expect((await sniffDocument(new Blob([bytes]),{kind:'unsupported'})).kind).toBe('pptx');});
it('keeps task HTML interactive in an opaque origin and knowledge HTML script-free',async()=>{const loadBlob=vi.fn(async()=>new Blob(['<script>parent.evil=1</script>']));await act(async()=>root.render(<DocumentPreview source={source} fileName="page.html" size={34} loadBlob={loadBlob}/>));expect(host.querySelector('iframe').getAttribute('sandbox')).toBe('allow-scripts');expect(host.querySelector('iframe').getAttribute('referrerpolicy')).toBe('no-referrer');await act(async()=>root.render(<DocumentPreview source={source} fileName="page.html" size={34} loadBlob={loadBlob} htmlPolicy="source"/>));expect(host.querySelector('iframe').getAttribute('sandbox')).toBe('');expect(window.evil).toBeUndefined();});
it('uses the shared Office renderer and disposes it on close',async()=>{await act(async()=>root.render(<DocumentPreview source={source} fileName="report.docx" size={30} loadBlob={async()=>new Blob(['office'])}/>));await vi.waitFor(()=>expect(render).toHaveBeenCalled());expect(render.mock.calls[0][2].fileType).toBe('docx');await act(async()=>root.unmount());expect(dispose).toHaveBeenCalled();root=createRoot(host);});
it('loads a large PDF through a controlled URL without reading a Blob',async()=>{const loadBlob=vi.fn();API.createFilePreview=vi.fn(async()=>({data:{id:'job',status:'ready',manifest:{kind:'native'}}}));API.filePreviewUrl=()=>'/api/file-previews/job/content';await act(async()=>root.render(<DocumentPreview source={source} fileName="large.pdf" size={2147483648} loadBlob={loadBlob}/>));expect(loadBlob).not.toHaveBeenCalled();expect(host.querySelector('iframe').getAttribute('src')).toBe('/api/file-previews/job/content');});
it('loads only a table window and preserves literal cell values',async()=>{const loadBlob=vi.fn();API.createFilePreview=vi.fn(async()=>({data:{id:'job',status:'ready',manifest:{kind:'table',sheets:[{id:'0',name:'数据',rowCount:500,columnCount:2}]}}}));API.filePreviewRows=vi.fn(async()=>({data:{cells:[{row:0,column:0,text:'<img src=x onerror=evil()>',length:24}]}}));await act(async()=>root.render(<DocumentPreview source={source} fileName="large.xlsx" size={2147483648} loadBlob={loadBlob}/>));expect(loadBlob).not.toHaveBeenCalled();expect(API.filePreviewRows.mock.calls[0][2]).toEqual({row:0,column:0});expect(host.querySelectorAll('tbody tr')).toHaveLength(200);expect(host.querySelector('td img')).toBeNull();expect(host.textContent).toContain('<img src=x');});
it('uses the server index to locate large converted documents without scanning all pages in the browser',async()=>{API.createFilePreview=vi.fn(async()=>({data:{id:'job',status:'ready',manifest:{kind:'pdf',pageCount:5000}}}));API.filePreviewUrl=()=>'/preview/content';API.filePreviewLocate=vi.fn(async()=>({data:{pages:[3000]}}));await act(async()=>root.render(<DocumentPreview source={source} fileName="large.docx" size={2147483648} request={{locators:[],quotes:['unique passage']}} loadBlob={vi.fn()}/>));await vi.waitFor(()=>expect(render).toHaveBeenCalled());expect(render.mock.calls[0][2].remoteUrl).toBe('/preview/content');expect(render.mock.calls[0][2].request.pdfResolution.targets[0].page).toBe(3000);});
it('ignores a late file response after switching to another version',async()=>{let finish;const loadBlob=vi.fn(()=>new Promise(r=>finish=r));await act(async()=>root.render(<DocumentPreview source={source} fileName="old.md" size={10} loadBlob={loadBlob}/>));await act(async()=>root.render(<DocumentPreview source={{...source,version:2}} fileName="new.md" size={10} loadBlob={async()=>new Blob(['# current'])}/>));await act(async()=>finish(new Blob(['# stale'])));expect(host.textContent).toContain('current');expect(host.textContent).not.toContain('stale');});
it('preserves scoped Wiki actions in knowledge original Markdown',async()=>{const onWiki=vi.fn();await act(async()=>root.render(<DocumentPreview source={source} fileName="source.md" renderMarkdown={renderKnowledgeMarkdown} onWiki={onWiki} size={30} loadBlob={async()=>new Blob(['[[entity/pump|水泵]]'])}/>));const link=host.querySelector('[data-wiki-page]');expect(link).not.toBeNull();await act(async()=>link.click());expect(onWiki).toHaveBeenCalledWith('entity/pump','水泵');});
it('never buffers a large unknown file before a controlled backend decision',async()=>{const loadBlob=vi.fn();API.createFilePreview=vi.fn(async()=>{throw Error('此格式不支持后台预览');});await act(async()=>root.render(<DocumentPreview source={source} fileName="large.unknown" size={2147483648} loadBlob={loadBlob}/>));expect(loadBlob).not.toHaveBeenCalled();expect(host.textContent).toContain('不支持后台预览');});
