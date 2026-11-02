import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { RefreshCw, Settings } from 'lucide-react';
import { authSession } from '../../services/authSession.js';
import { KnowledgeControls } from '../knowledge/KnowledgeControls.jsx';
import { readPreference, savePreference } from './hubModel.js';
import { Commander } from './commander/Commander.jsx';
import { Intelligence } from './intelligence/Intelligence.jsx';
import { Empty, Notice, HubSelect } from './HubUI.jsx';
import './hub.css';

export function WorkbenchHub({ role }) {
  const auth = useSyncExternalStore(authSession.subscribe, authSession.getSnapshot);
  return <KnowledgeControls><HubWorkspace key={`${auth.version}:${role}`} role={role} account={auth.user?.id || auth.user?.account || ''}/></KnowledgeControls>;
}
function HubWorkspace({ role, account }) {
  const [catalog, setCatalog] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  const [preference, setPreference] = useState(() => readPreference(account, role));
  useEffect(() => {
    const bar = document.querySelector('.app-topbar'), owner = {};
    if (bar) { bar.hubOwner = owner; bar.classList.add('hub-topbar'); }
    return () => { if (bar?.hubOwner === owner) { bar.classList.remove('hub-topbar'); delete bar.hubOwner; } };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    Promise.all([API.fetchWorkbenches(), API.fetchProjects()]).then(([w, p]) => {
      if (controller.signal.aborted) return;
      // Other existing API readers update their shared cache in place. A hub snapshot owns its data.
      setCatalog(structuredClone({ workbenches: w.data, projects: p.data }));
      setPreference(previous => {
        const names = role === 'commander' ? ['指挥官', '指挥中心'] : ['情报中心', '情报分析', '情报工作台'];
        const workbench = w.data.find(row => row.id === previous.workbenchId) || w.data.find(row => names.includes(row.name));
        const available = p.data.filter(row => row.workbenchId === workbench?.id);
        const project = available.find(row => row.id === previous.projectId) || available.find(row => names.includes(row.name)) || (available.length === 1 ? available[0] : null);
        return { ...previous, workbenchId: workbench?.id || '', projectId: project?.id || '', taskId: project?.id === previous.projectId ? previous.taskId || '' : '' };
      });
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [role, revision]);
  function choose(patch) { setPreference(previous => { const next = { ...previous, ...patch }; savePreference(account, role, next); return next; }); }
  const wb = catalog?.workbenches.find(row => row.id === preference.workbenchId);
  const project = catalog?.projects.find(row => row.id === preference.projectId && row.workbenchId === wb?.id);
  return <div className={`hub-page hub-${role}`}>
    <nav className="hub-narrow-nav" aria-label="工作台入口"><a className={role === 'commander' ? 'selected' : ''} href="#/workbench?tab=commander">指挥官</a><a className={role === 'intel' ? 'selected' : ''} href="#/workbench?tab=intel">情报中心</a></nav>
    <div className="hub-binding">
      <HubSelect label={role === 'commander' ? '指挥工作台' : '情报工作台'} value={wb?.id} options={(catalog?.workbenches || []).map(row => ({ value: row.id, label: row.name }))} onChange={id => choose({ workbenchId: id, projectId: '', taskId: '' })}/>
      <HubSelect label={role === 'commander' ? '指挥项目' : '分析项目'} value={project?.id} options={(catalog?.projects || []).filter(row => row.workbenchId === wb?.id).map(row => ({ value: row.id, label: row.name }))} onChange={id => choose({ projectId: id, taskId: '' })}/>
      {wb&&<a className="btn btn-ghost" href={`#/workbench?tab=pro&id=${encodeURIComponent(wb.id)}`}><Settings size={14}/>配置</a>}
      <button className="btn btn-ghost" aria-label="刷新工作台列表" onClick={() => setRevision(v => v + 1)}><RefreshCw size={14}/></button>
    </div>
    <Notice>{error}</Notice>
    {!catalog ? <Empty>{error ? '列表暂不可用，请重试。' : '正在读取工作台和项目…'}</Empty> : !project ? <Empty>选择一个已发布工作台下的项目。<a href="#/workbench?tab=pro">管理工作台</a><a href="#/projects">管理项目</a></Empty> : role === 'commander'
      ? <Commander key={project.id} project={project} workbench={wb} catalog={catalog} preference={preference} choose={choose}/>
      : <Intelligence key={project.id} project={project} catalog={catalog} account={account} preference={preference} choose={choose}/>}
  </div>;
}
export function mountWorkbenchHub(el, role) {
  const root = createRoot(el); root.render(<WorkbenchHub role={role}/>); el.viewCleanup = () => root.unmount();
}
