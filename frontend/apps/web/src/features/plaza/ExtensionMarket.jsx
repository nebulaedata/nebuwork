import { createUuid } from '../../lib/uuid.js';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, Input, Modal, Select } from 'antd';
import { FileText, FolderUp, Plug, Plus, RefreshCw, Search, Sparkles, Store } from 'lucide-react';
import { authSession } from '../../services/authSession.js';
import { runtimeScopeHref } from '../../services/extensionMarketApi.js';
import { useExtensionTheme } from '../runtime/RuntimeExtensions.jsx';
import '../runtime/runtimeExtensions.css';
import './extensionMarket.css';

const kinds = { skill: 'Skill', mcp: 'MCP' }, scopes = { expert: '专家', workbench: '工作台', project: '项目' };
const states = { pending: '等待安装', running: '正在安装', succeeded: '已加入运行资源草稿', failed: '安装失败', conflict: '草稿版本冲突', unknown: '结果待核对' };
const ongoing = operation => ['pending', 'running'].includes(operation.state);
const fromFile = file => (file.webkitRelativePath || file.name).split('/').slice(1).join('/') || file.name;

function useMarketLife() {
  const ref = useRef(null), [valid, setValid] = useState(true);
  if (!ref.current) ref.current = { controller: new AbortController(), version: authSession.getSnapshot().version };
  useEffect(() => { const item = ref.current; const unsubscribe = authSession.subscribe(() => { if (item.version !== authSession.getSnapshot().version) { item.controller.abort(); setValid(false); } }); return () => { item.controller.abort(); unsubscribe(); }; }, []);
  return { valid, signal: ref.current.controller.signal, live: () => !ref.current.controller.signal.aborted && ref.current.version === authSession.getSnapshot().version };
}

