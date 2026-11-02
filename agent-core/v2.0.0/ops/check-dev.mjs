import fs from 'node:fs/promises';
import YAML from 'yaml';
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
const args=Object.fromEntries(process.argv.slice(2).map(v=>v.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
if(!args.bootstrap||!args.output)throw Error('Required --bootstrap=... --output=...');
const bootstrap=YAML.parse(await fs.readFile(args.bootstrap,'utf8')).spring.cloud.nacos.discovery,base=`http://${bootstrap['server-addr']}/nacos/v1`;
const login=await fetch(base+'/auth/login',{method:'POST',body:new URLSearchParams({username:bootstrap.username,password:bootstrap.password})});assert.ok(login.ok);const token=(await login.json()).accessToken;
const config={};const merge=(a,b)=>{for(const[k,v]of Object.entries(b??{}))if(v&&typeof v==='object'&&!Array.isArray(v))merge(a[k]??={},v);else a[k]=v;};
for(const dataId of ['cccs-database-base-dev.yml','cccs-config-base-dev.yml','nebuwork-backend-api-dev.yml']){const r=await fetch(base+'/cs/configs?'+new URLSearchParams({dataId,group:'DEFAULT_GROUP',tenant:bootstrap.namespace,accessToken:token}));assert.ok(r.ok);merge(config,YAML.parse(await r.text()));}
assert.equal(config.nebu.agent,undefined,'Engine connection must be managed in the platform database');assert.equal(config.nebu.core,undefined);assert.equal(config.nebu.tasks,undefined);assert.equal(config.nebu['storage-dir'],undefined);
const ds=config.spring.datasource,url=new URL(ds.url.replace(/^jdbc:/,'')),schema=url.pathname.slice(1);
const db=await mysql.createConnection({host:url.hostname,port:Number(url.port||3306),user:ds.username,password:String(ds.password),database:schema});
const counts={};let migration,settings,administrators;
try{const [tables]=await db.query('SHOW FULL TABLES WHERE Table_type="BASE TABLE"');for(const t of tables.map(r=>Object.values(r)[0]).filter(t=>t.startsWith('nw_'))){assert.match(t,/^nw_[a-z0-9_]+$/);counts[t]=(await db.query(`SELECT COUNT(*) n FROM \`${t}\``))[0][0].n;}
for(const table of Object.keys(counts))assert.ok(!/^nw_(core_|task($|_)|template_|project_core$|workbench_core$|project_execution_preset$|file$)/.test(table),'Retired table '+table);
migration=(await db.query('SELECT version FROM flyway_schema_history WHERE success=1 ORDER BY installed_rank DESC LIMIT 1'))[0][0].version;assert.ok(Number(migration)>=20,'Engine settings migration missing');
const [[row]]=await db.query('SELECT * FROM nw_agent_engine_settings WHERE id=1');assert.ok(row?.configured && row.cluster_id && row.storage_id,'Engine connection not configured');
assert.ok(row.signing_key_cipher?.startsWith('v1:') && row.callback_key_cipher?.startsWith('v1:'),'Engine credentials must be encrypted');
administrators=(await db.query('SELECT COUNT(*) n FROM nw_agent_engine_admin'))[0][0].n;assert.ok(administrators>0,'Engine administrator grant missing');
settings={namespace:row.namespace,clusterId:row.cluster_id,apiUrls:typeof row.api_urls_json==='string'?JSON.parse(row.api_urls_json):row.api_urls_json,revision:row.revision};
}finally{await db.end();}
const probes=[];for(const url of ['http://127.0.0.1:42110/health/ready','http://127.0.0.1:42111/health/ready','http://127.0.0.1:42020/nwaa/actuator/health']){const r=await fetch(url);assert.equal(r.status,200,url);probes.push({url,status:r.status});}
const unauthorized=await fetch('http://127.0.0.1:42020/nwaa/api/agent-engine/settings');assert.equal(unauthorized.status,401);
const report={checkedAt:new Date().toISOString(),businessDatabase:{host:url.hostname,schema,migration,tables:counts},engineSettings:settings,administrators,oldConfigurationRemoved:true,probes,unauthenticatedSettingsAccess:unauthorized.status};await fs.mkdir(args.output,{recursive:true});await fs.writeFile(args.output+'/deployment-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checkedAt:report.checkedAt,migration,businessTables:Object.keys(counts).length,settingsSource:'database',apiCount:settings.apiUrls.length,administrators,oldConfigurationRemoved:true,probes}));
