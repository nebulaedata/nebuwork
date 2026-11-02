// Real catalog calls to a disposable private/Fake-IP fixture; no model inference.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { publicEncrypt, constants, randomUUID } from 'node:crypto';

const env = Object.fromEntries(readFileSync(new URL('.env', import.meta.url), 'utf8').split(/\r?\n/).filter(s => s && !s.startsWith('#')).map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
const base = `http://localhost:${env.DEV_HTTP_PORT}/nebulaedev/nwaa/api`;
const suffix = randomUUID().slice(0, 8);
const network = 'nebuwork-network-check-' + suffix;
const fixture = 'nebuwork-catalog-check-' + suffix;
const docker = args => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const compose = ['compose', '--env-file', 'deploy/dev/.env', '-f', 'deploy/dev/compose.app.yml'];
const backend = docker([...compose, 'ps', '-q', 'backend']);
if (!backend) throw Error('Local dev backend is not running');
let cookie = '', connected = false, created = false, running = false, knowledgeConnection, kb;
async function knowledge(path, body, method = 'POST') {
  const response = await fetch(base + '/knowledge-v101/' + knowledgeConnection.id + '/api/v1' + path, {method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-Knowledge-Method':method,'Idempotency-Key':randomUUID()},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const result=await response.json();if(!response.ok||!result.success)throw Error(path+': '+(result.msg||result.error?.message));return result.data;
}
async function api(path, body) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const result = await response.json();
  if (!response.ok || result.code !== 0) throw Error(path + ': ' + result.msg);
  return result.data;
}
try {
  // The benchmark address must reach a real HTTP server, not just pass a mocked policy.
  docker(['network', 'create', '--internal', '--subnet', '198.18.222.0/24', network]); created = true;
  const server = `require('node:http').createServer((req,res)=>{if(req.url==='/page'){res.setHeader('Content-Type','text/html');res.end('<html><body>Private network import verification.</body></html>');return;}res.setHeader('Content-Type','application/json');if(req.url!='/v1/models'||req.headers.authorization!=='Bearer network-validation-key'){res.statusCode=401;res.end('{}');return;}res.end(JSON.stringify({data:[{id:'network-validation-model'}]}));}).listen(43187,'0.0.0.0')`;
  docker(['run', '--rm', '-d', '--name', fixture, '--network', 'nebuwork-dev', 'node:22-bookworm-slim', 'node', '-e', server]); running = true;
  docker(['network', 'connect', '--ip', '198.18.222.2', network, fixture]);
  docker(['network', 'connect', network, backend]); connected = true;
  const key = await api('/auth/public-key');
  await api('/auth/login', { account: env.DEV_ADMIN_ACCOUNT, encryptedPassword: publicEncrypt({ key: key.publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(env.DEV_ADMIN_PASSWORD)).toString('base64') });
  for (const host of [fixture, '198.18.222.2']) {
    const result = await api('/model-providers/models', { type: 'custom', baseUrl: `http://${host}:43187/v1`, apiKey: 'network-validation-key' });
    if (!result.models.includes('network-validation-model')) throw Error('Catalog result missing for ' + host);
  }
  knowledgeConnection=(await api('/knowledge-mcp/connections?scopeKind=user&scopeId=')).find(c=>c.driver==='nebulae-v101-rest'&&c.enabled);
  if(!knowledgeConnection)throw Error('No V101 connection to verify web import');
  kb=await knowledge('/knowledge-bases',{name:'Network import '+suffix,config:{wiki_enabled:false,graph_enabled:false,image_caption:false,image_embedding:false,outline_enabled:false}});
  const imported=await knowledge('/knowledge-bases/'+kb.id+'/knowledge/url',{url:'http://'+fixture+':43187/page',name:'Private URL verification'});
  if(!imported.knowledge_id)throw Error('Private URL import did not create a document');
  const anonymous = await fetch(base + '/model-providers/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (anonymous.status !== 401) throw Error('Anonymous model access unexpectedly allowed');
  if(process.argv.includes('--browser')){console.log('Browser fixture ready: http://198.18.222.2:43187/v1; key: network-validation-key');await new Promise(resolve=>setTimeout(resolve,45000));}
  console.log('Network acceptance passed: real private-DNS and 198.18.0.0/15 model catalogs and private-URL knowledge import; authentication retained. No inference or external credentials used.');
} finally {
  if(kb&&cookie)await knowledge('/knowledge-bases/'+kb.id,{},'DELETE').catch(error=>{console.error('Test library cleanup failed: '+error.message);process.exitCode=1;});
  if (cookie) await api('/auth/logout', {}).catch(() => {});
  if (connected) docker(['network', 'disconnect', network, backend]);
  if (running) docker(['stop', fixture]);
  if (created) docker(['network', 'rm', network]);
}
