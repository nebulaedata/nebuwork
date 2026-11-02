import React, { useEffect, useRef, useState } from 'react';
import { Input, Modal, Select } from 'antd';
import { CheckCircle2, FileText, Plug, RefreshCw, Search, Sparkles } from 'lucide-react';
import { authSession } from '../../services/authSession.js';
import './marketInstallDialog.css';

const scopeNames = { expert: '专家', workbench: '工作台', project: '项目' };
const statuses = { pending: '等待安装', running: '正在安装', succeeded: '已加入运行资源草稿', failed: '安装失败', conflict: '运行资源草稿已变化', unknown: '安装结果待核对' };
const ongoing = operation => ['pending', 'running'].includes(operation?.state);

/** A fixed-target installer. Closing stops reads, while accepted writes remain recoverable. */
export function MarketInstallDialog({ kind, id, saved, references = [], dirty, busy: parentBusy, parentError, initialExtensionId, session, onSessionChange, onSave, onReload, onClose }) {
  const life = useRef({ controller: new AbortController(), version: authSession.getSnapshot().version });
  const callbacks = useRef(); callbacks.current = { onSessionChange, onSave, onReload };
  const [valid, setValid] = useState(true), [query, setQuery] = useState(''), [filter, setFilter] = useState(''), [offset, setOffset] = useState(0), [reload, setReload] = useState(0);
  const [catalog, setCatalog] = useState(null), [loading, setLoading] = useState(true), [catalogError, setCatalogError] = useState('');
  const [selected, setSelected] = useState(session?.request?.extensionId || session?.operation?.extensionId || initialExtensionId || '');
  const [detail, setDetail] = useState(null), [detailLoading, setDetailLoading] = useState(false), [detailError, setDetailError] = useState(''), [version, setVersion] = useState(session?.request?.body.versionId || '');
  const request = useRef(session?.request || null), actionBusy = useRef(false);
  const [operation, setOperation] = useState(session?.operation || null), [submitting, setSubmitting] = useState(false), [error, setError] = useState(''), [recent, setRecent] = useState([]);
  const [synced, setSynced] = useState(false), [syncing, setSyncing] = useState(false), [syncError, setSyncError] = useState(''), [syncAttempt, setSyncAttempt] = useState(0);
  const [submissionRejected, setSubmissionRejected] = useState(false);
  const [pollStopped, setPollStopped] = useState(false), [pollAttempt, setPollAttempt] = useState(0), [published, setPublished] = useState(false), [confirmReload, setConfirmReload] = useState(false);
  const pollStart = useRef(Date.now());
  const reloadInFlight = useRef(false);
  const signal = life.current.controller.signal;
  const live = () => !signal.aborted && life.current.version === authSession.getSnapshot().version;
  const sameAccount = () => life.current.version === authSession.getSnapshot().version;
  const busy = Boolean(parentBusy || submitting || syncing), locked = Boolean(request.current || operation);
  const closeBusy = Boolean(parentBusy || submitting);
  const current = (saved.extensions?.items || []).find(item => !item.inherited && item.extensionId === selected && references.some(ref => ref.installationId === item.installationId));
  const alreadyInstalled = Boolean(current && current.versionId === version);
  const installationPresent = Boolean(operation?.result?.installationId && references.some(ref => ref.installationId === operation.result.installationId));
  function remember(nextOperation, nextRequest = request.current) {
    if (sameAccount()) callbacks.current.onSessionChange?.({ request: nextRequest, operation: nextOperation });
  }
  function acceptOperation(value) {
    if (value.targetKind !== kind || value.targetId !== id) throw Error('安装操作不属于当前对象');
    remember(value); if (live()) { setOperation(value); setRecent(items => [value, ...items.filter(item => item.id !== value.id)]); }
  }
  useEffect(() => {
    const unsubscribe = authSession.subscribe(() => { if (!sameAccount()) { life.current.controller.abort(); setValid(false); } });
    return () => { life.current.controller.abort(); unsubscribe(); };
  }, []);
  useEffect(() => {
    const abort = new AbortController(), readSignal = AbortSignal.any([signal, abort.signal]);
    setLoading(true); setCatalogError('');
    const timer = setTimeout(() => API.fetchExtensionMarket({ q: query, kind: filter, offset, limit: 12 }, readSignal).then(({ data }) => {
      if (readSignal.aborted) return; setCatalog(data); setSelected(value => value || data.items[0]?.id || '');
    }).catch(failure => { if (!readSignal.aborted) setCatalogError(failure.message); }).finally(() => { if (!readSignal.aborted) setLoading(false); }), 180);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, filter, offset, reload]);
  useEffect(() => {
    API.fetchMarketOperations(signal).then(({ data }) => { if (live()) setRecent(data.filter(item => item.targetKind === kind && item.targetId === id)); }).catch(() => {});
  }, [reload]);
  useEffect(() => {
    if (!selected) { setDetail(null); setDetailLoading(false); setDetailError(''); return; }
    const abort = new AbortController(), readSignal = AbortSignal.any([signal, abort.signal]);
    setDetail(null); setDetailLoading(true); setDetailError('');
    API.fetchMarketExtension(selected, readSignal).then(({ data }) => {
      if (readSignal.aborted) return; setDetail(data); setVersion(request.current?.body.versionId || operation?.versionId || data.versionId || '');
    }).catch(failure => { if (!readSignal.aborted) setDetailError(failure.message); }).finally(() => { if (!readSignal.aborted) setDetailLoading(false); });
    return () => abort.abort();
  }, [selected, reload]);
  useEffect(() => {
    if (!ongoing(operation)) return;
    const abort = new AbortController(), readSignal = AbortSignal.any([signal, abort.signal]); let timer;
    async function poll() {
      try {
        const { data } = await API.fetchMarketOperation(operation.id, readSignal);
        if (readSignal.aborted) return; acceptOperation(data);
        if (ongoing(data)) {
          if (Date.now() - pollStart.current < 300000) timer = setTimeout(poll, 2000);
          else setPollStopped(true);
        }
      } catch (failure) { if (!readSignal.aborted) { setError(failure.message); setPollStopped(true); } }
    }
    timer = setTimeout(poll, 1000); return () => { clearTimeout(timer); abort.abort(); };
  }, [operation?.id, operation?.state, pollAttempt]);
  useEffect(() => {
    if (operation?.state !== 'succeeded' || reloadInFlight.current) return;
    if (dirty) { setSyncing(false); setSynced(false); setSyncError('本页有未保存的更改，已为你保留。确认重新载入草稿后，才能更新安装列表。'); return; }
    let cancelled = false; setSyncing(true); setSyncError('');
    Promise.resolve().then(() => callbacks.current.onReload(signal)).then(runtime => { if (!runtime) throw Error('运行资源列表尚未刷新'); if (!cancelled && live()) setSynced(true); }).catch(failure => { if (!cancelled && live()) setSyncError(failure.message); }).finally(() => { if (!cancelled && live()) setSyncing(false); });
    return () => { cancelled = true; };
  }, [operation?.id, operation?.state, syncAttempt, dirty]);
  async function act(fn) {
    if (actionBusy.current || !live()) return;
    actionBusy.current = true; setSubmitting(true); setError('');
    try { await fn(); } catch (failure) { if (live()) { setError(failure.message); if ([400, 403, 404, 409, 422].includes(failure.status)) setSubmissionRejected(true); } }
    finally { actionBusy.current = false; if (live()) setSubmitting(false); }
  }
  async function install() {
    await act(async () => {
      if (!request.current) {
        if (!detail || !version || alreadyInstalled || !detail.listed) return;
        const runtime = dirty ? await callbacks.current.onSave(false) : saved;
        if (!live()) return;
        if (!runtime || typeof runtime.revision !== 'number') throw Error('当前草稿未能保存，请检查保存错误后重试。');
        request.current = { extensionId: detail.id, body: { targetKind: kind, targetId: id, versionId: version, runtimeRevision: runtime.revision } };
        remember(null);
      }
      const { data } = await API.installMarketExtension(request.current.extensionId, request.current.body);
      // Retain the receipt after closing, without reopening the dialog or refreshing another page.
      if (live()) { pollStart.current = Date.now(); setPollStopped(false); }
      if (sameAccount()) acceptOperation(data);
    });
  }
  async function retry() { await act(async () => { const { data } = await API.retryMarketOperation(operation.id); if (live()) { pollStart.current = Date.now(); setPollStopped(false); } if (sameAccount())acceptOperation(data); }); }
  async function check() { await act(async () => { const { data } = await API.fetchMarketOperation(operation.id, signal); if (live()) { pollStart.current = Date.now(); setPollStopped(false); acceptOperation(data); setPollAttempt(value => value + 1); } }); }
  function reset() { request.current = null; setOperation(null); setError(''); setSyncError(''); setSynced(false); setPublished(false); setSubmissionRejected(false); setConfirmReload(false); callbacks.current.onSessionChange?.(null); setReload(value => value + 1); }
  async function reloadDraft() { await act(async () => { reloadInFlight.current = true; try { await callbacks.current.onReload(signal); if (live()) reset(); } finally { reloadInFlight.current = false; } }); }
  async function publish() { await act(async () => { const result = await callbacks.current.onSave(true); if (live()) { if (!result) throw Error('发布未完成，请处理保存或发布错误后重试。'); setPublished(true); } }); }
  function resume(item) { request.current = null; setSelected(item.extensionId || ''); setVersion(item.versionId || ''); setSynced(false); setPublished(false); setError(''); remember(item, null); setOperation(item); pollStart.current = Date.now(); setPollAttempt(value => value + 1); }
  function close() { onClose(Boolean(operation && ['failed', 'conflict'].includes(operation.state) || operation?.state === 'succeeded' && synced)); }
  if (!valid) return null;
  const release = detail?.versions.find(item => item.id === version);
  return <Modal open title="从市场安装扩展" width={960} footer={null} onCancel={close} closable={!closeBusy} maskClosable={false} keyboard={!closeBusy} className="runtime-extension-dialog market-install-dialog" destroyOnHidden>
    <div className="market-install-body">
      <p className="runtime-extension-help">安装到当前{scopeNames[kind]}的运行资源草稿。选择 Skills 或 MCP，发布后对新一轮执行生效。</p>
      <div className="market-install-toolbar"><Input aria-label="搜索市场扩展" prefix={<Search size={15}/>} placeholder="搜索名称或用途" value={query} disabled={busy || locked} onChange={event => { setQuery(event.target.value); setOffset(0); setSelected(''); }}/><Select aria-label="扩展类型" value={filter} disabled={busy || locked} onChange={value => { setFilter(value); setOffset(0); setSelected(''); }} options={[{ value: '', label: '全部类型' }, { value: 'skill', label: 'Skills' }, { value: 'mcp', label: 'MCP' }]}/><button className="btn btn-ghost" disabled={busy || loading || locked} aria-label="刷新扩展目录" onClick={() => setReload(value => value + 1)}><RefreshCw size={15}/></button></div>
      <div className="market-install-columns">
        <div className="market-install-catalog" aria-label="可安装扩展">
          {loading ? <p className="market-install-empty" role="status">读取扩展目录…</p> : catalogError ? <div className="market-install-empty" role="alert"><p>{catalogError}</p><button className="btn btn-ghost" disabled={busy} onClick={() => setReload(value => value + 1)}>重新加载目录</button></div> : catalog?.enabled === false ? <p className="market-install-empty">扩展市场尚未启用</p> : !catalog?.items.length ? <p className="market-install-empty">{query ? '没有匹配的扩展' : '暂无可安装的扩展'}</p> : <>
            {catalog.items.map(item => <button key={item.id} type="button" aria-pressed={selected === item.id} className={`market-install-item ${selected === item.id ? 'is-selected' : ''}`} disabled={busy || locked} onClick={() => { setSelected(item.id); setError(''); }}><span className={`runtime-extension-icon ${item.kind === 'skill' ? 'is-skill' : 'is-mcp'}`}>{item.kind === 'skill' ? <Sparkles size={17}/> : <Plug size={17}/>}</span><span><strong>{item.name}</strong><small>{item.kind === 'skill' ? 'Skill' : 'MCP'} · v{item.version}</small><p>{item.description}</p></span></button>)}
            {(offset > 0 || catalog.hasMore) && <div className="market-install-pages"><button className="runtime-extension-action" disabled={busy || locked || !offset} onClick={() => { setOffset(value => Math.max(0, value - 12)); setSelected(''); }}>上一页</button><span>第 {Math.floor(offset / 12) + 1} 页</span><button className="runtime-extension-action" disabled={busy || locked || !catalog.hasMore} onClick={() => { setOffset(value => value + 12); setSelected(''); }}>下一页</button></div>}
          </>}
        </div>
        <div className="market-install-detail">
          {detailLoading ? <p className="market-install-empty" role="status">读取扩展详情…</p> : detailError ? <div className="market-install-empty" role="alert"><p>{detailError}</p><button className="btn btn-ghost" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取详情</button></div> : !detail ? <p className="market-install-empty">选择左侧扩展，查看详情和版本</p> : <>
            <div><span className={`pill ${detail.kind === 'skill' ? 'pill-primary' : 'pill-info'}`}>{detail.kind === 'skill' ? 'Skill' : 'MCP'}</span><h3>{release?.payload.name || detail.name}</h3><p className="runtime-extension-help">{release?.payload.description || detail.description}</p></div>
            {current && <p className="runtime-extension-help">当前草稿安装版本：v{current.version}</p>}
            <label htmlFor="quick-install-version">安装版本<Select id="quick-install-version" value={version || undefined} disabled={busy || locked} onChange={setVersion} options={detail.versions.map(item => ({ value: item.id, label: `v${item.version}${item.id === detail.versionId ? ' · 最新版本' : ''}` }))}/></label>
            <div><h4>版本说明</h4><p className="runtime-extension-help">{release?.notes || '此版本未填写说明。'}</p></div>
            {detail.kind === 'skill' ? <div><h4>完整技能包 · {release?.payload.files?.length || 0} 个文件</h4><div className="runtime-extension-upload-files">{release?.payload.files?.map(file => <div key={file.path}><FileText size={14}/><code>{file.path}</code></div>)}</div></div> : <p className="runtime-extension-help">{release?.payload.mcp?.transport === 'stdio' ? '独立容器运行（stdio）' : 'Streamable HTTP'} · 管理员统一维护连接和认证，安装后直接使用。</p>}
            {alreadyInstalled && !locked && <p className="runtime-extension-notice" role="status">此版本已在当前对象的草稿中。</p>}
          </>}
        </div>
      </div>
      {dirty && !locked && <p className="runtime-extension-help">本页有未保存的更改。安装前会先保存完整草稿，保留已有运行配置。</p>}
      {(error || parentError) && <p role="alert" className="runtime-extension-error">{[...new Set([error, parentError].filter(Boolean))].join('；')}</p>}
      {operation && <div className={`market-install-result ${operation.state === 'succeeded' ? 'is-success' : ''}`} role="status">{operation.state === 'succeeded' && <CheckCircle2 size={18}/>}<div><strong>{operation.extensionName} {operation.version ? `v${operation.version} · ` : ''}{published ? '运行资源已发布' : statuses[operation.state] || operation.state}</strong>{operation.copiedFiles > 0 && <p>已准备 {operation.copiedFiles} 个文件</p>}{operation.error && <p className="runtime-extension-error">{operation.error}</p>}{ongoing(operation) && <p>安装由后台继续执行，关闭弹框后可再次打开查看原操作。</p>}{operation.state === 'succeeded' && <p>{published ? '新一轮执行使用已发布资源。' : synced ? installationPresent ? '当前扩展列表已更新。可继续安装，或在这里发布运行资源。' : '原操作已完成，当前草稿未引用此安装。可以继续选择扩展。' : syncError ? '安装已成功，当前列表尚未刷新。' : '正在更新当前扩展列表…'}</p>}{pollStopped && <p>自动读取已停止，请手动核对进度。</p>}</div></div>}
      {syncError && <p role="alert" className="runtime-extension-error">安装已成功，列表刷新失败：{syncError}<button className="runtime-extension-action" disabled={busy} onClick={() => setSyncAttempt(value => value + 1)}>重新刷新列表</button></p>}
      {request.current && !operation && <p className="runtime-extension-help">安装请求已固定。结果不确定时，使用原请求核对，不会重新选择目标或覆盖其他草稿。</p>}
      {!locked && recent.length > 0 && <details className="market-install-history"><summary>当前对象最近安装</summary>{recent.slice(0, 5).map(item => <div key={item.id}><span>{item.extensionName} · {statuses[item.state] || item.state}</span><button className="runtime-extension-action" disabled={busy} onClick={() => resume(item)}>查看操作</button></div>)}</details>}
      {confirmReload && <div className="market-install-reload"><p>重新载入将替换本页尚未保存的更改，已提交的安装操作会保留。</p><button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmReload(false)}>取消</button><button className="btn btn-ghost" disabled={busy} onClick={reloadDraft}>确认重新载入</button></div>}
      <footer className="market-install-footer"><div>{(operation?.state === 'conflict' || parentError || syncError && dirty) && !confirmReload && <button className="runtime-extension-action" disabled={busy} onClick={() => setConfirmReload(true)}>重新载入草稿并重选</button>}</div><div>
        <button className="btn btn-ghost" disabled={closeBusy} onClick={close}>{operation?.state === 'succeeded' ? '完成' : ongoing(operation) ? '关闭，后台继续安装' : '关闭'}</button>
        {!locked && <button className="btn btn-primary" disabled={busy || loading || detailLoading || !detail?.listed || !version || alreadyInstalled} onClick={install}>{busy ? '处理中…' : dirty ? '保存草稿并安装' : '安装到当前' + scopeNames[kind]}</button>}
        {request.current && !operation && <><button className="btn btn-primary" disabled={busy} onClick={install}>核对原安装请求</button>{submissionRejected && <button className="btn btn-ghost" disabled={busy} onClick={reset}>重新选择扩展</button>}</>}
        {ongoing(operation) && <button className="btn btn-ghost" disabled={busy} onClick={check}>核对安装进度</button>}
        {['failed', 'unknown'].includes(operation?.state) && <button className="btn btn-primary" disabled={busy} onClick={retry}>重试原操作</button>}
        {operation?.state === 'failed' && <button className="btn btn-ghost" disabled={busy} onClick={reset}>选择其他扩展</button>}
        {operation?.state === 'succeeded' && synced && <><button className="btn btn-ghost" disabled={busy} onClick={reset}>继续安装</button>{!published && installationPresent && <button className="btn btn-primary" disabled={busy} onClick={publish}>保存并发布资源</button>}</>}
      </div></footer>
    </div>
  </Modal>;
}
