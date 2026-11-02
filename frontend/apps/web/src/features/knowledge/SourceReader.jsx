import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DocumentPreview } from '../files/DocumentPreview.jsx';
import { createRoot } from 'react-dom/client';
import { renderKnowledgeMarkdown, wikiPageLabels, wikiBodyText } from './markdown.js';
import { knowledgeModal } from './lifecycle.js';
import { parseSourceLocators, sourceQuoteText } from './source/sourceLocator';
import { GitBranch, Clock, Link as LinkIcon } from 'lucide-react';
import './reader.css';

export function knowledgeTransport(reference, read) {
  const scoped = reference.scopeKind && reference.scopeId && reference.id;
  return {
    driver: reference.driver,
    read: async (payload, signal) => (await read(payload, signal)).data,
    fileSource: (documentId, version = {}) => ({kind:'knowledge',documentId,...Object.fromEntries(['sourceRefId','fileVersionId','parseVersionId'].filter(k=>version[k]).map(k=>[k,version[k]])),...scoped?{scopeKind:reference.scopeKind,scopeId:reference.scopeId,referenceId:reference.id}:{scopeKind:'catalog',connectionId:reference.connectionId,collectionId:reference.collectionId}}),
    binary: async (action, payload, signal) => (await (scoped
      ? API.knowledgeReferenceContent(reference.scopeKind, reference.scopeId, reference.id, action, payload, signal)
      : API.knowledgeCatalogContent(reference.connectionId, reference.collectionId, action, payload, signal))).data,
  };
}

export function evidenceTransport(taskId, evidenceId) {
  return {
    fileSource: () => ({kind:'evidence',taskId,evidenceId}),
    read: async (payload, signal) => (await API.readKnowledgeEvidence(taskId, evidenceId, { page: payload.page || 1 }, signal)).data,
    binary: async (action, payload, signal) => (await API.knowledgeEvidenceContent(taskId, evidenceId, action, { download: !!payload.download }, signal)).data,
  };
}

export function openKnowledgeSource(source, transport, valid = () => true) {
  knowledgeModal('来源 · ' + (source.title || source.documentId || '原文'), '<div data-source-reader></div><div class="modal-foot"><button class="btn btn-ghost" data-close>关闭</button></div>', valid, ctx => {
    ctx.box.classList.add('knowledge-reader-modal');
    const root = createRoot(ctx.box.querySelector('[data-source-reader]'));
    root.render(<SourceNavigator source={source} transport={transport} parentSignal={ctx.signal} />);
    ctx.cleanup(() => { root.unmount(); ctx.box.classList.remove('knowledge-reader-modal'); });
  });
}

export async function openTaskEvidence(taskId, id, valid = () => true) {
  knowledgeModal('引用依据', '<div data-source-reader>正在读取引用依据…</div><div class="modal-foot"><button class="btn btn-ghost" data-close>关闭</button></div>', valid, async ctx => {
    ctx.box.classList.add('knowledge-reader-modal');let root;
    ctx.cleanup(() => { root?.unmount(); ctx.box.classList.remove('knowledge-reader-modal'); });
    try {
      const { data } = await API.fetchKnowledgeEvidence(taskId, id, ctx.signal);if (!ctx.live()) return;
      root = createRoot(ctx.box.querySelector('[data-source-reader]'));
      const nav=data.navigation;
      const navigationTransport=nav?.scopeKind&&nav.scopeId&&nav.id?knowledgeTransport(nav,(payload,signal)=>API.readKnowledgeReference(nav.scopeKind,nav.scopeId,nav.id,payload,signal)):nav?.connectionId&&nav.collectionId?knowledgeTransport(nav,(payload,signal)=>API.readKnowledgeCatalog(nav.connectionId,nav.collectionId,payload,signal)):null;
      root.render(<SourceNavigator source={{ ...data.citation, text: data.text, imageId: data.imageId, sourceKind: data.sourceKind, fileName: data.fileName, fileType: data.fileType, sourceHash: data.sourceHash }} transport={evidenceTransport(taskId, id)} navigationTransport={navigationTransport} parentSignal={ctx.signal} />);
    } catch (error) { if (ctx.live() && error.name !== 'AbortError') ctx.error(error); }
  });
}

// Evidence reads stay pinned to the saved handle. Following a Wiki link uses
// the currently authorized reference transport and its normal ownership guards.
export function SourceNavigator({source,transport,navigationTransport=transport,parentSignal}) {
  const [next,setNext]=useState(null);
  return <>{next&&<button onClick={()=>setNext(null)}>返回引用依据</button>}<SourceReader key={next?`${next.documentId}:${next.contentKind}`:'initial'} source={next||source} transport={next?navigationTransport:transport} parentSignal={parentSignal} onNavigate={navigationTransport?setNext:undefined}/></>;
}

