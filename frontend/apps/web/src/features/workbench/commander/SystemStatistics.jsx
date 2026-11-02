import React, { useMemo } from 'react';
import { AlertCircle, MessageCircle, RefreshCw } from 'lucide-react';
import { formatTime, Empty, HubSelect } from '../HubUI.jsx';
import { statuses } from '../../tasks/agentState.js';
import { tokenCount, usageText } from '../../tasks/usage.js';
import { systemStatistics } from './systemModel.js';

export function SystemStatistics({ data, selected, scopeKey, onScope, graph, details, errors, loading, refresh, onSelect, onAsk, loadExpert }) {
  const scoped = graph.nodes.find(n => n.key === scopeKey);
  const stats = useMemo(() => systemStatistics(data, scoped, details), [data, scoped, details]);
  const days = useMemo(() => {
    const byDate = new Map(stats.daily.map(d => [d.date, d])), today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    return Array.from({ length: 14 }, (_, i) => { const date = new Date(Date.parse(`${today}T00:00:00Z`) - (13 - i) * 86400000).toISOString().slice(0, 10); return { date, totalTokens: stats.usage?.unavailable ? null : 0, ...byDate.get(date) }; });
  }, [stats.daily, stats.usage]);
  const max = Math.max(1, ...days.map(d => d.totalTokens || 0));
  const statisticsUnavailable = !data.loaded.projects || Object.hasOwn(data.errors, 'projects') || stats.usage?.unavailable || scoped?.kind === 'expert' && (!details[scoped.key] || details[scoped.key].usage?.unavailable);
  return <div className="cmd-statistics-content">
    <div className="cmd-stat-scope"><HubSelect label="统计范围" value={scopeKey || 'account'} options={[{ value: 'account', label: '当前账号' }, ...(scoped ? [{ value: scoped.key, label: scoped.label }] : []), ...(selected && selected.key !== scoped?.key ? [{ value: selected.key, label: selected.label }] : [])]} onChange={value => onScope(value === 'account' ? '' : value)}/><button className="btn-icon" aria-label="刷新系统统计" disabled={loading} onClick={refresh}><RefreshCw size={14}/></button></div>
    <p className="cmd-stat-updated">{loading ? '正在同步数据…' : `更新于 ${formatTime(data.updated)}`} · 累计口径</p>
    <p className="cmd-inventory-caption">当前账号资源</p>
    <div className="cmd-inventory">{[['工作台', data.loaded.workbenches ? stats.workbenchCount : null], ['项目', data.loaded.projects ? stats.projectCount : null], ['专家', data.loaded.experts ? stats.expertCount : null], ['任务', data.loaded.projects ? stats.taskCount : null]].map(([name, value]) => <div key={name}><strong>{tokenCount(value)}</strong><span>{name}</span></div>)}</div>
    <section className="cmd-token-summary"><span>累计消耗</span><strong>{stats.usage?.totalTokens != null && !stats.usage?.unavailable ? tokenCount(stats.usage.totalTokens) : '—'}<small>Tokens</small></strong><p>{usageText(stats.usage)}</p><div><span>今日消耗 · UTC+8</span><b>{usageText(stats.todayUsage)}</b></div></section>
    <div className="cmd-state-counts">{[['运行中', stats.active], ['失败', stats.failed], ['等待输入', stats.waiting], ['中断', stats.interrupted]].map(([label, value]) => <button key={label} onClick={() => onAsk(`请查询${scoped ? `“${scoped.label}”（${scoped.id}）范围` : '当前账号范围'}${label}的任务，核对真实执行状态与实际专家参与，说明可读取的问题证据；只查询，不修改任务。`)}><strong>{statisticsUnavailable ? '—' : value}</strong><span>{label}</span></button>)}</div>
    <section className="cmd-stat-section"><h3>近 14 日消耗 <small>UTC+8</small></h3>{!stats.dailyAvailable ? <p className="hub-muted">{scoped?.kind === 'task' ? '现有任务接口未提供按日用量，累计值见上方。' : '按日用量尚不可用，不以零补齐。'}</p> : <><div className="cmd-token-trend" role="img" aria-label="近14日实际Tokens趋势">{days.map(day => <div key={day.date} title={`${day.date}：${usageText(day)}`}><i style={{ height: `${Math.max(2, (day.totalTokens || 0) / max * 75)}px`, opacity: day.usageKnown === false || day.totalTokens == null ? .35 : .85 }}/></div>)}</div><div className="cmd-trend-dates"><span>{days[0].date.slice(5)}</span><span>{days.at(-1).date.slice(5)}</span></div></>}</section>
    <section className="cmd-stat-section"><h3>消耗较高 <small>前五名 · {scoped?.kind === 'expert' ? '已加载参与任务' : scoped ? '当前范围' : '按工作台'}</small></h3>{stats.ranks.map((row, i) => <button key={row.key} className="cmd-rank-row" onClick={() => onSelect(row.key)}><i>{i + 1}</i><span>{row.label}</span><small>{usageText(row.usage)}</small></button>)}{!stats.ranks.length&&<p className="hub-muted">暂无可比较的已记录用量。</p>}</section>
    <section className="cmd-stat-section"><h3><AlertCircle size={14}/>问题线索 <small>依据实际记录</small></h3>{Object.entries(errors).map(([key, message]) => <div className="cmd-source-issue" key={key}><b>来源读取提示</b><p>{message}</p><small>最近尝试 {formatTime(data.attemptedAt || data.updated)}；已有数据可能过期。</small></div>)}
      {stats.issues.slice(0, 20).map(task => <div className="cmd-system-issue" key={task.id}><button onClick={() => onSelect(`task:${task.id}`)}><strong>{task.title}</strong><span className={`hub-status ${task.status}`}>{statuses[task.status] || task.status}</span><small>{task.projectName || task.project || task.projectId} · {formatTime(task.updatedAt || task.time)}</small></button><button className="cmd-issue-ask" onClick={() => onAsk(`请只读核对任务“${task.title}”（ID：${task.id}，项目：${task.projectId}）的状态、错误信息和实际参与专家，分析问题与可行的处理方法。先说明证据；不要自动重试、停止或创建任务。`)}><MessageCircle size={12}/>询问原因与处理方法</button></div>)}
      {stats.usage?.unavailable&&<p className="hub-muted">用量统计暂不可用；未知状态不会计为零。</p>}
      {!stats.usage?.unavailable && !stats.issues.length && !Object.keys(errors).length&&<p className="hub-muted">当前已读取记录中，没有失败、等待输入或中断任务；不代表系统已经完成全面诊断。</p>}
      {stats.issues.length > 20&&<p className="hub-muted">展示前 20 条，可通过会话查询更多。</p>}
      {stats.partial&&<p className="hub-muted">状态数量优先使用完整统计，问题条目与任务排名仅含已加载参与记录。{details[scoped?.key]?.pagesStale ? '较早页面尚未刷新。' : '参与记录尚未加载完整。'}{scoped&&!scoped.historical&&<button onClick={() => details[scoped.key]?.pagesStale && !details[scoped.key]?.hasMore ? loadExpert(scoped, false, 'reset') : loadExpert(scoped, !!details[scoped.key])}>{details[scoped.key]?.pagesStale && !details[scoped.key]?.hasMore ? '重新读取参与记录' : '加载专家参与记录'}</button>}</p>}
    </section>
    {!data.loaded.projects&&<Empty>项目统计尚未读取成功。</Empty>}
  </div>;
}
