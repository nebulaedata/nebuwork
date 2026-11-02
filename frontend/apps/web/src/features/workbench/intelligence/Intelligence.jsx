import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Radar, FolderOpen, FileText, BookOpen, Search, RefreshCw, ArrowRight, Plus } from 'lucide-react';
import { AgentTask, FilePreview } from '../../tasks/AgentTask.jsx';
import { SourceNavigator, knowledgeTransport } from '../../knowledge/SourceReader.jsx';
import { knowledgeHref } from '../../knowledge/routes.js';
import { Empty, Notice, HubSelect, Overlay, formatTime } from '../HubUI.jsx';
import { analysisRequest, latestTasks, readPreference, savePreference, settledMap, sourceIdentity, sourceReference, taskArtifacts } from '../hubModel.js';

export function Intelligence({ project, catalog, account, preference, choose }) {
  const [sourceProject, setSourceProject] = useState(() => catalog.projects.some(p => p.id === preference.sourceProjectId) ? preference.sourceProjectId : project.id);
  const [sources, setSources] = useState({ refs: [], files: [] }), [sourceErrors, setSourceErrors] = useState([]), [sourceLoading, setSourceLoading] = useState(false);
  const [type, setType] = useState('all'), [refId, setRefId] = useState('all'), [query, setQuery] = useState(''), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const [rows, setRows] = useState([]), [hasMore, setHasMore] = useState(false), [warnings, setWarnings] = useState([]), [loading, setLoading] = useState(false), [revision, setRevision] = useState(0), [updated, setUpdated] = useState('');
  const [selected, setSelected] = useState([]), [detail, setDetail] = useState(null), [goal, setGoal] = useState('概括所选资料的关键事实、变化、风险及需要继续核实的问题。');
  const [analysisTask, setAnalysisTask] = useState(preference.taskId || ''), [history, setHistory] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [handoff, setHandoff] = useState(false);
  const life = useRef(null), pending = useRef(false), readCache = useRef(new Map()), previousSource = useRef('');
  useEffect(() => { const abort = new AbortController(); life.current = abort; return () => abort.abort(); }, []);
  useEffect(() => {
    const abort = new AbortController(); setSourceLoading(true); setSourceErrors([]);
    if (previousSource.current !== sourceProject) { setSources({ refs: [], files: [] }); setRows([]); readCache.current.clear(); setDetail(null); setRefId('all'); setPage(1); previousSource.current = sourceProject; }
    const p = catalog.projects.find(row => row.id === sourceProject);
    if (!p) { setSourceLoading(false); return () => abort.abort(); }
    Promise.allSettled([API.fetchKnowledgeScope('project', p.id, abort.signal), API.fetchKnowledgeScope('workbench', p.workbenchId, abort.signal), API.fetchProjectArtifacts(p.id, abort.signal)]).then(results => {
      if (abort.signal.aborted) return;
      setSources(previous => ({ refs: results.slice(0, 2).flatMap((r, i) => r.status === 'fulfilled' ? (r.value.data.knowledgeBases || []).map(ref => ({ ...ref, scopeKind: i === 0 ? 'project' : 'workbench', scopeId: i === 0 ? p.id : p.workbenchId, key: `${i}:${ref.id}` })) : [401,403,404].includes(r.reason.status) ? [] : previous.refs.filter(ref => ref.scopeKind === (i === 0 ? 'project' : 'workbench')).map(ref => ({ ...ref, stale: true }))),
        files: results[2].status === 'fulfilled' ? results[2].value.data.items.map(f => ({ ...f, kind: 'artifact', projectId: p.id })) : [401,403,404].includes(results[2].reason.status) ? [] : previous.files.map(f => ({ ...f, stale: true })) }));
      setSourceErrors(results.flatMap((r, i) => r.status === 'rejected' ? [`${['项目知识', '工作台知识', '项目成果'][i]}：${r.reason.message}`] : []));
      setSourceLoading(false);
    });
    return () => abort.abort();
  }, [sourceProject, catalog.projects, revision]);
  useEffect(() => {
    const abort = new AbortController(); if (sourceLoading) return () => abort.abort();
    setLoading(true); setWarnings([]);
    const refs = type === 'artifact' ? [] : sources.refs.filter(r => r.enabled && (refId === 'all' || r.key === refId));
    settledMap(refs, ref => API.readKnowledgeReference(ref.scopeKind, ref.scopeId, ref.id, { operation: search ? 'search' : 'documents', contentKind: ref.contentKind || (ref.type === 'wiki' ? 'wiki' : ref.type === 'faq' ? 'faq' : 'document'), query: search || undefined, page, pageSize: 20 }, abort.signal)).then(results => {
      if (abort.signal.aborted) return;
      const documents = results.flatMap((r, i) => {
        const cacheKey = JSON.stringify([refs[i].scopeKind, refs[i].scopeId, refs[i].id, search, page]);
        if (r.status === 'rejected') { if ([401,403,404].includes(r.reason.status)) readCache.current.delete(cacheKey); return (readCache.current.get(cacheKey) || []).map(row => ({ ...row, stale: true })); }
        const items = (r.value.data.results || r.value.data.documents || []).map(item => {
        const c = item.citation || {}, ref = refs[i];
        return { kind: 'knowledge', scopeKind: ref.scopeKind, scopeId: ref.scopeId, referenceId: ref.id, connectionId: ref.connectionId, collectionId: ref.collectionId,
          documentId: c.documentId || item.id, chunkId: c.chunkId, contentKind: c.contentKind || item.contentKind || ref.contentKind || (ref.type === 'wiki' ? 'wiki' : 'document'), title: c.title || item.title || item.name || item.id,
          text: item.text, reference: ref, citation: c, sourceName: ref.name };
        }); readCache.current.set(cacheKey, items); return items;
      });
      const files = type === 'knowledge' || refId !== 'all' ? [] : sources.files.filter(f => !search || f.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
      setRows([...new Map([...files, ...documents].map(row => [sourceIdentity(row), row])).values()]);
      setHasMore(results.some(r => r.status === 'fulfilled' && r.value.data.hasMore));
      setWarnings(results.flatMap((r, i) => r.status === 'rejected' ? [`${refs[i].name}：${r.reason.message}；保留的资料可能过期。`] : [ ...(r.value.data.partial ? [`${refs[i].name}：结果不完整`] : []), ...(r.value.data.warnings || []).map(w => typeof w === 'string' ? w : w.message) ]));
      setUpdated(new Date().toISOString()); setLoading(false);
    });
    return () => abort.abort();
  }, [sources, sourceLoading, type, refId, search, page]);
  useEffect(() => {
    const abort = new AbortController();
    API.fetchProjectTasks(project.id, abort.signal).then(({ data }) => {
      if (abort.signal.aborted) return;
      const tasks = latestTasks(data); setHistory(tasks);
      if (analysisTask && !tasks.some(t => t.id === analysisTask)) { setAnalysisTask(''); choose({ taskId: '' }); }
    }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [project.id, revision]);
  function toggle(row) { const id = sourceIdentity(row); setSelected(previous => previous.some(s => sourceIdentity(s) === id) ? previous.filter(s => sourceIdentity(s) !== id) : [...previous, row]); }
  async function analyse() {
    if (pending.current || !selected.length || !goal.trim()) return;
    pending.current = true; setBusy(true); setError('');
    try {
      // Supplying content creates and starts exactly once through the existing task contract.
      const { data } = await API.createTask(project.id, analysisRequest(goal.trim(), selected));
      if (life.current.signal.aborted) return;
      setAnalysisTask(data.task.id); choose({ taskId: data.task.id }); setHistory(previous => [data.task, ...previous.filter(t => t.id !== data.task.id)]);
    } catch (e) { if (!life.current.signal.aborted) setError(e.message); }
    finally { pending.current = false; if (!life.current.signal.aborted) setBusy(false); }
  }
  const selectedIds = new Set(selected.map(sourceIdentity));
  return <>
    <div className="intel-grid">
      <aside className="hub-panel intel-sources"><header className="hub-panel-head"><h2><FolderOpen size={15}/>资料来源</h2><button className="btn-icon" aria-label="刷新资料来源" onClick={() => setRevision(v => v + 1)}><RefreshCw size={14}/></button></header>
        <div className="hub-detail"><HubSelect label="来源项目" value={sourceProject} options={catalog.projects.map(p => ({ value: p.id, label: `${p.workbenchName || ''} / ${p.name}` }))} onChange={id => { setSourceProject(id); choose({ sourceProjectId: id }); }}/>
          <p className="hub-muted">汇聚项目成果及已授权的项目、工作台知识引用。</p>{sourceErrors.map((e, i) => <Notice key={i}>{e}</Notice>)}
          <button className={`hub-source-row ${refId === 'all' ? 'selected' : ''}`} onClick={() => { setRefId('all'); setPage(1); }}><Radar size={16}/><span>全部可见资料<small>{sources.files.length} 个成果 · {sources.refs.length} 个知识引用</small></span></button>
          {sources.refs.map(ref => <button key={ref.key} disabled={!ref.enabled} className={`hub-source-row ${refId === ref.key ? 'selected' : ''}`} onClick={() => { setRefId(ref.key); setType('knowledge'); setPage(1); }}><BookOpen size={16}/><span>{ref.name}<small>{ref.scopeKind === 'project' ? '项目' : '工作台'} · {ref.enabled ? '可访问' : '已停用'}</small></span></button>)}
          {!sources.refs.length&&!sourceLoading&&<p className="hub-muted">当前来源没有可见知识引用。可切换项目，或前往项目配置引用。</p>}
          <h3>已选资料（{selected.length}）</h3>{selected.map(row => <button key={sourceIdentity(row)} className="hub-source-row" onClick={() => toggle(row)}><span>{row.name || row.title}<small>{row.kind === 'artifact' ? `成果 v${row.version}` : row.sourceName} · 点击移除</small></span></button>)}
        </div>
      </aside>
      <section className="hub-panel intel-library"><header className="hub-panel-head"><h2><Search size={15}/>资料列表</h2><span className="hub-muted">{sourceLoading || loading ? '正在读取…' : `更新于 ${formatTime(updated)}`}</span></header>
        <form className="intel-search" onSubmit={e => { e.preventDefault(); setSearch(query.trim()); setPage(1); }}><input aria-label="检索情报资料" value={query} onChange={e => setQuery(e.target.value)} placeholder="检索知识内容或成果名称"/><button className="btn btn-primary" disabled={loading}>检索</button></form>
        <div className="intel-list-filters"><HubSelect label="资料类型" value={type} options={[{ value: 'all', label: '知识与成果' }, { value: 'knowledge', label: '知识资料' }, { value: 'artifact', label: '项目成果' }]} onChange={value => { setType(value); setRefId('all'); setPage(1); }}/></div>
        {warnings.map((w, i) => <Notice key={i}>{w}</Notice>)}
        <div className="intel-results">{rows.map(row => <article className={`intel-result ${detail&&sourceIdentity(detail) === sourceIdentity(row) ? 'selected' : ''}`} key={sourceIdentity(row)}><input type="checkbox" aria-label={`选择${row.name || row.title}`} checked={selectedIds.has(sourceIdentity(row))} onChange={() => toggle(row)}/><button onClick={() => setDetail(row)}>{row.kind === 'artifact' ? <FileText size={19}/> : <BookOpen size={19}/>}<span><strong>{row.name || row.title}</strong><small>{row.kind === 'artifact' ? `项目成果 · v${row.version}` : row.sourceName}{row.stale ? ' · 数据过期' : ''}</small>{row.text&&<p>{row.text.slice(0, 200)}</p>}</span></button></article>)}{!rows.length&&!loading&&!sourceLoading&&<Empty>{warnings.length || sourceErrors.length ? '部分来源读取失败，请重试或切换来源。' : '暂无可见资料。请切换项目或调整关键词。'}</Empty>}</div>
        {(hasMore || page > 1)&&<div className="hub-pagination"><button className="btn btn-ghost" disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>上一页</button><span>知识资料第 {page} 页</span><button className="btn btn-ghost" disabled={!hasMore || loading} onClick={() => setPage(p => p + 1)}>下一页</button></div>}
      </section>
      <section className="hub-panel intel-analysis"><header className="hub-panel-head"><h2><Radar size={15}/>按需分析</h2><span className="pill pill-dim">独立会话</span></header><div className="intel-analysis-controls"><label className="field">分析目标<textarea aria-label="情报分析目标" rows={3} value={goal} onChange={e => setGoal(e.target.value)}/></label><Notice>{error}</Notice><div className="hub-actions"><button className="btn btn-primary" disabled={busy || !selected.length || !goal.trim()} onClick={analyse}><Plus size={14}/>{busy ? '正在提交…' : '分析所选资料'}</button><button className="btn btn-ghost" disabled={!selected.length && !analysisTask} onClick={() => setHandoff(true)}><ArrowRight size={14}/>交给指挥官</button></div><HubSelect label="分析历史" value={analysisTask} options={history.map(t => ({ value: t.id, label: t.title }))} onChange={id => { setAnalysisTask(id); choose({ taskId: id }); }}/></div>
        {analysisTask ? <AgentTask key={analysisTask} taskId={analysisTask} embedded/> : <Empty>选择真实资料后发起分析。资料浏览和刷新不会启动智能体。</Empty>}
      </section>
    </div>
    {detail&&<SourceDetail row={detail} close={() => setDetail(null)} onSelect={() => toggle(detail)} selected={selectedIds.has(sourceIdentity(detail))}/>}
    {handoff&&<Handoff catalog={catalog} account={account} selected={selected} analysisTask={analysisTask} analysisProject={project.id} defaultGoal={goal} close={() => setHandoff(false)}/>}
  </>;
}
function SourceDetail({ row, close, onSelect, selected }) {
  const transport = useMemo(() => row.kind === 'knowledge' ? knowledgeTransport(row.reference, (body, signal) => API.readKnowledgeReference(row.scopeKind, row.scopeId, row.referenceId, body, signal)) : null, [row]);
  const abort = useMemo(() => new AbortController(), [row]);
  useEffect(() => () => abort.abort(), [abort]);
  return <Overlay title={row.name || row.title} close={close}><div className="hub-detail"><button className="btn btn-primary" onClick={onSelect}>{selected ? '移出分析资料' : '加入分析资料'}</button>{row.kind === 'knowledge'&&<a className="btn btn-ghost" href={knowledgeHref(row.reference, { from: '#/workbench?tab=intel' })}>打开知识库</a>}</div>{row.kind === 'artifact' ? <FilePreview projectId={row.projectId} file={row} close={close}/> : <SourceNavigator source={{ ...row.citation, documentId: row.documentId, chunkId: row.chunkId, title: row.title, contentKind: row.contentKind, text: row.text }} transport={transport} parentSignal={abort.signal}/>}</Overlay>;
}
export function Handoff({ catalog, account, selected, analysisTask, analysisProject, defaultGoal, close }) {
  const saved = useMemo(() => readPreference(account, 'commander'), [account]);
  const [wb, setWb] = useState(() => catalog.workbenches.some(w => w.id === saved.workbenchId) ? saved.workbenchId : catalog.workbenches.find(w => w.name === '指挥官')?.id || '');
  const [project, setProject] = useState(saved.projectId || ''), [tasks, setTasks] = useState([]), [target, setTarget] = useState(saved.taskId || 'new');
  const [goal, setGoal] = useState(defaultGoal), [refs, setRefs] = useState(selected.map(sourceReference)), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [taskLoading, setTaskLoading] = useState(true), [error, setError] = useState('');
  const attempt = useRef(null), life = useRef(null), pending = useRef(false);
  const availableProjects = catalog.projects.filter(p => p.workbenchId === wb), validProject = availableProjects.some(p => p.id === project);
  useEffect(() => { const abort = new AbortController(); life.current = abort; return () => abort.abort(); }, []);
  useEffect(() => { if (!validProject) setProject(availableProjects.find(p => p.name === '指挥中心')?.id || (availableProjects.length === 1 ? availableProjects[0].id : '')); }, [wb, validProject]);
  useEffect(() => {
    const abort = new AbortController(); setTasks([]); setTaskLoading(true); if (!validProject) return () => abort.abort();
    API.fetchProjectTasks(project, abort.signal).then(({ data }) => { if (!abort.signal.aborted) { setTasks(latestTasks(data)); setTarget(old => data.some(t => t.id === old) ? old : 'new'); setTaskLoading(false); } }).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [project, validProject]);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true);
    (async () => { let artifacts = [];
      if (analysisTask) { const [files, task] = await Promise.all([API.fetchProjectArtifacts(analysisProject, abort.signal), API.fetchTask(analysisTask, abort.signal)]); artifacts = taskArtifacts(files.data.items, task.data).map(f => sourceReference({ ...f, kind: 'artifact', projectId: analysisProject })); }
      if (!abort.signal.aborted) setRefs([...selected.map(sourceReference), ...artifacts]);
    })().catch(e => { if (!abort.signal.aborted) setError(`分析成果读取失败：${e.message}`); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [analysisTask, analysisProject, selected]);
  async function send() {
    if (pending.current || taskLoading || !validProject || (target !== 'new' && !tasks.some(t => t.id === target)) || !goal.trim()) return; pending.current = true; setBusy(true); setError('');
    try {
      const content = `情报中心转交目标：${goal.trim()}\n\n${analysisTask ? `分析任务：${analysisTask}，项目：${analysisProject}。\n` : ''}请先核验以下资料与成果，再依据目标决定后续工作。跨项目文件通过已授权只读工具读取；需要回传时导入固定版本。不得仅凭引用推断内容，不重复创建任务。\n${JSON.stringify(refs, null, 2)}`;
      // Keep a two-stage attempt in memory: a successful create is never repeated if sending is uncertain.
      const fingerprint = JSON.stringify([project, target, content]);
      if (attempt.current && attempt.current.fingerprint !== fingerprint) throw new Error('上次转交结果尚未确认，请保持目标和资料不变后重试。');
      attempt.current ||= { fingerprint, taskId: target !== 'new' ? target : null };
      // The shared API transport retains each uncertain write key, including after this dialog reopens.
      if (!attempt.current.taskId) { const { data } = await API.createTask(project, { title: '指挥官主会话', context: { entry: 'commander' } }); attempt.current.taskId = data.task.id; }
      if (life.current.signal.aborted) return;
      savePreference(account, 'commander', { workbenchId: wb, projectId: project, taskId: attempt.current.taskId });
      await API.sendTask(attempt.current.taskId, { content });
      if (life.current.signal.aborted) return;
      savePreference(account, 'commander', { workbenchId: wb, projectId: project, taskId: attempt.current.taskId });
      location.hash = '#/workbench?tab=commander'; close();
    } catch (e) { if (!life.current.signal.aborted) setError(e.message); }
    finally { pending.current = false; if (!life.current.signal.aborted) setBusy(false); }
  }
  return <Overlay title="交给指挥官" close={close}><div className="hub-detail"><HubSelect label="接收工作台" value={wb} options={catalog.workbenches.map(w => ({ value: w.id, label: w.name }))} onChange={setWb} disabled={busy}/><HubSelect label="接收项目" value={validProject ? project : ''} options={availableProjects.map(p => ({ value: p.id, label: p.name }))} onChange={setProject} disabled={busy}/><HubSelect label="接收主会话" value={target} options={[{ value: 'new', label: '新建指挥官主会话' }, ...tasks.map(t => ({ value: t.id, label: t.title }))]} onChange={setTarget} disabled={busy}/><label className="field">确认转交目标<textarea aria-label="确认转交目标" rows={4} value={goal} onChange={e => setGoal(e.target.value)} disabled={busy}/></label><p>共 {refs.length} 项来源引用{analysisTask ? '，附分析任务编号' : ''}。</p><pre>{JSON.stringify(refs, null, 2)}</pre><Notice>{error}</Notice><button className="btn btn-primary" disabled={busy || loading || taskLoading || !validProject || (target !== 'new' && !tasks.some(t => t.id === target)) || !goal.trim()} onClick={send}>{busy ? '正在转交…' : '确认转交'}</button></div></Overlay>;
}
