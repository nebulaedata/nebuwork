import { createUuid } from '../../../lib/uuid.js';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Command, Plus, Network, BarChart3, X } from 'lucide-react';
import { AgentTask } from '../../tasks/AgentTask.jsx';
import { Empty, Notice, HubSelect, formatTime } from '../HubUI.jsx';
import { dispatchTargets, latestTasks } from '../hubModel.js';
import { TaskDetail } from './TaskDetail.jsx';
import { useSystemOverview } from './useSystemOverview.js';
import { buildSystemGraph, questionFocus } from './systemModel.js';
import { SystemGraph } from './SystemGraph.jsx';
import { SystemStatistics } from './SystemStatistics.jsx';
import './system.css';

export function Commander({ project, workbench, catalog, preference, choose }) {
  const overview = useSystemOverview(catalog);
  const [tasks, setTasks] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState(null), [drawer, setDrawer] = useState(''), [draft, setDraft] = useState(null);
  const [selectedKey, setSelectedKey] = useState(''), [scopeKey, setScopeKey] = useState(''), [detail, setDetail] = useState(null), [chatWidth, setChatWidth] = useState(360);
  const life = useRef(null), pending = useRef(false), resizing = useRef(null), taskId = preference.taskId;
  const receive = useCallback(value => setSnapshot(value), []);
  useEffect(() => {
    const abort = new AbortController(); life.current = abort; setError('');
    const cached = catalog.projects.find(p => p.id === project.id)?.sessions;
    const read = Array.isArray(cached) && (!taskId || cached.some(t => t.id === taskId)) ? Promise.resolve({ data: cached }) : API.fetchProjectTasks(project.id, abort.signal);
    read.then(({ data }) => {
      if (abort.signal.aborted) return;
      const rows = latestTasks(data); setTasks(rows);
      if (!rows.some(t => t.id === taskId)) choose({ taskId: rows.find(t => t.context?.entry === 'commander')?.id || '' });
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [project.id]);
  useEffect(() => { setSnapshot(null); }, [taskId]);
  useEffect(() => { if (taskId) void overview.loadTask({ id: taskId, title: '指挥官会话' }); }, [taskId, overview.loadTask]);
  const history = overview.details[taskId]?.state;
  const turns = useMemo(() => {
    const values = new Map((history?.turns || []).map(turn => [turn.id, turn]));
    (snapshot?.state.turns || []).forEach(turn => { const old = values.get(turn.id); const tools = { ...old?.tools }; Object.entries(turn.tools).forEach(([key, value]) => tools[key] = { ...tools[key], ...value }); values.set(turn.id, { ...old, ...turn, tools }); });
    return [...values.values()].sort((a, b) => a.sequence - b.sequence);
  }, [history, snapshot]);
  const graph = useMemo(() => buildSystemGraph({ ...overview.data, versions: overview.versions, details: overview.details, live: snapshot, history: { state: history } }), [overview.data, overview.versions, overview.details, snapshot, history]);
  const question = useMemo(() => questionFocus(turns, graph), [turns, graph]);
  useEffect(() => setSelectedKey(''), [question.runId]);
  const selected = graph.nodes.find(n => n.key === selectedKey);
  useEffect(() => {
    const subjects = [...new Set([selectedKey, scopeKey])].map(key => graph.nodes.find(n => n.key === key)).filter(Boolean);
    subjects.filter(n => n.kind === 'expert' && !n.historical).forEach(n => { void overview.loadExpert(n, false, true); });
    subjects.filter(n => n.kind === 'task' && n.id !== taskId && overview.details[n.id] && overview.details[n.id].task.updatedAt !== n.updatedAt).forEach(n => { void overview.loadTask(n, true); });
  }, [overview.data.updated, selectedKey, scopeKey]);
  useEffect(() => {
    if (selectedKey && !graph.nodes.some(n => n.key === selectedKey)) setSelectedKey('');
    if (scopeKey && !graph.nodes.some(n => n.key === scopeKey)) setScopeKey('');
  }, [graph.nodes, selectedKey, scopeKey]);
  const targets = useMemo(() => dispatchTargets(turns), [turns]);
  const pick = key => { setSelectedKey(key); const node = graph.nodes.find(n => n.key === key); if (node?.kind === 'task') void overview.loadTask(node); if (node?.kind === 'expert' && !node.historical) void overview.loadExpert(node); };
  const ask = content => { setDraft({ content, id: createUuid() }); setDrawer(''); };
  async function createConversation() {
    if (pending.current) return; pending.current = true; setBusy(true); setError('');
    try {
      const { data } = await API.createTask(project.id, { title: '指挥官问答', context: { entry: 'commander' } });
      if (!life.current.signal.aborted) { setTasks(rows => [data.task, ...(rows || [])]); choose({ taskId: data.task.id }); }
    } catch (e) { if (!life.current.signal.aborted) setError(e.message); }
    finally { pending.current = false; if (!life.current.signal.aborted) setBusy(false); }
  }
  const follow = async target => {
    if (pending.current) return; pending.current = true; setBusy(true); setError('');
    try { await API.sendTask(taskId, { content: `请继续跟踪任务 ${target.id}（项目 ${target.projectId}）。先核对真实状态；完成后核验本次任务成果与固定版本，并按需导入当前指挥项目回传。不要重复创建或启动任务，查询无需额外发布文件。` }); if (!life.current.signal.aborted) setDetail(null); }
    catch (e) { if (!life.current.signal.aborted) setError(e.message); }
    finally { pending.current = false; if (!life.current.signal.aborted) setBusy(false); }
  };
  const conversations = latestTasks([...new Map([...(tasks || []), ...(overview.data.projects.find(p => p.id === project.id)?.sessions || [])].map(t => [t.id, t])).values()]);
  return <>
    <div className="hub-mobile-tabs"><button className="btn btn-ghost" onClick={() => setDrawer('graph')}><Network size={14}/>系统关系</button><button className="btn btn-ghost" onClick={() => setDrawer('statistics')}><BarChart3 size={14}/>统计与问题</button></div>
    <div className="cmd-grid cmd-overview" style={{ '--cmd-chat-width': `${chatWidth}px` }}>
      <section className="hub-panel cmd-chat"><header className="hub-panel-head"><h2><Command size={15}/>指挥官问答</h2><span className="pill pill-dim">了解 · 分析 · 执行</span></header>
        <div className="cmd-session-bar"><HubSelect label="会话" value={conversations.some(t => t.id === taskId) ? taskId : ''} options={conversations.map(t => ({ value: t.id, label: `${t.title} · ${formatTime(t.updatedAt || t.createdAt)}` }))} onChange={id => { setDraft(null); choose({ taskId: id }); }}/><button className="btn-icon" title="新建会话" aria-label="新建会话" disabled={busy || !tasks} onClick={createConversation}><Plus size={16}/></button></div>
        <Notice>{error}</Notice>{busy&&<p className="hub-muted" role="status">正在提交请求…</p>}
        {taskId ? <AgentTask key={taskId} taskId={taskId} embedded onSnapshot={receive} draftRequest={draft} conversationLabel="指挥官问答"/> : <Empty>{tasks ? '了解系统、查看用量、发现问题，也可以询问其他事情。每个新会话保存在当前绑定项目。' : '正在恢复会话…'}{draft&&<p className="cmd-pending-question">待填写的问题：{draft.content}</p>}{tasks&&<button className="btn btn-primary" disabled={busy} onClick={createConversation}>{draft ? '新建会话并填写问题' : '新建会话'}</button>}</Empty>}
        <div className="cmd-chat-resizer" role="separator" tabIndex={0} aria-label="调整问答栏宽度" aria-orientation="vertical" aria-valuenow={chatWidth} aria-valuemin={280} aria-valuemax={600} onPointerDown={event => { resizing.current = { x: event.clientX, width: chatWidth }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }} onPointerMove={event => { if (resizing.current) setChatWidth(Math.max(280, Math.min(600, resizing.current.width + event.clientX - resizing.current.x))); }} onPointerUp={() => { resizing.current = null; }} onLostPointerCapture={() => { resizing.current = null; }} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setChatWidth(w => Math.max(280, Math.min(600, w + (event.key === 'ArrowLeft' ? -20 : 20)))); } }}/>
      </section>
      {drawer&&<button className="hub-drawer-shade" aria-label="关闭侧栏" onClick={() => setDrawer('')}/>}
      <section className={`hub-panel cmd-relations ${drawer === 'graph' ? 'drawer-open' : ''}`}><header className="hub-panel-head"><h2><Network size={15}/>系统关系</h2><span className="hub-muted">当前账号 · 真实业务关系</span><button className="hub-drawer-close btn-icon" aria-label="关闭关系栏" onClick={() => setDrawer('')}><X size={16}/></button></header><SystemGraph graph={graph} question={question} selectedKey={selectedKey} onSelect={pick} onAsk={ask} onStatistics={key => { setScopeKey(key); const n = graph.nodes.find(node => node.key === key); if (n?.kind === 'expert' && !n.historical) void overview.loadExpert(n); }} onTaskDetail={setDetail} details={overview.details} loadTask={overview.loadTask} errors={overview.errors}/></section>
      <section className={`hub-panel cmd-system-statistics ${drawer === 'statistics' ? 'drawer-open' : ''}`}><header className="hub-panel-head"><h2><BarChart3 size={15}/>系统统计与问题</h2><button className="hub-drawer-close btn-icon" aria-label="关闭统计栏" onClick={() => setDrawer('')}><X size={16}/></button></header><SystemStatistics data={overview.data} selected={selected} scopeKey={scopeKey} onScope={key => { setScopeKey(key); const n = graph.nodes.find(node => node.key === key); if (n?.kind === 'expert' && !n.historical) void overview.loadExpert(n); }} graph={graph} details={overview.details} errors={overview.errors} loading={overview.loading} refresh={overview.refresh} onSelect={pick} onAsk={ask} loadExpert={overview.loadExpert}/></section>
    </div>
    {detail&&<TaskDetail task={detail} close={() => setDetail(null)} onFollow={taskId && targets.has(detail.id) ? follow : undefined}/>}
  </>;
}
