import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

function runtime(fetch) {
  const cache = new Map();
  const scope = { window:{__NEBUWORK_V101__:{apiBase:'/nebulaedev/nwaa/api/knowledge-v101/c/api/v1',uiBase:'/nebulaedev/nwaa/api/knowledge-v101/c/ui',connectionId:'c',admin:false,canCreate:true}},location:{pathname:'/nebulaedev/nwaa/api/knowledge-v101/c/ui/knowledge-bases',search:''},localStorage:{getItem(){throw Error('integrated payload must not use persistent storage');}},crypto:webcrypto,Headers,FormData,Uint8Array,fetch };
  function load(name) {
    if(cache.has(name))return cache.get(name);
    const source=readFileSync(new URL('../src/'+name+'.ts',import.meta.url),'utf8');
    const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const exports={};cache.set(name,exports);
    vm.runInNewContext(compiled,{...scope,exports,require:path=>load(path.replace('./',''))},{filename:name+'.ts'});
    return exports;
  }
  return load;
}
const requests=[];
let uncertain=true;
const load=runtime(async(url,options)=>{requests.push({url,options});if(uncertain){uncertain=false;throw Error('connection interrupted after submission');}return {ok:true,json:async()=>({success:true,data:{id:'session',preview_url:'/documents/d?file_version_id=f',content_url:'/api/v1/images/a/content'}})};});
const api=load('api');
await assert.rejects(api.send('/qa/sessions',{knowledge_base_ids:['k']}));
const result=await api.send('/qa/sessions',{knowledge_base_ids:['k']});
assert.equal(requests[0].options.headers.get('Idempotency-Key'),requests[1].options.headers.get('Idempotency-Key'),'uncertain writes must retain their original key');
assert.equal(requests[1].url,'/nebulaedev/nwaa/api/knowledge-v101/c/api/v1/qa/sessions');
assert.equal(requests[1].options.credentials,'same-origin');
assert.equal(result.preview_url,'/nebulaedev/nwaa/api/knowledge-v101/c/ui/documents/d?file_version_id=f');
assert.equal(result.content_url,'/nebulaedev/nwaa/api/knowledge-v101/c/api/v1/images/a/content');
await api.send('/qa/sessions/session',{title:'rename'},'PATCH');
assert.equal(requests.at(-1).options.method,'POST');
assert.equal(requests.at(-1).options.headers.get('X-Knowledge-Method'),'PATCH');
const routing=load('integration');
assert.equal(routing.appPath(),'/knowledge-bases');
assert.equal(routing.resourceURL('/pdfjs/cmaps/test.bcmap'),'/nebulaedev/nwaa/api/knowledge-v101/c/ui/pdfjs/cmaps/test.bcmap');
routing.uploadSessions.setItem('private filename','opaque-id');assert.equal(routing.uploadSessions.getItem('private filename'),'opaque-id');routing.uploadSessions.removeItem('private filename');
console.log('V101 browser bridge tests passed: external gateway prefix, static/media/source URLs, POST method tunnel, stable uncertain keys, session credentials and memory-only uploads.');
