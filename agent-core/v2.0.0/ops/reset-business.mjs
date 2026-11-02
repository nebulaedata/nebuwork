import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import sql from 'mysql2';
import YAML from 'yaml';
import {retireLinks} from './schema-retirement.mjs';

// Explicit operator command; never invoked by application startup. No independent service API is called.
const args=Object.fromEntries(process.argv.slice(2).map(v=>v.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
if(!args.bootstrap||!args.output||!args['expected-host']||!args['expected-schema'])throw Error('Required: --bootstrap=... --output=... --expected-host=... --expected-schema=... [--apply=inventory-sha256 --entries-paused=true]');
const out=path.resolve(args.output);await fs.mkdir(out,{recursive:true});
const bootstrap=YAML.parse(await fs.readFile(args.bootstrap,'utf8')).spring.cloud.nacos.discovery;
const nacos=`http://${bootstrap['server-addr']}/nacos/v1`;
const auth=await fetch(nacos+'/auth/login',{method:'POST',body:new URLSearchParams({username:bootstrap.username,password:bootstrap.password}),signal:AbortSignal.timeout(30000)});
if(!auth.ok)throw Error(`Nacos authentication failed (${auth.status})`);
const token=(await auth.json()).accessToken;
const config={};const merge=(a,b)=>{for(const [k,v] of Object.entries(b||{}))if(v&&typeof v==='object'&&!Array.isArray(v))merge(a[k]??={},v);else a[k]=v;};
for(const name of ['cccs-database-base-dev.yml','cccs-config-base-dev.yml','nebuwork-backend-api-dev.yml']){
  console.log('Reading configuration:',name);
  const response=await fetch(nacos+'/cs/configs?'+new URLSearchParams({dataId:name,group:'DEFAULT_GROUP',tenant:bootstrap.namespace,accessToken:token}),{signal:AbortSignal.timeout(30000)});
  if(response.status===404)continue;if(!response.ok)throw Error(`Configuration read failed (${response.status})`);
  const body=await response.text();merge(config,YAML.parse(body));
  if(name==='nebuwork-backend-api-dev.yml'&&!args.apply)await fs.writeFile(path.join(out,'nacos-module-backup.yml'),body,{mode:0o600});
}
const ds=config.spring.datasource,url=new URL(ds.url.replace(/^jdbc:/,'')),schema=url.pathname.slice(1);
if(url.hostname!==args['expected-host']||schema!==args['expected-schema']||!/^nebuwork_[a-zA-Z0-9_]+$/.test(schema))throw Error('Target does not match the explicit NebuWork database allowlist');
const db=await mysql.createConnection({host:url.hostname,port:Number(url.port||3306),user:ds.username,password:String(ds.password),database:schema,charset:'utf8mb4',timezone:'Z',connectTimeout:10000});
if(args['retire-links']==='true') {
 if(args['entries-paused']!=='true')throw Error('Pause business entrypoints first');
 const result=JSON.parse(await fs.readFile(path.join(out,'reset-result.json'),'utf8'));
 if(result.target.host!==url.hostname||result.target.schema!==schema||result.backupHash!==crypto.createHash('sha256').update(await fs.readFile(path.join(out,'business-backup.sql'))).digest('hex'))throw Error('A completed, backed-up reset is required');
 const removed=await retireLinks(db,schema,result.retired);await db.end();await fs.writeFile(path.join(out,'schema-retirement.json'),JSON.stringify({completedAt:new Date().toISOString(),removed},null,2));console.log(JSON.stringify({action:'retired_links',removed}));process.exit(0);
}
try{
 const [tableRows]=await db.query('SHOW FULL TABLES WHERE Table_type="BASE TABLE"');const all=tableRows.map(r=>Object.values(r)[0]);
 const tables=all.filter(t=>t.startsWith('nw_'));if(all.some(t=>!t.startsWith('nw_')&&t!=='flyway_schema_history'))throw Error('Unexpected shared tables; inspect manually before reset');
 const counts={},contentHashes={};for(const table of tables){if(!/^nw_[a-z0-9_]+$/.test(table))throw Error('Unsafe table name');counts[table]=(await db.query(`SELECT COUNT(*) n FROM \`${table}\``))[0][0].n;}
 for(const table of tables){const [rows]=await db.query(`SELECT * FROM \`${table}\``);contentHashes[table]=crypto.createHash("sha256").update(JSON.stringify(rows.map(r=>JSON.stringify(r)).sort())).digest("hex");}
 const inventory={contentHashes,host:url.hostname,port:Number(url.port||3306),schema,tables:counts,preserve:['flyway_schema_history','unified accounts (separate service)','independent workflow / knowledge / memory data'],retired:tables.filter(t=>/^nw_(core_|task($|_)|template_|project_core$|workbench_core$|project_execution_preset$|file$)/.test(t))};
 const digest=crypto.createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
 if(!args.apply){
   await fs.writeFile(path.join(out,'inventory.json'),JSON.stringify({...inventory,digest},null,2));
   const dump=await fs.open(path.join(out,'business-backup.sql'),'w',0o600);
   await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await db.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
   try{await dump.write('SET FOREIGN_KEY_CHECKS=0;\n');for(const table of all){const [ddl]=await db.query(`SHOW CREATE TABLE \`${table}\``);await dump.write(`DROP TABLE IF EXISTS \`${table}\`;\n${Object.values(ddl[0])[1]};\n`);const [rows]=await db.query(`SELECT * FROM \`${table}\``);for(const row of rows){const keys=Object.keys(row),values=keys.map(k=>{const v=row[k];return sql.escape(v&&typeof v==='object'&&!(v instanceof Date)&&!Buffer.isBuffer(v)?JSON.stringify(v):v,false,"Z");});await dump.write(`INSERT INTO \`${table}\` (${keys.map(k=>'`'+k+'`').join(',')}) VALUES (${values.join(',')});\n`);}}await dump.write('SET FOREIGN_KEY_CHECKS=1;\n');await db.commit();}finally{await dump.close();}
   const bytes=await fs.readFile(path.join(out,'business-backup.sql'));await fs.writeFile(path.join(out,'backup.sha256'),crypto.createHash('sha256').update(bytes).digest('hex'));
   console.log(JSON.stringify({action:'backup_and_inventory',...inventory,digest}));
 }else{
   if(args.apply!==digest||args['entries-paused']!=='true')throw Error('Inventory changed or old entrypoints have not been paused');
   const backup=await fs.readFile(path.join(out,'business-backup.sql'));if(crypto.createHash('sha256').update(backup).digest('hex')!==(await fs.readFile(path.join(out,'backup.sha256'),'utf8')).trim())throw Error('Backup checksum mismatch');
   const rehearsal=JSON.parse(await fs.readFile(path.join(out,'rehearsal.json'),'utf8'));if(rehearsal.backupHash!==crypto.createHash('sha256').update(backup).digest('hex')||!rehearsal.passed)throw Error('Verified restore/reset rehearsal required');
   await db.query('SET FOREIGN_KEY_CHECKS=0');await db.beginTransaction();
   try{for(const table of tables)await db.query(`DELETE FROM \`${table}\``);for(const table of ['nw_memory_settings','nw_workflow_settings','nw_knowledge_guard'])if(tables.includes(table))await db.query(`INSERT INTO \`${table}\`(id) VALUES(1)`);await db.commit();}catch(e){await db.rollback();throw e;}finally{await db.query('SET FOREIGN_KEY_CHECKS=1');}
   // Retired tables are empty and backed up. DDL is intentionally separate from the transactional data reset.
   await retireLinks(db,schema,inventory.retired);
   await db.query('SET FOREIGN_KEY_CHECKS=0');for(const table of inventory.retired)await db.query(`DROP TABLE \`${table}\``);await db.query('SET FOREIGN_KEY_CHECKS=1');
   await fs.writeFile(path.join(out,'reset-result.json'),JSON.stringify({completedAt:new Date().toISOString(),target:{host:url.hostname,schema},deletedRows:counts,retired:inventory.retired,backupHash:rehearsal.backupHash},null,2));
   console.log(JSON.stringify({action:'reset_completed',host:url.hostname,schema,retired:inventory.retired}));
 }
}finally{await db.end();}
