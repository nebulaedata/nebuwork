import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { Transform, type Readable } from 'node:stream';
import { z } from 'zod';
import { CreateMultipartUploadCommand, UploadPartCommand, UploadPartCopyCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { EngineError, ID, assertScope, hash, id, type Principal, type Artifact } from './contracts.js';
import type { Store } from './store.js';
import type { Objects } from './objects.js';
import type { Config } from './config.js';

export const MAX_FILE_BYTES = 2 * 1024 ** 3;
export const FILE_PART_BYTES = 16 * 1024 ** 2;
const TTL = 86400000;
const uploadTtl = () => Math.max(600000, Number(process.env.FILE_UPLOAD_TTL_MS) || TTL);
const previewTtl = () => Math.max(600000, Number(process.env.FILE_PREVIEW_TTL_MS) || 7 * TTL);
const parse = <T>(v: unknown): T => (typeof v === 'string' ? JSON.parse(v) : v) as T;
const schema = z.object({name:z.string().min(1).max(255),size:z.number().int().min(0).max(64*1024**3),mediaType:z.string().max(255).default('application/octet-stream'),sessionId:ID.optional(),purpose:z.enum(['artifact','preview']).default('artifact')}).strict().refine(v=>v.size <= (v.purpose==='artifact'?MAX_FILE_BYTES:64*1024**3),'文件超过容量限制');
type Meta = z.infer<typeof schema> & {principal:Principal; artifactId:string; createdAt:string};
type Upload = {id:string;tenant_id:string;owner_id:string;project_id:string;state:string;expires_at:number;lease_until:number;lease_token:string;doc:Meta|string;object_key:string;multipart_id:string;result:unknown;error:string};
export async function migrateFileTransfers(store: Store) {
  await store.pool.query(`CREATE TABLE IF NOT EXISTS ae_file_uploads(id VARCHAR(128) PRIMARY KEY,tenant_id VARCHAR(128) NOT NULL,owner_id VARCHAR(128) NOT NULL,project_id VARCHAR(128) NOT NULL,request_key VARCHAR(128) NOT NULL,request_hash CHAR(64) NOT NULL,state VARCHAR(24) NOT NULL,expires_at BIGINT NOT NULL,lease_until BIGINT NOT NULL DEFAULT 0,lease_token VARCHAR(128) NOT NULL DEFAULT '',doc JSON NOT NULL,object_key VARCHAR(1024) NOT NULL,multipart_id TEXT NOT NULL,result JSON,error VARCHAR(500) NOT NULL DEFAULT '',UNIQUE KEY upload_request(tenant_id,owner_id,request_key),INDEX upload_queue(state,lease_until,expires_at))`);
  await store.pool.query(`CREATE TABLE IF NOT EXISTS ae_file_parts(upload_id VARCHAR(128) NOT NULL,part_number INT NOT NULL,size BIGINT NOT NULL,digest CHAR(64) NOT NULL,etag VARCHAR(255),lease_token VARCHAR(128) NOT NULL,lease_until BIGINT NOT NULL,PRIMARY KEY(upload_id,part_number))`);
  await store.pool.query(`CREATE TABLE IF NOT EXISTS ae_preview_objects(id VARCHAR(128) PRIMARY KEY,tenant_id VARCHAR(128) NOT NULL,owner_id VARCHAR(128) NOT NULL,doc JSON NOT NULL,expires_at BIGINT NOT NULL,INDEX preview_expiry(expires_at))`);
}

/** Bounded stream: rejects an incorrect length and hashes bytes without retaining them. */
export class CheckedFileStream extends Transform {
  bytes = 0;
  readonly digest = createHash('sha256');
  constructor(readonly expected: number) { super(); }
  _transform(chunk: Buffer, _encoding: BufferEncoding, done: (e?: Error|null, chunk?: Buffer)=>void) {
    this.bytes += chunk.length;
    if (this.bytes > this.expected) return done(new EngineError(413,'part_too_large','分块大小不匹配'));
    this.digest.update(chunk); done(null,chunk);
  }
  _flush(done: (e?:Error|null)=>void) { done(this.bytes === this.expected ? null : new EngineError(422,'part_incomplete','分块不完整')); }
}

export class FileTransfers {
  constructor(readonly store: Store, readonly objects: Objects, readonly config: Config) {}
  private async rows(sql:string,args:unknown[]=[]):Promise<any[]> { const [rows]=await this.store.pool.query(sql,args);return rows as any[]; }
  async owned(p:Principal, uploadId:string) {
    const [u] = await this.rows('SELECT * FROM ae_file_uploads WHERE id=? AND tenant_id=? AND owner_id=?',[uploadId,p.tenantId,p.ownerId]) as Upload[];
    if(!u) throw new EngineError(404,'not_found','上传会话不存在');
    assertScope(p,'engine:write',u.project_id); return u;
  }
  async status(p:Principal,uploadId:string) {
    const u=await this.owned(p,uploadId), meta=parse<Meta>(u.doc);
    const parts=await this.rows('SELECT part_number,size,digest FROM ae_file_parts WHERE upload_id=? AND etag IS NOT NULL ORDER BY part_number',[u.id]);
    return {id:u.id,status:u.state,partSize:FILE_PART_BYTES,size:meta.size,name:meta.name,expiresAt:Number(u.expires_at),parts:parts.map(v=>({number:v.part_number,size:Number(v.size),sha256:v.digest})),result:u.result?parse(u.result):null,error:u.error};
  }
  async create(p:Principal,project:string,body:unknown,key:string) {
    assertScope(p,'engine:write',project);
    if(!key||key.length>128)throw new EngineError(422,'request_key','需要稳定的上传请求编号');
    const input=schema.parse(body), signature=hash({project,...input});
    const [prior]=await this.rows('SELECT * FROM ae_file_uploads WHERE tenant_id=? AND owner_id=? AND request_key=?',[p.tenantId,p.ownerId,key]);
    if(prior){if(prior.request_hash!==signature)throw new EngineError(409,'idempotency_conflict','原上传请求参数不同');return this.status(p,prior.id);}
    if(input.sessionId){const session=await this.store.ownedSession(p,input.sessionId);if(session.projectId!==project)throw new EngineError(404,'not_found','任务不属于当前项目');}
    const uploadId=id(), objectKey=this.objects.key(p.tenantId,p.ownerId,hash('file-upload:'+uploadId))+'.staging';
    const staged=await this.objects.client.send(new CreateMultipartUploadCommand({Bucket:this.config.S3_BUCKET,Key:objectKey,ContentType:input.mediaType}));
    const meta:Meta={...input,principal:p,artifactId:id(),createdAt:new Date().toISOString()};
    try {await this.store.pool.query('INSERT INTO ae_file_uploads(id,tenant_id,owner_id,project_id,request_key,request_hash,state,expires_at,doc,object_key,multipart_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[uploadId,p.tenantId,p.ownerId,project,key,signature,'uploading',Date.now()+uploadTtl(),JSON.stringify(meta),objectKey,staged.UploadId]);}
    catch(e){await this.objects.client.send(new AbortMultipartUploadCommand({Bucket:this.config.S3_BUCKET,Key:objectKey,UploadId:staged.UploadId}));const [winner]=await this.rows('SELECT id,request_hash FROM ae_file_uploads WHERE tenant_id=? AND owner_id=? AND request_key=?',[p.tenantId,p.ownerId,key]);if(winner&&winner.request_hash===signature)return this.status(p,winner.id);throw e;}
    return this.status(p,uploadId);
  }
  async part(p:Principal,uploadId:string,number:number,digest:string,source:Readable,length:number) {
    const u=await this.owned(p,uploadId),meta=parse<Meta>(u.doc);
    const count=Math.max(1,Math.ceil(meta.size/FILE_PART_BYTES)),expected=number===count?meta.size-(number-1)*FILE_PART_BYTES:FILE_PART_BYTES;
    if(u.state!=='uploading'||Number(u.expires_at)<Date.now())throw new EngineError(409,'upload_closed','上传会话已关闭或过期');
    if(!Number.isInteger(number)||number<1||number>count||length!==expected||!/^[a-f0-9]{64}$/.test(digest))throw new EngineError(422,'invalid_part','分块编号、长度或校验值无效');
    const [prior]=await this.rows('SELECT * FROM ae_file_parts WHERE upload_id=? AND part_number=?',[u.id,number]);
    if(prior&&prior.digest!==digest)throw new EngineError(409,'part_conflict','此分块与原文件内容不一致');
    if(prior?.etag){source.resume();return {number,sha256:digest,size:expected};}
    const token=id();
    await this.store.pool.query('INSERT IGNORE INTO ae_file_parts(upload_id,part_number,size,digest,lease_token,lease_until) VALUES(?,?,?,?,?,0)',[u.id,number,expected,digest,token]);
    const [claimed]:any=await this.store.pool.query('UPDATE ae_file_parts SET lease_token=?,lease_until=? WHERE upload_id=? AND part_number=? AND etag IS NULL AND lease_until<?',[token,Date.now()+600000,u.id,number,Date.now()]);
    if(!claimed.affectedRows)throw new EngineError(409,'part_busy','分块正在上传，请查询原会话');
    const checked=new CheckedFileStream(expected);source.once('error',e=>checked.destroy(e));source.pipe(checked);
    try {
      const result=await this.objects.client.send(new UploadPartCommand({Bucket:this.config.S3_BUCKET,Key:u.object_key,UploadId:u.multipart_id,PartNumber:number,Body:checked,ContentLength:expected,ChecksumSHA256:Buffer.from(digest,'hex').toString('base64')}));
      if(checked.bytes!==expected||checked.digest.digest('hex')!==digest)throw new EngineError(422,'checksum_mismatch','文件分块校验失败');
      await this.store.pool.query('UPDATE ae_file_parts SET etag=?,lease_until=0 WHERE upload_id=? AND part_number=? AND lease_token=?',[result.ETag,u.id,number,token]);
      return {number,sha256:digest,size:expected};
    } finally {source.unpipe(checked);checked.destroy();await this.store.pool.query('UPDATE ae_file_parts SET lease_until=0 WHERE upload_id=? AND part_number=? AND lease_token=?',[u.id,number,token]);}
  }
  async complete(p:Principal,uploadId:string) {
    const u=await this.owned(p,uploadId),meta=parse<Meta>(u.doc);
    if(['complete','sealing'].includes(u.state))return this.status(p,u.id);
    if(!['uploading','failed'].includes(u.state)||Number(u.expires_at)<Date.now())throw new EngineError(409,'upload_closed','上传会话已关闭或过期');
    const parts=await this.rows('SELECT * FROM ae_file_parts WHERE upload_id=? AND etag IS NOT NULL ORDER BY part_number',[u.id]);
    if(parts.length!==Math.max(1,Math.ceil(meta.size/FILE_PART_BYTES))||parts.reduce((n,p)=>n+Number(p.size),0)!==meta.size)throw new EngineError(409,'upload_incomplete','仍有分块尚未上传完成');
    await this.store.pool.query("UPDATE ae_file_uploads SET state='sealing',error='',lease_until=0 WHERE id=? AND state IN ('uploading','failed')",[u.id]);
    return this.status(p,u.id);
  }
  async cancel(p:Principal,uploadId:string) {
    const u=await this.owned(p,uploadId);
    await this.store.pool.query("UPDATE ae_file_uploads SET state='cancelled',lease_token=? WHERE id=? AND state NOT IN ('complete','publishing')",[id(),u.id]);
    const current=await this.owned(p,u.id);
    if(current.state==='cancelled')await this.abort(u);
    return this.status(p,u.id);
  }
  private async abort(u:Upload) {try{await this.objects.client.send(new AbortMultipartUploadCommand({Bucket:this.config.S3_BUCKET,Key:u.object_key,UploadId:u.multipart_id}));}catch{}try{await this.objects.client.send(new DeleteObjectCommand({Bucket:this.config.S3_BUCKET,Key:u.object_key}));}catch{} }
  async tick() {
    const [u]=await this.rows("SELECT * FROM ae_file_uploads WHERE state IN ('sealing','publishing') AND lease_until<? AND (expires_at>? OR state='publishing') LIMIT 1",[Date.now(),Date.now()]) as Upload[];
    if(u)await this.finalize(u);
    for(const expired of await this.rows("SELECT * FROM ae_file_uploads WHERE expires_at<? AND multipart_id<>'' AND state<>'publishing' AND lease_until<? LIMIT 10",[Date.now(),Date.now()]) as Upload[]){const [claimed]:any=await this.store.pool.query("UPDATE ae_file_uploads SET state=IF(state='complete','complete','expired'),lease_token=?,multipart_id='' WHERE id=? AND state<>'publishing' AND lease_until<?",[id(),expired.id,Date.now()]);if(claimed.affectedRows)await this.abort(expired);}
    for(const object of await this.rows('SELECT * FROM ae_preview_objects WHERE expires_at<? LIMIT 10',[Date.now()])){const doc=parse<any>(object.doc);await this.objects.client.send(new DeleteObjectCommand({Bucket:this.config.S3_BUCKET,Key:doc.objectKey}));await this.store.pool.query('DELETE FROM ae_preview_objects WHERE id=? AND expires_at<?',[object.id,Date.now()]);}
  }
  private async finalize(u:Upload) {
    const token=id(),meta=parse<Meta>(u.doc);
    const [claimed]:any=await this.store.pool.query("UPDATE ae_file_uploads SET lease_token=?,lease_until=? WHERE id=? AND state IN ('sealing','publishing') AND lease_until<?",[token,Date.now()+120000,u.id,Date.now()]);
    if(!claimed.affectedRows)return;
    let lost=false;
    const heartbeat=setInterval(()=>{void this.store.pool.query("UPDATE ae_file_uploads SET lease_until=? WHERE id=? AND lease_token=? AND state IN ('sealing','publishing')",[Date.now()+120000,u.id,token]).then(([r]:any)=>{if(!r.affectedRows)lost=true;}).catch(()=>{lost=true;});},15000);heartbeat.unref();
    try {
      const parts=await this.rows('SELECT * FROM ae_file_parts WHERE upload_id=? ORDER BY part_number',[u.id]);
      try{await this.objects.client.send(new CompleteMultipartUploadCommand({Bucket:this.config.S3_BUCKET,Key:u.object_key,UploadId:u.multipart_id,MultipartUpload:{Parts:parts.map(p=>({PartNumber:p.part_number,ETag:p.etag,ChecksumSHA256:Buffer.from(p.digest,'hex').toString('base64')}))}}));}
      catch(e){await this.objects.client.send(new HeadObjectCommand({Bucket:this.config.S3_BUCKET,Key:u.object_key}));}
      const object=await this.objects.get(u.object_key), sha=createHash('sha256');let bytes=0;
      for await(const chunk of object.Body as Readable){if(lost)throw new EngineError(409,'lease_lost','上传处理已取消或转移');bytes+=chunk.length;if(bytes>meta.size)throw new EngineError(422,'size_mismatch','文件长度校验失败');sha.update(chunk);}
      if(bytes!==meta.size)throw new EngineError(422,'size_mismatch','文件长度校验失败');
      const sha256=sha.digest('hex');
      // Preview derivatives have distinct keys: expiration can never delete an original.
      const objectKey=this.objects.key(u.tenant_id,u.owner_id,sha256)+(meta.purpose==='preview'?'.preview.'+u.id:'');
      const copySource=encodeURIComponent(this.config.S3_BUCKET+'/'+u.object_key).replace(/%2F/g,'/');
      if(bytes<=5*1024**3)await this.objects.client.send(new CopyObjectCommand({Bucket:this.config.S3_BUCKET,Key:objectKey,CopySource:copySource}));
      else {
        const copy=await this.objects.client.send(new CreateMultipartUploadCommand({Bucket:this.config.S3_BUCKET,Key:objectKey,ContentType:meta.mediaType}));
        try{const copied=[];for(let offset=0,n=1;offset<bytes;offset+=64*1024**2,n++){if(lost)throw new EngineError(409,'lease_lost','文件处理租约已失效');const part=await this.objects.client.send(new UploadPartCopyCommand({Bucket:this.config.S3_BUCKET,Key:objectKey,UploadId:copy.UploadId,PartNumber:n,CopySource:copySource,CopySourceRange:`bytes=${offset}-${Math.min(bytes-1,offset+64*1024**2-1)}`}));copied.push({PartNumber:n,ETag:part.CopyPartResult?.ETag});}await this.objects.client.send(new CompleteMultipartUploadCommand({Bucket:this.config.S3_BUCKET,Key:objectKey,UploadId:copy.UploadId,MultipartUpload:{Parts:copied}}));}
        catch(e){await this.objects.client.send(new AbortMultipartUploadCommand({Bucket:this.config.S3_BUCKET,Key:objectKey,UploadId:copy.UploadId}));throw e;}
      }
      const c=await this.store.pool.getConnection();
      try {await c.beginTransaction();const [rows]:any=await c.query('SELECT state,lease_token FROM ae_file_uploads WHERE id=? FOR UPDATE',[u.id]);if(rows[0]?.lease_token!==token||!['sealing','publishing'].includes(rows[0]?.state))throw new EngineError(409,'lease_lost','上传处理已取消或转移');await c.query("UPDATE ae_file_uploads SET state='publishing' WHERE id=?",[u.id]);await c.commit();}catch(e){await c.rollback();throw e;}finally{c.release();}
      let result:unknown;
      const data={sha256,objectKey,size:bytes,mediaType:meta.mediaType};
      if(meta.purpose==='artifact') {const artifact:Artifact={id:meta.artifactId,version:1,tenantId:u.tenant_id,ownerId:u.owner_id,projectId:u.project_id,sessionId:meta.sessionId??null,runId:null,name:meta.name,...data,source:{kind:'upload'},createdAt:meta.createdAt};result=await this.store.addArtifact(meta.principal,artifact,'upload:'+u.id);}
      else {result={id:u.id,...data};await this.store.pool.query('INSERT INTO ae_preview_objects(id,tenant_id,owner_id,doc,expires_at) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE doc=VALUES(doc)',[u.id,u.tenant_id,u.owner_id,JSON.stringify(result),Date.now()+previewTtl()]);}
      await this.store.pool.query("UPDATE ae_file_uploads SET state='complete',result=?,lease_until=0 WHERE id=? AND lease_token=? AND state='publishing'",[JSON.stringify(result),u.id,token]);
      // Keep the staging object until expiry, so a crash before publication is replayable.
    } catch(e){await this.store.pool.query("UPDATE ae_file_uploads SET state='failed',error=?,lease_until=0 WHERE id=? AND lease_token=? AND state NOT IN ('complete','cancelled','expired')",[e instanceof EngineError?e.message:'文件校验或存储失败，请重试原上传会话',u.id,token]);}
    finally{clearInterval(heartbeat);}
  }
}

export async function registerFileTransfers(app:FastifyInstance,store:Store,objects:Objects,config:Config,principal:(r:object)=>Principal) {
  const service=new FileTransfers(store,objects,config);
  // Encapsulation prevents the database object's buffered parser from capturing file parts.
  await app.register(async scope=>{
    scope.removeContentTypeParser('application/octet-stream');
    scope.addContentTypeParser('application/octet-stream',(_r,payload,done)=>done(null,payload));
    scope.addHook('preHandler',async()=>{if(process.env.FILE_TRANSFERS_ENABLED!=='true')throw new EngineError(503,'file_transfers_disabled','大文件功能尚未启用');});
    scope.post('/v1/projects/:project/file-uploads',async r=>service.create(principal(r),ID.parse((r.params as any).project),r.body,String(r.headers['idempotency-key']??'')));
    scope.get('/v1/file-uploads/:id',async r=>service.status(principal(r),ID.parse((r.params as any).id)));
    scope.post('/v1/file-uploads/:id/parts/:number',{bodyLimit:FILE_PART_BYTES},async r=>service.part(principal(r),ID.parse((r.params as any).id),Number((r.params as any).number),String(r.headers['x-part-sha256']??''),r.body as Readable,Number(r.headers['content-length'])));
    scope.post('/v1/file-uploads/:id/complete',async r=>service.complete(principal(r),ID.parse((r.params as any).id)));
    scope.post('/v1/file-uploads/:id/cancel',async r=>service.cancel(principal(r),ID.parse((r.params as any).id)));
    scope.get('/v1/preview-objects/:id',async(r,reply)=>{
      const p=principal(r);assertScope(p,'engine:read');
      const [rows]:any=await store.pool.query('SELECT doc FROM ae_preview_objects WHERE id=? AND tenant_id=? AND owner_id=? AND expires_at>?',[ID.parse((r.params as any).id),p.tenantId,p.ownerId,Date.now()]);
      if(!rows[0])throw new EngineError(404,'not_found','预览文件已过期');const doc=parse<any>(rows[0].doc);
      const range=r.headers.range;if(range&&!/^bytes=\d*-\d*$/.test(range))throw new EngineError(416,'invalid_range','无效范围');
      let object;try{object=await objects.get(doc.objectKey,range);}catch(error:any){if(error?.$metadata?.httpStatusCode===416)throw new EngineError(416,'invalid_range','请求范围超出文件长度');throw error;}reply.header('content-type',doc.mediaType).header('etag','"'+doc.sha256+'"').header('accept-ranges','bytes').header('cache-control','private, no-store').header('x-content-type-options','nosniff');
      if(object.ContentLength!==undefined)reply.header('content-length',object.ContentLength);if(object.ContentRange)reply.code(206).header('content-range',object.ContentRange);
      return reply.send(object.Body as Readable);
    });
  });
  let busy=false;const timer=setInterval(()=>{if(busy||process.env.FILE_TRANSFERS_ENABLED!=='true')return;busy=true;void service.tick().catch(()=>{}).finally(()=>{busy=false;});},1000);timer.unref();
  app.addHook('onClose',async()=>{clearInterval(timer);});
}
