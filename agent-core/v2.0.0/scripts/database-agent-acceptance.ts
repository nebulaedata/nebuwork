import { createUuid } from '../src/uuid.js';
import { mkdir, writeFile } from 'node:fs/promises';
const base='http://127.0.0.1:42028/nebulaedev/nwaa/api';
async function call(path:string,body?:unknown,key=createUuid()):Promise<any>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','idempotency-key':key},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json() as any;if(!response.ok||result.code!==0)throw Error(path+': '+JSON.stringify(result));return result.data;}
const providers=await call('/model-providers');let provider=providers.find((p:any)=>p.model==='scripted-database-model');
provider??=await call('/model-providers',{type:'custom',baseUrl:'http://127.0.0.1:42142/v1',model:'scripted-database-model',apiKey:'database-test-model-key'});
const resource=await call('/runtime-resources/workbench/qa-workbench');
const saved=await call('/runtime-resources/workbench/qa-workbench',{revision:resource.revision,document:{instructions:[],files:[],skills:[],mcp:[],model:{},modelProviderId:provider.id,requiredCapabilities:[]}});
await call('/runtime-resources/workbench/qa-workbench/publish',{revision:saved.revision});
const task=await call('/projects/qa-project/tasks',{title:'数据库智能体端到端验收',content:'新建 SQLite，建表，将生成的结构化数据写入，查询核对后导出 CSV。'});
let snapshot:any;const deadline=Date.now()+180000;
do{snapshot=await call('/tasks/'+task.task.id);const status=snapshot.runs.at(-1)?.status;if(['completed','failed','cancelled','interrupted'].includes(status))break;await new Promise(resolve=>setTimeout(resolve,500));}while(Date.now()<deadline);
const run=await call('/tasks/'+task.task.id+'/runs/'+snapshot.runs.at(-1).id);
const databases=(await call('/database-scopes/project/qa-project/databases')).databases;const created=databases.filter((d:any)=>d.name==='智能体自动建库验收').at(-1);
const operations=created?(await call('/databases/'+created.id+'/operations')).items:[];
const artifacts=await call('/projects/qa-project/artifacts');
const evidence={taskId:task.task.id,runId:run.id,status:run.status,databaseId:created?.id,operations:operations.map((op:any)=>({id:op.id,operation:op.operation,state:op.state,rowCount:op.result?.rowCount,affectedRows:op.result?.affectedRows})),artifacts:artifacts.items.map((a:any)=>({id:a.id,version:a.version,name:a.name})),eventTypes:snapshot.events.map((e:any)=>e.type)};
await mkdir('.qa',{recursive:true});await writeFile('.qa/database-agent-acceptance.json',JSON.stringify(evidence,null,2));process.stdout.write(JSON.stringify(evidence,null,2)+'\n');
if(run.status!=='completed'||operations.filter((o:any)=>o.state==='completed'&&o.runId===run.id).length<4||run.manifest.databaseReferences.some((r:any)=>r.id===created.id)||!artifacts.items.some((a:any)=>a.name==='智能体生成数据.csv'))throw Error('Database agent acceptance failed: '+JSON.stringify(run.error));