function MarketEditor({ entry, busy, onAction, onSaved, onClose }) {
  const [name, setName] = useState(entry.name), [description, setDescription] = useState(entry.description);
  const [assets, setAssets] = useState(entry.draft.files || []), [notes, setNotes] = useState(entry.draft.notes || '');
  const [connection, setConnection] = useState(entry.draft.mcp || { transport: 'http', url: '', args: [] });
  const [requiredFiles, setRequiredFiles] = useState((entry.draft.skill?.requiredFiles || []).join('\n'));
  const [secret, setSecret] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const folder = useRef(null), uploadKeys = useRef(new Map()), authAttempt = useRef(null);
  const [authPending, setAuthPending] = useState(false);
  const change = patch => setConnection(previous => ({ ...previous, ...patch }));
  const [uploadIncomplete, setUploadIncomplete] = useState(false);
  const draftChanged = name.trim() !== entry.name || description.trim() !== entry.description || notes !== (entry.draft.notes || '') || JSON.stringify(assets.map(asset => asset.id)) !== JSON.stringify((entry.draft.files || []).map(asset => asset.id)) || JSON.stringify(connection) !== JSON.stringify(entry.draft.mcp || { transport: 'http', url: '', args: [] }) || requiredFiles !== (entry.draft.skill?.requiredFiles || []).join('\n');
  async function save(publish) {
    setError(''); setNotice('');
    let parsed;
    try { if (secret.trim()) { parsed = JSON.parse(secret); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Error('认证必须是 JSON 对象'); } }
    catch (failure) { setError(failure.message); return; }
    await onAction(async () => {
      if (authAttempt.current) { const { data } = await API.saveMarketExtensionAuth(entry.id, authAttempt.current); authAttempt.current = null; setAuthPending(false); setSecret(''); onSaved(data); setNotice('原认证保存已核对。可以继续保存其他草稿更改。'); return; }
      if (publish) { const { data } = await API.publishMarketExtension(entry.id, entry.revision); onSaved(data); onClose(); return; }
      let result = (await API.saveMarketExtension(entry.id, { revision: entry.revision, name: name.trim(), description: description.trim(), notes, assetIds: assets.map(asset => asset.id), requiredFiles: requiredFiles.split('\n').map(s => s.trim()).filter(Boolean), mcp: connection })).data;
      setName(result.name); setDescription(result.description); setNotes(result.draft.notes || ''); setAssets(result.draft.files || []); setRequiredFiles((result.draft.skill?.requiredFiles || []).join('\n')); if (result.draft.mcp) setConnection(result.draft.mcp);
      onSaved(result);
      if (parsed) { authAttempt.current = { revision: result.revision, secret: parsed }; setAuthPending(true); result = (await API.saveMarketExtensionAuth(entry.id, authAttempt.current)).data; authAttempt.current = null; setAuthPending(false); setSecret(''); onSaved(result); }
      setNotice('市场草稿已保存，可以发布新版本。');
    }, failure => { if (failure.status >= 400 && failure.status < 500) { authAttempt.current = null; setAuthPending(false); } setError(failure.message); });
  }
  async function upload(files) {
    setError(''); setNotice('');
    if (!files.some(file => fromFile(file).toLowerCase() === 'skill.md')) { setError('请选择根目录包含 SKILL.md 的完整技能目录'); return; }
    await onAction(async () => {
      setUploadIncomplete(true);
      const uploaded = [];
      for (const file of files) {
        const path = fromFile(file), signature = `${path}:${file.size}:${file.lastModified}`;
        if (!uploadKeys.current.has(signature)) uploadKeys.current.set(signature, createUuid());
        const { data } = await API.uploadMarketAsset(entry.id, file, path, uploadKeys.current.get(signature), entry.revision);
        uploaded.push(data);
        setAssets(previous => [...previous.filter(asset => asset.path !== data.path), data]);
      }
      setAssets(uploaded); setUploadIncomplete(false);
      setNotice('文件已上传，请保存市场草稿。');
    }, failure => setError(failure.message));
  }
  return <Modal open title={`管理 ${kinds[entry.kind]}`} width={800} footer={null} onCancel={onClose} closable={!busy} maskClosable={!busy} keyboard={!busy} className="runtime-extension-dialog" destroyOnHidden>
    <form className="runtime-extension-form" onSubmit={event => { event.preventDefault(); void save(false); }}>
      <div className="runtime-extension-grid"><label htmlFor="market-name">名称<Input id="market-name" required maxLength={160} value={name} disabled={busy} onChange={e => setName(e.target.value)}/></label><label htmlFor="market-kind">类型<Input id="market-kind" value={kinds[entry.kind]} readOnly/></label></div>
      <label htmlFor="market-description">用途说明<Input.TextArea id="market-description" rows={3} required maxLength={2000} value={description} disabled={busy} onChange={e => setDescription(e.target.value)}/></label>
      {entry.kind === 'skill' ? <>
        <div className="market-package-heading"><strong>完整技能包</strong><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => folder.current.click()}><FolderUp size={15}/>上传目录</button><input hidden type="file" multiple webkitdirectory="" ref={folder} onChange={e => { void upload([...e.target.files]); e.target.value = ''; }}/></div>
        <div className="runtime-extension-upload-files">{assets.length ? assets.map(asset => <div key={asset.id}><FileText size={14}/><code>{asset.path}</code><small>{(asset.size / 1024).toFixed(1)} KB</small><button type="button" className="runtime-extension-action is-danger" disabled={busy} onClick={() => setAssets(previous => previous.filter(item => item.id !== asset.id))}>移除</button></div>) : <p className="runtime-extension-help">还没有技能文件。上传时保留目录内脚本、参考文件和素材。</p>}</div>
        <label htmlFor="market-required-files">必需文件（相对技能目录，每行一个）<Input.TextArea id="market-required-files" rows={3} value={requiredFiles} disabled={busy} onChange={e => setRequiredFiles(e.target.value)}/></label>
      </> : <>
        <label htmlFor="market-transport">连接方式<Select id="market-transport" value={connection.transport} disabled={busy} options={[{ value: 'http', label: 'Streamable HTTP' }, { value: 'stdio', label: '独立容器命令（stdio）' }]} onChange={transport => setConnection({ transport, args: [], ...(transport === 'http' ? { url: '' } : { command: '' }) })}/></label>
        <label htmlFor="market-endpoint">{connection.transport === 'http' ? '服务地址' : '命令'}<Input id="market-endpoint" required value={connection.url || connection.command || ''} disabled={busy} onChange={e => change({ [connection.transport === 'http' ? 'url' : 'command']: e.target.value })}/></label>
        {connection.transport === 'stdio' && <><label htmlFor="market-args">命令参数（每行一个）<Input.TextArea id="market-args" rows={3} value={(connection.args || []).join('\n')} disabled={busy} onChange={e => change({ args: e.target.value.split('\n').filter(Boolean) })}/></label><p className="runtime-extension-help">命令在引擎配置镜像创建的独立容器中运行，不共享任务工作区。</p></>}
        <label htmlFor="market-tools">开放工具（留空为全部，每行一个）<Input.TextArea id="market-tools" rows={2} value={(connection.tools || []).join('\n')} disabled={busy} onChange={e => { const tools = e.target.value.split('\n').filter(Boolean), next = { ...connection }; if (tools.length) next.tools = tools; else delete next.tools; setConnection(next); }}/></label>
        <label htmlFor="market-secret">统一认证 JSON <span className="runtime-extension-help">{entry.authConfigured ? '当前连接已配置认证；留空保留原值。' : '当前连接未配置认证。'}输入 {connection.transport === 'http' ? '{"headers":{"Authorization":"Bearer …"}}' : '{"env":{"API_KEY":"…"}}'}，输入 {'{}'} 清空认证。</span><Input.TextArea id="market-secret" rows={4} value={secret} disabled={busy || authPending} onChange={e => setSecret(e.target.value)} autoComplete="off" spellCheck={false}/></label>
        <p className="runtime-extension-help">认证不会返回浏览器。相同连接的认证更新对已有安装的新连接生效；更换连接需发布新版本。</p>
      </>}
      <label htmlFor="market-notes">版本说明<Input.TextArea id="market-notes" rows={2} maxLength={4000} value={notes} disabled={busy} onChange={e => setNotes(e.target.value)}/></label>
      {error && <p role="alert" className="runtime-extension-error">{error}</p>}{notice && <p role="status" className="runtime-extension-help">{notice}</p>}
      {uploadIncomplete && <p className="runtime-extension-error">目录尚未上传完整，请重新选择同一目录继续上传。</p>}
      {authPending && <p className="runtime-extension-help">保留原认证保存请求，核对完成后再修改认证。</p>}
      <footer><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>关闭</button><button className="btn btn-ghost" disabled={busy || uploadIncomplete}>{authPending ? '核对原认证保存' : '保存草稿'}</button><button type="button" className="btn btn-primary" disabled={busy || authPending || uploadIncomplete || draftChanged || Boolean(secret.trim())} onClick={() => save(true)}>{busy ? '处理中…' : '发布已保存草稿'}</button></footer>
    </form>
  </Modal>;
}

