import { Readable } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { bundlePath, compileHtmlBundle, createHtmlBundle, HTML_BUNDLE_LIMITS } from '../src/html-bundle.js';
import { hash, type Artifact, type Principal } from '../src/contracts.js';
import { createApi } from '../src/api.js';
import { sign } from '../src/auth.js';
import { testConfig } from './fixture.js';

const file = (contents: string) => ({ bytes: Buffer.from(contents), mediaType: 'application/octet-stream' });
const principal: Principal = { service:'test', tenantId:'tenant', ownerId:'alice', projects:['project'], scopes:['engine:read'] };
function fixture() {
  const bytes = Buffer.from('<!doctype html><h1>fixed version</h1>');
  const a = { id:'entry', version:2, projectId:'project', tenantId:'tenant', ownerId:'alice', objectKey:'private/object', sha256:hash(bytes), size:bytes.length, mediaType:'text/html', sessionId:'session', runId:'run' } as Artifact;
  const store = { artifact:vi.fn(async () => a) }, objects = { authorize:vi.fn(), get:vi.fn(async () => ({ Body:Readable.from([bytes]) })) };
  const input = { artifactId:'entry', version:2, entryPath:'index.html', resources:[] };
  return { bytes, a, store, objects, input };
}
it('bundles nested CSS, fonts, images, JSON and module chunks with shared module initialization', async () => {
  const files = new Map([
    ['index.html',file('<!doctype html><link rel="stylesheet" href="css/main.css"><img src="img/a.svg"><div style="background:url(img/a.svg)"></div><script type="module" src="js/main.js"></script><script type="module" src="js/other.js"></script>')],
    ['css/main.css',file('@import "theme.css"; body{background:url(../img/a.svg)}')],
    ['css/theme.css',file('@font-face{font-family:TaskFont;src:url(../fonts/a.woff2)}')],
    ['fonts/a.woff2',file('testfont')],['img/a.svg',file('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['js/main.js',file('import "./shared.js"; import value from "./data.json"; import("./detail.js").then(m=>console.log(m.title,value));')],
    ['js/other.js',file('import "./shared.js";')],['js/shared.js',file('globalThis.initialized=(globalThis.initialized||0)+1;')],
    ['js/detail.js',file('export const title="报告";')],['js/data.json',file('{"total":42}')],
  ]);
  const html = await compileHtmlBundle('index.html',files);
  expect(html).toContain('data:image/svg+xml');expect(html).toContain('data:font/woff2');expect(html).toContain('42');
  expect(html).not.toMatch(/src="js|href="css|import\s*\(/);expect(html.match(/globalThis\.initialized =/g)).toHaveLength(1);
  expect(await compileHtmlBundle('index.html',files)).toBe(html);
});
it('preserves classic global scripts and moves deferred scripts after document content',async()=>{
  const html=await compileHtmlBundle('index.htm',new Map([['index.htm',file('<script src="classic.js"></script><script defer src="later.js"></script><div id="ready"></div>')],['classic.js',file('var reportCount=42;')],['later.js',file('document.getElementById("ready").textContent=reportCount;')]]));
  expect(html).toContain('var reportCount = 42');expect(html.indexOf('id="ready"')).toBeLessThan(html.indexOf('document.getElementById'));
});
it('keeps local SVG and CSS fragments while rejecting nested unbundled SVG resources',async()=>{
  const files=new Map([['index.html',file('<img src="a.svg"><style>body{filter:url("#shadow")}</style>')],['a.svg',file('<svg xmlns="http://www.w3.org/2000/svg"><path fill="url(#gradient)"/></svg>')]]);
  expect(await compileHtmlBundle('index.html',files)).toContain('#shadow');
  files.set('a.svg',file('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://cdn.invalid/image.png"/></svg>'));
  await expect(compileHtmlBundle('index.html',files)).rejects.toThrow('SVG 图片须自包含');
});
it('fails closed on missing, external and runtime module paths, escapes and unsupported navigation',async()=>{
  for(const [source,expected] of [
    ['<img src="missing.png">','missing.png'],['<script src="https://cdn.invalid/lib.js"></script>','本地'],
    ['<style>@import "https://cdn.invalid/a.css";</style>','本地'],['<img src="../private.png">','相对路径'],
    ['<script type="module">import(window.somePath)</script>','固定路径'],['<a href="next.html">next</a>','单页'],
    ['<base href="/">','base'],['<script async src="app.js"></script>','async'],
    ['<template><script>window.shouldNotRun=true</script></template>','template'],['<script>import("./detail.js")</script>','普通脚本'],
  ])await expect(compileHtmlBundle('index.html',new Map([['index.html',file(source)]]))).rejects.toThrow(expected);
  for(const path of ['../secret','a/../b','C:/secret','/etc/passwd','a\\b','a%2fb','a?b'])expect(()=>bundlePath(path)).toThrow();
});
it('reads only exact authorized artifact versions and returns immutable canonical provenance',async()=>{
  const f=fixture();const first=await createHtmlBundle(principal,'project',f.input,f.store,f.objects as any);
  expect(f.store.artifact).toHaveBeenCalledWith(principal,'entry',2);expect(first.sha256).toBe(hash(Buffer.from(first.html)));
  expect(first.source.files).toEqual([expect.objectContaining({artifactId:'entry',version:2,sha256:f.a.sha256})]);
  expect((await createHtmlBundle(principal,'project',f.input,f.store,f.objects as any)).html).toBe(first.html);
  expect(first.source).not.toHaveProperty('objectKey');
});
it('rejects cross-project reads, duplicate paths, corrupt bytes and size abuse before returning a page',async()=>{
  let f=fixture();await expect(createHtmlBundle({...principal,projects:['elsewhere']},'project',f.input,f.store,f.objects as any)).rejects.toMatchObject({status:404});expect(f.store.artifact).not.toHaveBeenCalled();
  f=fixture();f.a.projectId='other';await expect(createHtmlBundle(principal,'project',f.input,f.store,f.objects as any)).rejects.toMatchObject({status:404});expect(f.objects.get).not.toHaveBeenCalled();
  f=fixture();f.a.sha256=hash('wrong');await expect(createHtmlBundle(principal,'project',f.input,f.store,f.objects as any)).rejects.toMatchObject({status:502});
  f=fixture();f.a.size=HTML_BUNDLE_LIMITS.entryBytes+1;await expect(createHtmlBundle(principal,'project',f.input,f.store,f.objects as any)).rejects.toThrow('2 MiB');expect(f.objects.get).not.toHaveBeenCalled();
  f=fixture();await expect(createHtmlBundle(principal,'project',{...f.input,resources:[{path:'index.html',artifactId:'other',version:1}]},f.store,f.objects as any)).rejects.toThrow('重复');
  f=fixture();f.a.size=1;await expect(createHtmlBundle(principal,'project',f.input,f.store,f.objects as any)).rejects.toMatchObject({status:413});
});
it('exposes the signed API with strict versioned inputs and project authorization',async()=>{
  const f=fixture(),api=await createApi(testConfig,f.store as any,f.objects as any);
  try{
    const headers={authorization:'Bearer '+await sign(principal,testConfig.ENGINE_SIGNING_KEY),'idempotency-key':'html-bundle-test'};
    const request={method:'POST' as const,url:'/v1/projects/project/html-bundles',headers,payload:f.input};
    const result=await api.inject(request);expect(result.statusCode,result.body).toBe(200);expect(result.json().source.files[0].version).toBe(2);
    expect((await api.inject({...request,headers:{'idempotency-key':'none'}})).statusCode).toBe(401);
    expect((await api.inject({...request,url:'/v1/projects/other/html-bundles'})).statusCode).toBe(404);
    expect((await api.inject({...request,payload:{...f.input,version:undefined}})).statusCode).toBe(422);
  }finally{await api.close();}
});
