import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import mysql from 'mysql2/promise';
import { SignJWT } from 'jose';

// One-time deployment migration, never imported by API/Worker or normal startup.
// Existing administrator grants and service credentials are preserved, not generated.
const args=Object.fromEntries(process.argv.slice(2).map(v=>v.replace(/^--/,'').split(/=(.*)/s).slice(0,2)));
assert.ok(args.bootstrap && args.output && args['expected-schema'] && ['import','retire'].includes(args.phase), 'Required --bootstrap=... --output=... --expected-schema=... --phase=import|retire');
const bootstrap=YAML.parse(await fs.readFile(args.bootstrap,'utf8')).spring.cloud.nacos.discovery;
const base=`http://${bootstrap['server-addr']}/nacos/v1`;
const login=await fetch(base+'/auth/login',{method:'POST',body:new URLSearchParams({username:bootstrap.username,password:bootstrap.password}),signal:AbortSignal.timeout(10000)});
assert.ok(login.ok,'Nacos login unavailable');const accessToken=(await login.json()).accessToken;
const query={dataId:'nebuwork-backend-api-dev.yml',group:'DEFAULT_GROUP',tenant:bootstrap.namespace,accessToken};
const config={};const merge=(a,b)=>{for(const[k,v]of Object.entries(b??{}))if(v&&typeof v==='object'&&!Array.isArray(v))merge(a[k]??={},v);else a[k]=v;};
let source;
for(const dataId of ['cccs-database-base-dev.yml','cccs-config-base-dev.yml',query.dataId]){
  const response=await fetch(base+'/cs/configs?'+new URLSearchParams({...query,dataId}),{signal:AbortSignal.timeout(10000)});assert.ok(response.ok,'Configuration unavailable');
  const text=await response.text();merge(config,YAML.parse(text));if(dataId===query.dataId)source=text;
}
await fs.mkdir(args.output,{recursive:true});
const ds=config.spring.datasource,url=new URL(ds.url.replace(/^jdbc:/,'')),schema=url.pathname.slice(1);assert.equal(schema,args['expected-schema'],'Wrong target database');
const db=await mysql.createConnection({host:url.hostname,port:Number(url.port||3306),user:ds.username,password:String(ds.password),database:schema});
try {
  const [[row]]=await db.query('SELECT * FROM nw_agent_engine_settings WHERE id=1');assert.ok(row,'Apply Flyway V20 before importing settings');
  if(args.phase==='retire'){
    assert.ok(row.configured && row.cluster_id && row.signing_key_cipher && row.callback_key_cipher,'Database connection not initialized');
    assert.ok((await db.query('SELECT owner_id FROM nw_agent_engine_admin'))[0].length,'Administrator grant missing');
    const next=YAML.parse(source);delete next.nebu.agent;
    await fs.writeFile(args.output+'/nacos-before-retirement.yml',source,{mode:0o600});
    const response=await fetch(base+'/cs/configs',{method:'POST',body:new URLSearchParams({...query,content:YAML.stringify(next),type:'yaml',casMd5:crypto.createHash('md5').update(source).digest('hex')}),signal:AbortSignal.timeout(10000)});
    assert.ok(response.ok && (await response.text()).trim()==='true','Nacos compare-and-set rejected');
    console.log(JSON.stringify({action:'retired-nacos-agent-settings',schema,clusterId:row.cluster_id}));
  } else {
    assert.ok(!row.configured,'Already configured; manage subsequent changes through the settings page');
    const legacy=config.nebu.agent;assert.ok(legacy?.['signing-key']?.length>=32 && legacy?.['callback-key']?.length>=32,'Existing connection credentials unavailable');
    const admins=String(config.nebu.workflow?.['admin-ids']||'').split(',').map(v=>v.trim()).filter(Boolean);assert.ok(admins.length,'No verified existing administrator grants to preserve');
    const urls=(args['api-urls']||legacy['base-url']).split(',').map(v=>v.trim().replace(/\/$/,''));assert.ok(urls.length && urls.length<=8);
    const token=await new SignJWT({tenantId:legacy.namespace,ownerId:'system-configuration',projects:[],scopes:['engine:read','engine:admin']}).setProtectedHeader({alg:'HS256'}).setSubject('nebuwork-configuration').setIssuer('nebuwork').setAudience('nebu-agent-engine').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(legacy['signing-key']));
    let identity;
    for(const address of urls){const result=await fetch(address+'/v1/cluster',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});assert.equal(result.status,200,'Engine identity unavailable');const cluster=await result.json();
      if(identity){assert.equal(cluster.clusterId,identity.clusterId);assert.equal(cluster.storageId,identity.storageId);}else identity=cluster;}
    const rootKey=Buffer.from(config.nebu.models['encryption-key'],'base64');assert.equal(rootKey.length,32);
    const encrypt=(kind,value)=>{const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',rootKey,iv);cipher.setAAD(Buffer.from('system-agent-engine\n'+kind));const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return 'v1:'+Buffer.concat([iv,encrypted,cipher.getAuthTag()]).toString('base64');};
    await fs.writeFile(args.output+'/settings-before-import.json',JSON.stringify(row,null,2),{mode:0o600});
    await db.beginTransaction();const [[locked]]=await db.query('SELECT configured FROM nw_agent_engine_settings WHERE id=1 FOR UPDATE');assert.ok(!locked.configured,'Configuration changed during import');
    await db.query('UPDATE nw_agent_engine_settings SET configured=TRUE,api_urls_json=?,namespace=?,signing_key_cipher=?,callback_key_cipher=?,cluster_id=?,storage_id=?,sandbox_image=?,revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=1',
      [JSON.stringify(urls),legacy.namespace,encrypt('signing',legacy['signing-key']),encrypt('callback',legacy['callback-key']),identity.clusterId,identity.storageId,legacy['sandbox-image']||'nebu-agent-sandbox:1','deployment-migration']);
    for(const admin of admins)await db.query('INSERT INTO nw_agent_engine_admin(owner_id) VALUES(?) ON DUPLICATE KEY UPDATE owner_id=owner_id',[admin]);
    const report={apiUrls:urls,namespace:legacy.namespace,clusterId:identity.clusterId,administratorCount:admins.length};
    await db.query('INSERT INTO nw_agent_engine_settings_audit(revision,actor,settings_json,credential_action) VALUES(?,?,?,?)',[Number(row.revision)+1,'deployment-migration',JSON.stringify(report),'import-existing']);await db.commit();
    console.log(JSON.stringify({action:'imported-existing-connection',schema,...report}));
  }
} catch(error){await db.rollback();console.error(JSON.stringify({error:error.code||error.name,message:error instanceof assert.AssertionError ? error.message : 'Settings migration failed; inspect configuration and connectivity'}));process.exitCode=1;}
finally{await db.end();}