function InstallDialog({ entry, initialTarget, busy, onAction, onInstalled, onClose }) {
  const life = useMarketLife(), [targets, setTargets] = useState(null), [target, setTarget] = useState(initialTarget || '');
  const [version, setVersion] = useState(entry.versionId), [error, setError] = useState('');
  const submitted = useRef(null), [checking, setChecking] = useState(false);
  const alreadyInDraft = entry.installations?.some(item => item.targetKind + ':' + item.targetId === target && item.versionId === version && item.inDraft);
  useEffect(() => { API.fetchMarketTargets(life.signal).then(result => { if (life.live()) setTargets(result.data); }).catch(failure => { if (life.live()) setError(failure.message); }); }, []);
  if (!life.valid) return null;
  async function submit(event) {
    event.preventDefault(); if (!target || !version) return;
    const selected = targets?.find(item => item.kind + ':' + item.id === target);
    if (!selected) { setError('请选择当前账号有权限的安装目标'); return; }
    await onAction(async () => {
      if (!submitted.current) {
        const runtime = await API.fetchRuntime(selected.kind, selected.id);
        if (!life.live()) return;
        submitted.current = { targetKind: selected.kind, targetId: selected.id, versionId: version, runtimeRevision: runtime.data.revision };
      }
      const { data } = await API.installMarketExtension(entry.id, submitted.current);
      if (life.live()) { onInstalled(data); onClose(); }
    }, failure => { if (life.live()) { setChecking(Boolean(submitted.current)); setError(failure.message); } });
  }
  return <Modal open title={`安装 ${entry.name}`} footer={null} onCancel={onClose} closable={!busy} maskClosable={!busy} keyboard={!busy} className="runtime-extension-dialog" destroyOnHidden><form className="runtime-extension-form" onSubmit={submit}>
    <label htmlFor="market-install-target">安装目标<Select id="market-install-target" showSearch optionFilterProp="label" value={target || undefined} loading={targets === null} disabled={busy || checking || targets === null} placeholder="选择专家、工作台或项目" options={(targets || []).map(item => ({ value: item.kind + ':' + item.id, label: `${scopes[item.kind]} · ${item.name}` }))} onChange={setTarget}/></label>
    {targets?.length === 0 && <p className="runtime-extension-help">暂无可安装的对象，请先创建专家、工作台或项目。</p>}
    <label htmlFor="market-install-version">固定版本<Select id="market-install-version" value={version} disabled={busy || checking} options={entry.versions.map(item => ({ value: item.id, label: `v${item.version}${item.notes ? ' · ' + item.notes : ''}` }))} onChange={setVersion}/></label>
    <p className="runtime-extension-help">安装完成后加入目标草稿，由你发布运行资源后生效。MCP 统一认证由管理员维护。</p>
    {alreadyInDraft && <p className="runtime-extension-help">此版本已在目标草稿中。<a href={runtimeScopeHref(target.split(':')[0], target.slice(target.indexOf(':') + 1))}>前往运行资源查看并发布</a></p>}
    {error && <p role="alert" className="runtime-extension-error">{error}</p>}
    {checking && <p className="runtime-extension-help">保留原目标、版本和请求编号。可核对原安装，或关闭后查看最近安装操作；草稿冲突需要重新选择目标版本。</p>}
    <footer><button type="button" className="btn btn-ghost" disabled={busy} onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy || alreadyInDraft || !target || !version || !targets?.length}>{busy ? '提交中…' : checking ? '核对原安装' : '加入运行资源草稿'}</button></footer>
  </form></Modal>;
}

