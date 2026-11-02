import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, Braces, Check, Copy, FileCode2, Plug, RefreshCw } from 'lucide-react';
import { authSession } from '../../services/authSession.js';
import { projectPublishedServices, projectServiceLinks } from './projectServicesModel.js';
import './projectPublishedServices.css';

function CopyAddress({ value, name, onCopied }) {
  return <button type="button" className="btn btn-ghost" aria-label={'复制' + name + '地址'} onClick={() => onCopied(value, name)}><Copy size={14}/>复制地址</button>;
}

export function ProjectPublishedServices({ workbenchId, projectId }) {
  const version = useSyncExternalStore(authSession.subscribe, () => authSession.getSnapshot().version);
  const initialVersion = useRef(version), life = useRef(null);
  const [attempt, setAttempt] = useState(0), [state, setState] = useState(null), [notice, setNotice] = useState(null);
  const scope = workbenchId + ':' + projectId, current = version === initialVersion.current;
  const loaded = current && state?.scope === scope && state.attempt === attempt ? state : null;
  useEffect(() => {
    if (!current) return;
    const controller = new AbortController(), identity = version;
    life.current = controller; setNotice(null);
    const live = () => !controller.signal.aborted && authSession.getSnapshot().version === identity;
    Promise.all([API.fetchWorkbenchService(workbenchId, controller.signal), API.fetchServiceReleases(workbenchId, controller.signal)])
      .then(([service, releases]) => {
        if (live()) setState({ scope, attempt, model: projectPublishedServices(service.data, releases.data, projectId) });
      }).catch(error => { if (live()) setState({ scope, attempt, error: error.message || '读取已发布服务失败' }); });
    return () => controller.abort();
  }, [workbenchId, projectId, scope, attempt, version, current]);
  async function copy(value, name) {
    const controller = life.current, identity = version;
    if (!current || controller?.signal.aborted) return;
    try {
      await navigator.clipboard.writeText(value);
      if (!controller.signal.aborted && authSession.getSnapshot().version === identity) setNotice({ text: name + '地址已复制', error: false });
    } catch {
      if (!controller.signal.aborted && authSession.getSnapshot().version === identity) setNotice({ text: '复制失败，请选中下方地址手动复制。', error: true });
    }
  }
  const model = loaded?.model, release = model?.release;
  const count = model?.status === 'published' ? model.pages.length + model.api.length + model.mcp.length : 0;
  const links = release && projectServiceLinks(API, workbenchId, projectId, release.id);
  const manage = '#/workbench?tab=pro&id=' + encodeURIComponent(workbenchId);
  const empty = !current ? '登录状态已变化，请重新进入项目概览。' : loaded?.error ? null : !loaded ? '正在读取已发布服务…' : model.status === 'disabled' ? '服务已停用，可在工作台服务发布中管理。' : count === 0 ? '当前项目暂无已发布服务。发布 HTML 页面、API 或 MCP 后将在这里展示。' : null;
  return <section className="card project-services" aria-label="已发布服务" aria-busy={current && !loaded}>
    <header className="project-services-header"><div><h2>已发布服务{count > 0 && <span className="project-services-total">{count}</span>}</h2><p>当前项目的页面和业务能力入口</p></div><div className="project-services-actions">
      <button type="button" className="btn btn-ghost" aria-label="刷新已发布服务" disabled={!current || !loaded} onClick={() => setAttempt(n => n + 1)}><RefreshCw size={14}/>刷新</button>
      {current && <a className="btn btn-ghost" href={manage}>管理服务<ArrowUpRight size={14}/></a>}
    </div></header>
    {loaded?.error && <div className="project-services-message" role="alert">{loaded.error}<button type="button" className="btn btn-ghost" onClick={() => setAttempt(n => n + 1)}>重新加载</button></div>}
    {empty && <p className="project-services-message" role={!loaded ? 'status' : undefined}>{empty}</p>}
    {release && <>
      <div className="project-services-release"><span>{release.definition.name || '工作台服务'} · v{release.version}</span>{release.createdAt && <span>发布于 {new Date(release.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>}<span className={'project-services-status' + (!model.available ? ' is-unavailable' : '')}>{model.available ? '已发布' : '运行功能未启用'}</span></div>
      {!model.available && <p className="project-services-message">服务运行功能尚未启用，开启后可使用以下入口。</p>}
      {count > 0 && <div className="project-services-grid">
        {model.pages.map(page => <article className="project-service-entry" key={'page:' + page.key}>
          <div className="project-service-kind"><FileCode2 size={16}/><span>HTML 页面</span></div><h3>{page.name || page.key}</h3><p className="project-service-description">在当前项目中打开已发布页面</p>
          <code className="project-service-address">{links.page(page.key)}</code>
          <footer>{model.available && <a className="btn project-service-open" href={links.page(page.key)} target="_blank" rel="noopener noreferrer">打开页面<ArrowUpRight size={14}/></a>}<CopyAddress value={links.page(page.key)} name={page.name || page.key} onCopied={copy}/></footer>
        </article>)}
        {model.api.map(capability => <article className="project-service-entry" key={'api:' + capability.key}>
          <div className="project-service-kind"><Braces size={16}/><span>API 接口</span><span className="project-service-method">POST</span></div><h3>{capability.name || capability.key}</h3><p className="project-service-description">{capability.description || '通过接口调用此业务能力'}</p>
          <code className="project-service-address">{links.invoke(capability.key)}</code>
          <footer>{model.available && <a className="btn btn-ghost" href={links.docs} target="_blank" rel="noopener noreferrer">查看文档<ArrowUpRight size={14}/></a>}<CopyAddress value={links.invoke(capability.key)} name={capability.name || capability.key} onCopied={copy}/></footer>
        </article>)}
        {model.mcp.length > 0 && <article className="project-service-entry">
          <div className="project-service-kind"><Plug size={16}/><span>MCP 服务</span><span className="project-service-method">Streamable HTTP</span></div><h3>{release.definition.name || '工作台 MCP'}</h3>
          <ul className="project-service-tools">{model.mcp.map(c => <li key={c.key}><span>{c.name || c.key}</span><code>{c.key}</code></li>)}</ul>
          <code className="project-service-address">{links.mcp}</code><footer><CopyAddress value={links.mcp} name="MCP 连接" onCopied={copy}/></footer>
        </article>}
      </div>}
      {(model.api.length > 0 || model.mcp.length > 0) && <p className="project-services-hint">接口和 MCP 调用使用项目参数 <code>projectId: {projectId}</code>，访问权限沿用工作台服务授权。</p>}
    </>}
    {current && notice && <p className={'project-services-feedback' + (notice.error ? ' is-error' : '')} role={notice.error ? 'alert' : 'status'}>{!notice.error && <Check size={14}/>}{notice.text}</p>}
  </section>;
}

export function mountProjectPublishedServices(host, props) {
  const root = createRoot(host);
  root.render(<ProjectPublishedServices {...props}/>);
  return () => root.unmount();
}
