import { esc, modal, footer, creationKey } from '../workbench/ui.js';
export function editProject(project, workbenches, selectedId, valid, onSaved) {
  const key=creationKey(),available=workbenches.filter(w=>w.activeVersionId);
  modal(project?'编辑项目':'新建项目', `<div class="field"><label>项目名称</label><input id="pe-name" maxlength="160" value="${esc(project?.name)}"></div><div class="field"><label>所属工作台</label>${project?`<p>${esc(project.workbenchName)} · 业务版本 v${project.ontologyVersion}</p>`:'<div id="pe-workbench"></div>'}<p class="dim">项目固定业务配置版本。智能体每轮解析最新发布的运行资源。</p></div><div class="field"><label>项目说明</label><textarea id="pe-desc" rows="3">${esc(project?.desc)}</textarea></div>${project?'<div class="field"><label>状态</label><div id="pe-status"></div></div>':''}${footer(project?'保存修改':'创建项目')}`,valid,ctx=>{
    const selected=available.find(w=>w.id===selectedId)?.id;
    const workbench=project?null:ctx.select('#pe-workbench',{label:'所属工作台',value:selected,options:available.map(w=>({value:w.id,label:`${w.name} · v${w.activeVersion}`}))});
    const status=project?ctx.select('#pe-status',{label:'项目状态',value:project.status,options:[{value:'active',label:'进行中'},{value:'paused',label:'暂停'},{value:'archived',label:'归档'}]}):null;
    if(!project&&!available.length){ctx.error(new Error('请先创建并发布工作台。'));ctx.box.querySelector('[data-save]').disabled=true;}
    ctx.action('[data-save]',async()=>{const payload={name:ctx.box.querySelector('#pe-name').value.trim(),desc:ctx.box.querySelector('#pe-desc').value.trim()};if(!payload.name)throw new Error('请输入项目名称');if(project){payload.revision=project.revision;payload.status=status.getValue();}else{payload.workbenchId=workbench.getValue();if(!payload.workbenchId)throw new Error('请选择已发布的工作台');}
      const result=project?await API.updateProject(project.id,payload):await API.createProject(payload,key(payload));if(!ctx.live())return;UI.closeModal();UI.toast('项目已保存');onSaved(result.data);
    });
  });
}
