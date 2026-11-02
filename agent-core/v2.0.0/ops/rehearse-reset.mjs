import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import assert from 'node:assert/strict';
import {retireLinks} from './schema-retirement.mjs';
const dir=process.argv[2];if(!dir||!process.env.REHEARSAL_DATABASE_URL)throw Error('Usage: REHEARSAL_DATABASE_URL=<isolated-local-mysql> node ops/rehearse-reset.mjs <backup-directory>');
const target=new URL(process.env.REHEARSAL_DATABASE_URL);if(!['127.0.0.1','localhost'].includes(target.hostname))throw Error('Rehearsal database must be an isolated local MySQL instance');
const backup=await fs.readFile(dir+'/business-backup.sql','utf8'),backupHash=crypto.createHash('sha256').update(backup).digest('hex');assert.equal(backupHash,(await fs.readFile(dir+'/backup.sha256','utf8')).trim());
const inventory=JSON.parse(await fs.readFile(dir+'/inventory.json','utf8')),schema='nebu_reset_rehearsal_'+backupHash.slice(0,16);
const db=await mysql.createConnection({host:target.hostname,port:Number(target.port||3306),user:decodeURIComponent(target.username),password:decodeURIComponent(target.password),multipleStatements:true,timezone:'Z'});
try{
 await db.query(`CREATE DATABASE IF NOT EXISTS \`${schema}\` CHARACTER SET utf8mb4`);await db.changeUser({database:schema});await db.query(backup);
 for(const [table,count] of Object.entries(inventory.tables))assert.equal((await db.query(`SELECT COUNT(*) n FROM \`${table}\``))[0][0].n,count,table);
 for(const [table,digest] of Object.entries(inventory.contentHashes)){const [rows]=await db.query(`SELECT * FROM \`${table}\``);assert.equal(crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>JSON.stringify(r)).sort())).digest('hex'),digest,table+' restored content');}
 const flyway=(await db.query('SELECT COUNT(*) n FROM flyway_schema_history'))[0][0].n;
 await db.query('SET FOREIGN_KEY_CHECKS=0');await db.beginTransaction();for(const table of Object.keys(inventory.tables))await db.query(`DELETE FROM \`${table}\``);
 const singleton=['nw_memory_settings','nw_workflow_settings','nw_knowledge_guard'];for(const table of singleton)if(table in inventory.tables)await db.query(`INSERT INTO \`${table}\`(id) VALUES(1)`);await db.commit();
 await retireLinks(db,schema,inventory.retired);
 for(const table of inventory.retired)await db.query(`DROP TABLE \`${table}\``);await db.query('SET FOREIGN_KEY_CHECKS=1');
 for(const table of Object.keys(inventory.tables).filter(t=>!inventory.retired.includes(t)))assert.equal((await db.query(`SELECT COUNT(*) n FROM \`${table}\``))[0][0].n,singleton.includes(table)?1:0,table);
 assert.equal((await db.query('SELECT COUNT(*) n FROM flyway_schema_history'))[0][0].n,flyway);
 await fs.writeFile(dir+'/rehearsal.json',JSON.stringify({passed:true,backupHash,schema,verifiedAt:new Date().toISOString(),tables:Object.keys(inventory.tables).length,preservedFlywayRows:flyway},null,2));console.log('Backup restored and reset verified in '+schema);
}finally{await db.end();}
