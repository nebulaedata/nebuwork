import { createUuid } from '../src/uuid.js';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const host=JSON.parse(await readFile('.acceptance-host.json','utf8'));
const root='http://127.0.0.1:42022/nwaa/api';
async function call(path:string,body?:unknown,key=createUuid()){
  const res=await fetch(root+path,{method:body?'POST':'GET',headers:{token:'acceptance-only-token','content-type':'application/json','idempotency-key':key},body:body?JSON.stringify(body):undefined});
  if(!res.ok)throw Error(`${path}: ${res.status} ${await res.text()}`);return (await res.json() as any).data;
}
const model=(await call('/model-providers')).find((m:any)=>m.baseUrl===host.modelUrl)??await call('/model-providers',{type:'custom',baseUrl:host.modelUrl,apiKey:'fixture-secret-never-persist',model:'scripted-model'});
const expert=await call('/agents',{name:'共享素材专家',role:'分析',tagline:'依据来源',modelProviderId:model.id});
const sop=await call(`/agents/${expert.id}/sop-sets`,{name:'核验资料',kind:'process',desc:'先阅读参考素材'});
const upload=new FormData();upload.set('revision','1');upload.set('file',new Blob(['shared-sop-evidence'],{type:'text/plain'}),'evidence.txt');
const uploaded=await fetch(root+`/agents/${expert.id}/sop-sets/${sop.id}/materials`,{method:'POST',headers:{token:'acceptance-only-token'},body:upload});assert.equal(uploaded.status,200,await uploaded.clone().text());const material=(await uploaded.json() as any).data.materialRefs[0];
const downloaded=await fetch(root+`/agents/${expert.id}/sop-sets/${sop.id}/materials/${material.id}/content`,{headers:{token:'acceptance-only-token'}});assert.equal(downloaded.status,200);assert.equal(await downloaded.text(),'shared-sop-evidence');
await call(`/runtime-resources/expert/${expert.id}`,{revision:0,document:{modelProviderId:model.id,instructions:[],files:[],skills:[],mcp:[],requiredCapabilities:[]}});await call(`/runtime-resources/expert/${expert.id}/publish`,{revision:1});
const wb=await call('/workbenches',{name:'分布式引擎验收'});
await call(`/workbenches/${wb.id}/bindings/agents/${expert.id}`,{revision:1,enabled:true});
await call(`/workbenches/${wb.id}/config`,{revision:2,bizName:'研究分析',domain:'项目分析',bizDef:'按照可验证证据完成任务',defaultAgentId:expert.id});
await call(`/runtime-resources/workbench/${wb.id}`,{revision:0,document:{modelProviderId:model.id,instructions:[{source:'workbench',path:'AGENTS.md',scope:'',content:'提交成果前检查来源。',revision:'1'}],files:[],skills:[],mcp:[],requiredCapabilities:[]}});
await call(`/workbenches/${wb.id}/publish`,{revision:3});
const project=await call('/projects',{name:'新引擎联调项目',workbenchId:wb.id});
const input={title:'项目研究报告',content:'write-report 请整理项目资料并生成报告'},key=createUuid();
const task=await call(`/projects/${project.id}/tasks`,input,key),repeat=await call(`/projects/${project.id}/tasks`,input,key);
assert.equal(task.task.id,repeat.task.id);assert.equal(task.runs[0].id,repeat.runs[0].id);
let detail:any;for(let i=0;i<120;i++){detail=await call(`/tasks/${task.task.id}`);if(['completed','failed','interrupted'].includes(detail.runs[0].status))break;await new Promise(r=>setTimeout(r,500));}
assert.equal(detail.runs[0].status,'completed',JSON.stringify(detail.runs[0].error));
const run=await call(`/tasks/${task.task.id}/runs/${detail.runs[0].id}`);assert.equal(run.manifest.model.model,'scripted-model');assert.ok(run.manifest.instructions.some((i:any)=>i.content.includes('检查来源')));
assert.ok(run.manifest.files.some((f:any)=>f.path.endsWith('/evidence.txt')));assert.ok(run.manifest.instructions.some((i:any)=>i.content.includes('先阅读参考素材')));
const files=await call(`/projects/${project.id}/artifacts`);assert.equal(files.items.length,1);
const content=await fetch(`${root}/projects/${project.id}/artifacts/${files.items[0].id}/content?version=1`,{headers:{token:'acceptance-only-token',range:'bytes=0-7'}});assert.equal(content.status,206);assert.equal(await content.text(),'# Report');
assert.ok(!JSON.stringify(detail).includes('fixture-secret-never-persist'));
await call(`/tasks/${task.task.id}/runs`,{content:'继续核对报告的来源'});
await writeFile('.acceptance-result.json',JSON.stringify({taskId:task.task.id,projectId:project.id,workbenchId:wb.id,runId:run.id,artifact:files.items[0],checks:['published resources + SOP material version','Java HTTP callback','pi direct model','Docker file tools','versioned artifact + Range','idempotency','credential isolation','follow-up conversation']},null,2));
console.log(JSON.stringify({taskId:task.task.id,projectId:project.id,status:'passed'}));
