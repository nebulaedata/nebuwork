import { createUuid } from '../apps/web/src/lib/uuid.js';
import { open, stat, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Deliberately isolated sample identity. This script must never target a shared deployment.
const base='http://127.0.0.1:42150/nebulaedev/nwaa',cookie='token=file-preview-browser-alice';
const root=resolve('apps/web/.qa/file-previews'),directory=resolve(process.argv.find(v=>v.startsWith('--directory='))?.slice(12)||join(root,'fixtures'));
const large=process.argv.includes('--large'),bigFormats=process.argv.includes('--big-formats'),partSize=16*1024*1024;
await mkdir(root,{recursive:true});
let peak=process.memoryUsage().rss;const monitor=setInterval(()=>peak=Math.max(peak,process.memoryUsage().rss),1000);monitor.unref();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,body,headers={}){const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...body!==undefined?{'Content-Type':'application/json'}:{},...headers},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)});const json=await response.json();assert.equal(response.status,200,`${path}: ${JSON.stringify(json)}`);assert.equal(json.code,0,JSON.stringify(json));return json.data;}
const mime={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',xls:'application/vnd.ms-excel',csv:'text/csv',pdf:'application/pdf',md:'text/markdown',html:'text/html',png:'image/png',wav:'audio/wav',mp4:'video/mp4'};
async function upload(path,name){
  const size=(await stat(path)).size,ext=name.split('.').pop(),slot=join(root,`upload-${createHash('sha256').update(path).digest('hex').slice(0,20)}.json`);
  let session;try{const saved=JSON.parse(await readFile(slot,'utf8'));session=await request('/api/projects/project/artifact-uploads/'+saved.id);}catch{}
  if(!session||['expired','cancelled'].includes(session.status)){session=await request('/api/projects/project/artifact-uploads',{name,size,mediaType:mime[ext]||'application/octet-stream'},{'Idempotency-Key':createUuid()});await writeFile(slot,JSON.stringify({id:session.id}));}
  const pathBase='/api/projects/project/artifact-uploads/'+session.id,confirmed=new Map(session.parts.map(p=>[p.number,p])),sha=createHash('sha256');
  const file=await open(path,'r');let cursor=0,number=1;
  try{do{const expected=Math.min(partSize,size-cursor),bytes=Buffer.alloc(expected);const {bytesRead}=await file.read(bytes,0,expected,cursor);assert.equal(bytesRead,expected);const digest=createHash('sha256').update(bytes).digest('hex');sha.update(bytes);
    if(confirmed.has(number))assert.equal(confirmed.get(number).sha256,digest,'reselected part checksum');
    else{await request(`${pathBase}/parts/${number}`,bytes,{'Content-Type':'application/octet-stream','X-Part-Sha256':digest});
      if(number===1){const recovered=await request(pathBase);assert.equal(recovered.parts[0].sha256,digest);session=recovered;}
    }
    cursor+=expected;if(size>20*1024*1024&&number%8===0)console.log(`${name}: ${cursor/1048576} / ${size/1048576} MiB`);number++;
  }while(cursor<size);}finally{await file.close();}
  session=await request(pathBase+'/complete',{});
  const deadline=Date.now()+3600000;while(session.status!=='complete'){assert.ok(Date.now()<deadline,'upload deadline');assert.notEqual(session.status,'failed',session.error);await sleep(1000);session=await request(pathBase);}
  assert.equal(session.result.sha256,sha.digest('hex'),'complete stream SHA-256');return session.result;
}
async function waitPreview(source,indexText){let job=await request('/api/file-previews',{source,indexText});const deadline=Date.now()+3600000;while(job.status!=='ready'){assert.ok(!['failed','cancelled','expired'].includes(job.status),JSON.stringify(job));assert.ok(Date.now()<deadline,'preview deadline');await sleep(2000);job=await request('/api/file-previews/'+job.id);}return job;}

const names=(await readdir(directory)).filter(name=>large?name==='large-2048MiB.csv':bigFormats?/^large\.(docx|pptx|xlsx|xls)$/.test(name):/^source\./.test(name));
const artifacts=[],results=[];
for(const name of names){const artifact=await upload(join(directory,name),name);artifacts.push({id:artifact.id,version:artifact.version,name:artifact.name,size:artifact.size,mediaType:artifact.mediaType,sha256:artifact.sha256});console.log('Uploaded '+name+' v'+artifact.version);
  const ext=name.split('.').pop();if(!['docx','pptx','xlsx','xls','csv','pdf'].includes(ext))continue;
  const source={kind:'artifact',projectId:'project',artifactId:artifact.id,version:artifact.version},job=await waitPreview(source,ext==='pdf');
  const denied=await fetch(base+'/api/file-previews/'+job.id,{headers:{Cookie:'token=file-preview-browser-bob'}});assert.equal(denied.status,404);
  if(job.manifest.kind==='table'){
    const sheet=job.manifest.sheets[0],indices=large?[0,1024,2047]:[0,Math.floor((sheet.rowCount-1)/2),sheet.rowCount-1];
    for(const row of indices){const page=await request(`/api/file-previews/${job.id}/sheets/${sheet.id}/rows?row=${row}&limit=1&columns=3`);assert.ok(page.cells.length,'random-access row '+row);if(large)assert.equal(page.cells.find(c=>c.row===row&&c.column===0).text,`row${String(row).padStart(6,'0')}`);}
    if(large){const cell=await request(`/api/file-previews/${job.id}/sheets/0/cell?row=2047&column=1&start=1040000`);assert.ok(cell.text.length>0);assert.equal(cell.length,1048565);}
  }else{const range=await fetch(base+`/api/file-previews/${job.id}/content`,{headers:{Cookie:cookie,Range:'bytes=0-15'}});assert.equal(range.status,206);assert.ok(Buffer.from(await range.arrayBuffer()).toString().startsWith('%PDF'));const quote=ext==='docx'?'Unique document evidence: total equals 42.':ext==='pptx'?`Unique slide evidence ${bigFormats?32:2}`:'Unique PDF page 2.';const location=await request('/api/file-previews/'+job.id+'/locate',{quote});assert.equal(location.reason,null,JSON.stringify(location));assert.equal(location.pages.length,1);if(bigFormats&&ext==='pptx')assert.equal(location.pages[0],32);const tail=await fetch(base+`/api/file-previews/${job.id}/content`,{headers:{Cookie:cookie,Range:'bytes=-32'}});assert.equal(tail.status,206);assert.equal((await tail.arrayBuffer()).byteLength,32);}
  if(large){const knowledge=await waitPreview({kind:'knowledge',scopeKind:'catalog',connectionId:'fixture',collectionId:'fixture',documentId:artifact.id},false);assert.equal(knowledge.manifest.sheets[0].rowCount,2048);}
  results.push({name,size:artifact.size,id:artifact.id,previewId:job.id,manifest:job.manifest,permissionCheck:'passed'});console.log('Preview accepted '+name+' '+job.manifest.kind);
}
clearInterval(monitor);
const report={isolatedIdentity:true,large,peakClientRssBytes:peak,results};
await writeFile(join(root,large?'large-acceptance.json':bigFormats?'office-large-acceptance.json':'acceptance.json'),JSON.stringify(report,null,2));
if(!large&&!bigFormats)await writeFile(join(root,'fixtures.json'),JSON.stringify(artifacts,null,2));
console.log(JSON.stringify({accepted:results.length,large,peakClientRssMiB:(peak/1048576).toFixed(1)}));
