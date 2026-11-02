// Real HTTP acceptance against the isolated dev environment. No model calls.
import { readFileSync } from 'node:fs';
import { randomBytes, createHash, publicEncrypt, constants } from 'node:crypto';
import { createUuid } from './uuid.mjs';
import vm from 'node:vm';
const env=Object.fromEntries(readFileSync(new URL('.env',import.meta.url),'utf8').split(/\r?\n/).filter(s=>s&&!s.startsWith('#')).map(s=>{const p=s.indexOf('=');return [s.slice(0,p),s.slice(p+1)];}));
const base=(process.argv[2]||'http://localhost:18080')+'/nebulaedev/nwaa/api';
const assert=(value,message)=>{if(!value)throw Error(message);};
function client(){let cookie='';return {get cookie(){return cookie;},async call(path,body,options={}){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'}),...options.headers},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000),...options});if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];const result=await response.json();return {response,result};},async login(account,password){const {result}=await this.call('/auth/public-key');const encryptedPassword=publicEncrypt({key:result.data.publicKey,padding:constants.RSA_PKCS1_PADDING},Buffer.from(password)).toString('base64');const login=await this.call('/auth/login',{account,encryptedPassword});assert(login.result.code===0,'login failed');},async api(path,body){const {response,result}=await this.call(path,body);assert(response.ok&&result.code===0,path+': '+result.msg);return result.data;}};}
const admin=client(),alice=client(),bob=client();const users=[];let connection,kb,qa;
const native=async(c,path,body,method=body===undefined?'GET':'POST',extra={})=>{
 const response=await fetch(base+'/knowledge-v101/'+connection.id+'/api/v1'+path,{method:method==='GET'?'GET':'POST',headers:{Cookie:c.cookie,...(method==='GET'?{}:{'X-Knowledge-Method':method,'Idempotency-Key':extra.key||createUuid(),'Content-Type':extra.type||'application/json'}),...extra.headers},...(method==='GET'?{}:{body:extra.raw||JSON.stringify(body??{})}),signal:AbortSignal.timeout(30000)});
 const result=await response.json();return {response,result};
};
const ok=async(...args)=>{const {response,result}=await native(...args);assert(response.ok&&result.success,args[1]+': '+(result.error?.message||result.msg));return result.data;};
try{
 await admin.login(env.DEV_ADMIN_ACCOUNT,env.DEV_ADMIN_PASSWORD);
 connection=(await admin.api('/knowledge-mcp/connections')).find(c=>c.driver==='nebulae-v101-rest');assert(connection,'V101 connection missing');
 assert((await admin.api('/knowledge-mcp/drivers')).some(d=>d.id==='nebulae-v101-rest'),'V101 driver missing');
 const nonce=createUuid().replaceAll('-','').slice(0,10),password=randomBytes(20).toString('hex');
 for(const [suffix,c]of [['a',alice],['b',bob]]){const user=await admin.api('/auth/accounts',{account:'qa_v101_'+nonce+suffix,password,name:'V101 acceptance '+suffix});users.push(user.id);await c.login('qa_v101_'+nonce+suffix,password);}
 const createRequest={operation:'kb.create',requestKey:createUuid(),payload:{name:'QA V101 '+nonce,description:'Isolated integration acceptance',config:{wiki_enabled:false,graph_enabled:false,image_caption:false,image_embedding:false,outline_enabled:false}}};
 kb=(await alice.api('/knowledge-mcp/connections/'+connection.id+'/manage',createRequest)).result.data;
 assert((await alice.api('/knowledge-mcp/connections/'+connection.id+'/manage',createRequest)).result.data.id===kb.id,'main create replay created another library');
 const mine=await ok(alice,'/knowledge-bases');assert(mine.some(n=>n.id===kb.id),'creator ownership not registered');
 assert(!(await ok(bob,'/knowledge-bases')).some(n=>n.id===kb.id),'directory leaked another account');
 assert((await native(bob,'/knowledge-bases/'+kb.id)).response.status>=400,'cross-account library access accepted');
 const bytes=Buffer.from('# 集成验证\n\n星云知识平台采用版本化引用核验资料，关键词测试口令为 V101needle。\n');
 const upload=await ok(alice,'/knowledge-bases/'+kb.id+'/uploads',{file_name:'acceptance.md',relative_path:'资料/acceptance.md',file_size:bytes.length});
 assert((await native(alice,'/uploads/'+upload.upload_id+'/parts/1',{},'PUT',{raw:bytes,type:'application/octet-stream',headers:{'X-Content-SHA256':'0'.repeat(64)}})).response.status>=400,'gateway dropped part checksum verification');
 await ok(alice,'/uploads/'+upload.upload_id+'/parts/1',{},'PUT',{raw:bytes,type:'application/octet-stream',headers:{'X-Content-SHA256':createHash('sha256').update(bytes).digest('hex')}});
 assert((await native(bob,'/uploads/'+upload.upload_id)).response.status>=400,'upload session leaked');
 const completed=await ok(alice,'/uploads/'+upload.upload_id+'/complete',{});assert(completed.knowledge_id,'upload did not produce document');
 let document;for(let attempt=0;attempt<60;attempt++){document=await ok(alice,'/knowledge/'+completed.knowledge_id);if(document.current_parse_version_id)break;await new Promise(resolve=>setTimeout(resolve,500));}assert(document.current_parse_version_id,'document was not parsed');
 const search=await ok(alice,'/search',{knowledge_base_ids:[kb.id],query_text:'V101needle',mode:'keyword',include_sources:true,include_context:true,rerank:{mode:'disabled'}});assert(search.results.length,'keyword retrieval empty');const source=search.results[0].source_refs[0];assert(source.file_version_id&&source.parse_version_id,'versioned source missing');
 const projection=await alice.api('/knowledge-mcp/connections/'+connection.id+'/read',{collectionId:kb.id,operation:'chunk',documentId:document.id,chunkId:search.results[0].chunk_id,sourceRefId:source.source_ref_id,fileVersionId:source.file_version_id,parseVersionId:source.parse_version_id});assert(projection.citation.sourceRefId===source.source_ref_id,'common reader discarded source identity');
 assert((await native(bob,'/sources/'+source.source_ref_id)).response.status>=400,'source leaked');
 const wiki=await ok(alice,'/knowledge-bases/'+kb.id+'/wiki/pages',{title:'验证页面',content:'星云资料检索 V101needle。',source_ids:[source.source_ref_id]});
 const revisions=await ok(alice,'/knowledge-bases/'+kb.id+'/wiki/pages/'+wiki.id+'/revisions');assert(revisions.length,'wiki revision missing');
 await ok(alice,'/knowledge-bases/'+kb.id+'/wiki/pages/'+wiki.id+'/revert',{revision_id:revisions[0].id});
 const wikiProjection=await alice.api('/knowledge-mcp/connections/'+connection.id+'/read',{collectionId:kb.id,operation:'documents',contentKind:'wiki',page:1,pageSize:20});assert(wikiProjection.documents.some(p=>p.id===wiki.id),'Wiki projection missing');const wikiSearch=await alice.api('/knowledge-mcp/connections/'+connection.id+'/read',{collectionId:kb.id,operation:'search',contentKind:'wiki',query:'V101needle'});assert(wikiSearch.results.some(r=>r.citation.documentId===wiki.id&&r.citation.contentKind==='wiki'),'Wiki search navigated to a source file instead of the page');
 const resolved=await alice.api('/knowledge-mcp/connections/'+connection.id+'/read',{collectionId:kb.id,operation:'source',sourceRefId:source.source_ref_id});assert(resolved.citation.fileVersionId===source.file_version_id,'inline Wiki source lost version');
 await ok(alice,'/knowledge-bases/'+kb.id+'/wiki/graph?view=overview');await ok(alice,'/knowledge-bases/'+kb.id+'/graph');await ok(alice,'/knowledge-bases/'+kb.id+'/images');
 qa=await ok(alice,'/qa/sessions',{knowledge_base_ids:[kb.id],knowledge_ids:[],enable_wiki:false,enable_graph:false});
 assert((await ok(alice,'/qa/sessions')).some(s=>s.id===qa.id),'own QA session missing');assert(!(await ok(bob,'/qa/sessions')).some(s=>s.id===qa.id),'QA directory leaked');assert((await native(bob,'/qa/sessions/'+qa.id)).response.status===404,'QA session leaked');
 assert((await native(alice,'/settings/appearance',{brand_color:'#6254e8'},'PUT')).response.status>=400,'ordinary user changed global settings');assert((await native(alice,'/model-connections')).response.status>=400,'model infrastructure leaked');
 await ok(alice,'/tasks');await ok(alice,'/extractions/documents');
 const form=new FormData();form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+y9h8AAAAASUVORK5CYII=','base64')],{type:'image/png'}),'query.png');
 const imageResponse=await fetch(base+'/knowledge-v101/'+connection.id+'/api/v1/search/query-images',{method:'POST',headers:{Cookie:alice.cookie,'X-Knowledge-Method':'POST','Idempotency-Key':createUuid()},body:form});const image=await imageResponse.json();assert(imageResponse.ok&&image.success,'multipart query image forwarding failed: '+JSON.stringify(image));
 assert((await native(bob,'/search',{knowledge_base_ids:[],query_image_id:image.data.query_image_id,mode:'image_vector'})).response.status>=400,'another account used a private query image');
 const html=await fetch(base+'/knowledge-v101/'+connection.id+'/ui/knowledge-bases/'+kb.id,{headers:{Cookie:alice.cookie}});assert(html.ok,'workspace failed');const text=await html.text();assert(text.includes('__NEBUWORK_V101__')&&text.includes('"admin":false'),'workspace account context missing');
 let browserBase;const window={};vm.runInNewContext(text.match(/<script>(window\.__NEBUWORK_V101__=[\s\S]*?)<\/script>/)[1],{window,location:{pathname:new URL(html.url).pathname},document:{createElement:()=>({}),head:{append:element=>{browserBase=element.href;}}},encodeURIComponent});assert(browserBase.startsWith('/nebulaedev/nwaa/api/knowledge-v101/'),'workspace lost the external gateway prefix');
 const asset=text.match(/src="\.\/(assets\/[^" ]+)"/)[1];const js=await fetch(new URL(browserBase+asset,base),{headers:{Cookie:alice.cookie}});assert(js.ok&&js.headers.get('content-type')?.includes('javascript'),'workspace JavaScript could not load under the gateway prefix');
 assert((await fetch(base+'/knowledge-v101/'+connection.id+'/ui/')).status===401,'anonymous workspace allowed');
 console.log('V101 acceptance passed: driver, ownership, account isolation, resumable upload/hash, parsing, keyword search, fixed-version common reader, Wiki search/revisions/restore, graph/images, multipart query images, private QA sessions, admin settings, authenticated workspace/prefix/assets and async delete-task access. No model calls.');
}finally{
 if(connection&&qa)await native(alice,'/qa/sessions/'+qa.id,{},'DELETE').catch(()=>{});
 if(connection&&kb){const deletion=await native(alice,'/knowledge-bases/'+kb.id,{},'DELETE').catch(()=>null);if(deletion?.result?.data?.task_id)await ok(alice,'/tasks/'+deletion.result.data.task_id);}
 for(const id of users)await admin.api('/auth/accounts/'+id+'/enabled',{enabled:false}).catch(()=>{});
 for(const c of[alice,bob,admin])await c.api('/auth/logout',{}).catch(()=>{});
}
