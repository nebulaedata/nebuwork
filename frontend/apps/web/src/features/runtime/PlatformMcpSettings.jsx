import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {authSession} from '../../services/authSession.js';
import {PlatformMcpRecords} from './PlatformMcpRecords.jsx';
import './platformMcp.css';
export function PlatformMcpSettings(){
  const [catalog,setCatalog]=useState(null),[error,setError]=useState('');
  useEffect(()=>{const abort=new AbortController(),version=authSession.getSnapshot().version,unsubscribe=authSession.subscribe(()=>{if(authSession.getSnapshot().version!==version){abort.abort();setCatalog(null);}});API.fetchPlatformMcpCatalog(abort.signal).then(r=>{if(!abort.signal.aborted)setCatalog(r.data);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>{abort.abort();unsubscribe();};},[]);
  return <div className="page settings-page"><section className="card platform-mcp-editor"><h3>系统 MCP</h3><p className="dim">系统能力按工作台单独授权，默认关闭。在工作台的运行资源配置中选择工具和数据范围，发布后由新轮次使用。</p><a className="btn btn-ghost btn-sm" href="#/workbench?tab=pro">前往工作台配置</a>{error&&<p role="alert">{error}</p>}{catalog&&<details><summary>已实现工具目录 · {catalog.tools.length} 项 · v{catalog.version}</summary>{catalog.tools.map(t=><details key={t.name} className="platform-mcp-record"><summary>{t.description} · {t.write?'写入 / 执行':'只读'}</summary><code>{t.name}</code><pre>{JSON.stringify(t.inputSchema,null,2)}</pre></details>)}</details>}<PlatformMcpRecords/></section></div>;
}
export function renderPlatformMcpSettings(el){const anchor=document.createElement("div");el.replaceChildren(anchor);const root=createRoot(anchor);root.render(<PlatformMcpSettings/>);const observer=new MutationObserver(()=>{if(!anchor.isConnected){observer.disconnect();root.unmount();}});observer.observe(document.body,{childList:true,subtree:true});return()=>{observer.disconnect();root.unmount();};}
