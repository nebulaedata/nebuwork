import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { workflowKey } from '../../services/workflowKey.js';
export const WorkflowContext = createContext(null);
export const key = workflowKey;
export const pretty = value => JSON.stringify(value, null, 2);
export const creationNames = { pending: '等待创建', syncing: '正在创建', ready: '已创建', failed: '创建失败' };
export const date = value => value ? new Date(typeof value === 'number' ? value * 1000 : value).toLocaleString('zh-CN', { hour12: false }) : '—';
export const Button = ({ primary, children, ...props }) => <button className={'btn ' + (primary ? 'btn-primary' : 'btn-ghost')} {...props}>{children}</button>;
export const Notice = ({ error }) => error ? <div className="wf-error" role="alert">{error}</div> : null;
export function useApi() {
  const context = useContext(WorkflowContext), scope = useRef(new AbortController());
  useEffect(() => {
    if (scope.current.signal.aborted) scope.current = new AbortController();
    return () => scope.current.abort();
  }, []);
  const call = useCallback((path, method, body, options) => context.call(path, method, body, { ...options,
    signal: options?.signal ? AbortSignal.any([scope.current.signal, options.signal]) : scope.current.signal }), [context]);
  const live = useCallback(() => !scope.current.signal.aborted && context.live(), [context]);
  return { call, live, artifactUrl: context.artifactUrl || ((id, artifact) => API.workflowArtifactUrl(id, artifact)) };
}
export function useJob() {
  const { live } = useApi(); const [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState('');
  const busyRef = useRef(false);
  const run = async operation => {
    if (busyRef.current || !live()) return;
    busyRef.current = true; setBusy(true); setError(''); setNote('');
    try { await operation(); }
    catch (e) { if (live() && e.name !== 'AbortError') setError(e.message || '操作失败，请重试'); }
    finally { busyRef.current = false; if (live()) setBusy(false); }
  };
  return { busy, error, note, setError, setNote, run };
}
export const creating = data => !!data?.enabled && ['pending', 'syncing'].includes(data.status);
export function useWatch(path, poll = () => false) {
  const { call, live } = useApi(), [data, setData] = useState(null), [error, setError] = useState(''), [version, setVersion] = useState(0);
  const pollRef = useRef(poll); pollRef.current = poll;
  const reload = useCallback(() => setVersion(v => v + 1), []);
  const accept = useCallback(value => { setData(value); setError(''); }, []);
  useEffect(() => {
    let alive = true, timer; const controller = new AbortController();
    const load = async () => {
      try {
        const result = await call(path, 'GET', undefined, { signal: controller.signal });
        if (!alive || !live()) return;
        setData(result); setError('');
        if (pollRef.current(result)) timer = setTimeout(load, 2000);
      } catch (e) { if (alive && live() && e.name !== 'AbortError') setError(e.message); }
    };
    if (path) void load();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [call, live, path, version]);
  return { data, error, reload, accept };
}
export const Loading = ({ error, reload }) => <section className="card wf-empty"><Notice error={error} /><p>{error ? '数据加载失败' : '正在加载…'}</p>{error && <Button onClick={reload}>重新加载</Button>}</section>;
export function Creation({ data, retry }) {
  return <section className="card wf-empty"><strong>{creationNames[data.status]}</strong><p>{data.status === 'failed' ? data.error : data.status === 'ready' ? '已创建，当前接入不可用。' : '正在创建，请稍候。'}</p>{data.enabled === false && <p>Workflow 接入已关闭，请联系管理员。</p>}{data.status === 'failed' && <Button disabled={data.enabled === false} onClick={retry}>重试原操作</Button>}</section>;
}
