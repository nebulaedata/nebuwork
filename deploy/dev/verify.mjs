import { createUuid } from './uuid.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicEncrypt, constants, randomBytes } from 'node:crypto';
const values = Object.fromEntries(readFileSync(new URL('.env', import.meta.url),'utf8').trim().split(/\r?\n/).filter(x=>x&&!x.startsWith('#')).map(x=>{const n=x.indexOf('=');return [x.slice(0,n),x.slice(n+1)];}));
const origin=process.argv[2] || `http://localhost:${values.DEV_HTTP_PORT}`;
const base=origin+'/nebulaedev/nwaa/api';
function client() {
  let cookie='';
  return {
    async call(path,body,expected=200,requestOrigin=origin) {
      const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:requestOrigin,Cookie:cookie,'Idempotency-Key':createUuid()},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)});
      const result=await response.json();
      assert.equal(response.status,expected,`${path}: ${result.msg}`);
      if(response.headers.get('set-cookie')){
        const set=response.headers.get('set-cookie');assert.match(set,/HttpOnly/i);assert.match(set,/SameSite=Lax/i);cookie=set.split(';')[0];
      }
      if(expected===200)assert.equal(result.code,0,`${path}: ${result.msg}`);
      return result.data;
    },
    async login(account,password,expected=200) {
      const {publicKey}=await this.call('/auth/public-key');
      await this.call('/auth/login',{account,encryptedPassword:publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_PADDING},Buffer.from(password)).toString('base64')},expected);
    },
  };
}
async function until(read,predicate,label) {
  for(let i=0;i<60;i++) { const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,1000)); }
  throw Error(`${label} did not finish in 60 seconds`);
}
const admin=client(), a=client(), b=client(), anonymous=client();
await anonymous.call('/auth/me',undefined,401);
await admin.login(values.DEV_ADMIN_ACCOUNT,values.DEV_ADMIN_PASSWORD);
const me=await admin.call('/auth/me');assert.equal(me.role,'admin');
const engine=await admin.call('/agent-engine/settings/status');assert.equal(engine.ready,true);assert.equal(engine.nodes.length,2);
assert.ok(engine.workers.filter(v=>v.online).length>=3,'Expected three online dev workers');
console.log(`Login and engine connectivity passed (${engine.workers.length} workers reported).`);
await admin.call('/auth/logout',{},403,'http://cross-site.invalid');
assert.equal((await admin.call('/auth/me')).id,me.id);
let first,second,workbench,flow;
const password=randomBytes(20).toString('hex'),suffix=randomBytes(6).toString('hex');
try {
  first=await admin.call('/auth/accounts',{account:'qa_a_'+suffix,password,name:'Dev verification A'});
  second=await admin.call('/auth/accounts',{account:'qa_b_'+suffix,password,name:'Dev verification B'});
  await a.login(first.account,'wrong-password-2026',401);
  await a.login(first.account,password);await b.login(second.account,password);
  await a.call('/auth/accounts',undefined,403);
  workbench=await a.call('/workbenches',{name:'Dev isolation check '+suffix,desc:'Temporary automated verification'});
  await b.call('/workbenches/'+workbench.id,undefined,404);
  await admin.call('/auth/accounts/'+first.id+'/enabled',{enabled:false});
  await a.call('/auth/me',undefined,401);
  await admin.call('/auth/accounts/'+first.id+'/enabled',{enabled:true});
  await a.call('/auth/me',undefined,401);
  await a.login(first.account,password);
  await a.call('/workbenches/'+workbench.id+'/delete',{revision:workbench.revision});workbench=null;
  await b.call('/auth/logout',{});await b.call('/auth/me',undefined,401);
  console.log('Account isolation, permissions, CSRF, disable/re-enable, and logout passed.');
  flow=await admin.call('/workflows',{name:'Dev Docker verification '+suffix,description:'Automatically archived after successful validation'});
  await until(()=>admin.call('/workflows/'+flow.id),v=>v.status==='ready','Workflow creation');
  const run=await admin.call('/workflows/'+flow.id+'/tasks',{input:{message:'Docker dev verification'}});
  const finished=await until(()=>admin.call('/workflow-tasks/'+run.id),v=>v.task?.state==='succeeded','Workflow execution');
  assert.equal(finished.task.state,'succeeded');
  console.log('Java → Workflow creation and real Python execution passed.');
} finally {
  if(workbench)try {await a.call('/workbenches/'+workbench.id+'/delete',{revision:workbench.revision});}catch{}
  if(flow)try {await admin.call('/workflows/'+flow.id+'/archive',{archived:true});}catch{}
  for(const user of [first,second])if(user)await admin.call('/auth/accounts/'+user.id+'/enabled',{enabled:false});
  await admin.call('/auth/logout',{});
}
await admin.call('/auth/me',undefined,401);
console.log(`Dev verification passed at ${origin}. Test accounts are disabled and the test workflow is archived.`);
