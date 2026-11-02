import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KnowledgeControls, KnowledgeSelect } from './KnowledgeControls.jsx';
import { GalleryFilters } from './GalleryFilters.jsx';
import { Search, FileText, BookOpen, RefreshCw, ArrowUpRight, Images } from 'lucide-react';
import { knowledgeHref } from './routes.js';
import { SourceReader, knowledgeTransport } from './SourceReader.jsx';
import './reader.css';
import { loadGalleryMedia } from './mediaQueue.js';
import { GraphView } from './GraphWorkspace.jsx';
import { WikiWorkspace } from './WikiWorkspace.jsx';
import { DocumentPanel } from './DocumentPanel.jsx';
import './workspaces.css';
export { GraphView } from './GraphWorkspace.jsx';

const tabs=[['search','检索'],['document','原文'],['wiki','Wiki'],['graph','图谱'],['gallery','图片']];
const sectionCopy={search:['知识检索','输入问题或关键词，找到知识库中的内容并核验来源。'],document:['原文资料','浏览已接入的文档，打开原文件或阅读解析正文。'],wiki:['Wiki','按目录阅读知识页面，查看页面链接与来源。'],graph:['知识图谱','探索资料中的实体与关联，查看每条关系的来源。'],gallery:['图片','查找资料中的图片，阅读图片描述与识别文字。']};
const titleOf=item=>item.title||item.name||item.id;
export function mountKnowledgeExplorer(element, reference, read, life) {
  const root=createRoot(element);root.render(<KnowledgeExplorer reference={reference} read={read} parentSignal={life.signal}/>);life.cleanup(()=>root.unmount());
}

export function openKnowledgeExplorer(reference, read, valid=()=>true) {
  if(valid())location.hash=knowledgeHref(reference);
}

