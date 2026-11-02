/** Isolated browser acceptance host. Uses only compose.test.yml infrastructure. */
import { createServer, request } from 'node:http';
import { createApi } from '../src/api.js';
import { Store } from '../src/store.js';
import { Objects } from '../src/objects.js';
import { Business } from '../src/business.js';
import { Worker } from '../src/worker.js';
import { testConfig } from '../tests/fixture.js';
const store=new Store(testConfig.DATABASE_URL),objects=new Objects(testConfig);
await store.migrate();await objects.initialize();const api=await createApi(testConfig,store,objects);
await api.listen({host:'127.0.0.1',port:42141});
const gateway=createServer((incoming,outgoing)=>{
  if(incoming.url?.startsWith('/nebulaedev/web/punterapi/')){
    incoming.resume();outgoing.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
    outgoing.end(JSON.stringify({status:0,data:{userInfo:{punterId:'alice',nickName:'数据库隔离验收'}}}));return;
  }
  if(!incoming.url?.startsWith('/nebulaedev/nwaa/')){outgoing.writeHead(404);outgoing.end();return;}
  const forwarded=request({hostname:'127.0.0.1',port:42140,path:incoming.url.replace(/^\/nebulaedev/,''),method:incoming.method,headers:{...incoming.headers,host:'127.0.0.1:42140',token:'database-browser-token'}},response=>{outgoing.writeHead(response.statusCode??502,response.headers);response.pipe(outgoing);});
  forwarded.on('error',()=>{outgoing.writeHead(502);outgoing.end('Isolated database Java host unavailable');});incoming.pipe(forwarded);
});
gateway.listen(42028,'127.0.0.1',()=>process.stdout.write('Database acceptance API 42141 / gateway 42028 ready\n'));
// Explicitly scripted model for protocol acceptance, not a production model.
const model=createServer(async(incoming,outgoing)=>{
  if(incoming.url==='/v1/models'){outgoing.setHeader('content-type','application/json');outgoing.end(JSON.stringify({object:'list',data:[{id:'scripted-database-model',object:'model'}]}));return;}
  if(incoming.url!=='/v1/chat/completions'){outgoing.writeHead(404);outgoing.end();return;}
  const chunks:Buffer[]=[];for await(const chunk of incoming)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString());
  const calls=new Map<string,string>();for(const message of body.messages??[])for(const call of message.tool_calls??[])calls.set(call.id,call.function.name);
  const decode=(value:any):any=>{if(typeof value==='string'){try{return decode(JSON.parse(value));}catch{return value;}}if(Array.isArray(value))return decode(value[0]?.text??value[0]);if(value?.content)return decode(value.content);return value;};
  const results=(body.messages??[]).filter((m:any)=>m.role==='tool').map((m:any)=>({name:calls.get(m.tool_call_id),value:decode(m.content)}));
  const created=results.find((r:any)=>r.name==='database_create')?.value,last=results.at(-1);let next:string|undefined,args:any={},content='数据库验收未完成';
  if(!last){next='database_create';args={name:'智能体自动建库验收',description:'真实 pi SDK / Java 工具 / SQLite / S3 端到端协议验收'};}
  else if(last.value?.state==='unknown'||last.value?.state==='failed'||last.value?.isError)content='数据库操作失败或待核对：'+JSON.stringify(last.value);
  else if(['queued','running'].includes(last.value?.state)){next='database_operation_get';args={databaseId:created.id,operationId:last.value.operationId??last.value.id,waitMs:20000};}
  else if(last.name==='database_create'){next='database_execute';args={databaseId:created.id,sql:'CREATE TABLE generated_data (id INTEGER PRIMARY KEY, topic TEXT, value TEXT)'};}
  else if(last.value?.operation==='execute'){next='database_insert_rows';args={databaseId:created.id,table:'generated_data',rows:[{id:1,topic:'生成结果',value:'0012'},{id:2,topic:'精确数字',value:'9007199254740993'}]};}
  else if(last.value?.operation==='insert_rows'){next='database_query';args={databaseId:created.id,sql:'SELECT topic,value FROM generated_data ORDER BY id'};}
  else if(last.value?.operation==='query'){next='database_export';args={databaseId:created.id,table:'generated_data',format:'csv',name:'智能体生成数据'};}
  else if(last.value?.operation==='export'){const artifact=last.value.result.artifact;content=`已新建 SQLite、建表并保存 2 行生成数据，查询已核对前导零和精确数字。成果：[智能体生成数据.csv](artifact://${artifact.id}/${artifact.version})`;}
  const delta=next?{role:'assistant',tool_calls:[{index:0,id:'database-call-'+results.length,type:'function',function:{name:next,arguments:JSON.stringify(args)}}]}:{role:'assistant',content};
  const base={id:'database-model-'+results.length,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'scripted-database-model'};
  outgoing.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});outgoing.write('data: '+JSON.stringify({...base,choices:[{index:0,delta,finish_reason:null}]})+'\n\n');outgoing.write('data: '+JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:next?'tool_calls':'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}})+'\n\n');outgoing.end('data: [DONE]\n\n');
});
model.listen(42142,'127.0.0.1');
const workerConfig={...testConfig,BUSINESS_API_URL:'http://127.0.0.1:42140/nwaa',LEASE_MS:30000};const worker=new Worker(workerConfig,store,objects,new Business(workerConfig));
let ticking=false;const timer=setInterval(()=>{if(ticking)return;ticking=true;worker.tick().catch(e=>process.stderr.write('Database acceptance worker: '+e.message+'\n')).finally(()=>{ticking=false;});},300);
async function close(){clearInterval(timer);gateway.close();model.close();await worker.stop();await api.close();await store.close();objects.client.destroy();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
