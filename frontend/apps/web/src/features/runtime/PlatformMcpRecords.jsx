import React,{useEffect,useRef,useState} from 'react';
import {authSession} from '../../services/authSession.js';

export function PlatformMcpRecords(){
  const [items,setItems]=useState(null),[error,setError]=useState(''),[page,setPage]=useState(0);
  useEffect(()=>{const abort=new AbortController(),version=authSession.getSnapshot().version;setItems(null);setError('');const unsubscribe=authSession.subscribe(()=>{if(authSession.getSnapshot().version!==version){abort.abort();setItems(null);}});API.fetchPlatformMcpOperations(abort.signal,page*50).then(r=>{if(!abort.signal.aborted)setItems(r.data);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>{abort.abort();unsubscribe();};},[page]);
  return <div className="platform-mcp-records"><h3>本人调用记录</h3>{error&&<p role="alert">{error}</p>}{items===null&&!error?<p className="dim">正在读取…</p>:items?.length?<>{items.map(r=><div className="platform-mcp-record" key={r.id}><code>{r.tool_name}</code><span>{({started:'处理中',completed:'已完成',unknown:'结果待核对',failed:'失败'})[r.state]||r.state}</span><small>{r.id}</small>{r.error_message&&<span>{r.error_message}</span>}</div>)}</>:items&&<p className="dim">暂无调用记录。</p>}<div className="platform-mcp-toolbar"><button className="btn btn-ghost btn-sm" disabled={!page} onClick={()=>setPage(p=>p-1)}>上一页</button><button className="btn btn-ghost btn-sm" disabled={!items||items.length<50} onClick={()=>setPage(p=>p+1)}>下一页</button></div></div>;
}
export function platformOperationId(tool){let visited=0;const find=value=>{if(++visited>10000)return null;if(typeof value==='string'&&value.length<1048576){try{return find(JSON.parse(value));}catch{return null;}}if(!value||typeof value!=='object')return null;if(/^pmc-[a-f0-9]{40}$/.test(value.operationId||''))return value.operationId;for(const v of Object.values(value)){const id=find(v);if(id)return id;}return null;};return find(tool.result)||find(tool.output);}
export function PlatformMcpOperationButton({tool}){
  const id=platformOperationId(tool),[record,setRecord]=useState(null),[error,setError]=useState(''),abort=useRef(null);
  useEffect(()=>{const unsubscribe=authSession.subscribe(()=>{abort.current?.abort();setRecord(null);});return()=>{abort.current?.abort();unsubscribe();};},[]);
  if(!id)return null;
  return <div><button className="btn btn-ghost btn-sm" onClick={async()=>{abort.current?.abort();abort.current=new AbortController();const signal=abort.current.signal;try{setError('');const result=await API.fetchPlatformMcpOperation(id,signal);if(!signal.aborted)setRecord(result.data);}catch(e){if(!signal.aborted)setError(e.message);}}}>查看系统调用记录</button>{record&&<dl><dt>操作编号</dt><dd>{record.id}</dd><dt>状态</dt><dd>{record.state}</dd>{record.error_message&&<><dt>业务说明</dt><dd>{record.error_message}</dd></>}</dl>}{error&&<p role="alert">{error}</p>}</div>;
}
