import { chownSync, mkdirSync } from 'node:fs';
const e = process.env;
const base = 'http://nacos:8848/nacos';
const namespace = 'nebuwork-dev';
async function form(path, values, token, method = 'POST') {
  const url = new URL(base + path);
  if (token) url.searchParams.set('accessToken', token);
  const response = await fetch(url, { method, body: new URLSearchParams(values), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Nacos ${path}: HTTP ${response.status}`);
  return response.text();
}
// The initializer is available only before Nacos has an administrator. Existing passwords are never reset.
const init = await fetch(base + '/v1/auth/users/admin', {method: 'POST', body: new URLSearchParams({password: e.NACOS_PASSWORD}), signal: AbortSignal.timeout(15000)});
if (![200, 400, 403, 409].includes(init.status)) throw Error(`Nacos admin initialization: HTTP ${init.status}`);
const login = JSON.parse(await form('/v1/auth/login', {username:'nacos',password:e.NACOS_PASSWORD}));
if (!login.accessToken) throw Error('Nacos login failed; keep the original dev .env with its volumes.');
const token = login.accessToken;
const list = await fetch(base + '/v1/console/namespaces?accessToken=' + encodeURIComponent(token));
if (!list.ok) throw Error(`Cannot read Nacos namespaces: HTTP ${list.status}; ${await list.text()}`);
if (!(await list.json()).data.some(v => v.namespace === namespace)) {
  await form('/v1/console/namespaces', {customNamespaceId:namespace,namespaceName:namespace,namespaceDesc:'Independent local Docker development'}, token);
}
const configs = {
  'cccs-database-base-dev.yml': {
    spring: {
      datasource: {url:'jdbc:mysql://mysql:3306/nebuwork_1?characterEncoding=utf-8&useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=Asia/Shanghai',username:'nebuwork',password:e.JAVA_DB_PASSWORD},
      redis: {host:'redis',port:6379,database:0,password:e.REDIS_PASSWORD,timeout:'3s'},
    },
  },
  'cccs-config-base-dev.yml': {
    nebu: {
      auth: {'allowed-origins':'', 'cookie-secure':false},
      models: {'encryption-key':e.ENCRYPTION_KEY,'block-special-addresses':false,'internal-allowlist-enabled':false},
      knowledge: {'encryption-key':e.ENCRYPTION_KEY,'admin-ids':e.DEV_ADMIN_ID,'block-special-addresses':false,'internal-allowlist-enabled':false},
      databases: {'target-allowlist-enabled':false,'block-special-addresses':false},
      memory: {'admin-ids':e.DEV_ADMIN_ID},
      workflow: {'admin-ids':e.DEV_ADMIN_ID},
      'platform-mcp': {url:'http://platform-mcp:42120/mcp','service-key':e.PLATFORM_MCP_SERVICE_KEY},
      'extension-market': {enabled:false,'admin-ids':e.DEV_ADMIN_ID},
      'workbench-services': {enabled:false},
      files: {enabled:false,'worker-key':e.PREVIEW_WORKER_KEY},
    },
  },
  'nebuwork-backend-api-dev.yml': {server:{port:42020,servlet:{'context-path':'/nwaa'}},spring:{flyway:{enabled:true,'clean-disabled':true}}},
};
for (const [dataId, config] of Object.entries(configs)) {
  const query = new URLSearchParams({dataId,group:'DEFAULT_GROUP',tenant:namespace,accessToken:token});
  const existing = await fetch(base + '/v1/cs/configs?' + query);
  if (existing.status === 404) {
    const result = await form('/v1/cs/configs', {dataId,group:'DEFAULT_GROUP',tenant:namespace,type:'yaml',content:JSON.stringify(config,null,2)}, token);
    if (result !== 'true') throw Error(`Nacos did not save ${dataId}`);
    console.log(`Created ${dataId}`);
  } else if (!existing.ok) throw Error(`Cannot read ${dataId}: HTTP ${existing.status}`);
  else console.log(`Preserved ${dataId}`);
}
for (const dir of ['/data/backend','/data/project','/data/runtime']) mkdirSync(dir,{recursive:true});
chownSync('/data/backend',10001,10001);
console.log('Component initialization complete.');
