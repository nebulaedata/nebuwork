import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, ArrowDown, Plus, Search, PanelLeft, PanelRight, FileText, Check, LoaderCircle, Circle, X, Download, ChevronLeft, ChevronDown, Users, ListChecks, Layers, FolderOpen } from 'lucide-react';
import { authSession } from '../../services/authSession.js';
import { agentReducer, emptyState, statuses, isActive, toolLabels } from './agentState.js';
import { renderTaskMarkdown } from './markdown.js';
import { DocumentPreview } from '../files/DocumentPreview.jsx';
import { UploadTasks } from '../files/UploadTasks.jsx';
import { openTaskEvidence } from '../knowledge/SourceReader.jsx';
import { evidenceLinks } from './knowledgeEvidence.js';
import { usageText } from './usage.js';
import { taskExpertRoster } from './taskExperts.js';
import {PlatformMcpOperationButton} from '../runtime/PlatformMcpRecords.jsx';
import { DatabaseToolRecord, databaseToolStatus } from '../databases/DatabaseToolRecord.jsx';
import { databaseScopeHref, scopeLabel } from '../databases/databaseModel.js';
import { Overlay } from '../workbench/HubUI.jsx';
import { HtmlServicePublishButton } from '../services/HtmlServicePublisher.jsx';
import './agentTask.css';
import '../files/filePreview.css';

