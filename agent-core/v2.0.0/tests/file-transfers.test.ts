import { createUuid } from '../src/uuid.js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import { Store } from '../src/store.js';
import { Objects } from '../src/objects.js';
import { createApi } from '../src/api.js';
import { sign } from '../src/auth.js';
import { hash, type Principal } from '../src/contracts.js';
import { CheckedFileStream, FileTransfers, FILE_PART_BYTES, MAX_FILE_BYTES } from '../src/file-transfers.js';
import { testConfig } from './fixture.js';

const store=new Store(testConfig.DATABASE_URL),objects=new Objects(testConfig);
const p:Principal={service:'file-tests',tenantId:'file-tests',ownerId:createUuid(),projects:['project'],scopes:['engine:*']};
let api:Awaited<ReturnType<typeof createApi>>,headers:Record<string,string>,service:FileTransfers;
beforeAll(async()=>{vi.stubEnv('FILE_TRANSFERS_ENABLED','true');await store.migrate();await objects.initialize();api=await createApi(testConfig,store,objects);headers={authorization:'Bearer '+await sign(p,testConfig.ENGINE_SIGNING_KEY),'idempotency-key':createUuid()};service=new FileTransfers(store,objects,testConfig);});
afterAll(async()=>{await api?.close();await store.close();objects.client.destroy();vi.unstubAllEnvs();});
async function create(size:number,key=createUuid(),purpose='artifact',principal=p){return api.inject({method:'POST',url:'/v1/projects/project/file-uploads',headers:{authorization:'Bearer '+await sign(principal,testConfig.ENGINE_SIGNING_KEY),'idempotency-key':key},payload:{name:'data.csv',size,mediaType:'text/csv',purpose}});}
async function part(id:string,number:number,bytes:Buffer,digest=hash(bytes)){return api.inject({method:'POST',url:`/v1/file-uploads/${id}/parts/${number}`,headers:{...headers,'content-type':'application/octet-stream','x-part-sha256':digest},payload:bytes});}
async function settle(id:string){for(let n=0;n<20;n++){await service.tick();const state=await service.status(p,id);if(['complete','failed'].includes(state.status))return state;await new Promise(r=>setTimeout(r,300));}throw new Error('upload did not settle');}
it('rejects incorrect length without retaining an oversized stream',async()=>{const checked=new CheckedFileStream(4);checked.resume();const error=new Promise<Error>(resolve=>checked.on('error',resolve));Readable.from([Buffer.from('12345')]).pipe(checked);expect((await error).message).toContain('不匹配');});
it('streams parts to S3, resumes without duplicate artifacts, and preserves range reads',async()=>{
  const key=createUuid(),bytes=Buffer.from('id,name\n001,first\n002,last\n'),created=await create(bytes.length,key);expect(created.statusCode,created.body).toBe(200);const id=created.json().id;
  expect((await create(bytes.length,key)).json().id).toBe(id);expect((await create(bytes.length+1,key)).statusCode).toBe(409);
  expect((await part(id,1,bytes)).statusCode).toBe(200);expect((await part(id,1,bytes)).statusCode).toBe(200);
  const resume=await api.inject({method:'GET',url:`/v1/file-uploads/${id}`,headers});expect(resume.json().parts).toEqual([{number:1,size:bytes.length,sha256:hash(bytes)}]);
  const sealed=await api.inject({method:'POST',url:`/v1/file-uploads/${id}/complete`,headers,payload:{}});expect(sealed.statusCode,sealed.body).toBe(200);
  const result=await settle(id);expect(result.error).toBe('');expect(result.status).toBe('complete');expect((result.result as any).sha256).toBe(hash(bytes));
  const again=await api.inject({method:'POST',url:`/v1/file-uploads/${id}/complete`,headers,payload:{}});expect(again.json().result.id).toBe((result.result as any).id);
  const range=await api.inject({method:'GET',url:`/v1/artifacts/${(result.result as any).id}/content?version=1`,headers:{...headers,range:'bytes=3-6'}});expect(range.statusCode).toBe(206);expect(range.rawPayload).toEqual(bytes.subarray(3,7));
  const all=await store.artifacts(p,'project');expect(all.filter(a=>a.id===(result.result as any).id)).toHaveLength(1);
});
it('requires every part, rejects replaced bytes, and hides sessions from another account and project',async()=>{
  const created=await create(FILE_PART_BYTES+3),id=created.json().id;expect((await api.inject({method:'POST',url:`/v1/file-uploads/${id}/complete`,headers,payload:{}})).statusCode).toBe(409);
  const bytes=Buffer.alloc(FILE_PART_BYTES,65);expect((await part(id,1,bytes)).statusCode).toBe(200);expect((await part(id,1,bytes,hash('different'))).statusCode).toBe(409);
  expect((await part(id,2,Buffer.from('last'))).statusCode).toBe(422);
  const wrong=await sign({...p,ownerId:createUuid()},testConfig.ENGINE_SIGNING_KEY),wrongProject=await sign({...p,projects:['other']},testConfig.ENGINE_SIGNING_KEY);
  expect((await api.inject({method:'GET',url:`/v1/file-uploads/${id}`,headers:{authorization:'Bearer '+wrong}})).statusCode).toBe(404);
  expect((await api.inject({method:'GET',url:`/v1/file-uploads/${id}`,headers:{authorization:'Bearer '+wrongProject}})).statusCode).toBe(404);
  expect((await api.inject({method:'POST',url:`/v1/file-uploads/${id}/cancel`,headers,payload:{}})).json().status).toBe('cancelled');
  expect((await part(id,2,Buffer.from('end'))).statusCode).toBe(409);
});
it('accepts the exact 2 GiB metadata boundary and rejects one byte beyond it',async()=>{const accepted=await create(MAX_FILE_BYTES);expect(accepted.statusCode,accepted.body).toBe(200);const rejected=await create(MAX_FILE_BYTES+1);expect(rejected.statusCode).toBe(422);await service.cancel(p,accepted.json().id);});
it('publishes preview objects separately and expires them without removing original artifacts',async()=>{
  const bytes=Buffer.from('private preview'),created=await create(bytes.length,createUuid(),'preview'),id=created.json().id;expect((await part(id,1,bytes)).statusCode).toBe(200);await service.complete(p,id);const state=await settle(id);expect(state.status,state.error).toBe('complete');
  const read=await api.inject({method:'GET',url:'/v1/preview-objects/'+id,headers});expect(read.rawPayload).toEqual(bytes);
  const other=await sign({...p,ownerId:createUuid()},testConfig.ENGINE_SIGNING_KEY);expect((await api.inject({method:'GET',url:'/v1/preview-objects/'+id,headers:{authorization:'Bearer '+other}})).statusCode).toBe(404);
  expect((await api.inject({method:'GET',url:'/v1/preview-objects/'+id,headers:{...headers,range:'bytes=99999-'}})).statusCode).toBe(416);
  const original=(await create(bytes.length)).json().id;await part(original,1,bytes);await service.complete(p,original);const artifact=await settle(original);
  await store.pool.query('UPDATE ae_preview_objects SET expires_at=0 WHERE id=?',[id]);await service.tick();
  expect((await api.inject({method:'GET',url:'/v1/preview-objects/'+id,headers})).statusCode).toBe(404);
  expect((await objects.get((artifact.result as any).objectKey)).ContentLength).toBe(bytes.length);
});
it('rejects a corrupted part before confirming it, and publishes empty files with the actual empty SHA',async()=>{
  const invalid=(await create(3)).json().id;const response=await part(invalid,1,Buffer.from('abc'),hash('bad'));expect(response.statusCode).toBeGreaterThanOrEqual(400);expect((await service.status(p,invalid)).parts).toHaveLength(0);await service.cancel(p,invalid);
  const empty=(await create(0)).json().id;expect((await part(empty,1,Buffer.alloc(0))).statusCode).toBe(200);await service.complete(p,empty);const result=await settle(empty);expect(result.status,result.error).toBe('complete');expect((result.result as any).sha256).toBe(hash(''));
});
