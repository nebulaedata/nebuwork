import React, { useEffect, useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronRight, FileText, Folder, List, ListTree, BookOpen } from 'lucide-react';
import { SourceReader } from './SourceReader.jsx';

export const wikiTypes = { summary: '摘要', entity: '实体', concept: '概念', synthesis: '综合', comparison: '对比', index: '索引' };
export function WikiWorkspace({ transport, parentSignal, initialSource, onSource, onGraph, onSelection }) {
  const v101=transport.driver==='nebulae-v101-rest';
  const [branches,setBranches]=useState({}),[expanded,setExpanded]=useState(new Set()),[pages,setPages]=useState([]),[types,setTypes]=useState(new Map());
  const [selected,setSelected]=useState(initialSource||null),[query,setQuery]=useState(''),[group,setGroup]=useState('knowledge'),[flat,setFlat]=useState(false),[page,setPage]=useState(1),[more,setMore]=useState(false),[total,setTotal]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const life=useMemo(()=>new AbortController(),[transport,parentSignal]);
  useEffect(()=>{if(initialSource)setSelected(initialSource);},[initialSource]);
  useEffect(()=>{const stop=()=>life.abort();parentSignal?.addEventListener('abort',stop,{once:true});if(parentSignal?.aborted)stop();return()=>{life.abort();parentSignal?.removeEventListener('abort',stop);};},[life,parentSignal]);
  const loadBranch=async(id='')=>{
    setBranches(old=>({...old,[id]:{...old[id],loading:true,error:''}}));
    try {const [folders,documents]=await Promise.all([transport.read({operation:'wiki.folders',parent_id:id},life.signal),id?transport.read({operation:'documents',contentKind:'wiki',folder_id:id,page:1,pageSize:100},life.signal):Promise.resolve({documents:[]})]);
      if(!life.signal.aborted)setBranches(old=>({...old,[id]:{folders:folders.folders||[],pages:documents.documents||[],hasMore:documents.hasMore,page:1}}));
    }catch(e){if(!life.signal.aborted)setBranches(old=>({...old,[id]:{...old[id],loading:false,error:e.message}}));}
  };
  useEffect(()=>{void loadBranch();transport.read({operation:'wiki.graph'},life.signal).then(d=>{if(!life.signal.aborted)setTypes(new Map((d.nodes||[]).map(n=>[n.slug||n.id,n])));}).catch(()=>{});},[life]);
  useEffect(()=>{const abort=new AbortController(),stop=()=>abort.abort();life.signal.addEventListener('abort',stop,{once:true});if(life.signal.aborted)stop();setBusy(true);setError('');
    const timer=setTimeout(()=>transport.read({operation:query.trim()?'search':'documents',contentKind:'wiki',...(query.trim()?{query:query.trim(),topK:20}:{}),page,pageSize:100},abort.signal).then(d=>{
      if(abort.signal.aborted)return;const rows=d.documents||d.results?.map(r=>({id:r.citation.documentId,title:r.citation.title,text:r.text}))||[];setPages(old=>page===1?rows:[...old,...rows]);setMore(!!d.hasMore);setTotal(d.total??null);
      setSelected(old=>old||rows.length&&{documentId:(rows.find(r=>r.pageType==='index'||r.id==='index')||rows[0]).id,contentKind:'wiki'}||null);
    }).catch(e=>{if(!abort.signal.aborted)setError(e.message);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);}),query?220:0);
    return()=>{clearTimeout(timer);abort.abort();life.signal.removeEventListener('abort',stop);};
  },[life,query,page]);
  const typeOf=item=>item.pageType||types.get(item.id)?.page_type||(item.id==='index'?'index':undefined);
  const matches=item=>group==='summary'?typeOf(item)==='summary':typeOf(item)!=='summary'&&typeOf(item)!=='index';
  const choose=item=>{setSelected({documentId:item.id,title:item.title,contentKind:'wiki',pageType:typeOf(item)});onSelection?.();};
  const pageButton=(item,depth=0)=><button className={`kw-tree-page ${selected?.documentId===item.id?'active':''}`} key={item.id} style={{paddingLeft:14+depth*16}} onClick={()=>choose(item)} title={item.title}><FileText size={14}/><span>{item.title||item.id}</span></button>;
  const folderRows=(id='',depth=0)=>(branches[id]?.folders||[]).map(folder=>{
    const open=expanded.has(folder.id),branch=branches[folder.id];return <div key={folder.id}><button className="kw-tree-folder" style={{paddingLeft:10+depth*16}} aria-expanded={open} onClick={()=>{setExpanded(old=>{const next=new Set(old);open?next.delete(folder.id):next.add(folder.id);return next;});if(!open&&!branch)void loadBranch(folder.id);}}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<Folder size={14}/><span>{folder.name}</span><small>{folder.page_count??''}</small></button>{open&&<div>{branch?.loading&&<small className="kw-tree-status" role="status">正在读取目录…</small>}{branch?.error&&<button className="kw-tree-error" onClick={()=>loadBranch(folder.id)}>读取失败，点击重试</button>}{folderRows(folder.id,depth+1)}{(branch?.pages||[]).filter(matches).map(p=>pageButton(p,depth+1))}{branch?.hasMore&&<button onClick={async()=>{try{const next=await transport.read({operation:'documents',contentKind:'wiki',folder_id:folder.id,page:(branch.page||1)+1,pageSize:100},life.signal);if(!life.signal.aborted)setBranches(old=>({...old,[folder.id]:{...branch,pages:[...branch.pages,...next.documents],hasMore:next.hasMore,page:(branch.page||1)+1}}));}catch(e){if(!life.signal.aborted)setError(e.message);}}}>加载更多页面</button>}</div>}</div>;
  });
  const selectedNode=types.get(selected?.documentId), selectedSource=useMemo(()=>selected?{...selected,pageType:selected.pageType||selectedNode?.page_type}:null,[selected,selectedNode]);
  const index=pages.find(p=>typeOf(p)==='index'||p.id==='index');
  return <section className="knowledge-explorer kw-wiki-workspace">
    <aside className="kw-wiki-sidebar" aria-label="Wiki 页面导航"><label className="kw-sidebar-search"><Search size={16}/><input aria-label="搜索 Wiki 页面" placeholder="搜索 Wiki 页面…" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/></label>
      <button className={`kw-wiki-index ${selected?.documentId===index?.id?'active':''}`} onClick={()=>index?choose(index):setFlat(true)}><BookOpen size={16}/>索引</button>
      <div className="kw-sidebar-tools"><div className="kw-sidebar-tabs"><button className={group==='knowledge'?'active':''} onClick={()=>setGroup('knowledge')}>知识 <small>{types.size?[...types.values()].filter(n=>!['summary','index'].includes(n.page_type)).length:''}</small></button>{!v101&&<button className={group==='summary'?'active':''} onClick={()=>setGroup('summary')}>摘要 <small>{types.size?[...types.values()].filter(n=>n.page_type==='summary').length:''}</small></button>}</div><button className="kw-icon-button" aria-label={flat?'切换目录树':'切换页面列表'} onClick={()=>setFlat(!flat)}>{flat?<ListTree size={17}/>:<List size={17}/>}</button></div>
      <nav className="kw-wiki-tree">{busy&&<p role="status" className="kw-tree-status">正在读取页面…</p>}{error&&<p role="alert" className="knowledge-error">{error}</p>}{branches['']?.error&&<button onClick={()=>loadBranch()}>目录读取失败，点击重试</button>}{query||flat||group==='summary'?pages.filter(matches).map(p=>pageButton(p)):<>{folderRows()}{pages.filter(p=>!(p.folderId||p.folder_id)).filter(matches).map(p=>pageButton(p))}</>}{!busy&&(query||flat)&&!pages.filter(matches).length&&<p className="kw-tree-status">暂无匹配页面</p>}{more&&<button onClick={()=>setPage(p=>p+1)}>加载更多页面{total!=null?` · 共 ${total} 页`:''}</button>}</nav>
    </aside>
    <main className="kw-wiki-main">{selectedSource?<SourceReader key={selectedSource.documentId} source={selectedSource} transport={transport} parentSignal={life.signal} presentation="wiki" onNavigate={value=>value.contentKind==='wiki'?setSelected(value):onSource(value)} onGraph={()=>onGraph?.(selectedSource)}/>:<div className="knowledge-page-empty"><BookOpen size={28}/><h3>选择一个知识页面</h3><p>从左侧目录或搜索结果开始阅读。</p></div>}</main>
  </section>;
}
