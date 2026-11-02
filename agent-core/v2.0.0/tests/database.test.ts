import { createUuid } from '../src/uuid.js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { validateManifest, hash, type Principal } from '../src/contracts.js';
import { databaseContext } from '../src/database.js';
import { AgentRuntime } from '../src/runtime.js';
import { createApi } from '../src/api.js';
import { Store } from '../src/store.js';
import { Objects } from '../src/objects.js';
import { sign } from '../src/auth.js';
import { testConfig } from './fixture.js';

const base={schemaVersion:1,tenantId:'database-tests',ownerId:'alice',projectId:'project',workbenchId:'workbench',taskId:'task',primaryExpertId:'main',resolvedAt:new Date().toISOString(),model:{providerId:'model',revision:'1',protocol:'openai-compatible',baseUrl:'https://model.example/v1',model:'configured',credentialRef:'key'}};
const ref=(id:string,scopeKind:'project'|'workbench'|'expert',scopeId:string)=>({id,name:id,description:'分析数据',type:'sqlite',scopeKind,scopeId,configVersion:1,permissions:{read:true,write:true,schema:true}});
const tool={name:'database_query',description:'query',capability:'database',operation:'query',replay:'idempotent'};
it('keeps historical manifests empty and rejects leaked database scopes or credentials',()=>{
  expect(validateManifest({...base,databaseReferences:undefined}).databaseReferences).toEqual([]);
  for(const source of [ref('db','project','other-project'),ref('db','expert','other-expert'),ref('db','workbench','other-workbench')])expect(()=>validateManifest({...base,databaseReferences:[source]})).toThrow('授权范围');
  expect(()=>validateManifest({...base,databaseReferences:[{...ref('db','project','project'),password:'never-here'}]})).toThrow();
  expect(()=>validateManifest({...base,databaseReferences:[ref('db','project','project'),ref('db','project','project')]})).toThrow('重复');
});
it('delegates only common databases and this expert databases and preserves the frozen parent',async()=>{
  const common=[ref('workbench-db','workbench','workbench'),ref('project-db','project','project')],manifest=validateManifest({...base,businessTools:[tool],databaseReferences:[...common,ref('main-db','expert','main')],experts:[{id:'law',name:'法务',instructions:'分析',runtime:{databaseReferences:[...common,ref('law-db','expert','law')],businessTools:[tool]}}]});
  const before=hash(manifest),store={children:vi.fn().mockResolvedValue([]),fenced:vi.fn(async(_lease,callback)=>callback({})),createSession:vi.fn().mockResolvedValue({id:'child-session',taskId:'child-task'}),createRun:vi.fn().mockResolvedValue({id:'child-run'}),emit:vi.fn()};
  const runtime=new AgentRuntime(store as any,{} as any,{authorize:vi.fn()} as any,{} as any,{id:'run',manifest,tenantId:'database-tests',ownerId:'alice',projectId:'project',sessionId:'session',workerId:'worker',fence:1} as any,{id:'session'} as any,new AbortController().signal);
  const delegate=(runtime as any).tools().find((t:any)=>t.name==='delegate_expert');await delegate.execute('delegate-call',{expertId:'law',goal:'核对数据'});const child=validateManifest(store.createRun.mock.calls[0]![4]);
  expect(child.databaseReferences.map(r=>r.id)).toEqual(['workbench-db','project-db','law-db']);expect(hash(manifest)).toBe(before);expect(databaseContext(child)).toContain('operationId');expect(databaseContext(child)).not.toContain('main-db');
  const invalid=structuredClone(manifest);invalid.experts[0]!.runtime!.databaseReferences!.push(ref('bad','expert','main') as any);expect(()=>validateManifest(invalid)).toThrow('自身授权范围');
});

const store=new Store(testConfig.DATABASE_URL),objects=new Objects(testConfig);let api:Awaited<ReturnType<typeof createApi>>;
const principal:Principal={service:'database-storage-tests',tenantId:'database-tests',ownerId:createUuid(),projects:['*'],scopes:['engine:*']};
beforeAll(async()=>{await store.migrate();await objects.initialize();api=await createApi(testConfig,store,objects);});
afterAll(async()=>{await api?.close();await store.close();objects.client.destroy();});
it('round trips authenticated binary snapshots without exposing another account objects',async()=>{
  const bytes=Buffer.alloc(4096);bytes.write('SQLite format 3\0',0,'binary');const digest=hash(bytes),token=await sign(principal,testConfig.ENGINE_SIGNING_KEY),headers={authorization:'Bearer '+token,'content-type':'application/octet-stream','idempotency-key':'database-object:'+digest,'x-content-sha256':digest};
  const upload=await api.inject({method:'POST',url:'/v1/database-objects',headers,payload:bytes});expect(upload.statusCode).toBe(200);expect(upload.json().sha256).toBe(digest);
  const read=await api.inject({method:'GET',url:'/v1/database-objects/'+digest,headers:{authorization:headers.authorization}});expect(read.statusCode).toBe(200);expect(read.rawPayload).toEqual(bytes);
  const other=await sign({...principal,ownerId:createUuid()},testConfig.ENGINE_SIGNING_KEY);const absent=await api.inject({method:'GET',url:'/v1/database-objects/'+digest,headers:{authorization:'Bearer '+other}});expect(absent.statusCode).not.toBe(200);
  const invalid=await api.inject({method:'POST',url:'/v1/database-objects',headers:{...headers,'x-content-sha256':hash('wrong')},payload:bytes});expect(invalid.statusCode).toBe(422);
  const noAuth=await api.inject({method:'GET',url:'/v1/database-objects/'+digest});expect(noAuth.statusCode).toBe(401);
  const cap=await api.inject({method:'GET',url:'/v1/capabilities',headers:{authorization:headers.authorization}});expect(cap.json().databaseResources).toBe(true);
});
