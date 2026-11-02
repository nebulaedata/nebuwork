import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Network, List, Search, RotateCcw, Maximize, Focus, X, ExternalLink, MessageCircle, BarChart3 } from 'lucide-react';
import { Empty, HubSelect } from '../HubUI.jsx';
import { statuses } from '../../tasks/agentState.js';
import { usageText } from '../../tasks/usage.js';
import { displayGraph, graphPositions, kindNames } from './systemModel.js';

const Graph3D = lazy(() => import('./Graph3D.jsx'));
class GraphBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onUnavailable('三维资源暂不可用，已切换关系列表。'); }
  render() { return this.state.failed ? null : this.props.children; }
}
export function objectUrl(node) {
  const id = encodeURIComponent(node.id);
  return node.kind === 'workbench' ? `#/workbench?tab=pro&id=${id}` : node.kind === 'project' ? `#/project/${id}` : node.kind === 'expert' ? `#/agent/${id}` : `#/task/${id}`;
}
export function SystemGraph({ graph, question, selectedKey, onSelect, onAsk, onStatistics, onTaskDetail, details, loadTask, errors }) {
  const [query, setQuery] = useState(''), [kind, setKind] = useState(''), [mode, setMode] = useState('graph');
  const [expanded, setExpanded] = useState({}), [focus, setFocus] = useState([]), [reset, setReset] = useState(0), [unavailable, setUnavailable] = useState('');
  const [maximized, setMaximized] = useState(false); const container = useRef(null);
  const focusSignature = question.keys.join('|');
  useEffect(() => { setFocus(question.keys); setQuery(''); setKind(''); if (!question.keys.length) setReset(n => n + 1); }, [question.runId, focusSignature]);
  useEffect(() => { if (selectedKey) { setFocus([selectedKey]); setQuery(''); setKind(''); } }, [selectedKey]);
  useEffect(() => { if (!maximized) return; const escape = event => { if (event.key === 'Escape') setMaximized(false); }; document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape); }, [maximized]);
  const selected = graph.nodes.find(n => n.key === selectedKey);
  const view = useMemo(() => displayGraph(graph, expanded, focus, query, kind), [graph, expanded, focus, query, kind]);
  const positions = useMemo(() => { const visible = new Set(view.nodes.map(n => n.key)); return graphPositions({ nodes: graph.nodes.filter(n => n.kind !== 'task' || visible.has(n.key)) }); }, [graph, view.nodes]);
  const select = key => { onSelect(key); const n = graph.nodes.find(row => row.key === key); if (n?.kind === 'task') void loadTask(n); };
  const expand = project => setExpanded(previous => ({ ...previous, [project.id]: (previous[project.id] || 0) + 50 }));
  const related = selected ? graph.edges.filter(e => e.source === selectedKey || e.target === selectedKey) : [];
  const showAll = () => { setFocus([]); setKind(''); setQuery(''); onSelect(''); setReset(n => n + 1); };
  return <div className={`cmd-system-graph ${maximized ? 'is-maximized' : ''}`} ref={container}>
    <div className="cmd-system-toolbar">
      <div className="hub-segment"><button className={mode === 'graph' ? 'selected' : ''} disabled={!!unavailable} onClick={() => setMode('graph')}><Network size={14}/>三维</button><button className={mode === 'list' ? 'selected' : ''} onClick={() => setMode('list')}><List size={14}/>列表</button></div>
      <label className="cmd-graph-search"><Search size={14}/><input aria-label="搜索关系对象" value={query} placeholder="搜索工作台、专家、任务…" onChange={e => setQuery(e.target.value)}/></label>
      <HubSelect label="对象类型" value={kind || 'all'} options={[{ value: 'all', label: '全部类型' }, ...Object.entries(kindNames).map(([value, label]) => ({ value, label }))]} onChange={value => setKind(value === 'all' ? '' : value)}/>
      <button className="btn-icon" aria-label="复位关系图" onClick={showAll}><RotateCcw size={15}/></button><button className="btn-icon" aria-label={maximized ? '退出全屏关系图' : '全屏关系图'} onClick={() => setMaximized(value => !value)}><Maximize size={15}/></button>
    </div>
    <div className="cmd-graph-context"><button onClick={showAll} className={!focus.length ? 'selected' : ''}>系统全景</button><button disabled={!question.keys.length} className={focus.length ? 'selected' : ''} onClick={() => { setFocus(question.keys); setQuery(''); setKind(''); }}>本轮关联 {question.keys.length ? `(${question.keys.length})` : ''}</button><button disabled={!selected} onClick={() => { setFocus([selectedKey]); setQuery(''); setKind(''); }}><Focus size={12}/>聚焦所选</button><span>{view.nodes.length} 个对象 · {view.edges.length} 条关系</span></div>
    {(unavailable || question.failed)&&<p className="cmd-graph-notice" role="status">{unavailable || '本轮部分工具查询失败，仅展示已核实的关联。'}</p>}
    <div className="cmd-graph-stage">
      {view.nodes.length ? mode === 'graph' && !unavailable ? <GraphBoundary onUnavailable={message => { setUnavailable(message); setMode('list'); }}><Suspense fallback={<Empty>正在准备三维关系图…</Empty>}><Graph3D graph={view} positions={positions} selected={selectedKey} focus={focus} reset={reset} onSelect={select} onUnavailable={message => { setUnavailable(message); setMode('list'); }}/></Suspense></GraphBoundary> : <div className="cmd-relation-list" aria-label="系统对象列表">{view.nodes.map(node => <button className={`cmd-relation-row ${selectedKey === node.key ? 'selected' : ''}`} key={node.key} onClick={() => select(node.key)}><i className={`cmd-type-dot ${node.kind}`}/><span><strong>{node.label}</strong><small>{kindNames[node.kind]}{node.status ? ` · ${statuses[node.status] || ({active:'进行中',archived:'已归档'})[node.status] || node.status}` : ''}{node.historical ? ' · 历史快照' : ''}</small></span><small>{usageText(node.usage)}</small></button>)}</div> : <Empty>{query || kind || focus.length ? '没有匹配的已加载关系，可返回全景或展开项目。' : '暂无可展示的授权业务资源。'}</Empty>}
      {mode === 'graph' && !unavailable&&<div className="cmd-graph-guide">拖动旋转 · 滚轮缩放 · 右键平移 · 点击查看</div>}
    </div>
    {selected&&<div className="cmd-object-detail" aria-label="所选对象详情"><div className="cmd-object-title"><i className={`cmd-type-dot ${selected.kind}`}/><strong>{selected.label}</strong><span>{kindNames[selected.kind]}</span><button className="btn-icon" aria-label="关闭对象详情" onClick={() => onSelect('')}><X size={14}/></button></div><p className="hub-muted">{usageText(selected.usage)}{selected.status ? ` · ${statuses[selected.status] || ({active:'进行中',archived:'已归档'})[selected.status] || selected.status}` : ''}{selected.historical ? ' · 来源于历史快照，当前目录不可见' : ''}</p>
      <div className="cmd-object-actions"><button onClick={() => onAsk(`请介绍${kindNames[selected.kind]}“${selected.label}”（ID：${selected.id}），查询其真实状态、关系和用量；如果有问题，说明证据与缺失信息。`)}><MessageCircle size={13}/>询问此对象</button><button onClick={() => onStatistics(selected.key)}><BarChart3 size={13}/>统计此对象</button>{!selected.historical&&<a href={objectUrl(selected)}><ExternalLink size={13}/>打开详情</a>}
        {selected.kind === 'project'&&<button onClick={() => expand(selected)}>展开任务（每批 50）</button>}{selected.kind === 'task'&&<><button onClick={() => onTaskDetail(selected)}>成果与执行详情</button><button onClick={() => loadTask(selected, true)}>刷新执行关系</button></>}
      </div>
      <div className="cmd-object-relations">{related.slice(0, 8).map(edge => <p key={edge.id} title={edge.provenance}><span className={edge.configured ? 'cmd-config-line' : 'cmd-fact-line'}/>{edge.label} · {graph.nodes.find(n => n.key === (edge.source === selectedKey ? edge.target : edge.source))?.label}<small>{edge.provenance}</small></p>)}{related.length > 8&&<p className="hub-muted">另有 {related.length - 8} 条关联，聚焦查看。</p>}{!related.length&&<p className="hub-muted">暂无已核实的关联。</p>}</div>
      {selected.kind === 'task'&&<p className="hub-muted">{!details[selected.id] ? '实际专家参与与派发关系正在按需读取。' : details[selected.id].partial ? '部分执行未读取完整。' : '已读取任务执行及持久化历史。'}{errors[selected.id] ? ` ${errors[selected.id]}` : ''}</p>}
    </div>}
    <div className="cmd-graph-footer"><span><i className="cmd-config-line"/>配置关系</span><span><i className="cmd-fact-line"/>归属／实际执行</span><span>任务已展示 {view.shownTasks}/{view.taskCount} · 同时最多 200</span>{Object.keys(expanded).length > 0&&<button onClick={() => setExpanded({})}>收起任务</button>}</div>
  </div>;
}