const fmt = value => value ? new Date(value).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const json = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
function Markdown({ children, onArtifact, onEvidence }) { const html=useMemo(()=>({__html:renderTaskMarkdown(children || '')}),[children]); return <div className="task-markdown" onClick={e => { const evidence=e.target.closest('[data-knowledge-evidence]');if(evidence){e.preventDefault();onEvidence?.(evidence.dataset.knowledgeEvidence);return;}const a = e.target.closest('[data-artifact-id]'); if (a) { e.preventDefault(); onArtifact?.(a.dataset.artifactId, a.dataset.artifactVersion ? Number(a.dataset.artifactVersion) : undefined); } }} dangerouslySetInnerHTML={html} />; }
function StatusIcon({ status }) { return status === 'completed' ? <Check size={15} /> : status === 'failed' ? <X size={15} /> : isActive(status) ? <LoaderCircle size={15} className="agent-spin" /> : <Circle size={13} />; }
function TaskExperts({ experts, loading, onExpert }) {
  const [open, setOpen] = useState(false), container = useRef(null), listId = React.useId();
  useEffect(() => { if(!open)return;const close=event=>{if(!container.current?.contains(event.target))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close); }, [open]);
  useEffect(()=>setOpen(false),[experts.map(expert=>expert.id).join(',')]);
  const initials = name => /^[A-Za-z]/.test(name) ? name.slice(0,2).toUpperCase() : [...name][0];
  const names = experts.slice(0,2).map(expert=>expert.name).join(' · ');
  return <div className="agent-task-experts" ref={container} onKeyDown={event=>{if(event.key==='Escape'){setOpen(false);container.current.querySelector('button')?.focus();}}} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setOpen(false);}}>
    <button type="button" className="agent-task-expert-trigger" disabled={!experts.length} aria-label="查看任务专家" aria-expanded={open} aria-controls={listId} title={experts.map(expert=>expert.name).join('、')} onClick={()=>setOpen(value=>!value)}>
      {experts.length ? <><span className="agent-task-expert-avatars" aria-hidden="true">{experts.slice(0,2).map((expert,index)=><span className={`agent-task-expert-avatar tone-${index%2}`} key={expert.id}>{initials(expert.name)}</span>)}</span><span className="agent-task-expert-names">{names}</span>{experts.length>1&&<span className="agent-task-expert-count">等{experts.length}人</span>}<ChevronDown size={13} className={open?'expanded':''}/></> : <><Users size={14}/><span>{loading?'正在读取专家…':'暂无任务专家'}</span></>}
    </button>
    {open&&<div className="agent-task-expert-popover" id={listId} role="group" aria-label="任务专家列表"><div className="agent-task-expert-heading">任务专家<span>{experts.length} 人</span></div>{experts.map((expert,index)=><button type="button" className="agent-task-expert-option" key={expert.id} onClick={()=>{setOpen(false);onExpert(expert);}}><span className={`agent-task-expert-avatar tone-${index%2}`} aria-hidden="true">{initials(expert.name)}</span><span className="agent-task-expert-option-name">{expert.name}</span><span className={`agent-task-expert-state ${expert.status||''}`}>{expert.label}</span></button>)}</div>}
  </div>;
}
function ToolCard({ tool, onEvidence }) {
  return <details className={`agent-tool ${tool.status}`}><summary><StatusIcon status={tool.status} /><span>{toolLabels[tool.name] || (tool.name?.startsWith('mcp__nebuwork__')?'调用系统能力':tool.name?.startsWith('mcp_') ? '调用外部工具' : tool.name || '执行工具')}</span><small>{tool.status === 'running' ? '进行中' : tool.status === 'failed' ? '失败' : databaseToolStatus(tool) || '完成'}</small></summary>
    <div className="agent-tool-body"><PlatformMcpOperationButton tool={tool}/>{tool.name?.startsWith("database_")&&<DatabaseToolRecord tool={tool}/>}{evidenceLinks(tool).map(c=><button key={c.evidenceId} onClick={()=>onEvidence?.(c.evidenceId)}>查看原文 · {c.title||c.documentId}</button>)}<div className="agent-muted">{tool.name}</div>{tool.arguments && <pre>{json(tool.arguments)}</pre>}{tool.output && <pre>{tool.output}</pre>}{tool.result && <pre>{json(tool.result)}</pre>}</div>
  </details>;
}
function ToolGroup({ tools, onEvidence }) { return tools.length < 3 ? tools.map(tool => <ToolCard key={tool.id} tool={tool} onEvidence={onEvidence} />) : <details className="agent-tool-group" open={tools.some(t => t.status === 'running')}><summary>{toolLabels[tools[0].name] || tools[0].name} · {tools.length} 次操作</summary>{tools.map(t => <ToolCard key={t.id} tool={t} onEvidence={onEvidence} />)}</details>; }
function Turn({ turn, artifacts, onArtifact, experts, onExpert, onEvidence }) {
  const ordered = [...Object.values(turn.messages).map(m => ({ kind: 'message', ...m })), ...Object.values(turn.tools).map(t => ({ kind: 'tool', ...t }))].sort((a,b) => a.sequence - b.sequence);
  const groups = [];
  for (const item of ordered) { const last = groups.at(-1); if (item.kind === 'tool' && last?.kind === 'tools' && last.items[0].name === item.name) last.items.push(item); else groups.push(item.kind === 'tool' ? { kind: 'tools', id: item.id, items: [item] } : item); }
  return <article className="agent-turn" aria-label="执行轮次">
    {groups.map(item => item.kind === 'tools' ? <ToolGroup key={item.id} tools={item.items} onEvidence={onEvidence} /> : item.content || item.role === 'user' ? <div key={item.id} className={`agent-message ${item.role}`}><div className="agent-message-by">{item.role === 'user' ? '你' : '智能体'}<time>{fmt(item.occurredAt)}</time></div><Markdown onArtifact={onArtifact} onEvidence={onEvidence}>{item.content}</Markdown>{(item.fileRefs?.length || item.fileIds?.length) > 0 && <div className="agent-attachment-row">{(item.fileRefs || item.fileIds.map(id=>({id}))).map(ref => <button key={ref.id} onClick={() => onArtifact(ref.id,ref.version)}><FileText size={13} />{artifacts[ref.id]?.name || '输入附件'}{ref.version ? ` · v${ref.version}` : ''}</button>)}</div>}</div> : null)}
    {Object.values(experts).filter(e => e.parentRunId === turn.id).map(e => <button className="agent-expert-summary" key={e.runId} onClick={() => onExpert(e.runId)}><Users size={16} /><span><b>{e.name}</b><small>{e.goal}</small></span><span>查看协作</span></button>)}
    {turn.activities.filter(e => e.type === 'input.required').map(e => <div className="agent-input-required" key={e.eventId}>{e.payload.question}</div>)}
    {turn.error && <div className="agent-error" role="alert">{json(turn.error)}</div>}
    <div className={`agent-turn-status ${turn.status}`}><StatusIcon status={turn.status} />{statuses[turn.status] || turn.status}{turn.usage&&<span className="agent-muted"> · {usageText(turn.usage)}</span>}</div>
  </article>;
}
function Context({ run }) {
  const m = run?.manifest;
  if (!m) return <p className="agent-muted">执行准备完成后，这里显示本轮实际生效的配置。</p>;
  return <div className="agent-context"><p className="agent-muted">本轮配置已固定。下一轮读取最新发布版本。</p><dl><dt>模型</dt><dd>{m.model.model} <small>版本 {m.model.revision}</small></dd><dt>权限</dt><dd>全工具权限 · 项目数据边界生效</dd><dt>解析时间</dt><dd>{fmt(m.resolvedAt)}</dd></dl>
    <details><summary>指令 · {m.instructions.length}</summary>{m.instructions.map((v,i) => <div className="agent-context-item" key={i}><b>{v.source}</b><small>{v.path} · {v.revision} · {v.scope || '全工作区'}</small><pre>{v.content}</pre></div>)}</details>
    {m.degraded?.length > 0 && <div className="agent-error">{m.degraded.map((d,i)=><p key={i}>{d.resourceId}：{d.reason}</p>)}</div>}<details><summary>Skills · {m.skills.length}</summary>{m.skills.map(v => <div className="agent-context-item" key={v.id}><b>{v.name}{v.required ? ' · 必需' : ''}</b><small>{v.directory} · {v.revision}</small><p>{v.description}</p>{v.requiredFiles?.map(f => <code key={f}>{f}<br /></code>)}</div>)}</details>
    <details><summary>MCP · {m.mcp.length+(m.platformMcp?1:0)}</summary>{m.platformMcp&&<div className="agent-context-item"><b>系统 MCP</b><small>工具目录 v{m.platformMcp.catalogVersion} · 授权 v{m.platformMcp.policyRevision}</small><p>{m.platformMcp.policy.tools.join("、")}</p></div>}{m.mcp.map(v => <div className="agent-context-item" key={v.id}><b>{v.id}</b><small>{v.transport} · {v.required ? '必需' : '可选'} · {({connected:'已连接',failed:'连接失败',unavailable:'服务不可用，本轮已降级',credential_unavailable:'凭据不可用，本轮已降级'})[run.mcpStatus?.[v.id]] || '等待连接'}</small><p>{run.mcpCatalog?.[v.id] ? run.mcpCatalog[v.id].map(t=>t.name).join('、') : v.tools?.join('、') || '连接后发现工具'}</p></div>)}</details>
    <details><summary>数据库 · {m.databaseReferences?.length || 0}</summary>{(m.databaseReferences || []).map(ref=><div className="agent-context-item" key={ref.id}><a href={databaseScopeHref(ref.scopeKind,ref.scopeId,ref.id)}>{ref.name}</a><small>{scopeLabel[ref.scopeKind]}来源 · 配置 v{ref.configVersion} · {ref.permissions.write?'可读写':'只读'}{ref.permissions.schema?' · 可修改表结构':''}</small></div>)}{!m.databaseReferences?.length&&<p className="agent-muted">本轮未固定数据库引用。本轮新建库以创建工具记录为准。</p>}</details>
    <details><summary>知识与记忆</summary><p>知识引用：{m.knowledgeRefs.join('、') || '未绑定'}</p><p>记忆：{m.memory.status}</p><pre>{json(m.memory.problems)}</pre><p>已召回 {m.memory.facts.length} 项</p></details>
    <details><summary>资源版本与来源</summary>{m.bundleVersions.map(v => <p key={v.id + v.version}>{v.id} · {v.version}<small>{v.hash}</small></p>)}<small>快照 {run.manifestHash}</small></details>
  </div>;
}
export function FilePreview({ projectId, file, close, onArtifact, onEvidence }) {
  return <section className="agent-file-preview">
    <header className="agent-file-preview-head">
      <button type="button" className="agent-file-preview-back" onClick={close} aria-label="关闭预览" title="返回文件列表"><ChevronLeft size={18} aria-hidden="true" /></button>
      <div className="agent-file-preview-title">
        <span className="agent-file-preview-icon" aria-hidden="true"><FileText size={20} /></span>
        <div className="agent-file-preview-copy"><strong>{file.name}</strong><p className="agent-file-preview-meta"><span className="agent-file-preview-version">版本 {file.version}</span><span>{file.runId ? '智能体产物' : '项目文件'}</span><span>{(file.size / 1024).toFixed(1)} KB</span></p></div>
      </div>
      <div className="agent-file-preview-actions"><HtmlServicePublishButton key={projectId+":"+file.id} projectId={projectId} file={file}/><a className="agent-file-preview-download" href={API.artifactUrl(projectId, file)} download={file.name} aria-label="下载文件"><Download size={16} aria-hidden="true" />下载文件</a></div>
    </header>
    {file.source && <details className="agent-file-preview-source"><summary><Layers size={14} aria-hidden="true" /><span>文件来源</span><ChevronDown size={14} className="agent-file-preview-source-chevron" aria-hidden="true" /></summary><pre>{json(file.source)}</pre></details>}
    <div className="agent-file-preview-body"><DocumentPreview source={{kind:'artifact',projectId,artifactId:file.id,version:file.version}} fileName={file.name} mediaType={file.mediaType} size={file.size} loadBlob={async signal=>(await API.artifactContent(projectId,file,signal)).data} onArtifact={onArtifact} onEvidence={onEvidence}/></div>
  </section>;
}
export function TaskConversation({ task, taskId, embedded, connected, latest, left, setLeft, right, setRight, scroll, nearBottom, setNewProgress, hasEarlier, sending, earlier, state, runs, allFiles, openFile, openExpert, lifetime, newProgress, send, error, setError, attachments, setAttachments, text, setText, activeRun, mode, setMode, action, taskExperts, currentRun, openTaskExpert, conversationLabel }) {
  return <main className={`agent-conversation ${embedded ? 'agent-conversation-embedded' : ''}`}><header className="agent-conversation-head">{!embedded&&<button onClick={()=>setLeft(!left)} aria-label="切换任务栏"><PanelLeft size={18}/></button>}<div><strong>{task.title}</strong><small>{connected?'实时连接':'正在连接事件流'} · {statuses[latest?.status||'idle']} · {usageText(task.usage)}</small></div>{embedded?<a href={`#/task/${taskId}`} title="打开完整任务">详情</a>:<button onClick={()=>setRight(!right)} aria-label="切换成果与上下文"><PanelRight size={18}/></button>}</header>
      <div className="agent-transcript" ref={scroll} onScroll={()=>{const el=scroll.current;nearBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<90;if(nearBottom.current)setNewProgress(false);}}>{hasEarlier&&<button className="agent-earlier" disabled={sending} onClick={earlier}>加载更早的记录</button>}{state.turns.length?state.turns.map(t=><Turn key={t.id} turn={{...t,status:runs.find(r=>r.id===t.id)?.status||t.status,usage:runs.find(r=>r.id===t.id)?.usage}} artifacts={allFiles} onArtifact={openFile} experts={state.experts} onExpert={openExpert} onEvidence={id=>openTaskEvidence(taskId,id,()=>!lifetime.current.signal.aborted)}/>):<div className="agent-welcome"><Layers size={32}/><h2>{conversationLabel || '从一个明确的目标开始'}</h2><p>{conversationLabel ? '询问系统、统计用量、分析问题，或聊聊其他事情。需要执行时请明确说明目标。' : '描述你想完成的工作，添加资料。智能体会显示进展，并把成果保存在项目中。'}</p></div>}</div>
      {newProgress&&<button className="agent-new-progress" onClick={()=>{nearBottom.current=true;scroll.current.scrollTop=scroll.current.scrollHeight;setNewProgress(false);}}><ArrowDown size={14}/>有新进展</button>}
      <UploadTasks projectId={task.projectId} taskId={taskId}/><form className="agent-composer" onSubmit={e=>{e.preventDefault();send();}}>{error&&<div className="agent-error" role="alert">{error}<button type="button" onClick={()=>setError('')} aria-label="关闭错误"><X size={13}/></button></div>}{attachments.length>0&&<div className="agent-attachment-row">{attachments.map(f=><button type="button" key={f.id} onClick={()=>setAttachments(v=>v.filter(a=>a.id!==f.id))}>{f.name}<X size={12}/></button>)}</div>}<textarea value={text} onChange={e=>setText(e.target.value)} placeholder={activeRun?.status==='waiting_input'?'补充需要的信息…':conversationLabel ? '询问任何事情，或描述要执行的工作…' : '描述目标，或继续这项工作…'} aria-label="任务消息" onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();send();}}}/><div className="agent-compose-actions"><label className="agent-upload" title="添加附件"><Plus size={19}/><input type="file" multiple disabled={sending||Boolean(activeRun&&mode==='steer')} onChange={e=>{const picked=[...e.target.files];e.target.value='';action(async()=>{for(const file of picked){const{data}=await API.uploadArtifact(task.projectId,file,taskId,undefined,{onRetryComplete:data=>{if(!lifetime.current.signal.aborted)setAttachments(v=>v.some(f=>f.id===data.id)?v:[...v,data]);}});if(!lifetime.current.signal.aborted)setAttachments(v=>[...v,data]);}});}}/></label>{activeRun&&<select aria-label="消息发送方式" value={mode} onChange={e=>setMode(e.target.value)}><option value="follow_up">排队到下一轮</option><option value="steer">{activeRun.status==='waiting_input'?'回答当前问题':'补充当前执行'}</option></select>}<TaskExperts experts={taskExperts} loading={Boolean(latest&&!currentRun?.manifest)} onExpert={openTaskExpert}/><span className="agent-muted agent-send-hint">Ctrl ↵ 发送</span>{activeRun&&<button type="button" className="agent-stop" disabled={sending} onClick={()=>action(()=>API.commandRun(taskId,activeRun.id,{type:'cancel'}))}>停止</button>}{activeRun?.status==='interrupted'&&<button type="button" disabled={sending} onClick={()=>action(()=>API.commandRun(taskId,activeRun.id,{type:'resume'}))}>恢复</button>}<button className="agent-send" disabled={sending||!text.trim()} aria-label="发送消息"><ArrowUp size={19}/></button></div></form>
    </main>;
}
export function AgentTask({ taskId, embedded = false, onSnapshot, draftRequest, conversationLabel }) {
  const [state, dispatch] = useReducer(agentReducer, undefined, () => emptyState(null));
  const [task, setTask] = useState(null), [project, setProject] = useState(null), [tasks, setTasks] = useState([]), [files, setFiles] = useState([]), [runs, setRuns] = useState([]), [selectedRun, setSelectedRun] = useState(null), [runDetails, setRunDetails] = useState({});
  const [error, setError] = useState(''), [connected, setConnected] = useState(false), [text, setText] = useState(''), [sending, setSending] = useState(false), [mode, setMode] = useState('follow_up'), [attachments, setAttachments] = useState([]), [search, setSearch] = useState(''), [tab, setTab] = useState('files'), [preview, setPreview] = useState(null), [expert, setExpert] = useState(null), [hasEarlier, setHasEarlier] = useState(false), [newProgress, setNewProgress] = useState(false), [widths, setWidths] = useState([260,360]), [left, setLeft] = useState(window.innerWidth >= 900), [right, setRight] = useState(window.innerWidth >= 900);
  const scroll = useRef(null), nearBottom = useRef(true), lifetime = useRef(null), messages = useRef([]), refreshId = useRef(0), runsFetchId=useRef(0), actionPending=useRef(false);
  useEffect(()=>{const media=window.matchMedia?.('(max-width: 900px)');if(!media)return;const changed=()=>{setLeft(!media.matches);setRight(!media.matches);};media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[]);
  const refreshRuns=async signal=>{const generation=++runsFetchId.current;const {data}=await API.fetchTaskRuns(taskId,signal);if(!signal.aborted&&generation===runsFetchId.current){setRuns(data.items);if(data.usage)setTask(previous=>previous?{...previous,usage:data.usage}:previous);}};
  const activeRun = [...runs].reverse().find(r => isActive(r.status)), latest = activeRun || runs.at(-1);
  const runDetail = runDetails[selectedRun || latest?.id], currentRun = runDetails[latest?.id];
  const taskExperts = taskExpertRoster(currentRun || latest, state.experts, latest ? [] : project?.agents || []);
  const inspectorExperts = taskExpertRoster(runDetail, state.experts);
  const allFiles = { ...Object.fromEntries(files.map(f => [f.id, f])), ...state.artifacts };
  useEffect(() => {
    const abort = new AbortController(); lifetime.current = abort; let timer, flush;
    setRunDetails({});setSelectedRun(null);
    const live = () => !abort.signal.aborted;
    const refresh = async () => { const generation = ++refreshId.current; const [{ data: d }] = await Promise.all([API.fetchTask(taskId, abort.signal)]); if (!live() || generation !== refreshId.current) return;
      setTask(d.task); setRuns(d.runs); setHasEarlier(d.hasEarlier); dispatch({ type: 'reset', sessionId: d.session.id }); dispatch({ type: 'events', items: d.events });
      void API.subscribeTask(taskId, d.cursor, { onConnection: value => { if(live()) setConnected(value); }, onError: e => { if(live()) setError(e.message); }, onEvent: e => { messages.current.push(e); if (!flush) flush = setTimeout(() => { flush = null; if(live()) dispatch({ type:'events',items:messages.current.splice(0) }); }, 50); } }, abort.signal);
      const meta = await Promise.allSettled([API.fetchProjectDetail(d.task.projectId, abort.signal), embedded ? Promise.resolve({data:[]}) : API.fetchProjectTasks(d.task.projectId, abort.signal), API.fetchProjectArtifacts(d.task.projectId, abort.signal)]); if (!live()) return;
      if (meta[0].status === 'fulfilled') {setProject(meta[0].value.data.project);if (!embedded && document.getElementById('topbar-crumb')) document.getElementById('topbar-crumb').textContent = ` / ${meta[0].value.data.project.name} / ${d.task.title}`;}
      if (meta[1].status === 'fulfilled') setTasks(meta[1].value.data);
      if (meta[2].status === 'fulfilled') setFiles(meta[2].value.data.items);
      const failures=meta.filter(r=>r.status==='rejected');if(failures.length)setError(failures.map(r=>r.reason.message).join('；'));
      timer = setInterval(async () => { try { if (!document.hidden) await refreshRuns(abort.signal); } catch(e) { if(live()) setError(e.message); } }, 3000);
    };
    refresh().catch(e => { if(live()) setError(e.message); });
    return () => { abort.abort(); clearInterval(timer); clearTimeout(flush); messages.current = []; };
  }, [taskId]);
  useEffect(() => {
    const ids = [...new Set([latest?.id, selectedRun].filter(Boolean))];if(!ids.length)return;
    const abort = new AbortController(), pending = new Set();
    const fetchRun = async id => { if(pending.has(id))return;pending.add(id);try{const {data}=await API.fetchAgentRun(taskId,id,abort.signal);if(!abort.signal.aborted)setRunDetails(previous=>({...previous,[id]:data}));}catch(e){if(!abort.signal.aborted)setError(e.message);}finally{pending.delete(id);} };
    ids.forEach(id=>void fetchRun(id));
    const timer = ids.some(id=>isActive(runs.find(run=>run.id===id)?.status)) ? setInterval(()=>ids.forEach(id=>{if(!document.hidden && isActive(runs.find(run=>run.id===id)?.status))void fetchRun(id);}),3000) : null;
    return()=>{abort.abort();clearInterval(timer);};
  }, [taskId, selectedRun, latest?.id, latest?.status]);
  useEffect(() => { if (nearBottom.current && scroll.current) { scroll.current.scrollTop = scroll.current.scrollHeight; setNewProgress(false); } else setNewProgress(true); }, [state.cursor]);
  async function action(fn) { if(actionPending.current)return; actionPending.current=true; setError(''); setSending(true); try { await fn(); } catch(e) { if(!lifetime.current?.signal.aborted) setError(e.message); } finally { actionPending.current=false; if(!lifetime.current?.signal.aborted) setSending(false); } }
  useEffect(() => { if (activeRun?.status === 'waiting_input') setMode('steer'); }, [activeRun?.id, activeRun?.status]);
  const send = () => action(async () => { if(!text.trim()) return; const content=text.trim();
    if(conversationLabel && !runs.length && task.title === '指挥官问答') {
      const {data}=await API.editTask(taskId,{title:content.slice(0,80),context:task.context||{}});
      if(lifetime.current.signal.aborted)return;setTask(data.task);
    }
    if(activeRun && mode !== 'follow_up') await API.commandRun(taskId, activeRun.id, { type: activeRun.status === 'waiting_input' ? 'resume' : mode, content }); else await API.sendTask(taskId, { content, fileRefs: attachments.map(f => ({id:f.id,version:f.version})) }); if(lifetime.current.signal.aborted) return; setText(''); setAttachments([]); await refreshRuns(lifetime.current.signal); });
  function resize(side,e) { const start=e.clientX, original=widths[side]; e.currentTarget.setPointerCapture(e.pointerId); const handle=event=>setWidths(prev=>prev.map((v,i)=>i===side?Math.max(side?280:220,Math.min(side?560:380,original+(event.clientX-start)*(side?-1:1))):v)); const element=e.currentTarget; element.onpointermove=handle; element.onpointerup=()=>{element.onpointermove=null;element.onpointerup=null;}; }
  async function earlier() { await action(async () => { let cursor=0, items=[]; const first=Math.min(...Object.keys(state.events).map(Number)); while(cursor<first-1) { const {data}=await API.fetchTaskHistory(taskId,cursor,lifetime.current.signal); if(!data.items.length) break; items.push(...data.items);cursor=data.items.at(-1).sequence; } if(!lifetime.current.signal.aborted) { nearBottom.current=false; dispatch({type:'events',items}); setHasEarlier(false); } }); }
  const openFile = (id, version) => action(async () => { let f=allFiles[id]; if(version && f?.version !== version) { const {data} = await API.fetchArtifact(task.projectId,id,version,lifetime.current.signal); f=data; } if(f) {setPreview(f);setRight(true);} else setError('该成果尚未提交或你没有访问权限。'); });
  const openExpert = id => action(async()=>{const {data}=await API.fetchExpertRun(taskId,id,lifetime.current.signal);if(!lifetime.current.signal.aborted){setExpert(data);setPreview(null);setRight(true);setTab('experts');}});
  const openTaskExpert = item => {setPreview(null);setExpert(null);setSelectedRun(latest?.id||null);setRight(true);setTab('experts');if(item.runId)void openExpert(item.runId);else if(embedded)setExpert({roster:taskExperts});};
  useEffect(() => { onSnapshot?.({ task, runs, state, runDetails }); }, [task, runs, state, runDetails, onSnapshot]);
  useEffect(() => { if (draftRequest?.content) setText(draftRequest.content); }, [draftRequest]);
  if(!task) return <div className="page"><div className="card empty">{error || '正在读取任务…'}</div></div>;
  const conversationProps = { task, taskId, embedded, connected, latest, left, setLeft, right, setRight, scroll, nearBottom, setNewProgress, hasEarlier, sending, earlier, state, runs, allFiles, openFile, openExpert, lifetime, newProgress, send, error, setError, attachments, setAttachments, text, setText, activeRun, mode, setMode, action, taskExperts, currentRun, openTaskExpert, conversationLabel };
  if (embedded) return <div className="agent-shell agent-embedded"><TaskConversation {...conversationProps}/>{(preview || expert)&&<Overlay title="会话详情" close={()=>{setPreview(null);setExpert(null);}}>{preview?<FilePreview projectId={task.projectId} file={preview} onArtifact={openFile} onEvidence={id=>openTaskEvidence(taskId,id,()=>!lifetime.current.signal.aborted)} close={()=>setPreview(null)}/>:<><button onClick={()=>setExpert(null)}>关闭专家详情</button><div className="hub-detail">{expert.roster?expert.roster.map(e=><p key={e.id}>{e.name} · {e.label}</p>):expert.events?.filter(e=>e.type==='message.completed').map(e=><Markdown key={e.eventId} onArtifact={openFile}>{e.payload.content}</Markdown>)}<a href={`#/task/${taskId}`}>打开完整协作详情</a></div></>}</Overlay>}</div>;
  return <div className={`agent-shell ${left?'':'hide-left'} ${right?'':'hide-right'}`} style={{'--agent-left':`${widths[0]}px`,'--agent-right':`${widths[1]}px`}}>
    <aside className="agent-task-list"><header><button className="agent-mobile-close" aria-label="关闭任务栏" onClick={()=>setLeft(false)}><X size={16}/></button><a href={`#/project/${task.projectId}`}><FolderOpen size={16}/>{project?.name || '项目任务'}</a><button title="新建任务" onClick={()=>action(async()=>{const {data}=await API.createTask(task.projectId,{title:'新任务'});if(!lifetime.current.signal.aborted)location.hash=`#/task/${data.task.id}`;})}><Plus size={17}/></button></header><label className="agent-search"><Search size={15}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索任务"/></label><nav>{tasks.filter(t=>t.title.includes(search)).map(t=><a key={t.id} className={t.id===taskId?'selected':''} href={`#/task/${t.id}`}><b>{t.title}</b><small>{statuses[t.id===taskId?latest?.status||'idle':t.status]}<time>{fmt(t.id===taskId?latest?.createdAt||t.updatedAt:t.updatedAt)}</time></small><small>{usageText(t.id===taskId?task.usage:t.usage)}</small></a>)}</nav></aside>
    <div className="agent-resize agent-resize-left" role="separator" aria-label="调整任务栏宽度" tabIndex={0} onPointerDown={e=>resize(0,e)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key))setWidths(([a,b])=>[Math.max(220,Math.min(380,a+(e.key==='ArrowRight'?20:-20))),b]);}}/>
    <TaskConversation {...conversationProps}/><div className="agent-resize agent-resize-right" role="separator" aria-label="调整成果栏宽度" tabIndex={0} onPointerDown={e=>resize(1,e)} onKeyDown={e=>{if(['ArrowLeft','ArrowRight'].includes(e.key))setWidths(([a,b])=>[a,Math.max(280,Math.min(560,b+(e.key==='ArrowLeft'?20:-20)))]);}}/>
    <aside className="agent-inspector"><button className="agent-mobile-close agent-inspector-close" aria-label="关闭成果与上下文" onClick={()=>setRight(false)}><X size={16}/></button>{preview?<FilePreview projectId={task.projectId} file={preview} onArtifact={openFile} onEvidence={id=>openTaskEvidence(taskId,id,()=>!lifetime.current.signal.aborted)} close={()=>setPreview(null)}/>:<><header className="agent-inspector-tabs">{[['files','成果',FileText],['plan','计划',ListChecks],['experts','专家',Users],['context','上下文',Layers]].map(([id,label,Icon])=><button className={tab===id?'selected':''} key={id} onClick={()=>setTab(id)}><Icon size={15}/>{label}</button>)}</header><div className="agent-inspector-content">{tab!=='files'&&<label className="agent-run-picker">执行轮次<select value={selectedRun||latest?.id||''} onChange={e=>setSelectedRun(e.target.value)}>{runs.map((r,i)=><option key={r.id} value={r.id}>第 {i+1} 轮 · {statuses[r.status]}</option>)}</select></label>}
      {tab==='files'&&<><div className="agent-section-title">项目共享成果 <small>{Object.keys(allFiles).length}</small></div>{Object.values(allFiles).reverse().map(f=><div className="agent-file-service-row" key={f.id}><button className="agent-file" onClick={()=>setPreview(f)}><FileText size={21}/><span><b>{f.name}</b><small>v{f.version} · {(f.size/1024).toFixed(1)} KB · {fmt(f.createdAt)}</small></span></button><HtmlServicePublishButton projectId={task.projectId} workbenchId={project?.workbenchId} file={f}/></div>)}{!Object.keys(allFiles).length&&<p className="agent-muted">已提交的成果会显示在这里。临时文件不会作为可靠成果共享。</p>}</>}
      {tab==='plan'&&<><div className="agent-section-title">任务计划</div>{(state.plans[runDetail?.id]||[]).map(p=><div className={`agent-plan ${p.status}`} key={p.id}><StatusIcon status={p.status}/><span>{p.text}</span></div>)}{!state.plans[runDetail?.id]?.length&&<p className="agent-muted">本轮尚未提交结构化计划。</p>}</>}
      {tab==='context'&&<Context run={runDetail}/>}
      {tab==='experts'&&<><div className="agent-section-title">任务专家<small>{inspectorExperts.length} 人</small></div>{inspectorExperts.map(item=><div key={item.id} className="agent-expert"><Users size={18}/><span><b>{item.name}</b><small>{item.label}</small></span></div>)}{!inspectorExperts.length&&<p className="agent-muted">本轮暂无任务专家。</p>}<div className="agent-section-title agent-expert-collaboration-title">专家协作</div>{(runDetail?.children||[]).map(c=><button key={c.id} className="agent-expert" onClick={()=>openExpert(c.id)}><Users size={18}/><span><b>{state.experts[c.id]?.name||inspectorExperts.find(item=>item.invocations.some(call=>call.runId===c.id))?.name||'协作专家'}</b><small>{statuses[c.status]}</small></span></button>)}{!runDetail?.children?.length&&<p className="agent-muted">本轮尚未委派专家。</p>}{expert&&<div className="agent-expert-detail"><button onClick={()=>setExpert(null)}>关闭专家详情</button>{expert.events.filter(e=>e.type==='message.completed').map(e=><Markdown key={e.eventId} onArtifact={openFile} onEvidence={id=>openTaskEvidence(taskId,id,()=>!lifetime.current.signal.aborted)}>{e.payload.content}</Markdown>)}</div>}</>}
    </div></>}</aside>
  </div>;
}
window.Views ||= {};
window.Views.task = { render(el, taskId) { const root=createRoot(el);root.render(<AgentTask key={taskId} taskId={taskId}/>);el.viewCleanup=()=>root.unmount(); } };