const msg = {
  precise: '已定位并高亮命中内容', structural: '已定位到来源区域', partial: '已定位部分内容，映射不完整',
  missing: '原文件中未找到唯一对应位置，可继续阅读正文', ambiguous: '原文存在重复内容，无法确定唯一位置',
  unavailable: '来源已修改或版本不一致，未使用旧定位', none: '此内容没有原文件定位信息',
};
const readerMode = source => source.preferText || ['wiki','faq'].includes(source.contentKind) ? 'text' : source.imageId && !source.preferOriginal ? 'image' : 'original';

export function SourceReader({ source, transport, parentSignal, onNavigate, presentation, onGraph }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [page, setPage] = useState(1);
  const [mode, setMode] = useState(() => readerMode(source));
  const [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const life = useRef(null);
  useEffect(() => {
    const abort = new AbortController();life.current = abort;const stop = () => abort.abort();parentSignal?.addEventListener('abort', stop, { once: true });if(parentSignal?.aborted)abort.abort();
    setData(null);setError('');setPage(1);setMode(readerMode(source));
    return () => { abort.abort();parentSignal?.removeEventListener('abort', stop); };
  }, [source, transport, parentSignal]);
  useEffect(() => {
    const abort = new AbortController();const stop = () => abort.abort();life.current?.signal.addEventListener('abort', stop, { once: true });setError('');setData(null);
    transport.read({ operation: (source.chunkId || source.sourceRefId) && source.contentKind !== 'wiki' ? 'chunk' : 'document', documentId: source.documentId, chunkId: source.chunkId || undefined, sourceRefId: source.sourceRefId, fileVersionId:source.fileVersionId, parseVersionId:source.parseVersionId, contentKind: source.contentKind || 'document', page, pageSize: 20 }, abort.signal)
      .then(result => { if (!abort.signal.aborted) setData(result); }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => { abort.abort();life.current?.signal.removeEventListener('abort',stop); };
  }, [source, transport, page]);
  const locateRequest=useMemo(()=>{
    const doc=data?.document||{};
    const locators=parseSourceLocators(source.sourceLocators?.length ? source.sourceLocators : data?.citation?.sourceLocators || data?.chunk?.source_locators);
    return {locators, quotes:[source.text || data?.chunk?.content || ''].map(sourceQuoteText).filter(Boolean), scope:sourceQuoteText(source.text || data?.chunk?.content || ''), sourceMarkdown:source.text || data?.chunk?.content || '', unavailable: data?.chunk?.content_revision > 0 || !!(source.sourceHash&&doc.sourceHash&&source.sourceHash!==doc.sourceHash) || locators.some(l=>l.source_hash && doc.sourceHash && l.source_hash!==doc.sourceHash), imageDigest:data?.imageDigest};
  },[source,data]);
  const doc = data?.document || {}, chunks = data?.chunks || [];
  const download = async () => {
    setBusy(true);setError('');try {if(doc.fileSize>20*1024*1024&&transport.fileSource&&API.createFileDownload){const result=await API.createFileDownload(transport.fileSource(source.documentId, {...doc,...source}),life.current.signal);if(life.current.signal.aborted)return;const a=document.createElement('a');a.href=API.filePreviewDownloadUrl(result.data.id);a.download=doc.fileName||source.fileName||'document';a.click();return;}const b=await transport.binary('preview',{documentId:source.documentId,download:true,sourceRefId:source.sourceRefId,fileVersionId:source.fileVersionId,parseVersionId:source.parseVersionId},life.current.signal);if(life.current.signal.aborted)return;const url=URL.createObjectURL(b),a=document.createElement('a');a.href=url;a.download=doc.fileName||source.fileName||doc.title||source.title||'document';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){if(!life.current.signal.aborted)setError(e.message);}finally{if(!life.current.signal.aborted)setBusy(false);}
  };
  const followLink=async event=>{
    const link=event.target.closest('[data-wiki-page],[data-source-ref]');if(!link)return;event.preventDefault();
    if(link.dataset.wikiPage){onNavigate?.({documentId:link.dataset.wikiPage,title:link.textContent,contentKind:'wiki'});return;}
    try{const resolved=await transport.read({operation:'source',sourceRefId:link.dataset.sourceRef},life.current.signal);if(!life.current.signal.aborted)onNavigate?.({...resolved.citation,text:resolved.text});}catch(e){if(!life.current.signal.aborted)setError(e.message);}
  };
  const pageLabels=wikiPageLabels(doc.extractedText);
  const pageTitle=slug=>slug.includes('|')?slug.split('|').slice(1).join('|'):doc.inLinkTitles&&Object.hasOwn(doc.inLinkTitles,slug)?doc.inLinkTitles[slug]:pageLabels[slug]||slug;
  const links = value => Array.isArray(value) ? value : [];
  const wikiLinks=(values,sourceLinks=false)=>links(values).map(raw=>{
    const [id,...parts]=String(raw).split('|'), info=sourceLinks?(doc.sources||[]).find(d=>d.documentId===id.trim()):null;
    const title=parts.join('|')||info?.title||pageTitle(id);
    return <button key={raw} disabled={info?.available===false} onClick={()=>onNavigate?.({...info,documentId:id.trim(),title,contentKind:sourceLinks?'document':'wiki'})}>{title}{info?.available===false?' · 已不可用':''}</button>;
  });
  if(presentation==='wiki')return <article className="kw-wiki-article">
    {error&&<p className="knowledge-error" role="alert">{error}</p>}{!data&&!error&&<p role="status">正在读取知识页面…</p>}
    {data&&<><header className="kw-wiki-article-header"><div><h1>{doc.title||source.title||source.documentId}</h1><div className="kw-wiki-page-meta"><span className={`kw-type-tag kw-type-${doc.pageType||source.pageType||'wiki'}`}>{({entity:'实体',concept:'概念',summary:'摘要',synthesis:'综合',comparison:'对比',index:'索引'})[doc.pageType||source.pageType]||'Wiki'}</span>{doc.version!=null&&<span className="kw-meta-chip">v{doc.version}</span>}{links(doc.aliases).map(alias=><span className="kw-meta-chip" key={alias}><LinkIcon size={12}/>{alias}</span>)}</div></div>{onGraph&&<button className="kw-icon-button" aria-label="查看页面关系图" onClick={onGraph}><GitBranch size={17}/></button>}</header>
      {doc.updatedAt&&<p className="kw-wiki-updated"><Clock size={13}/>{new Date(doc.updatedAt).toLocaleString()}</p>}{doc.summary&&<p className="kw-wiki-summary">{doc.summary}</p>}
      <div className="task-markdown kw-wiki-body" onClick={followLink} dangerouslySetInnerHTML={{__html:renderKnowledgeMarkdown(wikiBodyText(doc.extractedText,doc.title||source.title)||'暂无正文')}}/>
      {onNavigate&&<footer className="kw-wiki-links">{links(doc.inLinks).length>0&&<div><span>被链接</span><nav>{wikiLinks(doc.inLinks)}</nav></div>}{links(doc.outLinks).length>0&&<div><span>相关页面</span><nav>{wikiLinks(doc.outLinks)}</nav></div>}{links(doc.sourceRefs).length>0&&<div><span>来源文档</span><nav>{wikiLinks(doc.sourceRefs,true)}</nav></div>}</footer>}
    </>}
  </article>;
  return <section className="knowledge-reader">
    {presentation==='document'&&data&&<div className="kw-document-info"><section><h3>基本信息</h3><dl><dt>文件名</dt><dd>{doc.fileName||doc.title||source.fileName||source.title}</dd><dt>类型</dt><dd><span className="kw-meta-chip">{(doc.fileType||doc.fileName?.split('.').pop()||source.fileType||'文档').toUpperCase()}</span></dd>{doc.fileSize>0&&<><dt>大小</dt><dd>{doc.fileSize>=1048576?(doc.fileSize/1048576).toFixed(1)+' MB':(doc.fileSize/1024).toFixed(1)+' KB'}</dd></>}{doc.createdAt&&<><dt>上传时间</dt><dd>{new Date(doc.createdAt).toLocaleString()}</dd></>}{doc.folderPath&&<><dt>来源目录</dt><dd>{doc.folderPath}</dd></>}</dl></section>
      <section><h3>自定义元数据</h3>{doc.customMetadata&&Object.keys(doc.customMetadata).length?<dl>{Object.entries(doc.customMetadata).map(([key,value])=><React.Fragment key={key}><dt>{key}</dt><dd>{typeof value==='object'?JSON.stringify(value):String(value)}</dd></React.Fragment>)}</dl>:<p className="dim">{doc.customMetadata?'暂无自定义元数据':'当前接口未提供自定义元数据'}</p>}</section>
      <section><h3>摘要</h3>{doc.summary?<p className="kw-document-summary">{doc.summary}</p>:<p className="dim">{Object.hasOwn(doc,'summary')?'暂无摘要':'当前接口未提供摘要'}</p>}</section></div>}
    <header><div>{presentation==='document'?<h3 className="kw-content-title">文件内容 {data?.total!=null&&<small>共 {data.total} 个片段</small>}</h3>:<><strong>{doc.title||source.title||source.documentId}</strong><small>{doc.folderPath ? `${doc.folderPath}/${doc.fileName||''}` : doc.fileName || source.fileName}</small></>}</div><div className="knowledge-actions">
      {!['wiki','faq'].includes(source.contentKind)&&<button className={mode==='original'?'selected':''} onClick={()=>setMode('original')}>{presentation==='document'?'预览':'原文件'}</button>}
      {source.imageId&&<button className={mode==='image'?'selected':''} onClick={()=>setMode('image')}>原图</button>}
      <button className={mode==='text'?'selected':''} onClick={()=>setMode('text')}>{presentation==='document'?'查看分块':'解析正文'}</button>
      {!['wiki','faq'].includes(source.contentKind)&&<button onClick={download} disabled={busy}>下载</button>}
    </div></header>
    {error&&<p className="knowledge-error" role="alert">{error}</p>}
    {!data&&!error&&<p role="status">正在读取来源…</p>}
    {mode!=='text'&&data&&<div className="knowledge-original" tabIndex={0}><DocumentPreview renderMarkdown={renderKnowledgeMarkdown} onWiki={(documentId,title)=>onNavigate?.({documentId,title,contentKind:"wiki"})} htmlPolicy="source" key={mode} source={transport.fileSource?.(source.documentId, {...doc,...source})} fileName={mode==='image'?'image.png':doc.fileName||source.fileName||source.title} fileType={mode==='image'?'png':doc.fileType||source.fileType} size={mode==='image'?0:doc.fileSize??-1} request={locateRequest} parentSignal={life.current?.signal} onStatus={setStatus} loadBlob={signal=>transport.binary(mode==='image'?'media':'preview',{documentId:source.documentId,chunkId:source.chunkId,imageId:source.imageId,sourceRefId:source.sourceRefId,fileVersionId:source.fileVersionId||doc.fileVersionId,parseVersionId:source.parseVersionId||doc.parseVersionId},signal)}/></div>}
    {mode==='text'&&data&&<div className="knowledge-parsed">
      {source.text&&<blockquote>{source.text}</blockquote>}
      {(chunks.length?chunks:[{id:doc.id,content:doc.extractedText}]).map((chunk,index)=><article key={chunk.id||index} className={chunk.id===source.chunkId?'knowledge-source-hit':''}><small>{chunk.id===source.chunkId?'命中分块':'正文'}{chunk.chunk_index!=null?` · ${chunk.chunk_index+1}`:''}</small><div className="task-markdown" onClick={followLink} dangerouslySetInnerHTML={{__html:renderKnowledgeMarkdown(chunk.content||'暂无正文')}}/></article>)}
      {!source.chunkId&&!source.sourceRefId&&<div className="knowledge-actions"><button disabled={page===1} onClick={()=>setPage(p=>p-1)}>上一页正文</button><span>第 {page} 页</span><button disabled={!data.hasMore} onClick={()=>setPage(p=>p+1)}>下一页正文</button></div>}
      {['wiki','faq'].includes(source.contentKind)&&<p className="dim">{source.contentKind==='wiki'?'Wiki 为整理生成的内容，可通过下方来源核验原文。':'FAQ 为知识库维护的问答内容。'}</p>}
      {onNavigate&&links(doc.sourceRefs).length>0&&<nav aria-label="来源文档"><h4>来源文档</h4>{links(doc.sourceRefs).map(raw=>{const [id,...parts]=String(raw).split('|');const info=(doc.sources||[]).find(d=>d.documentId===id.trim());const title=parts.join('|')||info?.title||'来源文档';return <button key={raw} disabled={info?.available===false} onClick={()=>onNavigate({...info,documentId:id.trim(),title,contentKind:'document'})}>{title}{info?.available===false?' · 已不可用':''}</button>;})}</nav>}
      {onNavigate&&['outLinks','inLinks'].filter(key=>links(doc[key]).length).map(key=><nav key={key} aria-label={key==='outLinks'?'页面链接':'反向链接'}><h4>{key==='outLinks'?'页面链接':'反向链接'}</h4>{links(doc[key]).map(slug=><button key={slug} onClick={()=>onNavigate({documentId:slug.split('|')[0],title:slug.split('|').slice(1).join('|')||pageTitle(slug),contentKind:'wiki'})}>{pageTitle(slug)}</button>)}</nav>)}
    </div>}
  </section>;
}
