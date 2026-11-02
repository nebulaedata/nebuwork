import { createUuid } from '../../lib/uuid.js';
import { useEffect, useRef, useState } from 'react';

const current = () => true;
const when = time => time ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '—';
export function EngineSettings({ call, isCurrent = current }) {
  const [draft, setDraft] = useState(null), [signingKey, setSigningKey] = useState(''), [callbackKey, setCallbackKey] = useState('');
  const [error, setError] = useState(''), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [revision, reload] = useState(0);
  const [status, setStatus] = useState(null), [statusError, setStatusError] = useState(''), [checking, setChecking] = useState(false), [isDraftCheck, setIsDraftCheck] = useState(false);
  const attempt = useRef(null), pending = useRef(false), scope = useRef(null), statusRequest = useRef(0);
  const live = () => isCurrent() && !scope.current?.signal.aborted;
  const refreshStatus = async () => {
    const request = ++statusRequest.current;
    setChecking(true); setStatusError('');
    try { const result = await call('/status', 'GET', undefined, { signal: scope.current.signal });
      if (live() && request === statusRequest.current) { setStatus(result); setIsDraftCheck(false); }
    } catch (e) { if (live() && request === statusRequest.current && e.name !== 'AbortError') setStatusError(e.message); }
    finally { if (live() && request === statusRequest.current) setChecking(false); }
  };
  useEffect(() => {
    const controller = new AbortController(); scope.current = controller;
    setError(''); setNote(''); setSigningKey(''); setCallbackKey(''); attempt.current = null;
    void call('', 'GET', undefined, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted || !isCurrent()) return;
      setDraft({ ...result, apiUrls: result.apiUrls?.length ? result.apiUrls : [''], namespace: result.namespace || 'nebuwork-v2', sandboxImage: result.sandboxImage || 'nebu-agent-sandbox:1', requestTimeoutMs: result.requestTimeoutMs || 15000 });
      if (result.canEdit && result.configured) void refreshStatus();
    }).catch(e => { if (!controller.signal.aborted && isCurrent() && e.name !== 'AbortError') setError(e.message); });
    return () => { controller.abort(); statusRequest.current++; };
  }, [call, isCurrent, revision]);
  if (!draft) return <section className="card engine-settings"><h2>智能体引擎</h2><p>{error || '正在加载连接配置…'}</p>{error && <button className="btn btn-ghost" onClick={() => reload(v => v + 1)}>重新加载</button>}</section>;
  if (!draft.canEdit) return <section className="card engine-settings"><h2>智能体引擎</h2><p>平台引擎：{draft.configured ? '已配置' : '尚未配置'}</p><p className="dim">仅指定管理员可以维护集群连接，各账号的任务和会话继续独立授权。</p><p className="dim">当前账号 ID：<code>{draft.actorId}</code></p></section>;
  const dirty = () => { attempt.current = null; setError(''); setNote(''); if (isDraftCheck) setStatus(null); };
  const edit = change => { setDraft(value => ({ ...value, ...change })); dirty(); };
  const body = () => ({ revision: draft.revision, apiUrls: draft.apiUrls.map(url => url.trim()), namespace: draft.namespace.trim(), sandboxImage: draft.sandboxImage.trim(), requestTimeoutMs: Number(draft.requestTimeoutMs), signingKey, callbackKey });
  const run = async save => {
    if (pending.current || !live()) return;
    pending.current = true; setBusy(true); setError(''); setNote('');
    try {
      if (save) {
        attempt.current ||= createUuid();
        const result = await call('', 'POST', body(), { key: attempt.current, signal: scope.current.signal });
        if (!live()) return;
        setDraft(result); setSigningKey(''); setCallbackKey(''); attempt.current = null;
        setNote('配置已保存，后续请求立即使用数据库中的配置。'); void refreshStatus();
      } else {
        ++statusRequest.current; setChecking(false);
        const result = await call('/test', 'POST', body(), { signal: scope.current.signal });
        if (!live()) return;
        setStatus(result); setStatusError(''); setIsDraftCheck(true); setNote(result.message + '。本次检查未保存配置。');
      }
    } catch (e) { if (live() && e.name !== 'AbortError') setError(e.message || '操作失败，请重试'); }
    finally { pending.current = false; if (live()) setBusy(false); }
  };
  const workers = status?.workers || [], online = workers.filter(worker => worker.online).length;
  return <div className="engine-settings-layout">
    <section className="card engine-settings">
      <div className="engine-settings-heading"><div><h2>智能体引擎</h2><p className="dim">统一管理平台到引擎的连接。API 接收请求，Worker 执行任务，共享存储保存会话和成果。</p></div><span className={'pill ' + (draft.configured ? 'pill-success' : 'pill-dim')}>{draft.configured ? '已保存连接' : '待配置'}</span></div>
      <form autoComplete="off" onSubmit={event => { event.preventDefault(); void run(true); }}><fieldset disabled={busy}>
        <div className="engine-node-heading"><label>API 节点</label><button type="button" className="btn btn-ghost btn-sm" disabled={draft.apiUrls.length >= 8} onClick={() => edit({ apiUrls: [...draft.apiUrls, ''] })}>添加节点</button></div>
        <p className="dim engine-help">填写 Java 后端可访问的地址。可以配置一个负载均衡地址，也可以添加同一集群的多个 API 节点。</p>
        <div className="engine-node-inputs">{draft.apiUrls.map((url, index) => <div className="engine-node-input" key={index}><span className="engine-node-number">{index + 1}</span><input aria-label={`API 节点 ${index + 1}`} type="url" required maxLength={2048} placeholder="http://127.0.0.1:42110" value={url} onChange={event => edit({ apiUrls: draft.apiUrls.map((value, i) => i === index ? event.target.value : value) })} /><button type="button" className="btn btn-ghost btn-sm" disabled={draft.apiUrls.length === 1} aria-label={`移除 API 节点 ${index + 1}`} onClick={() => edit({ apiUrls: draft.apiUrls.filter((_, i) => i !== index) })}>移除</button></div>)}</div>
        <div className="engine-settings-grid">
          <label>签名密钥<input aria-label="签名密钥" type="password" autoComplete="new-password" maxLength={512} value={signingKey} placeholder={draft.hasSigningKey ? '已保存，留空保留' : '填写引擎 ENGINE_SIGNING_KEY'} onChange={e => { setSigningKey(e.target.value); dirty(); }} /><small>用于平台访问 API，所有 API 节点使用同一签名密钥。</small></label>
          <label>回调密钥<input aria-label="回调密钥" type="password" autoComplete="new-password" maxLength={512} value={callbackKey} placeholder={draft.hasCallbackKey ? '已保存，留空保留' : '填写引擎 BUSINESS_API_KEY'} onChange={e => { setCallbackKey(e.target.value); dirty(); }} /><small>用于 Worker 回调平台，需要与各 Worker 的部署配置一致。</small></label>
          <label>业务命名空间<input aria-label="业务命名空间" required maxLength={128} value={draft.namespace} readOnly={draft.configured} onChange={e => edit({ namespace: e.target.value })} /><small>{draft.configured ? '已绑定现有业务，避免变更后无法访问原有会话和成果。' : '首次保存后固定，账号和项目权限在此范围内生效。'}</small></label>
          <label>任务沙箱镜像<input aria-label="任务沙箱镜像" required maxLength={240} value={draft.sandboxImage} onChange={e => edit({ sandboxImage: e.target.value })} /><small>各 Worker 主机都需具备对应镜像。</small></label>
          <label>请求超时（毫秒）<input aria-label="请求超时" required type="number" min={1000} max={60000} step={1} value={draft.requestTimeoutMs} onChange={e => edit({ requestTimeoutMs: e.target.value })} /></label>
        </div>
        <div className="engine-settings-actions"><button type="button" className="btn btn-ghost" onClick={() => void run(false)}>检查连接</button><button type="submit" className="btn btn-primary">保存配置</button><button type="button" className="btn btn-ghost" onClick={() => reload(v => v + 1)}>重新加载</button></div>
      </fieldset></form>
      {error && <p className="engine-error" role="alert">{error}</p>}<p role="status" aria-live="polite">{note}</p>
    </section>
    <section className="card engine-settings"><div className="engine-settings-heading"><div><h2>{isDraftCheck ? '草稿连接检查' : '集群状态'}</h2><p className="dim">{status ? `检查于 ${when(status.checkedAt)}` : '检查连接后展示实际节点状态。'}</p></div><button className="btn btn-ghost btn-sm" disabled={!draft.configured || checking || busy} onClick={() => void refreshStatus()}>{checking ? '正在检查…' : '刷新状态'}</button></div>
      {statusError && <p className="engine-error" role="alert">{statusError}</p>}
      {status && <><div className="engine-cluster-summary"><span><strong>{status.nodes.filter(node => node.ready).length}/{status.nodes.length}</strong> API 可用</span><span><strong>{online}</strong> Worker 在线</span><span className="dim">集群 <code>{status.clusterId || '尚未确认'}</code></span></div>
        <div className="engine-status-grid">{status.nodes.map(node => <article className="engine-status-node" key={node.url}><div><strong>API 节点</strong><span className={'pill ' + (node.ready ? 'pill-success' : 'pill-danger')}>{node.ready ? '可用' : '异常'}</span></div><code>{node.url}</code><small>{node.message} · {node.latencyMs} ms</small></article>)}</div>
        <h3>执行节点</h3><p className="dim engine-help">Worker 自动登记心跳，无需逐个填写地址。超过 30 秒没有心跳显示离线；此处不负责启动容器。</p>
        {!workers.length && <p className="dim">尚未发现 Worker，请确认执行节点已连接同一个引擎数据库。</p>}
        <div className="engine-status-grid">{workers.map(worker => <article className="engine-status-node" key={worker.id}><div><strong>{worker.hostname}</strong><span className={'pill ' + (worker.online ? 'pill-success' : 'pill-dim')}>{worker.online ? '在线' : '离线'}</span></div><small>执行 {worker.active} / 容量 {worker.capacity} · 等待 {worker.waiting}</small><small>最近心跳 {when(worker.lastSeen)}</small>{worker.storageId !== status.storageId && <small className="engine-error">共享文件配置与 API 不一致</small>}</article>)}</div>
      </>}
    </section>
  </div>;
}
