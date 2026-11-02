import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { KnowledgeControls, KnowledgeSelect as Select } from '../knowledge/KnowledgeControls.jsx';
import { authSession } from '../../services/authSession.js';
import { Overlay } from '../workbench/HubUI.jsx';
import { initialHtmlResources, isHtmlArtifact, mergeHtmlPage, suggestHtmlResources, validateHtmlResources } from './htmlServiceModel.js';
import './services.css';
import '../workbench/hub.css';

export function HtmlServicePublishButton({ projectId, workbenchId, file }) {
  const [selected, setSelected] = useState(null);
  useEffect(() => setSelected(null), [projectId, file.id]);
  if (!isHtmlArtifact(file)) return null;
  return <><button className="html-service-publish-button" aria-label={'发布 ' + file.name + ' 为 HTML 服务'} onClick={() => setSelected(structuredClone(file))}>发布为 HTML 服务</button>{selected && createPortal(<HtmlServicePublisher key={selected.id + ':' + selected.version} projectId={projectId} workbenchId={workbenchId} file={selected} close={() => setSelected(null)}/>, document.body)}</>;
}

export function HtmlServicePublisher({ projectId, workbenchId, file, close }) {
  const [entry] = useState(() => structuredClone(file)), [context, setContext] = useState(null), [resources, setResources] = useState([]);
  const [name, setName] = useState(file.name.replace(/\.html?$/i, '')), [key, setKey] = useState('page-' + file.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48));
  const [entryPath, setEntryPath] = useState(file.name), [serviceName, setServiceName] = useState(''), [capabilities, setCapabilities] = useState([]), [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false), [matching, setMatching] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState(''), [prepared, setPrepared] = useState(null), [preview, setPreview] = useState(''), [published, setPublished] = useState(false);
  const life = useRef(null), pending = useRef(false), preparedRef = useRef(null);
  useEffect(() => {
    const controller = new AbortController(), version = authSession.getSnapshot().version;
    life.current = { controller, version };
    const live = () => !controller.signal.aborted && authSession.getSnapshot().version === version;
    const unsubscribe = authSession.subscribe(() => { if (!live()) { controller.abort(); setContext(null); setResources([]); setPrepared(null); setPreview(''); setError('账号已变化，请关闭并重新打开。'); } });
    void (async () => {
      const [project, artifacts] = await Promise.all([API.fetchProjectDetail(projectId, controller.signal), API.fetchProjectArtifacts(projectId, controller.signal)]);
      if (!live()) return;
      const wb = workbenchId || project.data.project.workbenchId;
      if (!wb) throw new Error('该项目没有可发布的工作台。');
      const [service, releases] = await Promise.all([API.fetchWorkbenchService(wb, controller.signal), API.fetchServiceReleases(wb, controller.signal)]);
      if (!live()) return;
      const initial = initialHtmlResources(entry, artifacts.data.items);
      setEntryPath(initial.entryPath); setResources(initial.resources);
      setContext({ wb, service: service.data, project: project.data.project, releases: releases.data });
      setServiceName(service.data.draft.name || project.data.project.name + '页面服务');
      try {
        const suggested = await suggestHtmlResources(entry, initial.entryPath, initial.resources, async f => {
          if (f.size > 2 * 1024 ** 2) return '';
          const response = await API.artifactContent(projectId, f, controller.signal); return response.data.text();
        }, live);
        if (live()) setResources(previous => previous.map(r => ({ ...r, selected: r.touched ? r.selected : suggested.find(s => s.id === r.id)?.selected || false })));
      } catch (e) { if (live()) setNotice('配套文件未能自动匹配，请手动选择：' + e.message); }
      finally { if (live()) setMatching(false); }
    })().catch(e => { if (live()) setError(e.message); });
    return () => { controller.abort(); unsubscribe(); };
  }, [projectId, workbenchId, entry]);
  const live = () => life.current && !life.current.controller.signal.aborted && authSession.getSnapshot().version === life.current.version;
  const signal = () => life.current.controller.signal;
  async function action(fn) {
    if (pending.current || !live()) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { if (live()) setError(e.message); } finally { pending.current = false; if (live()) setBusy(false); }
  }
  const invalidate = () => { preparedRef.current = null; setPrepared(null); setPreview(''); setPublished(false); };
  const changeResource = (id, patch) => { invalidate(); setResources(rows => rows.map(r => r.id === id ? { ...r, ...patch, touched: true } : r)); };
  async function save() {
    if (!name.trim() || !serviceName.trim() || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(key)) throw new Error('请填写服务名称、页面名称和有效的页面标识。');
    const refs = validateHtmlResources(entryPath, resources, entry);
    const base = preparedRef.current?.definition || context.service.draft;
    const page = { key, name: name.trim(), projectIds: [projectId], capabilities, refreshSeconds: 0 };
    // Check replacement before creating an immutable asset.
    mergeHtmlPage(base, page, replace || Boolean(preparedRef.current));
    const asset = await API.createServiceAsset(context.wb, { projectId, artifactId: entry.id, version: entry.version, entryPath, resources: refs }, signal());
    if (!live()) return null;
    const definition = mergeHtmlPage({ ...base, name: serviceName.trim() }, { ...page, assetId: asset.data.id }, replace || Boolean(preparedRef.current));
    const revision = preparedRef.current?.revision ?? context.service.revision;
    const result = await API.saveWorkbenchService(context.wb, { revision, definition }, signal());
    if (!live()) return null;
    const saved = { revision: result.data.revision, definition: result.data.draft, source: asset.data.source };
    preparedRef.current = saved; setPrepared(saved); setReplace(true);
    setContext(c => ({ ...c, service: { ...c.service, ...result.data } }));
    setNotice('页面已保存为服务草稿。'); return saved;
  }
  const url = () => API.serviceUrl(context.wb, 'pages/' + encodeURIComponent(key)) + '?projectId=' + encodeURIComponent(projectId);
  const existing = context?.service.draft.pages.find(p => p.key === key);
  const definition = prepared?.definition;
  const active = context?.releases.find(r => r.id === context.service.activeReleaseId)?.definition;
  const changed = definition ? [...new Set([...(active?.pages || []).map(p => p.key), ...definition.pages.map(p => p.key)])].filter(k => JSON.stringify(active?.pages?.find(p => p.key === k)) !== JSON.stringify(definition.pages.find(p => p.key === k))) : [];
  return <Overlay title="发布为 HTML 服务" close={close}><KnowledgeControls><div className="service-publisher html-service-publisher">
    {error && <p role="alert" className="runtime-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!context ? <p>正在读取服务配置…</p> : <>
      {!context.service.available && <p className="service-notice">服务运行功能尚未启用，可保存草稿；开启后才能预览和访问。</p>}
      <p className="dim">来源：{context.project.name} / {entry.name} · v{entry.version}。页面及配套资源固定为所选产物版本。</p>
      {matching && <p role="status">正在匹配配套产物…</p>}
      <fieldset disabled={busy || matching || published}><div className="service-grid">
        <label>服务名称<input aria-label="服务名称" value={serviceName} maxLength={200} onChange={e => { invalidate(); setServiceName(e.target.value); }}/></label>
        <label>页面名称<input aria-label="页面名称" value={name} maxLength={200} onChange={e => { invalidate(); setName(e.target.value); }}/></label>
        <label>页面标识<input aria-label="页面标识" value={key} maxLength={80} onChange={e => { invalidate(); setReplace(false); setKey(e.target.value); }}/></label>
        <label>HTML 入口路径<input aria-label="HTML 入口路径" value={entryPath} onChange={e => { invalidate(); setEntryPath(e.target.value); }}/></label>
        <label className="service-wide">页面可用能力<Select disabled={busy || matching || published} aria-label="页面可用能力" mode="multiple" value={capabilities} options={context.service.draft.capabilities.filter(c => c.channels.page && c.projectIds.includes(projectId)).map(c => ({ value: c.key, label: c.name }))} onChange={value => { invalidate(); setCapabilities(value); }}/></label>
      </div>
      {existing && !prepared && <label className="html-service-replace"><input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)}/>替换已有页面“{existing.name}”（可修改标识以新增页面）</label>}
      <h4>配套产物</h4><p className="dim">勾选页面依赖的文件。路径相对于站点根目录；未匹配或未提交的依赖会阻止打包。最多 100 个文件，总计 20 MiB。</p>
      <div className="html-service-resources">{resources.map(r => <label className="html-service-resource" key={r.id}>
        <input type="checkbox" aria-label={'包含 ' + r.name} checked={r.selected} onChange={e => changeResource(r.id, { selected: e.target.checked })}/>
        <span><b>{r.name}</b><small>v{r.version} · {(r.size / 1024).toFixed(1)} KB{r.sessionId !== entry.sessionId ? ' · 项目其他产物' : ''}</small></span>
        <input aria-label={r.name + ' 包内路径'} value={r.path} onChange={e => changeResource(r.id, { path: e.target.value })}/>
      </label>)}{!resources.length && <p className="dim">没有配套产物，可直接发布自包含 HTML。</p>}</div></fieldset>
      <div className="service-toolbar"><button className="btn btn-ghost" disabled={busy || matching || published} onClick={() => action(save)}>保存页面草稿</button>
        <button className="btn btn-ghost" disabled={busy || matching || published || !context.service.available} onClick={() => action(async () => { const saved = preparedRef.current || await save(); if (!saved || !live()) return; const result = await API.previewWorkbenchService(context.wb, saved.revision, signal()); if (live()) setPreview(url() + '&releaseId=' + encodeURIComponent(result.data.id)); })}>保存并预览</button>
        <button className="btn btn-ghost" disabled={busy || matching || published} onClick={() => action(async () => { const result = await API.fetchWorkbenchService(context.wb, signal()); if (live()) { invalidate(); setContext(c => ({ ...c, service: result.data })); setReplace(false); setNotice('已重新读取服务草稿，保留当前页面编辑；请核对后再次保存。'); } })}>重新读取服务草稿</button>
      </div>
      {prepared && !published && <section className="service-notice"><b>将发布整个工作台服务草稿</b><p>{definition.capabilities.length} 项业务能力、{definition.pages.length} 个页面；页面变更：{changed.join('、') || '无'}。其他已保存的草稿修改也会一起发布。</p><details><summary>查看与当前正式版本的完整差异</summary><pre>{JSON.stringify({ current: active || null, next: definition }, null, 2)}</pre></details>
        <button className="btn btn-primary" disabled={busy || !context.service.available} onClick={() => action(async () => { await API.publishWorkbenchService(context.wb, prepared.revision, signal()); if (live()) { setPublished(true); setNotice('HTML 服务已发布。'); setPreview(''); } })}>发布新版本</button>
      </section>}
      {published && <p><a href={url()} target="_blank" rel="noopener noreferrer">打开已发布页面</a> · <a href={'#/workbench?tab=pro&id=' + encodeURIComponent(context.wb)}>管理服务版本与授权</a></p>}
      {prepared?.source && <details><summary>固定的产物版本与来源</summary><pre>{JSON.stringify(prepared.source, null, 2)}</pre></details>}
      {preview && <div className="service-preview"><header><b>草稿页面预览</b><button className="btn btn-ghost" onClick={() => setPreview('')}>关闭预览</button></header><iframe title="HTML 服务草稿预览" src={preview}/></div>}
    </>}
  </div></KnowledgeControls></Overlay>;
}
