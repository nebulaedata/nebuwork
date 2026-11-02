import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Controls, Handle, Position, applyNodeChanges } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { List, Network, RefreshCw } from 'lucide-react';
import { Empty, Notice, Overlay, formatTime } from '../HubUI.jsx';
import { settledMap } from '../hubModel.js';
import { openTaskMemoryHistory } from '../../memory/views.js';

const kindNames = { user: '用户记忆', workbench: '工作台', project: '项目', expert: '专家' };
function MemoryNode({ data }) {
  return <div className={`cmd-memory-node ${data.entry ? 'is-memory' : 'is-scope'}`} title={data.label}><Handle type="target" position={Position.Top}/><span>{data.label}</span><Handle type="source" position={Position.Bottom}/></div>;
}
const nodeTypes = { memory: MemoryNode };
export function memoryGraph(scopes) {
  const nodes = [], edges = [];
  scopes.forEach((scope, i) => {
    const scopeKey = `${scope.kind}:${scope.id}`, a = i * Math.PI * 2 / Math.max(scopes.length, 1);
    const position = { x: 220 + Math.cos(a) * 150, y: 260 + Math.sin(a) * 150 };
    nodes.push({ id: scopeKey, type: 'memory', position, data: { label: scope.name } });
    if (scope.kind === 'project') edges.push({ id: `owner:${scopeKey}`, source: `workbench:${scope.workbenchId}`, target: scopeKey, label: '所属' });
    if (scope.kind === 'expert') edges.push({ id: `configured:${scopeKey}`, source: `project:${scope.projectId}`, target: scopeKey, label: '配置专家' });
    (scope.items || []).forEach((entry, j) => {
      const id = `entry:${entry.id}`, angle = a + (j - (scope.items.length - 1) / 2) * .45;
      nodes.push({ id, type: 'memory', position: { x: position.x + Math.cos(angle) * (100 + j % 3 * 20), y: position.y + Math.sin(angle) * (100 + j % 3 * 20) }, data: { label: entry.title || '记忆来源', entry } });
      edges.push({ id: `scope:${id}`, source: scopeKey, target: id, label: '记忆来源' });
      const source = entry.source?.taskId;
      if (source && !entry.sourceTaskDeleted) {
        const taskKey = `task:${source}`;
        if (!nodes.some(n => n.id === taskKey)) nodes.push({ id: taskKey, type: 'memory', position: { x: position.x + 160 + j % 4 * 35, y: position.y - 90 - j * 20 }, data: { label: '来源任务', taskId: source } });
        edges.push({ id: `source:${id}`, source: taskKey, target: id, label: '已记录来源' });
      }
    });
  });
  const ids = new Set(nodes.map(n => n.id));
  return { nodes, edges: edges.filter(e => ids.has(e.source) && ids.has(e.target)) };
}
export function MemoryPanel({ project, workbench, taskId }) {
  const life = useRef(null);
  const [scopes, setScopes] = useState([]), [errors, setErrors] = useState([]), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  const [mode, setMode] = useState('graph'), [detail, setDetail] = useState(null), [nodes, setNodes] = useState([]), [selection, setSelection] = useState('');
  useEffect(() => {
    const abort = new AbortController(); life.current = abort; setLoading(true); setErrors([]);
    (async () => {
      const { data } = await API.fetchProjectDetail(project.id, abort.signal); if (abort.signal.aborted) return;
      const experts = data.project.agents || data.workbenchVersion?.snapshot?.agents || [];
      const targets = [{ kind: 'user', id: 'self', name: '用户记忆' }, { kind: 'workbench', id: workbench.id, name: workbench.name }, { kind: 'project', id: project.id, name: project.name, workbenchId: workbench.id },
        ...experts.map(e => ({ kind: 'expert', id: e.id, name: e.name, projectId: project.id }))];
      const results = await settledMap(targets, s => API.fetchMemoryScope(s.kind, s.id, 0, abort.signal));
      if (abort.signal.aborted) return;
      setScopes(results.flatMap((r, i) => r.status === 'fulfilled' ? [{ ...targets[i], ...r.value.data, items: r.value.data.items || [] }] : []));
      setErrors(results.flatMap((r, i) => r.status === 'rejected' ? [`${targets[i].name}：${r.reason.message}`] : []));
    })().catch(e => { if (!abort.signal.aborted) setErrors([e.message]); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [project.id, workbench.id, revision]);
  const graph = useMemo(() => memoryGraph(scopes), [scopes]);
  useEffect(() => setNodes(graph.nodes), [graph]);
  async function more(scope) {
    const abort = life.current;
    const version = scope.nextOffset;
    setLoading(true);
    try { const { data } = await API.fetchMemoryScope(scope.kind, scope.id, version, abort.signal);
      if (abort.signal.aborted) return;
      setScopes(rows => rows.map(s => s === scope ? { ...s, ...data, items: [...s.items, ...data.items.filter(e => !s.items.some(old => old.id === e.id))] } : s));
    } catch (e) { if (!abort.signal.aborted) setErrors(v => [...v, e.message]); } finally { if (!abort.signal.aborted) setLoading(false); }
  }
  const entries = scopes.flatMap(scope => scope.items.map(e => ({ ...e, scopeName: scope.name })));
  return <>
    <div className="cmd-memory-toolbar"><div className="hub-segment"><button className={mode === 'graph' ? 'selected' : ''} onClick={() => setMode('graph')}><Network size={13}/>关系</button><button className={mode === 'list' ? 'selected' : ''} onClick={() => setMode('list')}><List size={13}/>列表</button></div><button className="btn-icon" aria-label="刷新记忆" onClick={() => setRevision(v => v + 1)}><RefreshCw size={14}/></button></div>
    <div className="cmd-memory-notices">{errors.map((e, i) => <Notice key={i}>{e}</Notice>)}{scopes.some(s => !s.enabled)&&<p>记忆服务未启用；仅展示已保存来源，不能据此认定本轮已使用。</p>}<p>拖动节点，滚轮缩放。连线表示配置归属和已记录来源。</p>{taskId&&<button className="btn btn-ghost btn-sm" onClick={() => openTaskMemoryHistory(taskId)}>本会话实际使用记录</button>}</div>
    {loading&&<p className="hub-muted" role="status">正在读取记忆…</p>}
    {!entries.length ? <Empty>{loading ? '正在读取记忆…' : errors.length > 0 ? '暂无可展示记录，部分范围读取失败。' : '暂无可见记忆记录。'}</Empty> : mode === 'graph' ? <div className="cmd-memory-canvas"><ReactFlow nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes} onNodesChange={changes => setNodes(prev => applyNodeChanges(changes, prev))} fitView minZoom={.15} maxZoom={2} nodesConnectable={false} onNodeClick={(_, node) => { if (node.data.entry) setDetail(node.data.entry.id); else setSelection(node.data.taskId ? `来源任务：${node.data.taskId}` : node.data.label); }}><Controls showInteractive={false}/></ReactFlow>{selection&&<div className="cmd-graph-selection">{selection}</div>}</div> : <div className="cmd-memory-list">{entries.map(e => <button className="hub-source-row" key={e.id} onClick={() => setDetail(e.id)}><strong>{e.title}</strong><small>{e.scopeName} · {e.state} · {e.syncState}</small></button>)}</div>}
    <div className="cmd-memory-pagination">{scopes.filter(s => s.hasMore).map(s => <button key={`${s.kind}:${s.id}`} className="btn btn-ghost btn-sm" disabled={loading} onClick={() => more(s)}>加载更多 · {s.name}</button>)}{scopes.some(s => s.hasMore)&&<p className="hub-muted">关系图只包含已加载记录。</p>}<a href={`#/project/${project.id}?tab=memory`}>管理项目记忆</a><a href={`#/workbench?tab=pro&id=${workbench.id}`}>管理工作台记忆</a><a href="#/settings?tab=memory">用户记忆</a></div>
    {detail&&<MemoryDetail id={detail} close={() => setDetail(null)}/>}
  </>;
}
function MemoryDetail({ id, close }) {
  const [entry, setEntry] = useState(null), [error, setError] = useState('');
  useEffect(() => { const abort = new AbortController(); API.fetchMemory(id, abort.signal).then(({ data }) => { if (!abort.signal.aborted) setEntry(data); }).catch(e => { if (!abort.signal.aborted) setError(e.message); }); return () => abort.abort(); }, [id]);
  return <Overlay title="记忆内容与来源" close={close}><div className="hub-detail"><Notice>{error}</Notice>{entry ? <><h3>{entry.title}</h3><p>{kindNames[entry.kind] || entry.kind} · {entry.state} · {entry.syncState} · v{entry.revision} · {formatTime(entry.updatedAt)}</p><pre>{entry.content}</pre>{entry.facts?.map((f, i) => <p key={i}>{f.text}</p>)}<h4>来源</h4><pre>{JSON.stringify(entry.source, null, 2)}</pre>{entry.sourceTaskDeleted ? <p>来源任务已删除，记忆独立保留。</p> : entry.source?.taskId&&<a className="btn btn-ghost" href={`#/task/${entry.source.taskId}`}>打开来源任务</a>}</> : !error&&<p>正在读取内容…</p>}</div></Overlay>;
}