function AssetImage({ item, transport, parentSignal }) {
  const [url,setUrl]=useState(''),[error,setError]=useState('');
  useEffect(()=>{const abort=new AbortController();const stop=()=>abort.abort();parentSignal?.addEventListener('abort',stop,{once:true});let url;setError('');
    loadGalleryMedia(()=>transport.binary('media',{documentId:item.documentId,chunkId:item.chunkId,imageId:item.id,sourceRefId:item.citation?.sourceRefId,fileVersionId:item.citation?.fileVersionId,parseVersionId:item.citation?.parseVersionId},abort.signal),abort.signal).then(blob=>{if(!abort.signal.aborted){url=URL.createObjectURL(blob);setUrl(url);}}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return()=>{abort.abort();parentSignal?.removeEventListener('abort',stop);if(url)URL.revokeObjectURL(url);};
  },[item,transport,parentSignal]);
  return url?<img src={url} alt={item.caption||item.title} loading="lazy"/>:<p role="status">{error||'正在读取图片…'}</p>;
}

export function KnowledgeExplorer(props) {
  return <KnowledgeControls><KnowledgeExplorerContent {...props}/></KnowledgeControls>;
}

function KnowledgeExplorerContent({reference,read,parentSignal,pageLayout=false,hideTabs=false}) {
  const transport=useMemo(()=>knowledgeTransport(reference,read),[reference,read]);
  const [tab,setTab]=useState(reference.initialMode||'search'),[query,setQuery]=useState(''),[submitted,setSubmitted]=useState(''),[kind,setKind]=useState(reference.contentKind||'document');
  const [page,setPage]=useState(1),[data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[caps,setCaps]=useState(null);
  const [source,setSource]=useState(reference.initialDocumentId?{documentId:reference.initialDocumentId,title:reference.name,contentKind:reference.contentKind||'document',preferText:reference.driver==='nebulae-v1-http'}:null);
  const [graph,setGraph]=useState({mode:'overview'}),[filters,setFilters]=useState({}),[sort,setSort]=useState(''),[order,setOrder]=useState('desc'),[documentIds,setDocumentIds]=useState([]),[sourceDocs,setSourceDocs]=useState([]),[sourceQuery,setSourceQuery]=useState(''),[sourcePage,setSourcePage]=useState(1),[sourceHasMore,setSourceHasMore]=useState(false),[searchIn,setSearchIn]=useState([]),[revision,setRevision]=useState(0);
  const [wikiMode,setWikiMode]=useState('pages'),[folder,setFolder]=useState(''),[folders,setFolders]=useState(null);const kindEdited=useRef(false),galleryConfig=useRef(null);
  const [graphKind,setGraphKind]=useState(pageLayout?'wiki':'entity'),[expandedDocument,setExpandedDocument]=useState(false),[wikiGraphSelection,setWikiGraphSelection]=useState(null);
  useEffect(()=>{
    const abort=new AbortController(),stop=()=>abort.abort();parentSignal?.addEventListener('abort',stop,{once:true});if(parentSignal?.aborted)abort.abort();
    transport.read({operation:'capabilities'},abort.signal).then(result=>{
      if(abort.signal.aborted)return;setCaps(result);
      if(!kindEdited.current&&!reference.contentKind&&['document','faq','wiki'].includes(result.type))setKind(result.type);
    }).catch(e=>{if(!abort.signal.aborted)setError(e.message);});
    return()=>{abort.abort();parentSignal?.removeEventListener('abort',stop);};
  },[transport,parentSignal,reference.contentKind]);
  useEffect(()=>{if(pageLayout||tab!=='wiki'||wikiMode!=='pages')return;const abort=new AbortController();transport.read({operation:'wiki.folders',parent_id:folder},abort.signal).then(result=>{if(!abort.signal.aborted)setFolders(result);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});const stop=()=>abort.abort();parentSignal?.addEventListener('abort',stop,{once:true});return()=>{abort.abort();parentSignal?.removeEventListener('abort',stop);};},[tab,folder,wikiMode,transport,parentSignal,pageLayout]);
  useEffect(()=>{
    const abort=new AbortController(),stop=()=>abort.abort();parentSignal?.addEventListener('abort',stop,{once:true});if(parentSignal?.aborted)abort.abort();setData(null);setError('');
    if(pageLayout&&tab==='wiki'&&wikiMode==='pages'){setLoading(false);return()=>{abort.abort();parentSignal?.removeEventListener('abort',stop);};}
    if(tab==='search'&&!submitted){setLoading(false);return()=>{abort.abort();parentSignal?.removeEventListener('abort',stop);};}
    setLoading(true);
    const operation=tab==='search'?'search':tab==='document'?'documents':tab==='graph'&&graphKind==='wiki'?'wiki.graph':tab==='wiki'?wikiMode==='graph'?'wiki.graph':submitted?'search':'documents':tab;
    const payload={operation,page,pageSize:20,...(tab==='search'||tab==='wiki'||tab==='document'?{contentKind:tab==='wiki'?'wiki':tab==='document'?'document':kind}:{}),...(submitted?{query:submitted}:{}),...(tab==='wiki'?{folder_id:folder}:{}),...(tab==='graph'?graph:{}),...(tab==='gallery'?{attrFilters:filters,sortBy:sort||undefined,sortOrder:order,documentIds:documentIds.length?documentIds:undefined,searchIn:searchIn.length?searchIn:undefined}:{})};
    transport.read(payload,abort.signal).then(result=>{if(!abort.signal.aborted){if(tab==='gallery'&&result.config)galleryConfig.current={transport,value:result.config};setData(result);}}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});
    return()=>{abort.abort();parentSignal?.removeEventListener('abort',stop);};
  },[tab,submitted,page,kind,graph,filters,sort,order,documentIds,searchIn,wikiMode,folder,revision,transport,parentSignal,pageLayout,graphKind]);
  useEffect(()=>{
    if(tab!=='gallery')return;const abort=new AbortController();const stop=()=>abort.abort();parentSignal?.addEventListener('abort',stop,{once:true});
    const timer=setTimeout(()=>transport.read({operation:'documents',contentKind:'document',query:sourceQuery,page:sourcePage,pageSize:20},abort.signal).then(result=>{if(!abort.signal.aborted){setSourceDocs(old=>{const chosen=old.filter(d=>documentIds.includes(d.id));const all=[...chosen,...(sourcePage>1?old:[]),...(result.documents||[])];return [...new Map(all.map(d=>[d.id,d])).values()];});setSourceHasMore(!!result.hasMore);}}).catch(e=>{if(!abort.signal.aborted)setError(e.message);}),200);
    return()=>{clearTimeout(timer);abort.abort();parentSignal?.removeEventListener('abort',stop);};
  },[tab,sourceQuery,sourcePage,transport,parentSignal]);
  const switchTab=value=>{setTab(value);setPage(1);setQuery('');setSubmitted('');setSource(null);setError('');};
  const navigate=value=>setSource({...value,preferText:caps?.capabilities?.preview?.supported===false});
  useEffect(()=>{if(!source||!pageLayout)return;const close=e=>{if(e.key==='Escape'){setSource(null);setExpandedDocument(false);}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close);},[source,pageLayout]);
  const documentLayout=pageLayout&&tab==='document';
  const originalPanel=source&&<DocumentPanel source={source} transport={transport} parentSignal={parentSignal} onNavigate={navigate} onClose={()=>{setSource(null);setExpandedDocument(false);}} expanded={expandedDocument} onExpand={()=>setExpandedDocument(!expandedDocument)}/>;
  if(pageLayout&&tab==='wiki'&&wikiMode==='pages')return <div className={`kw-wiki-with-document ${source&&source.contentKind!=='wiki'?'has-document':''} ${expandedDocument?'document-expanded':''}`}><WikiWorkspace transport={transport} parentSignal={parentSignal} initialSource={source?.contentKind==='wiki'?source:undefined} onSelection={()=>setSource(null)} onSource={navigate} onGraph={value=>{setWikiGraphSelection(value.documentId);setWikiMode('graph');setSource(null);}}/>{source&&source.contentKind!=='wiki'&&originalPanel}</div>;
  if(source&&!documentLayout&&!(pageLayout&&(tab==='graph'||tab==='wiki')))return <div className={`knowledge-explorer ${pageLayout?'knowledge-explorer-page knowledge-detail-reader':''}`}><div className="knowledge-reader-back"><button onClick={()=>setSource(null)}>返回{tab==='search'?'检索结果':tab==='gallery'?'图片列表':tab==='wiki'?'Wiki':'图谱'}</button></div><SourceReader key={source.documentId+':'+(source.chunkId||'')+':'+(source.imageId||'')} source={source} transport={transport} parentSignal={parentSignal} onNavigate={navigate} presentation={source.contentKind==='wiki'?'wiki':undefined}/></div>;
  if(pageLayout&&(tab==='graph'||tab==='wiki'&&wikiMode==='graph'))return <div className={`knowledge-explorer kw-graph-page ${source?'has-original-panel':''} ${expandedDocument?'document-expanded':''}`}><div className="kw-graph-page-toolbar">{tab==='wiki'?<button onClick={()=>setWikiMode('pages')}>返回 Wiki 目录</button>:<div className="kw-view-switch" aria-label="关系图类型"><button className={graphKind==='wiki'?'selected':''} onClick={()=>setGraphKind('wiki')}>Wiki 页面关系</button><button className={graphKind==='entity'?'selected':''} onClick={()=>setGraphKind('entity')}>实体知识图谱</button></div>}{tab==='graph'&&graphKind==='entity'&&<form onSubmit={e=>{e.preventDefault();setSubmitted(query.trim());setGraph({mode:query.trim()?'query':'overview'});setRevision(r=>r+1);}}><input aria-label="从知识库查询实体" placeholder="从知识库查询实体…" value={query} onChange={e=>setQuery(e.target.value)}/><button>查询</button></form>}<button className="kw-icon-button" aria-label="刷新关系图" onClick={()=>setRevision(r=>r+1)}><RefreshCw size={16}/></button></div>{error&&<p role="alert" className="knowledge-error">{error}</p>}{loading&&<p role="status">正在读取关系图…</p>}{data&&<GraphView data={data} initialSelection={tab==='wiki'?wikiGraphSelection:null} wiki={tab==='wiki'||graphKind==='wiki'} transport={transport} parentSignal={parentSignal} onSource={navigate} onPage={value=>{location.hash=knowledgeHref({...reference,initialDocumentId:value.documentId,contentKind:'wiki'},{tab:'wiki',from:new URLSearchParams(location.hash.split('?')[1]||'').get('from')});}} onExpand={node=>{setSubmitted('');setQuery('');setGraph({mode:'expand',nodeId:node.id});}}/>}{source&&originalPanel}</div>;
  const rows=data?.results||data?.documents||[];
  const attrs=(data?.config||(galleryConfig.current?.transport===transport?galleryConfig.current.value:null))?.attributes||[];
  const ContentWrapper=documentLayout?'div':React.Fragment;
  return <section className={`knowledge-explorer ${pageLayout?'knowledge-explorer-page':''} ${documentLayout?'kw-document-workspace':''} ${tab==='gallery'?'knowledge-images-page':''} ${source&&documentLayout?'has-document':''} ${expandedDocument?'document-expanded':''}`}><ContentWrapper {...(documentLayout?{className:'kw-document-list'}:{})}>
    {!hideTabs&&<nav className="knowledge-explorer-tabs" aria-label="知识库内容类型">{tabs.map(([value,label])=><button key={value} className={tab===value?'selected':''} onClick={()=>switchTab(value)}>{label}{caps?.capabilities?.[value]?.enabled===false?' · 未开启':''}</button>)}</nav>}
    {pageLayout&&<div className="knowledge-section-heading"><div><h2>{sectionCopy[tab][0]}</h2><p>{sectionCopy[tab][1]}</p></div></div>}
    {caps?.capabilities?.[tab]?.enabled===false&&<p className="knowledge-note">此库未开启该能力的新内容生成，已有内容仍可浏览。</p>}
    <form className="knowledge-explorer-toolbar" onSubmit={e=>{e.preventDefault();setPage(1);setSubmitted(query.trim());if(tab==='graph')setGraph({mode:query.trim()?'query':'overview'});setRevision(v=>v+1);}}>
      <label className="knowledge-query-field"><span>{tab==='graph'?'实体名称':'关键词'}</span><span className="knowledge-query-input"><Search size={16}/><input value={query} maxLength={8000} onChange={e=>setQuery(e.target.value)} placeholder={tab==='search'?'输入问题或关键词':tab==='graph'?'搜索实体名称':tab==='gallery'?'搜索图片描述或文字':tab==='wiki'?'搜索 Wiki 页面':'搜索原文名称'}/></span></label>
      {tab==='search'&&<label className="knowledge-query-kind"><span>检索范围</span><KnowledgeSelect aria-label="检索范围" value={kind} options={[{value:"document",label:"文档"},{value:"wiki",label:"Wiki"},...(reference.driver==='nebulae-v101-rest'?[]:[{value:"faq",label:"问答"}])]} onChange={value=>{kindEdited.current=true;setKind(value);}}/></label>}
      <button type="submit" className="knowledge-query-submit" disabled={loading}>{loading?'读取中…':tab==='search'?'检索':'查找'}</button>
      {tab!=='search'&&<button type="button" className="knowledge-query-refresh" aria-label="刷新当前内容" onClick={()=>setRevision(v=>v+1)} disabled={loading}><RefreshCw size={16}/></button>}
    </form>
    {tab==='wiki'&&<><div className="knowledge-actions knowledge-wiki-switch"><button className={wikiMode==='pages'?'selected':''} onClick={()=>setWikiMode('pages')}>目录与页面</button><button className={wikiMode==='graph'?'selected':''} onClick={()=>setWikiMode('graph')}>页面关系图</button></div>{wikiMode==='pages'&&<nav className="knowledge-wiki-directory" aria-label="Wiki 目录"><strong>页面目录</strong><button onClick={()=>setFolder('')}>全部页面</button>{folder&&<button onClick={()=>setFolder(folders?.parent_id||'')}>上级目录</button>}{(folders?.folders||[]).map(item=><button key={item.id} onClick={()=>{setFolder(item.id);setPage(1);setSubmitted('');}}>{item.name}</button>)}</nav>}</>}
    {tab==='gallery'&&<GalleryFilters supportsSorting={reference.driver!=='nebulae-v101-rest'} attributes={attrs} documents={sourceDocs} sourceHasMore={sourceHasMore} onMoreSources={()=>setSourcePage(p=>p+1)} onSourceSearch={value=>{setSourceQuery(value);setSourcePage(1);}} documentIds={documentIds} filters={filters} sort={sort} order={order} searchIn={searchIn} onChange={update=>{if('documentIds' in update)setDocumentIds(update.documentIds);if('filters' in update)setFilters(update.filters);if('sort' in update)setSort(update.sort);if('order' in update)setOrder(update.order);if('searchIn' in update)setSearchIn(update.searchIn);setPage(1);}} onReset={()=>{setDocumentIds([]);setFilters({});setSort('');setOrder('desc');setSearchIn([]);setPage(1);}}/>}
    {error&&<p className="knowledge-error" role="alert">{error}</p>}{loading&&<p role="status">正在读取内容…</p>}
    <div className="knowledge-explorer-results">
      {data?.partial&&<p className="knowledge-warning">本次结果不完整</p>}{(data?.warnings||[]).map((w,i)=><p className="knowledge-warning" key={i}>{typeof w==='string'?w:w.message}</p>)}
      {data&&(tab==='graph'||tab==='wiki'&&wikiMode==='graph')?<GraphView data={data} wiki={tab==='wiki'} transport={transport} parentSignal={parentSignal} onSource={navigate} onPage={navigate} onExpand={node=>{setSubmitted('');setQuery('');setGraph({mode:'expand',nodeId:node.id});}}/>:
      tab==='gallery'?<div className="knowledge-gallery">{(data?.items||[]).map(item=><article key={item.id}><AssetImage item={item} transport={transport} parentSignal={parentSignal}/><h4>{item.title}</h4><p>{item.caption||'暂无图片描述'}</p>{item.enabled===false&&<p className="dim">未参与检索</p>}{item.ocrText&&<details><summary>OCR 文本</summary><p>{item.ocrText}</p></details>}<button onClick={()=>navigate({...item.citation,text:item.caption,imageId:item.id,sourceKind:'image'})}>查看大图</button><button onClick={()=>navigate({...item.citation,text:item.ocrText||item.caption,imageId:item.id,preferOriginal:true})}>核验来源</button></article>)}</div>:
      rows.map((item,i)=>{const c=item.citation||{documentId:item.id,title:titleOf(item),contentKind:item.contentKind||(tab==='wiki'?'wiki':'document')};const RowIcon=c.contentKind==='wiki'?BookOpen:FileText;return <article className={`knowledge-explorer-row ${item.citation?'knowledge-search-result':''} ${source?.documentId===c.documentId?'active':''}`} key={c.chunkId||c.documentId||i}><span className="knowledge-result-icon"><RowIcon size={20}/></span><div className="knowledge-result-copy"><div className="knowledge-result-title"><strong>{c.title||titleOf(item)}</strong><small>{c.contentKind==='wiki'?'Wiki':item.fileName?.split('.').pop()?.toUpperCase()||'文档'}</small></div>{item.folderPath&&<p className="dim">{item.folderPath}/{item.fileName}</p>}{item.text&&<p className="knowledge-result-excerpt">{item.text}</p>}<div className="knowledge-actions"><button onClick={()=>navigate({...c,text:item.text})}>{item.citation?'查看原文并定位':'阅读'}<ArrowUpRight size={13}/></button></div></div></article>;})}
      {data&&!loading&&!rows.length&&!data.nodes?.length&&!data.items?.length&&!(tab==='wiki'&&wikiMode==='graph')&&tab!=='graph'&&<div className="knowledge-page-empty">{tab==='gallery'?<Images size={28}/>:<FileText size={28}/>}<h3>{tab==='gallery'?'暂无图片':'暂无可见内容'}</h3><p>{tab==='gallery'?'尝试调整关键词或筛选条件，查找相关图片。':'尝试其他关键词，或稍后刷新资料列表。'}</p></div>}
      {!data&&!loading&&!error&&tab==='search'&&<div className="knowledge-page-empty"><Search size={28}/><h3>从一个问题开始</h3><p>输入问题或关键词，检索相关资料。</p><small>打开检索结果，可查看原文与命中位置。</small></div>}
    </div>
    {data&&(rows.length>0||data.items?.length>0||page>1)&&tab!=='graph'&&!(tab==='wiki'&&wikiMode==='graph')&&tab!=='search'&&<div className="knowledge-actions knowledge-pagination"><button disabled={loading||page===1} onClick={()=>setPage(p=>p-1)}>上一页</button><span>第 {page} 页{data.total!=null?` · 共 ${data.total} 条`:''}</span><button disabled={loading||!data.hasMore} onClick={()=>setPage(p=>p+1)}>下一页</button></div>}
  </ContentWrapper>{documentLayout&&source&&originalPanel}</section>;
}
