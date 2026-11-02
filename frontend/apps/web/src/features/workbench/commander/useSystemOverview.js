import { useCallback, useEffect, useRef, useState } from 'react';
import { accountTasks, factsFromEvents, nodeKey } from './systemModel.js';

/** One read pool for lazy version/run/history details. No automatic writes or model calls. */
export function readQueue(limit = 4) {
  let active = 0, closed = false; const waiting = [];
  const pump = () => { while (!closed && active < limit && waiting.length) {
    const job = waiting.shift(); active++;
    Promise.resolve().then(job.fn).then(job.resolve, job.reject).finally(() => { active--; pump(); });
  } };
  return { run: fn => new Promise((resolve, reject) => { if (closed) return reject(new DOMException('已取消', 'AbortError')); waiting.push({ fn, resolve, reject }); pump(); }),
    close: () => { closed = true; waiting.splice(0).forEach(job => job.reject(new DOMException('已取消', 'AbortError'))); } };
}

export function useSystemOverview(catalog) {
  const [data, setData] = useState(() => ({ ...structuredClone(catalog), experts: [], loaded: { workbenches: true, projects: true, experts: false }, errors: {}, updated: '', attemptedAt: '' }));
  const [versions, setVersions] = useState({}), [details, setDetails] = useState({}), [extraErrors, setExtraErrors] = useState({});
  const [loading, setLoading] = useState(true), [tick, setTick] = useState(0);
  const life = useRef(null), cache = useRef({}), inFlight = useRef(new Map());
  useEffect(() => {
    const controller = new AbortController(), queue = readQueue(4); life.current = { controller, queue };
    return () => { controller.abort(); queue.close(); cache.current = {}; inFlight.current.clear(); };
  }, []);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => {
    const controller = new AbortController(); let pending = false;
    const load = async () => {
      if (pending || document.hidden || controller.signal.aborted) return;
      pending = true; setLoading(true);
      const keys = ['workbenches', 'projects', 'experts'];
      const results = await Promise.allSettled([API.fetchWorkbenches(), API.fetchProjects(), API.fetchAgents()]);
      if (!controller.signal.aborted) {
        setData(old => { const now = new Date().toISOString(), next = { ...old, errors: {}, loaded: { ...old.loaded }, attemptedAt: now, updated: results[1].status === 'fulfilled' ? now : old.updated };
          results.forEach((result, i) => { const key = keys[i];
            if (result.status === 'fulfilled') { next[key] = structuredClone(result.value.data); next.loaded[key] = true; }
            else { next.errors[key] = result.reason.message; if ([401, 403, 404].includes(result.reason.status)) { next[key] = []; next.loaded[key] = false; } }
          }); return next; });
        if (results[1].status === 'fulfilled') {
          const ids = new Set(accountTasks(results[1].value.data).map(t => t.id));
          setDetails(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key.startsWith('expert:') || ids.has(key))));
          for (const id of Object.keys(cache.current)) if (!id.startsWith('expert:') && !ids.has(id)) delete cache.current[id];
        } else if ([401, 403, 404].includes(results[1].reason.status)) { setDetails({}); cache.current = {}; }
        if (results[2].status === 'rejected' && [401, 403, 404].includes(results[2].reason.status)) setDetails(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => !key.startsWith('expert:'))));
        setLoading(false);
      }
      pending = false;
    };
    void load(); const timer = setInterval(load, 10000); document.addEventListener('visibilitychange', load);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [tick]);

  useEffect(() => {
    const { controller, queue } = life.current;
    const missing = data.workbenches.filter(w => w.activeVersionId && !versions[w.activeVersionId]);
    missing.forEach(w => {
      const key = `version:${w.activeVersionId}`; if (inFlight.current.has(key)) return;
      const promise = queue.run(() => API.fetchWorkbenchVersion(w.id, w.activeVersionId)); inFlight.current.set(key, promise);
      promise.then(({ data: value }) => { if (!controller.signal.aborted) { setVersions(previous => ({ ...previous, [w.activeVersionId]: value })); setExtraErrors(previous => { const next = { ...previous }; delete next[key]; return next; }); } })
        .catch(error => { if (!controller.signal.aborted) setExtraErrors(previous => ({ ...previous, [key]: `${w.name}发布关系：${error.message}` })); })
        .finally(() => inFlight.current.delete(key));
    });
  }, [data.workbenches, versions]);

  const loadTask = useCallback((task, force = false) => {
    if (!task?.id) return Promise.resolve();
    const key = task.id, { controller, queue } = life.current;
    if (inFlight.current.has(key)) return inFlight.current.get(key);
    if (cache.current[key] && !force) return Promise.resolve(cache.current[key]);
    const promise = (async () => {
      try {
        const { data: projection } = await queue.run(() => API.fetchTask(key, controller.signal));
        if (controller.signal.aborted) return;
        const runResults = await Promise.allSettled((projection.runs || []).map(run => queue.run(() => API.fetchAgentRun(key, run.id, controller.signal))));
        const runDetails = Object.fromEntries(runResults.flatMap((result, i) => result.status === 'fulfilled' ? [[projection.runs[i].id, result.value.data]] : []));
        const events = new Map((projection.events || []).map(e => [e.sequence, e])); let cursor = 0;
        for (;;) {
          const { data: page } = await queue.run(() => API.fetchTaskHistory(key, cursor, controller.signal));
          if (controller.signal.aborted) return;
          const items = page.items || []; items.forEach(e => events.set(e.sequence, e));
          const next = items.at(-1)?.sequence; if (!next || next <= cursor || page.hasMore === false) break; cursor = next;
        }
        const result = { ...projection, runDetails, state: factsFromEvents([...events.values()], projection.session.id), loadedAt: Date.now(), partial: runResults.some(r => r.status === 'rejected') };
        if (!controller.signal.aborted) { cache.current[key] = result; setDetails(old => ({ ...old, [key]: result })); setExtraErrors(old => { const next = { ...old }; delete next[key]; if (result.partial) next[key] = '部分执行详情读取失败，关系尚未加载完整。'; return next; }); }
        return result;
      } catch (error) { if (!controller.signal.aborted) { setExtraErrors(old => ({ ...old, [key]: `${task.title || '任务'}：${error.message}` })); if ([401, 403, 404].includes(error.status)) { delete cache.current[key]; setDetails(old => { const next = { ...old }; delete next[key]; return next; }); } } }
      finally { inFlight.current.delete(key); }
    })(); inFlight.current.set(key, promise); return promise;
  }, []);
  const loadExpert = useCallback((expert, more = false, refresh = false) => {
    const key = nodeKey('expert', expert.id), { controller, queue } = life.current;
    if (inFlight.current.has(key)) return inFlight.current.get(key);
    if (cache.current[key] && !more && !refresh) return Promise.resolve(cache.current[key]);
    const offset = more ? (cache.current[key]?.offset || 0) + 50 : 0;
    const promise = queue.run(() => API.fetchAgentDetail(expert.id, offset)).then(({ data: value }) => {
      if (controller.signal.aborted) return;
      const previous = cache.current[key], preserve = refresh === true && previous?.offset > 0;
      const incoming = value.tasks || [], incomingIds = new Set(incoming.map(t => t.id));
      const result = { ...value, loadedAt: Date.now(), tasks: offset ? [...new Map([...(previous?.tasks || []), ...incoming].map(t => [t.id, t])).values()] : preserve ? [...incoming, ...previous.tasks.filter(t => !incomingIds.has(t.id))] : incoming,
        ...(offset && previous?.pagesStale ? { pagesStale: true } : {}),
        ...(preserve ? { offset: previous.offset, hasMore: previous.offset + 50 < value.taskTotal, pagesStale: true } : {}) };
      cache.current[key] = result; setDetails(old => ({ ...old, [key]: result })); setExtraErrors(old => { const next = { ...old }; delete next[key]; if(value.usage?.unavailable) next[key] = `${expert.label}：专家统计暂不可用。`; return next; }); return result;
    }).catch(error => { if (!controller.signal.aborted) { setExtraErrors(old => ({ ...old, [key]: `${expert.label}：${error.message}` })); if ([401, 403, 404].includes(error.status)) { delete cache.current[key]; setDetails(old => { const next = { ...old }; delete next[key]; return next; }); } } }).finally(() => inFlight.current.delete(key));
    inFlight.current.set(key, promise); return promise;
  }, []);
  return { data, versions, details, loading, refresh, loadTask, loadExpert, errors: { ...data.errors, ...extraErrors } };
}
