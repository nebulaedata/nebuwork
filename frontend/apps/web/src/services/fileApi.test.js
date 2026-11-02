// @vitest-environment jsdom
import { File, Blob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFileApi, MAX_FILE_BYTES } from './fileApi.js';
beforeEach(()=>{localStorage.clear();vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>vi.unstubAllGlobals());
function setup() { let version=1;const subscribers=new Set(),auth={getSnapshot:()=>({version,user:{id:'alice'}}),subscribe:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn);},assertCurrent:v=>{if(v!==version)throw new DOMException('account changed','AbortError');}};const request=vi.fn();return {request,api:createFileApi(request,p=>'/gateway'+p,auth),changeAccount:()=>{version++;subscribers.forEach(fn=>fn());}}; }
const digest=async blob=>Buffer.from(await webcrypto.subtle.digest('SHA-256',await blob.arrayBuffer())).toString('hex');
it('keeps binary uploads chunked, bounds concurrent requests, and publishes confirmed progress',async()=>{
  const {api,request}=setup(),file=new File([new Uint8Array(20*1024*1024+1)],'large.csv',{lastModified:1});
  vi.spyOn(file,'arrayBuffer').mockRejectedValue(new Error('whole file must not be read'));
  const parts=[],progress=[];let active=0,peak=0;
  request.mockImplementation(async(path,o)=>{if(path.endsWith('/artifact-uploads'))return{data:{id:'upload',name:file.name,size:file.size,status:'uploading',partSize:16*1024*1024,parts:[]}};if(path.includes('/parts/')){active++;peak=Math.max(peak,active);expect(o.body.size).toBeLessThanOrEqual(16*1024*1024);expect(o.headers['X-Part-Sha256']).toBe(await digest(o.body));parts.push(o.body.size);active--;return{data:{}};}if(path.endsWith('/complete'))return{data:{status:'complete',result:{id:'artifact',version:1}}};throw Error(path);});
  expect((await api.uploadLargeArtifact('project',file,'task','stable-key',{onProgress:p=>progress.push(p)})).data).toEqual({id:'artifact',version:1});expect(parts.reduce((a,b)=>a+b,0)).toBe(file.size);expect(peak).toBeLessThanOrEqual(3);expect(progress.at(-1).confirmed).toBe(file.size);expect(file.arrayBuffer).not.toHaveBeenCalled();
});
it('recovers the original upload session and verifies previously confirmed bytes before resuming',async()=>{
  const {api,request}=setup(),file=new File(['first,last\n001,value\n'],'report.csv',{lastModified:2}),sha=await digest(file);
  request.mockResolvedValueOnce({data:{id:'upload',name:file.name,size:file.size,status:'uploading',partSize:16*1024*1024,parts:[]}}).mockRejectedValueOnce(new Error('lost response'));
  await expect(api.uploadLargeArtifact('p',file,undefined,'key')).rejects.toThrow('lost');request.mockReset();
  request.mockImplementation(async path=>path.endsWith('/complete')?{data:{status:'complete',result:{id:'done',version:1}}}:{data:{id:'upload',name:file.name,size:file.size,status:'uploading',partSize:16*1024*1024,parts:[{number:1,size:file.size,sha256:sha}]}});
  await api.uploadLargeArtifact('p',file,undefined,'another-key');expect(request.mock.calls[0][0]).toContain('/upload');expect(request.mock.calls.some(([path])=>path.endsWith('/artifact-uploads')||path.includes('/parts/'))).toBe(false);
});
it('refuses to resume a file with different content and stops after an account change',async()=>{
  const {api,request,changeAccount}=setup(),file=new File(['correct'],'report.csv',{lastModified:3});
  request.mockResolvedValue({data:{id:'u',name:file.name,size:file.size,status:'uploading',partSize:16*1024*1024,parts:[{number:1,size:file.size,sha256:'0'.repeat(64)}]}});
  await expect(api.uploadLargeArtifact('p',file,undefined,'key')).rejects.toThrow('内容');expect(request.mock.calls).toHaveLength(1);
  localStorage.clear();request.mockImplementation(async()=>{changeAccount();return{data:{id:'other'}};});await expect(api.uploadLargeArtifact('p',file)).rejects.toMatchObject({name:'AbortError'});
});
it('rejects one byte above 2 GiB before issuing requests',async()=>{const{api,request}=setup();await expect(api.uploadLargeArtifact('p',{size:MAX_FILE_BYTES+1})).rejects.toThrow('2048');expect(request).not.toHaveBeenCalled();});
it('uses resource IDs and gateway paths for preview, pagination and cell expansion',async()=>{const{api,request}=setup();request.mockResolvedValue({data:{}});await api.createFilePreview({kind:'artifact',projectId:'p',artifactId:'a',version:3},true);await api.filePreviewRows('preview','工作表',{row:201,column:50});await api.filePreviewCell('preview','0',201,50,16384);expect(JSON.parse(request.mock.calls[0][1].body).source.version).toBe(3);expect(api.filePreviewUrl('preview')).toBe('/gateway/api/file-previews/preview/content');expect(request.mock.calls[1][0]).toContain('row=201&column=50&limit=200&columns=50');});
