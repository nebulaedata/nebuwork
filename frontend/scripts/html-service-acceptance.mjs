// Isolated browser fixture: actual UI, compiler, sandbox host and SDK; scripted service storage/auth.
// Run after building New2, with PLAYWRIGHT_MODULE pointing to an installed Playwright index.mjs.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { createServer } from 'vite';
if(!process.env.NEBU_ENGINE_DIST||!process.env.NEBU_SERVICE_ASSET_DIR)throw Error('Set NEBU_ENGINE_DIST to the built New2 dist directory and NEBU_SERVICE_ASSET_DIR to the Java workbench-service resource directory.');
const root=resolve('apps/web'),engine=resolve(process.env.NEBU_ENGINE_DIST);
const {createHtmlBundle}=await import(pathToFileURL(resolve(engine,'html-bundle.js')));
const {hash}=await import(pathToFileURL(resolve(engine,'contracts.js')));
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const java=resolve(process.env.NEBU_SERVICE_ASSET_DIR);
const principal={service:'browser-fixture',tenantId:'fixture',ownerId:'fixture',projects:['project'],scopes:['engine:read']};
const files=new Map([
  ['index.html',Buffer.from('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>任务报告</title><link rel="stylesheet" href="css/main.css"><main><h1>任务报告</h1><img src="img/chart.svg" alt="产物图片"><p id="result">正在读取固定产物…</p><button id="save">保存页面设置</button><p id="state"></p><p id="refresh-count">刷新次数：0</p></main><script type="module" src="js/main.js"></script></html>')],
  ['css/main.css',Buffer.from('@import "theme.css";body{margin:0;padding:28px;color:rgb(80,40,160);background:#faf9ff;font:16px TaskFont,system-ui}main{padding:24px;border:1px solid #dcd5ef;border-radius:12px;background:white}img{width:80px;height:48px}button{padding:10px 16px;border-radius:8px;border:0;background:#7253d7;color:white;font:inherit}')],
  ['css/theme.css',Buffer.from('@font-face{font-family:TaskFont;src:url(../fonts/report.woff2)}')],
  ['fonts/report.woff2',await readFile(resolve('node_modules/katex/dist/fonts/KaTeX_Main-Regular.woff2'))],
  ['img/chart.svg',Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="48"><rect x="8" y="20" width="15" height="25" fill="#7253d7"/><rect x="33" y="10" width="15" height="35" fill="#987be8"/><rect x="58" y="2" width="15" height="43" fill="#c2b2f3"/></svg>')],
  ['js/main.js',Buffer.from('import {total} from "./shared.js";import("./detail.js").then(async m=>{const c=await NebuService.ready();let count=0;NebuService.on("refresh",()=>{document.getElementById("refresh-count").textContent="刷新次数："+(++count);});document.getElementById("result").textContent=m.title+" · "+total+" · "+c.projectId;document.getElementById("save").onclick=async()=>{const s=await NebuService.state.save({filter:"confirmed"},c.revision);document.getElementById("state").textContent="已保存 v"+s.revision;};try{parent.document.body;document.body.dataset.isolated="no";}catch{document.body.dataset.isolated="yes";}fetch("/forbidden-direct-fetch").catch(()=>{document.body.dataset.network="blocked";});});')],
  ['js/shared.js',Buffer.from('export const total=42;')],['js/detail.js',Buffer.from('export const title="配套资源已加载";')],
]);
const artifacts=[...files].map(([path,bytes],i)=>({id:'artifact-'+i,version:i+1,name:path.split('/').at(-1),projectId:'project',sessionId:'task',runId:'run',source:{path:'report/'+path},size:bytes.length,sha256:hash(bytes),objectKey:path,mediaType:'application/octet-stream'}));artifacts[0].mediaType='text/html';
const store={artifact:async(p,id,version)=>{const a=artifacts.find(a=>a.id===id&&a.version===version);if(p.ownerId!=='fixture'||!a)throw Error('missing fixed artifact');return a;}};
const objects={authorize(){},get:async key=>({Body:Readable.from([files.get(key)])})};
let service={available:true,enabled:false,revision:0,draft:{name:'任务报告服务',description:'',capabilities:[],pages:[]}},active=null,state={},stateRevision=0,revoked=false,directRequests=0;
const assets=new Map(),releases=new Map(),instances=new Map();
const json=(res,value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
const body=async req=>{let value='';for await(const part of req)value+=part;return JSON.parse(value||'{}');};
const base='/api/workbench-services/wb';
const fixture=`import React from 'react';import {createRoot} from 'react-dom/client';import {HtmlServicePublishButton} from '/src/features/services/HtmlServicePublisher.jsx';import '/src/styles.css';import '/src/form-controls.css';import '/src/features/tasks/agentTask.css';
const request=async(path,body)=>{const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw Error(result.msg);return result;};
window.API={fetchProjectDetail:async()=>({data:{project:{id:'project',name:'验收项目',workbenchId:'wb'}}}),fetchProjectArtifacts:async()=>({data:{items:${JSON.stringify(artifacts)}}}),fetchWorkbenchService:()=>request('/__fixture/service'),fetchServiceReleases:()=>request('/__fixture/releases'),artifactContent:async(p,f)=>({data:await(await fetch('/__fixture/content/'+f.id)).blob()}),createServiceAsset:(w,b)=>request('/__fixture/assets',b),saveWorkbenchService:(w,b)=>request('/__fixture/service',b),previewWorkbenchService:(w,r)=>request('/__fixture/preview',{revision:r}),publishWorkbenchService:(w,r)=>request('/__fixture/publish',{revision:r}),serviceUrl:(w,p)=>'${base}/'+p};
createRoot(document.getElementById('root')).render(React.createElement('div',{className:'agent-shell'},React.createElement(HtmlServicePublishButton,{projectId:'project',file:${JSON.stringify(artifacts[0])}})));`;
const server=await createServer({root,server:{host:'127.0.0.1',port:0,strictPort:false},plugins:[{
  name:'html-service-browser-fixture',resolveId(id){if(id==='/__html_service_fixture.jsx')return id;},load(id){if(id==='/__html_service_fixture.jsx')return fixture;},
  configureServer(vite){vite.middlewares.use((req,res,next)=>{void(async()=>{
    const url=new URL(req.url,'http://fixture.invalid'),path=url.pathname;
    if(path==='/__html_service_acceptance'){res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml(path,'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HTML 服务隔离验收</title><body><div id="root"></div><script type="module" src="/__html_service_fixture.jsx"></script></body></html>'));return;}
    if(path==='/forbidden-direct-fetch'){directRequests++;res.end('forbidden');return;}
    if(path==='/__fixture/revoke'){revoked=true;json(res,{});return;}
    if(path.startsWith('/__fixture/')||path.startsWith(base+'/')){
      const publicShell=path.endsWith('/host.js')||path.endsWith('/page-sdk.js')||path===base+'/pages/page-artifact-0';
      if(!publicShell&&(!req.headers.cookie?.includes('html-service-fixture=1')||revoked)){json(res,{code:403,msg:'访问已撤销'},403);return;}
      if(path==='/__fixture/service'&&req.method==='GET'){json(res,{data:service});return;}
      if(path==='/__fixture/releases'){json(res,{data:[...releases.values()]});return;}
      if(path.startsWith('/__fixture/content/')){res.end(files.get(artifacts.find(a=>a.id===path.split('/').at(-1)).objectKey));return;}
      if(path==='/__fixture/assets'){const input=await body(req);delete input.projectId;const packed=await createHtmlBundle(principal,'project',input,store,objects);const id='asset-'+packed.sha256;assets.set(id,packed);json(res,{data:{id,...packed}});return;}
      if(path==='/__fixture/service'){const input=await body(req);assert.equal(input.revision,service.revision);service={...service,revision:service.revision+1,draft:input.definition};json(res,{data:service});return;}
      if(['/__fixture/preview','/__fixture/publish'].includes(path)){const input=await body(req);assert.equal(input.revision,service.revision);const release={id:'release-'+path.split('/').at(-1)+'-'+service.revision,definition:structuredClone(service.draft)};releases.set(release.id,release);if(path.endsWith('publish')){active=release;service.enabled=true;}json(res,{data:release});return;}
      if(path.endsWith('/host.js')||path.endsWith('/page-sdk.js')){res.setHeader('Content-Type','application/javascript');res.end(await readFile(resolve(java,path.split('/').at(-1))));return;}
      if(path===base+'/pages/page-artifact-0'){
        const shell=await readFile(resolve(java,'page-host.html'),'utf8');
        res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src data:; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self' about:; base-uri 'none'; object-src 'none'");res.end(shell);return;
      }
      if(path===base+'/manifest'){const release=releases.get(url.searchParams.get('releaseId'))||active;json(res,{code:0,data:{...release,releaseId:release.id,pages:release.definition.pages,projects:[{id:'project',name:'验收项目'}]}});return;}
      if(path.endsWith('/instances')){const input=await body(req),release=releases.get(input.releaseId)||active,page=release.definition.pages[0];const instance={id:'instance-'+instances.size,releaseId:release.id,projectId:'project',page,html:assets.get(page.assetId).html,state:{},revision:0};instances.set(instance.id,instance);json(res,{code:0,data:instance});return;}
      if(path.includes('/page-instances/')){const id=path.split('/')[5],instance=instances.get(id);if(path.endsWith('/state')){const input=await body(req);assert.equal(input.revision,stateRevision);state=input.state;stateRevision++;}json(res,{code:0,data:{...instance,state,revision:stateRevision}});return;}
    }
    next();
  })().catch(error=>json(res,{code:422,msg:error.message},422));});}
}]});
await server.listen();const origin=server.resolvedUrls.local[0].replace(/\/$/,'');
const browser=await chromium.launch({headless:true});
const output=resolve('apps/web/.qa/html-service');await mkdir(output,{recursive:true});
let inspectedPage;const browserErrors=[];
try{
  const context=await browser.newContext({viewport:{width:1360,height:960}});await context.addCookies([{name:'html-service-fixture',value:'1',url:origin}]);
  const page=await context.newPage(),failures=[];inspectedPage=page;page.on('pageerror',e=>failures.push(e.message));page.on('console',message=>{if(message.type()==='error')browserErrors.push(message.text());});
  await page.goto(origin+'/__html_service_acceptance');await page.getByRole('button',{name:'发布 index.html 为 HTML 服务',exact:true}).click();await page.getByRole('button',{name:'保存并预览',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').evaluate(el=>el.closest('.agent-shell')===null),true);
  await page.waitForFunction(()=>!document.querySelector('fieldset')?.disabled);
  await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(output,'mobile.png'),fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1360,height:960});await page.getByRole('button',{name:'保存并预览',exact:true}).click();
  const host=page.frameLocator('iframe[title="HTML 服务草稿预览"]'),report=host.frameLocator('iframe#page');
  await report.getByText('配套资源已加载 · 42 · project',{exact:true}).waitFor({timeout:30000});
  assert.equal(await report.locator('body').getAttribute('data-isolated'),'yes');
  await report.locator('body[data-network="blocked"]').waitFor();
  assert.equal(await report.locator('body').evaluate(el=>getComputedStyle(el).color),'rgb(80, 40, 160)');
  assert.equal(await report.locator('img').evaluate(el=>el.complete&&el.naturalWidth===80),true);
  assert.equal(await report.locator('body').evaluate(async()=>{await document.fonts.load('16px TaskFont');return document.fonts.check('16px TaskFont');}),true);
  await report.getByRole('button',{name:'保存页面设置'}).click();await report.getByText('已保存 v1',{exact:true}).waitFor();
  assert.deepEqual(state,{filter:'confirmed'});assert.equal(directRequests,0);assert.equal(active,null);
  await page.getByRole('button',{name:'发布新版本',exact:true}).click();await page.getByRole('link',{name:'打开已发布页面'}).waitFor();
  const url=await page.getByRole('link',{name:'打开已发布页面'}).getAttribute('href');const published=await context.newPage();await published.goto(origin+url);
  await published.frameLocator('iframe#page').getByText('配套资源已加载 · 42 · project',{exact:true}).waitFor();
  assert.equal(await published.locator('body > header').count(),0);
  assert.equal(await published.locator('iframe#page').evaluate(el=>el.getBoundingClientRect().top===0&&el.getBoundingClientRect().height===innerHeight),true);
  const refresh=published.getByRole('button',{name:'刷新数据',exact:true});
  await refresh.press('Enter'); await published.frameLocator('iframe#page').getByText('刷新次数：1',{exact:true}).waitFor();
  await published.locator('#status').waitFor({state:'hidden'});
  await published.screenshot({path:resolve(output,'published-desktop.png'),fullPage:true});
  await published.setViewportSize({width:390,height:844});
  assert.equal(await refresh.evaluate(el=>{const r=el.getBoundingClientRect();return r.width===48&&r.height===48&&r.right<=innerWidth-15&&r.bottom<=innerHeight-15&&r.left>innerWidth-80&&r.top>innerHeight-80;}),true);
  assert.equal(await published.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await published.screenshot({path:resolve(output,'published-mobile.png'),fullPage:true});
  files.set('js/detail.js',Buffer.from('SOURCE CHANGED AFTER RELEASE'));await published.reload();await published.frameLocator('iframe#page').getByText('配套资源已加载 · 42 · project',{exact:true}).waitFor();
  const unauthorized=await browser.newContext(),denied=await unauthorized.request.get(origin+base+'/page-instances/instance-1');assert.equal(denied.status(),403);await unauthorized.close();
  await page.request.post(origin+'/__fixture/revoke');await published.waitForFunction(()=>!document.querySelector('iframe#page').hasAttribute('srcdoc'),{},{timeout:22000});
  await published.getByRole('alert').waitFor(); assert.equal(await refresh.isVisible(),true);
  assert.deepEqual(failures,[]);const result={passed:true,selectedFiles:artifacts.length,ui:'desktop/mobile',compiler:'actual New2 compiler',host:'actual Java host and SDK',api:'scripted isolated fixture; Java verified separately',checks:['preview-before-publish','CSS/images/fonts/modules','opaque sandbox','network blocked','state save','immutable release','authorization revocation']};
  await writeFile(resolve(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(JSON.stringify({alerts:await inspectedPage?.locator('[role=alert]').allTextContents(),frames:await Promise.all((inspectedPage?.frames()||[]).map(async f=>({url:f.url(),body:(await f.locator('body').innerText().catch(()=>'' )).slice(0,300)}))),browserErrors}));throw error;}
finally{await browser.close();await server.close();}
