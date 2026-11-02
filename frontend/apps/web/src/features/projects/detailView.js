import { editTask } from '../tasks/editor.js';
import { taskRows, taskFiles, taskUsage } from '../tasks/projectPanels.js';
import { esc, date, viewScope, showError, snapshotHtml } from '../workbench/ui.js';
import { editProject } from './editor.js';
import { renderKnowledgeScope } from '../knowledge/views.js';
import { renderMemoryScope } from '../memory/views.js';
import { mountRuntimeEditor } from '../runtime/RuntimeEditor.jsx';
import { mountDatabaseScope } from '../databases/databaseMount.js';
const tabs=[['overview','概览'],['sessions','任务'],['files','成果文件'],['databases','数据库'],['runtime','运行资源'],['kb','知识库'],['memory','记忆']];
window.Views ||= {};
window.Views.project={async render(el,id,query={}){
  const valid=viewScope(el),reload=()=>this.render(el,id,query);el.innerHTML='<div class="page">'+UI.skeleton(4)+'</div>';
  try{const{data:d}=await API.fetchProjectDetail(id);if(!valid())return;const p=d.project,version=d.workbenchVersion,active=tabs.some(([key])=>key===query.tab)?query.tab:'overview';
    document.getElementById('topbar-title').innerHTML='<a href="#/projects">项目</a>';document.getElementById('topbar-crumb').textContent=' / '+p.name;document.getElementById('topbar-tabs').innerHTML='<div class="tabs">'+tabs.map(([key,label])=>`<a class="tab ${active===key?'active':''}" href="#/project/${encodeURIComponent(id)}?tab=${key}">${label}</a>`).join('')+'</div>';
    let body=active==='sessions'?`<div class="card">${taskRows(d.sessions)}</div>`:active==='files'?'<div data-project-files></div>':active==='databases'?'<div data-database-scope></div>':active==='runtime'?'<div data-runtime></div>':active==='kb'?'<div data-knowledge-scope></div>':active==='memory'?'<div data-memory-scope></div>':`${taskUsage(d)}<div class="card card-pad" style="margin-top:20px"><div class="tc-title">业务配置 v${version.version}</div><p class="dim">发布于 ${date(version.publishedAt)}。运行资源独立更新，每轮固定快照。</p><details><summary>查看项目业务定义</summary>${snapshotHtml(version.snapshot)}</details></div><div data-project-services></div><div class="card" style="margin-top:20px">${taskRows(d.sessions.slice(0,8))}</div>`;
    el.innerHTML=`<div class="page project-detail-page"><div class="pd-head"><div><div class="pd-title">${esc(p.name)}</div><div class="pd-sub">${esc(p.desc)}</div></div><div class="config-actions"><button class="btn btn-ghost" data-edit>编辑项目</button><button class="btn btn-primary" data-new ${p.status!=='active'?'disabled':''}>新建任务</button><button class="btn btn-ghost" data-refresh>刷新</button></div></div><section class="project-workbench-context"><span class="project-context-icon">${ICON('layout-dashboard',20)}</span><div class="project-context-main"><div class="project-context-label">所属工作台</div><div class="project-context-name">${esc(p.workbenchName)}</div></div><a class="btn btn-ghost btn-sm" href="#/workbench?tab=pro&id=${encodeURIComponent(p.workbenchId)}">工作台配置</a></section>${body}</div>`;
    el.querySelector('[data-edit]').onclick=()=>editProject(p,[],null,valid,reload);el.querySelector('[data-new]').onclick=()=>editTask(p,null,valid,t=>{location.hash='#/task/'+t.id;});el.querySelector('[data-refresh]').onclick=reload;
    for(const button of el.querySelectorAll('[data-task-download]'))button.onclick=()=>{const f=d.files.find(f=>f.id===button.dataset.taskDownload);const a=document.createElement('a');a.href=API.artifactUrl(id,f);a.download=f.name;a.click();};
    if(active==='overview'){const{mountProjectPublishedServices}=await import('../services/ProjectPublishedServices.jsx');if(valid())el.viewCleanup=mountProjectPublishedServices(el.querySelector('[data-project-services]'),{projectId:id,workbenchId:p.workbenchId});}
    if(active==='runtime')el.viewCleanup=mountRuntimeEditor(el.querySelector('[data-runtime]'),'project',id);
    if(active==='files'){const{mountProjectFiles}=await import('../files/ProjectFiles.jsx');if(valid())el.viewCleanup=mountProjectFiles(el.querySelector('[data-project-files]'),{projectId:id,initialFiles:d.files,writable:p.status==='active'});}
    if(active==='databases'&&API.fetchDatabaseScope)el.viewCleanup=mountDatabaseScope(el.querySelector('[data-database-scope]'),{kind:'project',id,initialDatabase:query.database});
    if(active==='kb')await renderKnowledgeScope(el.querySelector('[data-knowledge-scope]'),{kind:'project',id,valid,onChanged:reload});
    if(active==='memory')await renderMemoryScope(el.querySelector('[data-memory-scope]'),{kind:'project',id,valid});
  }catch(e){if(valid())showError(el,e,reload);}
}};
