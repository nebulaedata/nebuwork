import { esc } from '../workbench/ui.js';
import { statuses } from './agentState.js';

export const tokenCount = value => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-CN');
export function usageText(usage) {
  if (!usage || usage.unavailable) return '统计暂不可用';
  const total = usage.totalTokens ?? usage.tokens;
  if (total == null) return '用量未知';
  const text = `${tokenCount(total)} Tokens`;
  return usage.usageKnown === false ? `已记录 ${text}，部分用量未知` : text;
}
export function sumUsage(values) {
  if (values.some(v => !v || v.unavailable)) return { totalTokens: null, usageKnown: false, unavailable: true };
  const fields = ['totalTokens','inputTokens','outputTokens','cacheReadTokens','cacheWriteTokens','callCount','unknownCalls','pendingCalls'];
  const out = { usageKnown: values.every(v => v.usageKnown !== false) };
  for (const key of fields) out[key] = values.length && values.every(v => v[key] == null) ? null : values.reduce((sum,v) => sum + Number(v[key] ?? 0), 0);
  return out;
}
export function dailyUsage(values) {
  const days = new Map();
  for (const value of values) for (const day of value?.daily || []) { const list = days.get(day.date) || []; list.push(day); days.set(day.date, list); }
  return [...days].sort(([a],[b]) => a.localeCompare(b)).map(([date,list]) => ({ date, ...sumUsage(list) }));
}
export function usageTrend(usage) {
  if (usage?.unavailable) return '<div class="empty" role="status">用量统计暂不可用</div>';
  const today = new Date(Date.now() + 8*3600000).toISOString().slice(0,10);
  const byDate = new Map((usage?.daily || []).map(day => [day.date, day]));
  const days = Array.from({length:14},(_,i) => { const date = new Date(Date.parse(today+'T00:00:00Z')-(13-i)*86400000).toISOString().slice(0,10); return {date,totalTokens:0,...byDate.get(date)}; });
  if (!days.some(day => Number(day.totalTokens) > 0)) return `<div class="empty">${days.some(day=>day.totalTokens==null||day.usageKnown===false)?'部分执行用量未知':'暂无执行用量'}</div>`;
  const max = Math.max(...days.map(day => Number(day.totalTokens)||0),1);
  return `<svg viewBox="0 0 560 140" role="img" aria-label="近14日 Token 消耗，UTC+8" style="width:100%;height:150px">${days.map((day,i) => { const h=Number(day.totalTokens||0)/max*95; return `<g><title>${esc(day.date)}：${esc(usageText(day))}</title><rect x="${i*40+9}" y="${110-h}" width="22" height="${Math.max(h,1)}" rx="3" fill="var(--accent,#6C63F0)" opacity="${day.usageKnown===false?.5:.85}"/><text x="${i*40+20}" y="133" text-anchor="middle" fill="currentColor" font-size="9">${day.date.slice(5)}</text></g>`; }).join('')}</svg><div class="dim">按实际请求时间统计 · UTC+8${usage?.usageKnown===false?' · 部分调用未提供用量':''}</div>`;
}
export function taskDistribution(tasks = []) {
  if (!tasks.length) return '<div class="empty">暂无任务记录</div>';
  const counts = new Map(); for (const task of tasks) counts.set(task.status,(counts.get(task.status)||0)+1);
  return [...counts].map(([status,count])=>`<div class="file-row"><span>${esc(statuses[status]||status)}</span><span style="margin-left:auto">${count} 个</span></div>`).join('');
}
