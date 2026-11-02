import { createUuid } from './uuid.mjs';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
const path = join(root, '.env');
const secret = () => randomBytes(24).toString('hex');
if (!existsSync(path)) {
  const env = {
    DEV_HTTP_PORT: '18080', DEV_BIND: '0.0.0.0', DEV_ADMIN_ACCOUNT: 'admin', DEV_ADMIN_PASSWORD: secret(), DEV_ADMIN_ID: createUuid(),
    DEV_MYSQL_PORT: '13316', DEV_REDIS_PORT: '16389', DEV_NACOS_PORT: '28848', DEV_NACOS_GRPC_PORT: '29848',
    DEV_MINIO_PORT: '29000', DEV_MINIO_CONSOLE_PORT: '29001',
    MYSQL_ROOT_PASSWORD: secret(), JAVA_DB_PASSWORD: secret(), ENGINE_DB_PASSWORD: secret(), NACOS_DB_PASSWORD: secret(), REDIS_PASSWORD: secret(),
    MINIO_ROOT_USER: 'nebuworkdev', MINIO_ROOT_PASSWORD: secret(), NACOS_PASSWORD: secret(),
    NACOS_AUTH_TOKEN: randomBytes(48).toString('base64'), NACOS_IDENTITY_KEY: 'nebuworkDevIdentity', NACOS_IDENTITY_VALUE: secret(),
    ENCRYPTION_KEY: randomBytes(32).toString('base64'), ENGINE_SIGNING_KEY: secret(), BUSINESS_API_KEY: secret(),
    WORKFLOW_API_KEY: secret(), PLATFORM_MCP_SERVICE_KEY: secret(), PREVIEW_WORKER_KEY: secret(),
  };
  writeFileSync(path, Object.entries(env).map(([k,v]) => `${k}=${v}`).join('\n')+'\n', { mode: 0o600, flag: 'wx' });
  console.log('Created deploy/dev/.env with independent dev credentials.');
}
const env = Object.fromEntries(readFileSync(path, 'utf8').trim().split(/\r?\n/).filter(x => x && !x.startsWith('#')).map(x => {const n=x.indexOf('=');return [x.slice(0,n),x.slice(n+1)];}));
const uiDefaults = {DEV_KNOWLEDGE_HTTP_PORT:'18081',DEV_WORKFLOW_HTTP_PORT:'18082',DEV_NEO4J_HTTP_PORT:'27474',DEV_NEO4J_BOLT_PORT:'27687',WORKFLOW_UI_ACCOUNT:'admin',WORKFLOW_UI_PASSWORD:secret()};
for(const [key,value] of Object.entries(uiDefaults))if(!env[key]){env[key]=value;writeFileSync(path,readFileSync(path,'utf8')+key+'='+value+'\n',{mode:0o600});}
for(const key of Object.keys(uiDefaults).filter(key=>key.endsWith('_PORT')))if(!/^\d+$/.test(env[key])||Number(env[key])<1||Number(env[key])>65535)throw Error(key+' must be a valid port');
if(!/^[A-Za-z0-9_.-]{1,64}$/.test(env.WORKFLOW_UI_ACCOUNT))throw Error('Invalid WORKFLOW_UI_ACCOUNT');
for (const key of ['KNOWLEDGE_DB_PASSWORD','KNOWLEDGE_GRAPH_PASSWORD']) if (!env[key]) {env[key]=secret();writeFileSync(path,readFileSync(path,'utf8')+`${key}=${env[key]}\n`,{mode:0o600});}
if (!env.NACOS_DB_PASSWORD) { env.NACOS_DB_PASSWORD=secret();writeFileSync(path,readFileSync(path,'utf8')+`NACOS_DB_PASSWORD=${env.NACOS_DB_PASSWORD}\n`,{mode:0o600}); }
for (const key of ['JAVA_DB_PASSWORD','ENGINE_DB_PASSWORD','NACOS_DB_PASSWORD']) if (!/^[a-f0-9]{48}$/.test(env[key])) throw Error(`${key} must remain generated hexadecimal`);
mkdirSync(join(root,'generated'), { recursive: true });
writeFileSync(join(root,'generated/workflow-ui.htpasswd'),env.WORKFLOW_UI_ACCOUNT+':{SHA}'+createHash('sha1').update(env.WORKFLOW_UI_PASSWORD).digest('base64')+'\n',{mode:0o600});
writeFileSync(join(root, 'generated/01-databases.sql'), `CREATE DATABASE IF NOT EXISTS nebuwork_1 CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS nebu_agent_engine CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS nacos_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE USER IF NOT EXISTS 'nebuwork'@'%' IDENTIFIED BY '${env.JAVA_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'nebuengine'@'%' IDENTIFIED BY '${env.ENGINE_DB_PASSWORD}';
CREATE USER IF NOT EXISTS 'nacosdev'@'%' IDENTIFIED BY '${env.NACOS_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON nebuwork_1.* TO 'nebuwork'@'%';
GRANT ALL PRIVILEGES ON nebu_agent_engine.* TO 'nebuengine'@'%';
GRANT ALL PRIVILEGES ON nacos_dev.* TO 'nacosdev'@'%';\n`, { mode: 0o600 });
console.log(`Dev environment ready; HTTP port ${env.DEV_HTTP_PORT}. Existing secrets and volumes are preserved.`);
