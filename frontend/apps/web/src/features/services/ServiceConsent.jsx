import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { authSession } from '../../services/authSession.js';
import './services.css';
export function ServiceConsent({ requestId }) {
  const [request, setRequest] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { const abort = new AbortController(), epoch = authSession.getSnapshot().version; const unsubscribe = authSession.subscribe(() => { if (authSession.getSnapshot().version !== epoch) { abort.abort(); setRequest(null); } }); API.fetchServiceConsent(requestId, abort.signal).then(r => { if (!abort.signal.aborted) setRequest(r.data); }).catch(e => { if (!abort.signal.aborted) setError(e.message); }); return () => { abort.abort(); unsubscribe(); }; }, [requestId]);
  async function decide(approve) { setBusy(true); setError(''); const version = authSession.getSnapshot().version; try { const r = await API.decideServiceConsent(requestId, approve); authSession.assertCurrent(version); location.assign(r.data.redirectUri); } catch (e) { if (authSession.getSnapshot().version === version) { setError(e.message); setBusy(false); } } }
  return <div className="page"><section className="card service-consent"><h2>授权应用访问工作台服务</h2>{error && <p role="alert">{error}</p>}{request ? <><p>应用「{request.application.name}」请求在当前账号的授权范围内调用工作台服务。</p><p>工作台：{request.workbenchId}</p><pre>{JSON.stringify(request.application.scope, null, 2)}</pre><div className="service-toolbar"><button className="btn btn-ghost" disabled={busy} onClick={() => decide(false)}>拒绝</button><button className="btn btn-primary" disabled={busy} onClick={() => decide(true)}>允许此应用</button></div></> : !error && <p>正在读取授权请求…</p>}</section></div>;
}
window.Views = window.Views || {};
window.Views['service-consent'] = { render(el, _id, query = {}) { const root = createRoot(el); root.render(<ServiceConsent requestId={query.requestId || ''}/>); el.viewCleanup = () => root.unmount(); } };
