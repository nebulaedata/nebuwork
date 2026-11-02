import {createServer,request as proxyRequest} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {fixture,testConfig} from './fixture.js';
import {Store} from '../src/store.js';
import {Objects} from '../src/objects.js';
import {Business} from '../src/business.js';
import {Worker} from '../src/worker.js';
import {createApi} from '../src/api.js';
import mysql from 'mysql2/promise';

// Explicit local acceptance fixture. It never ships in dist or the engine container.
const upstream=await fixture();
const bootstrap=await mysql.createConnection(testConfig.DATABASE_URL);await bootstrap.query('CREATE DATABASE IF NOT EXISTS agent_acceptance');await bootstrap.end();
const env={...testConfig,DATABASE_URL:testConfig.DATABASE_URL.replace('/agent_test','/agent_acceptance'),S3_BUCKET:'agent-acceptance',PORT:42120,BUSINESS_API_URL:'http://127.0.0.1:42022/nwaa'};
const store=new Store(env.DATABASE_URL),objects=new Objects(env);await store.migrate();await objects.initialize();
const api=await createApi(env,store,objects);await api.listen({host:'0.0.0.0',port:42120});
const workers=[0,1,2].map(()=>new Worker(env,store,objects,new Business(env)));
let ticking=false;const timer=setInterval(async()=>{if(ticking)return;ticking=true;try{await Promise.all(workers.map(w=>w.tick()));}catch{console.error('Acceptance scheduler unavailable');}finally{ticking=false;}},250);
const gateway=createServer((req,res)=>{
  if(req.url?.startsWith('/nebulaedev/web/punterapi/power/')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:0,data:{userInfo:{punterId:'acceptance-user',nickName:'联调测试账号'}}}));return;}
  if(!req.url?.startsWith('/nebulaedev/nwaa/')){res.writeHead(404).end();return;}
  const upstream=proxyRequest({hostname:'127.0.0.1',port:42022,path:req.url.replace('/nebulaedev',''),method:req.method,headers:{...req.headers,host:'127.0.0.1:42022',token:'acceptance-only-token'}},response=>{res.writeHead(response.statusCode!,response.headers);response.pipe(res);});
  upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});req.pipe(upstream);res.on('close',()=>upstream.destroy());
});gateway.listen(42122,'127.0.0.1');
await writeFile('.acceptance-host.json',JSON.stringify({modelUrl:`http://127.0.0.1:${upstream.port}/v1`,javaModelUrl:`http://host.docker.internal:${upstream.port}/v1`,gateway:'http://127.0.0.1:42122'}));
console.log('Acceptance engine, scripted model and test gateway ready');
const close=async()=>{clearInterval(timer);gateway.close();await Promise.all(workers.map(w=>w.stop()));await api.close();await upstream.app.close();await store.close();objects.client.destroy();};
process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
