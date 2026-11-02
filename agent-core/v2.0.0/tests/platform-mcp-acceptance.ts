import { createUuid } from '../src/uuid.js';
import assert from 'node:assert/strict';
import {createServer,request as proxyRequest} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {fixture,testConfig} from './fixture.js';
import {Store} from '../src/store.js';
import {Objects} from '../src/objects.js';
import {Business} from '../src/business.js';
import {Worker} from '../src/worker.js';
import {createApi} from '../src/api.js';
import {createPlatformMcpServer} from '../src/platform-mcp-server.js';
import mysql from 'mysql2/promise';

const root='http://127.0.0.1:42023/nwaa/api';
const bootstrap=await mysql.createConnection(testConfig.DATABASE_URL);await bootstrap.query('CREATE DATABASE IF NOT EXISTS platform_mcp_acceptance');await bootstrap.end();
const env={...testConfig,DATABASE_URL:testConfig.DATABASE_URL.replace('/agent_test','/platform_mcp_acceptance'),S3_BUCKET:'platform-mcp-acceptance',BUSINESS_API_URL:'http://127.0.0.1:42023/nwaa'};
const store=new Store(env.DATABASE_URL),objects=new Objects(env);await store.migrate();await objects.initialize();
const provider=await fixture(),api=await createApi(env,store,objects);await api.listen({host:'127.0.0.1',port:42220});
const mcp=createPlatformMcpServer({businessUrl:env.BUSINESS_API_URL,serviceKey:'isolated-platform-service-key-32-characters'});await new Promise<void>(r=>mcp.listen(42221,'127.0.0.1',r));
const workers=[0,1].map(()=>new Worker(env,store,objects,new Business(env)));
let ticking=false;const timer=setInterval(async()=>{if(ticking)return;ticking=true;try{await Promise.all(workers.map(w=>w.tick()));}finally{ticking=false;}},200);
const gateway=createServer((req,res)=>{
  if(req.url?.startsWith('/nebulaedev/web/punterapi/power/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:0,data:{userInfo:{punterId:'platform-acceptance-user',nickName:'MCP 隔离测试'}}}));return;}
  if(!req.url?.startsWith('/nebulaedev/nwaa/')){res.writeHead(404).end();return;}
  const proxy=proxyRequest({hostname:'127.0.0.1',port:42023,path:req.url.replace('/nebulaedev',''),method:req.method,headers:{...req.headers,host:'127.0.0.1:42023',token:'platform-acceptance-token'}},response=>{res.writeHead(response.statusCode!,response.headers);response.pipe(res);});proxy.on('error',()=>res.writeHead(502).end());req.pipe(proxy);
});gateway.listen(42222,'127.0.0.1');
async function call(path:string,body?:unknown,key=createUuid()){const res=await fetch(root+path,{method:body?'POST':'GET',headers:{token:'platform-acceptance-token','content-type':'application/json','idempotency-key':key},body:body?JSON.stringify(body):undefined});assert.ok(res.ok,`${path}: ${res.status} ${await res.clone().text()}`);return (await res.json() as any).data;}
async function settle(taskId:string){for(let i=0;i<180;i++){const detail=await call(`/tasks/${taskId}`);if(['completed','failed','interrupted'].includes(detail.runs.at(-1)?.status)){assert.equal(detail.runs.at(-1).status,'completed',JSON.stringify(detail.runs.at(-1).error));return detail;}await new Promise(r=>setTimeout(r,500));}throw Error('Task deadline exceeded');}
async function close(){clearInterval(timer);gateway.close();await Promise.all(workers.map(w=>w.stop()));await api.close();mcp.closeAllConnections();mcp.close();await provider.app.close();await store.close();objects.client.destroy();}
try{
  for(let i=0;i<120;i++){try{await call('/platform-mcp/catalog');break;}catch{if(i===119)throw Error('Java acceptance host unavailable');await new Promise(r=>setTimeout(r,500));}}
  const catalog=await call('/platform-mcp/catalog');assert.equal(catalog.tools.length,172);
  const model=await call('/model-providers',{type:'custom',baseUrl:`http://127.0.0.1:${provider.port}/v1`,apiKey:'fixture-secret-never-persist',model:'scripted-model'});
  async function workbench(name:string){const wb=await call('/workbenches',{name});await call(`/runtime-resources/workbench/${wb.id}`,{revision:0,document:{modelProviderId:model.id,instructions:[],files:[],skills:[],mcp:[],requiredCapabilities:[]}});await call(`/workbenches/${wb.id}/config`,{revision:1,bizName:name,domain:"MCP 验收",bizDef:"只使用真实系统能力完成隔离测试"});await call(`/workbenches/${wb.id}/publish`,{revision:2});return wb;}
  const source=await workbench('系统 MCP 验收工作台'),target=await workbench('被调度工作台');
  const sourceProject=await call('/projects',{name:'来源项目',workbenchId:source.id}),targetProject=await call('/projects',{name:'目标项目',workbenchId:target.id});
  const tools=['nw_project_list','nw_task_create','nw_memory_propose','nw_resource_read'];
  await call(`/workbenches/${source.id}/platform-mcp-policy`,{revision:0,policy:{enabled:true,scope:'account',tools,resources:[]}});await call(`/workbenches/${source.id}/platform-mcp-policy/publish`,{revision:1});
  const task=await call(`/projects/${sourceProject.id}/tasks`,{title:'系统 MCP 真实链路验收',content:`platform-mcp-smoke|${targetProject.id}|${sourceProject.id}`});
  const detail=await settle(task.task.id),runId=detail.runs.at(-1).id;
  const records=await call('/platform-mcp/operations');assert.equal(records.filter((r:any)=>r.run_id===runId&&r.state==='completed').length,3,JSON.stringify(records));
  const derived=(await call(`/projects/${targetProject.id}/tasks`)).find((t:any)=>t.title==='MCP 派生报告');assert.ok(derived);await settle(derived.id);
  const artifacts=await call(`/projects/${targetProject.id}/artifacts`);assert.ok(artifacts.items.length>0);
  const memories=await call(`/memory/scopes/project/${sourceProject.id}`);const draft=(memories.items??memories).find((e:any)=>e.title==='MCP 验收建议');assert.equal(draft.state,'draft');assert.equal(draft.source.type,'agent_proposal');assert.equal(draft.source.runId,runId);
  assert.ok(provider.modelRequests.some((r:any)=>r.tools?.some((t:any)=>t.function.name==='mcp__nebuwork__nw_task_create')));
  const exported=JSON.stringify(detail);assert.ok(!exported.includes('fixture-secret-never-persist'));assert.ok(!exported.includes('isolated-platform-service-key'));
  await writeFile('.qa-platform-mcp-acceptance.json',JSON.stringify({status:'passed',model:'scripted HTTP fixture (not a real model)',sourceWorkbench:source.id,targetWorkbench:target.id,sourceProject:sourceProject.id,targetProject:targetProject.id,taskId:task.task.id,runId,derivedTaskId:derived.id,artifactCount:artifacts.items.length,memoryId:draft.id,tools:records.map((r:any)=>({id:r.id,tool:r.tool_name,state:r.state}))},null,2));
  console.log('PASS: Java → Worker → official MCP HTTP → Java services; cross-workbench task, S3 artifact, memory draft and persisted calls.');
  if(process.env.PLATFORM_ACCEPTANCE_KEEP==='1'){console.log('Isolated browser gateway ready on 42222');await new Promise<void>(resolve=>{process.on('SIGINT',()=>resolve());process.on('SIGTERM',()=>resolve());});}
}finally{await close();await writeFile(process.env.PLATFORM_ACCEPTANCE_DONE!,'done');}
