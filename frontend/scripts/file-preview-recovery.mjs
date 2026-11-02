import {readFile,writeFile} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=new URL('../apps/web/.qa/file-previews/',import.meta.url),base='http://127.0.0.1:42150/nebulaedev/nwaa';
const cookie='token=file-preview-browser-alice',name='nebu-file-preview-isolated-worker';
async function call(path,body){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result.data;}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function start(){const child=spawn('docker',['run','--rm','--name',name,'--cpus','4','--memory','16g','--pids-limit','256','--read-only','--cap-drop','ALL',...['NET_ADMIN','SETUID','SETGID','CHOWN','DAC_OVERRIDE','FOWNER'].flatMap(c=>['--cap-add',c]),'--security-opt','no-new-privileges:true','--tmpfs','/tmp:size=512m,mode=1777','--tmpfs','/run:size=16m','-v','nebu-file-preview-scratch-test:/work','-e','PREVIEW_API_URL=http://host.docker.internal:42150/nebulaedev/nwaa','-e','PREVIEW_WORKER_KEY=isolated-file-preview-worker-key-32-characters','nebu-file-preview-worker:1'],{stdio:'inherit'});child.unref();}
const large=JSON.parse(await readFile(new URL('large-acceptance.json',root))),artifact=large.results[0];
spawnSync('docker',['stop','--timeout','1',name],{stdio:'ignore'});await sleep(1000);
let job=await call('/api/file-previews',{source:{kind:'knowledge',scopeKind:'catalog',connectionId:'fixture-restart-'+Date.now(),collectionId:'fixture',documentId:artifact.id}});
start();const events=[],deadline=Date.now()+600000;
while(!['reading','converting'].includes(job.status)){assert.ok(Date.now()<deadline);await sleep(500);job=await call('/api/file-previews/'+job.id);}
events.push(job.status);assert.equal(spawnSync('docker',['stop','--timeout','1',name],{stdio:'inherit'}).status,0);await sleep(1000);start();console.log('Worker restarted while source was being read; waiting for the persisted lease to expire.');
while(job.status!=='ready'){assert.ok(Date.now()<deadline,'recovery deadline');assert.ok(!['failed','expired','cancelled'].includes(job.status),JSON.stringify(job));await sleep(3000);job=await call('/api/file-previews/'+job.id);if(events.at(-1)!==job.status){events.push(job.status);console.log(job.status);}}
const row=await call(`/api/file-previews/${job.id}/sheets/0/rows?row=2047&limit=1&columns=1`);assert.equal(row.cells[0].text,'row002047');
const office=JSON.parse(await readFile(new URL('office-large-acceptance.json',root))).results.find(r=>r.name.endsWith('.pptx'));
let ppt=await call('/api/file-previews',{source:{kind:'artifact',projectId:'project',artifactId:office.id,version:1}});
while(ppt.status!=='ready'){assert.ok(Date.now()<deadline);assert.notEqual(ppt.status,'failed',JSON.stringify(ppt));await sleep(2000);ppt=await call('/api/file-previews/'+ppt.id);}
assert.equal(ppt.manifest.pageCount,32);assert.equal(ppt.manifest.slideMappingExact,true);
const located=await call('/api/file-previews/'+ppt.id+'/locate',{quote:'Unique slide evidence 32'});assert.deepEqual(located.pages,[32]);
await writeFile(new URL('worker-recovery.json',root),JSON.stringify({image:'nebu-file-preview-worker:1',persistedLeaseRecovery:true,events,sourceBytes:artifact.size,lastRow:row.cells[0].text,productionImagePptPages:ppt.manifest.pageCount},null,2));
console.log('Production image restart recovery and 32-page PPTX conversion passed.');
