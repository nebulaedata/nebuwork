import React, { useEffect, useState } from 'react';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { TaskDetail } from './TaskDetail.jsx';
import { statuses } from '../../tasks/agentState.js';
import { usageText } from '../../tasks/usage.js';
import { Empty, Notice, HubSelect, formatTime } from '../HubUI.jsx';
import { latestTasks, settledMap } from '../hubModel.js';


export { Commander } from './CommanderOverview.jsx';

export function TaskBoard({ projects, targets, onFollow }) {
  const [byProject, setByProject] = useState({}), [failures, setFailures] = useState({}), [updated, setUpdated] = useState('');
  const [projectId, setProjectId] = useState(''), [status, setStatus] = useState(''), [linked, setLinked] = useState(false);
  const [selected, setSelected] = useState(null), [reload, setReload] = useState(0), [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController(); let timer, pending = false;
    const load = async () => {
      if (pending || document.hidden || abort.signal.aborted) return; pending = true; setLoading(true);
      const results = await settledMap(projects, p => { if (abort.signal.aborted) throw new DOMException('已取消', 'AbortError'); return API.fetchProjectTasks(p.id, abort.signal); });
      if (!abort.signal.aborted) {
        setByProject(previous => { const next = Object.fromEntries(Object.entries(previous).filter(([id]) => projects.some(p => p.id === id))); results.forEach((r, i) => { const id = projects[i].id;
          if (r.status === 'fulfilled') next[id] = r.value.data.map(t => ({ ...t, projectId: id, projectName: projects[i].name }));
          else if ([401, 403, 404].includes(r.reason.status)) delete next[id];
        }); return next; });
        setFailures(Object.fromEntries(results.flatMap((r, i) => r.status === 'rejected' ? [[projects[i].id, r.reason.message]] : [])));
        setUpdated(new Date().toISOString()); setLoading(false);
      }
      pending = false;
    };
    void load(); timer = setInterval(load, 10000); document.addEventListener('visibilitychange', load);
    return () => { abort.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [projects, reload]);
  const tasks = latestTasks(Object.values(byProject).flat()).filter(t => (!projectId || t.projectId === projectId) && (!status || t.status === status) && (!linked || targets.has(t.id)));
  return <>
    <div className="hub-filters"><HubSelect label="任务项目" value={projectId || 'all'} options={[{ value: 'all', label: '全部项目' }, ...projects.map(p => ({ value: p.id, label: p.name }))]} onChange={v => setProjectId(v === 'all' ? '' : v)}/><HubSelect label="任务状态" value={status || 'all'} options={[{ value: 'all', label: '全部状态' }, ...Object.entries(statuses).map(([value, label]) => ({ value, label }))]} onChange={v => setStatus(v === 'all' ? '' : v)}/>
      <label className="hub-check"><input type="checkbox" checked={linked} onChange={e => setLinked(e.target.checked)}/>当前会话派发（{targets.size}）</label>
      <div className="hub-update"><span>{loading ? '正在刷新…' : `更新于 ${formatTime(updated)}`}</span><button className="btn-icon" aria-label="刷新任务看板" onClick={() => setReload(v => v + 1)}><RefreshCw size={14}/></button></div>
      {Object.entries(failures).map(([id, message]) => <Notice key={id}>{projects.find(p => p.id === id)?.name}：{message}；已有数据可能过期。</Notice>)}
    </div>
    <div className="cmd-task-cards">{tasks.map(t => <article key={t.id} className="cmd-task-card"><button className="cmd-task-main" onClick={() => setSelected(t)}><strong>{t.title}</strong><span className={`hub-status ${t.status}`}>{statuses[t.status] || t.status || '状态未知'}</span><small>{t.projectName} · {formatTime(t.updatedAt || t.createdAt)}</small><small>{usageText(t.usage)}{targets.has(t.id) ? ' · 本会话派发' : ''}{failures[t.projectId] ? ' · 数据过期' : ''}</small></button>{targets.has(t.id)&&onFollow&&<button className="cmd-follow" onClick={() => onFollow(t)}>继续跟踪／回传成果</button>}</article>)}{!tasks.length&&<Empty>{loading ? '正在读取任务…' : '暂无符合条件的任务'}</Empty>}</div>
    {selected&&<TaskDetail task={selected} close={() => setSelected(null)} onFollow={targets.has(selected.id) ? onFollow : undefined}/>}
  </>;
}