export function ExtensionMarket({ query = {}, onCount }) {
  const theme = useExtensionTheme(), life = useMarketLife();
  const [catalog, setCatalog] = useState(null), [q, setQ] = useState(''), [kind, setKind] = useState(''), [manage, setManage] = useState(query.manage === '1');
  const [offset, setOffset] = useState(0), [reload, setReload] = useState(0), [error, setError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null), [editing, setEditing] = useState(false), [installing, setInstalling] = useState(false), [creating, setCreating] = useState(false), [operations, setOperations] = useState([]);
  const [newName, setNewName] = useState(''), [newDescription, setNewDescription] = useState(''), [newKind, setNewKind] = useState('skill');
  const busyRef = useRef(false);
  const initialTarget = query.targetKind && query.targetId ? `${query.targetKind}:${query.targetId}` : query.agentId ? `expert:${query.agentId}` : '';
  useEffect(() => { if (!query.extensionId) return; API.fetchMarketExtension(query.extensionId, life.signal).then(({ data }) => { if (life.live()) { setSelected(data); setInstalling(true); } }).catch(failure => { if (life.live()) setError(failure.message); }); }, []);
  async function action(fn, onError) {
    if (busyRef.current || !life.live()) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await fn(); return true; } catch (failure) { if (life.live()) { if (onError) onError(failure); else setError(failure.message); } return false; }
    finally { busyRef.current = false; if (life.live()) setBusy(false); }
  }
  useEffect(() => {
    const abort = new AbortController(), signal = AbortSignal.any([abort.signal, life.signal]);
    setLoading(true); setError('');
    const timer = setTimeout(() => { API.fetchExtensionMarket({ q, kind, manage, offset, limit: 24 }, signal).then(({ data }) => { if (!signal.aborted) { setCatalog(data); onCount?.(data.total); if (data.enabled) API.fetchMarketOperations(signal).then(result => { if (!signal.aborted) setOperations(result.data); }).catch(() => {}); } }).catch(failure => { if (!signal.aborted) setError(failure.message); }).finally(() => { if (!signal.aborted) setLoading(false); }); }, 200);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [q, kind, manage, offset, reload]);
  useEffect(() => {
    if (!operations.some(ongoing)) return;
    let cancelled = false, timer; const started = Date.now(), abort = new AbortController(), signal = AbortSignal.any([abort.signal, life.signal]);
    async function poll() { try { const { data } = await API.fetchMarketOperations(signal); if (cancelled || signal.aborted) return; setOperations(data); if (!data.some(ongoing)) setReload(n => n + 1); if (data.some(ongoing) && Date.now() - started < 300000) timer = setTimeout(poll, 2000); } catch (failure) { if (!signal.aborted) setError(failure.message); } }
    timer = setTimeout(poll, 1500); return () => { cancelled = true; clearTimeout(timer); abort.abort(); };
  }, [operations.some(ongoing), reload]);
  const saved = detail => { if (life.live()) { setSelected(detail); setReload(n => n + 1); } };
  async function open(item, edit = false) { return action(async () => { const { data } = await API.fetchMarketExtension(item.id, life.signal); if (life.live()) { setSelected(data); setEditing(edit); } }); }
  if (!life.valid) return null;
  return <ConfigProvider theme={theme}><section className="extension-market" aria-label="扩展市场">
    <header className="market-heading"><div><h2>扩展市场</h2><p>安装完整 Skills 或 MCP 到专家、工作台和项目，发布运行资源后使用。</p></div><div className="market-toolbar-actions">{(catalog?.canManage || manage) && <button className="btn btn-ghost" disabled={busy} onClick={() => { setManage(value => !value); setOffset(0); }}>{manage ? '返回市场' : '管理扩展'}</button>}{catalog?.canManage && <button className="btn btn-primary" disabled={busy || !catalog.enabled} onClick={() => setCreating(true)}><Plus size={15}/>新增扩展</button>}<button className="btn btn-ghost" aria-label="刷新扩展市场" disabled={busy || loading} onClick={() => setReload(n => n + 1)}><RefreshCw size={15}/></button></div></header>
    <div className="market-toolbar"><div className="market-filters">{[['', '全部'], ['skill', 'Skills'], ['mcp', 'MCP']].map(([value, label]) => <button key={value} className={kind === value ? 'is-active' : ''} onClick={() => { setKind(value); setOffset(0); }}>{label}</button>)}</div><label className="market-search"><Search size={15}/><input aria-label="搜索扩展" placeholder="搜索名称或用途" value={q} onChange={e => { setQ(e.target.value); setOffset(0); }}/></label></div>
    {error && <p className="runtime-extension-error runtime-extension-banner" role="alert">{error}<button className="runtime-extension-action" onClick={() => setReload(n => n + 1)}>重新加载</button></p>}
    {loading ? <div className="card market-empty" role="status">正在读取扩展市场…</div> : catalog?.enabled === false ? <div className="card market-empty"><Store size={28}/><strong>扩展市场尚未启用</strong><p>需完成数据库和引擎升级，并由部署管理员启用市场功能。</p></div> : !error && <>
      <div className="market-results-heading"><span>{manage ? '管理目录' : '可安装扩展'} · {catalog?.total || 0}</span></div>
      <div className="market-grid">{catalog?.items.map(item => <article className="card market-card" key={item.id}><div className="market-card-heading"><span className={`runtime-extension-icon ${item.kind === 'skill' ? 'is-skill' : 'is-mcp'}`}>{item.kind === 'skill' ? <Sparkles size={19}/> : <Plug size={19}/>}</span><div><h3>{item.name}</h3><span className={`pill ${item.kind === 'skill' ? 'pill-primary' : 'pill-info'}`}>{kinds[item.kind]}</span>{item.version && <span className="market-version">v{item.version}</span>}</div>{manage && <span className={`pill ${item.listed ? 'pill-success' : 'pill-dim'}`}>{item.listed ? '已上架' : item.versionId ? '已下架' : '草稿'}</span>}</div><p>{item.description}</p>{item.installations?.length > 0 && <small className="market-install-state">{item.installations.filter(install => install.inDraft).length} 个目标草稿已安装 · {item.installations.filter(install => install.inPublished).length} 个目标已发布</small>}<footer><button className="runtime-extension-action" disabled={busy} onClick={() => open(item)}>查看详情</button><div>{manage && <button className="runtime-extension-action" disabled={busy} onClick={() => open(item, true)}>编辑</button>}<button className="btn btn-ghost" disabled={busy || !item.listed || !item.versionId} onClick={async () => { if (await open(item) && life.live()) setInstalling(true); }}>安装</button></div></footer></article>)}</div>
      {!catalog?.items.length && <div className="card market-empty"><Store size={30}/><strong>{q ? '没有匹配的扩展' : '暂无扩展'}</strong><p>{catalog?.canManage ? '可通过新增扩展上传技能包或配置 MCP，再发布到市场。' : '管理员上架 Skills 或 MCP 后，可在这里查看和安装。'}</p></div>}
      {(offset > 0 || catalog?.hasMore) && <div className="market-pagination"><button className="btn btn-ghost" disabled={!offset || busy} onClick={() => setOffset(n => Math.max(0, n - 24))}>上一页</button><span>第 {Math.floor(offset / 24) + 1} 页</span><button className="btn btn-ghost" disabled={!catalog?.hasMore || busy} onClick={() => setOffset(n => n + 24)}>下一页</button></div>}
    </>}
    {operations.length > 0 && <details className="card market-operations" open={operations.some(ongoing)}><summary>最近安装操作{operations.some(ongoing) ? ' · 进行中' : ''}</summary>{operations.map(operation => <div key={operation.id}><div><strong>{operation.extensionName} {operation.version ? `v${operation.version} · ` : ''}{states[operation.state] || operation.state}</strong><small>{scopes[operation.targetKind]} · {operation.targetId}{operation.copiedFiles ? ` · 已准备 ${operation.copiedFiles} 个文件` : ''}</small>{operation.error && <p className="runtime-extension-error">{operation.error}</p>}</div><div>{operation.state === 'succeeded' && <a className="btn btn-ghost" href={runtimeScopeHref(operation.targetKind, operation.targetId)}>前往运行资源</a>}{['failed', 'unknown'].includes(operation.state) && <button className="btn btn-ghost" disabled={busy} onClick={() => action(async () => { const { data } = await API.retryMarketOperation(operation.id); if (life.live()) { setOperations(previous => previous.map(item => item.id === data.id ? data : item)); setReload(n => n + 1); } })}>重试原操作</button>}</div></div>)}</details>}
    {creating && <Modal open title="新增市场扩展" footer={null} closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={() => setCreating(false)} className="runtime-extension-dialog" destroyOnHidden><form className="runtime-extension-form" onSubmit={e => { e.preventDefault(); void action(async () => { const { data } = await API.createMarketExtension({ kind: newKind, name: newName, description: newDescription }); if (life.live()) { setCreating(false); setSelected(data); setEditing(true); setReload(n => n + 1); } }); }}><label htmlFor="market-new-kind">类型<Select id="market-new-kind" value={newKind} disabled={busy} onChange={setNewKind} options={[{ value: 'skill', label: 'Skill' }, { value: 'mcp', label: 'MCP' }]}/></label><label htmlFor="market-new-name">名称<Input id="market-new-name" required maxLength={160} disabled={busy} value={newName} onChange={e => setNewName(e.target.value)}/></label><label htmlFor="market-new-description">用途说明<Input.TextArea id="market-new-description" required rows={3} maxLength={2000} disabled={busy} value={newDescription} onChange={e => setNewDescription(e.target.value)}/></label>{error && <p className="runtime-extension-error" role="alert">{error}</p>}<footer><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setCreating(false)}>取消</button><button className="btn btn-primary" disabled={busy}>创建草稿</button></footer></form></Modal>}
    {selected && editing && <MarketEditor key={selected.id} entry={selected} busy={busy} onAction={action} onSaved={saved} onClose={() => { setSelected(null); setEditing(false); }}/>}
    {selected && !editing && !installing && <Modal open title={selected.name} width={760} footer={null} closable={!busy} maskClosable={!busy} keyboard={!busy} onCancel={() => setSelected(null)} className="runtime-extension-dialog" destroyOnHidden><div className="runtime-extension-form">{error && <p role="alert" className="runtime-extension-error">{error}</p>}<div className="market-detail-meta"><span className="pill pill-primary">{kinds[selected.kind]}</span><span>{selected.listed ? '已上架' : '未上架'} · {selected.version ? `当前 v${selected.version}` : '尚未发布'}</span></div><p>{selected.description}</p>{selected.installations?.length > 0 && <div className="market-installed-targets"><strong>当前账号安装情况</strong>{selected.installations.map(item => <a key={item.installationId} href={runtimeScopeHref(item.targetKind, item.targetId)}>{scopes[item.targetKind]} · {item.targetId} · v{item.version} · {item.inDraft ? item.inPublished ? '已发布' : '草稿待发布' : '已发布，当前草稿未引用'}</a>)}</div>}{selected.versions.map(version => <details key={version.id} open={version.id === selected.versionId}><summary>v{version.version}{version.id === selected.versionId ? ' · 当前版本' : ''}</summary><p className="runtime-extension-help">{version.notes || '未填写版本说明'}</p>{selected.kind === 'skill' ? <div className="runtime-extension-upload-files">{version.payload.files.map(file => <div key={file.path}><FileText size={14}/><code>{file.path}</code><small>{(file.size / 1024).toFixed(1)} KB</small></div>)}</div> : <p className="runtime-extension-help">{version.payload.mcp.transport === 'http' ? version.payload.mcp.url : [version.payload.mcp.command, ...version.payload.mcp.args].join(' ')} · 认证由管理员统一维护</p>}</details>)}<footer>{selected.canManage && <><button className="btn btn-ghost" disabled={busy} onClick={() => setEditing(true)}>编辑草稿</button>{selected.versionId && <button className="btn btn-ghost" disabled={busy} onClick={() => action(async () => { const { data } = await API.listMarketExtension(selected.id, selected.revision, !selected.listed); saved(data); })}>{selected.listed ? '下架' : '重新上架'}</button>}</>}<button className="btn btn-primary" disabled={busy || !selected.listed || !selected.versionId} onClick={() => setInstalling(true)}>安装</button></footer></div></Modal>}
    {selected && installing && <InstallDialog entry={selected} initialTarget={initialTarget} busy={busy} onAction={action} onInstalled={operation => { setOperations(previous => [operation, ...previous.filter(item => item.id !== operation.id)]); }} onClose={() => { setInstalling(false); setSelected(null); }}/>}
  </section></ConfigProvider>;
}

export function mountExtensionMarket(host, props) { const root = createRoot(host); root.render(<ExtensionMarket {...props}/>); return () => root.unmount(); }
