import { createUuid } from './uuid.mjs';
import { publicEncrypt, constants } from 'node:crypto';
import mysql from 'mysql2/promise';
const e = process.env;
const base = 'http://backend:42020/nwaa/api';
let cookie = '';
// A completed setup must keep working after an administrator changes the initial password.
const db=await mysql.createConnection({host:'mysql',user:'nebuwork',password:e.JAVA_DB_PASSWORD,database:'nebuwork_1'});
const [setup]=await db.query("SELECT (SELECT configured FROM nw_agent_engine_settings WHERE id=1) AS engine, (SELECT configured FROM nw_workflow_settings WHERE id=1) AS workflow, (SELECT COUNT(*) FROM nw_knowledge_connection WHERE driver='nebulae-v101-rest') AS knowledge");
await db.end();
if (setup[0]?.engine && setup[0]?.workflow && setup[0]?.knowledge) {
  console.log('Application connections already initialized; account passwords and edited settings preserved.');
  process.exit(0);
}
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(90000),
    headers: { 'Content-Type':'application/json', ...(cookie ? {Cookie:cookie} : {}), 'Idempotency-Key':createUuid() },
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),
  });
  const result = await response.json();
  if (!response.ok || result.code !== 0) throw Error(`${path}: ${result.msg || response.status}`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return result.data;
}
const { publicKey } = await api('/auth/public-key');
await api('/auth/login', {account:e.DEV_ADMIN_ACCOUNT,encryptedPassword:publicEncrypt({key:publicKey,padding:constants.RSA_PKCS1_PADDING},Buffer.from(e.DEV_ADMIN_PASSWORD)).toString('base64')});
try {
  const engine = await api('/agent-engine/settings');
  if (!engine.configured) {
    await api('/agent-engine/settings', {revision:engine.revision,apiUrls:['http://engine-api1:42110','http://engine-api2:42110'],namespace:'nebuwork-dev',sandboxImage:'nebuwork-dev-sandbox:2.0.0',requestTimeoutMs:15000,signingKey:e.ENGINE_SIGNING_KEY,callbackKey:e.BUSINESS_API_KEY});
    console.log('Engine connection saved after both API nodes passed validation.');
  } else console.log('Existing engine settings preserved.');
  const workflow = await api('/workflow/settings');
  if (!workflow.configured) {
    const draft={revision:workflow.revision,enabled:true,baseUrl:'http://workflow:8765',apiKey:e.WORKFLOW_API_KEY,requestTimeoutMs:15000};
    await api('/workflow/settings/test', draft);
    await api('/workflow/settings', draft);
    console.log('Workflow connection tested and saved.');
  } else console.log('Existing Workflow settings preserved.');
  const connections=await api('/knowledge-mcp/connections');
  if (!connections.some(c=>c.driver==='nebulae-v101-rest')) {
    const connection=await api('/knowledge-mcp/connections',{name:'Nebulae V101',driver:'nebulae-v101-rest',endpoint:'http://knowledge-v101:8080',authType:'none',authHeader:'',enabled:true,published:true,tenantId:''});
    await api('/knowledge-mcp/connections/'+connection.id+'/test',{});
    console.log('V101 knowledge connection saved; no model credentials or business libraries were seeded.');
  }
  const status=await api('/agent-engine/settings/status');
  if (!status.ready) throw Error('Engine status is not ready');
  console.log(`Application initialization complete; ${status.nodes.length} engine APIs reachable.`);
} finally { await api('/auth/logout', {}); }
