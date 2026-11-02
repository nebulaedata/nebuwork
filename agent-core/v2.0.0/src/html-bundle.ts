import path from 'node:path';
import { build, transform, type Loader, type Plugin } from 'esbuild';
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { init, parse as imports } from 'es-module-lexer';
import { z } from 'zod';
import { EngineError, ID, assertScope, hash, type Principal, type Artifact } from './contracts.js';
import type { Store } from './store.js';
import type { Objects } from './objects.js';

export const HTML_BUNDLE_LIMITS = { files: 100, entryBytes: 2 * 1024 ** 2, inputBytes: 20 * 1024 ** 2, outputBytes: 32 * 1024 ** 2 };
const reference = z.object({ path: z.string().min(1).max(512), artifactId: ID, version: z.number().int().positive() }).strict();
export const htmlBundleSchema = z.object({ artifactId: ID, version: z.number().int().positive(), entryPath: z.string().min(1).max(512), resources: z.array(reference).max(99).default([]) }).strict();
type Element = DefaultTreeAdapterMap['element'];
type Node = DefaultTreeAdapterMap['node'];
type File = { bytes: Buffer; mediaType: string };
const fail = (message: string): never => { throw new EngineError(422, 'html_bundle_invalid', message); };
export function bundlePath(value: string) {
  if (!value || /[\\\u0000-\u001f:?#%]/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) fail('资源路径须为包内相对路径：' + value);
  return value;
}
function resolve(value: string, from: string) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value) || /[\\\u0000-\u001f]/.test(value)) fail('资源必须先提交为本地产物：' + value);
  let decoded: string;
  try { decoded = decodeURIComponent(value.split(/[?#]/)[0]!); } catch { return fail('资源 URL 无效：' + value); }
  const result = path.posix.normalize(decoded.startsWith('/') ? decoded.slice(1) : path.posix.join(path.posix.dirname(from), decoded));
  return bundlePath(result);
}
const attr = (el: Element, name: string) => el.attrs.find(a => a.name === name)?.value;
const remove = (el: Element, name: string) => { el.attrs = el.attrs.filter(a => a.name !== name); };
const set = (el: Element, name: string, value: string) => { remove(el, name); el.attrs.push({ name, value }); };
const content = (el: Element) => el.childNodes.map(n => 'value' in n ? n.value : '').join('');
const text = (el: Element, value: string) => { el.childNodes = [{ nodeName: '#text', value, parentNode: el }]; };
function detach(el: Element) { if (el.parentNode && 'childNodes' in el.parentNode) el.parentNode.childNodes = el.parentNode.childNodes.filter(n => n !== el); }
const utf8 = (file: File, name: string) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); } catch { return fail('文本资源必须为 UTF-8：' + name); } };
const mime = (name: string) => ({ '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.avif':'image/avif', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.otf':'font/otf' }[path.posix.extname(name).toLowerCase()]);

/** Pure compiler: no filesystem resolver, project plugins, package installation or code execution. */
export async function compileHtmlBundle(entry: string, files: Map<string, File>) {
  const read = (name: string) => {
    const file = files.get(name) ?? fail('缺少已提交的配套产物：' + name);
    if (/\.svg$/i.test(name)) {
      const svg = utf8(file, name);
      const refs = [...svg.matchAll(/(?:href|src)\s*=\s*["']([^"']*)["']|url\(\s*([^)]*)\)/gi)].map(m => (m[1] ?? m[2] ?? '').trim().replace(/^["']|["']$/g, ''));
      if (/@import\b/i.test(svg) || refs.some(value => value && !value.startsWith('#') && !value.startsWith('data:'))) fail('SVG 图片须自包含，请将嵌套资源内联后重新提交：' + name);
    }
    return file;
  };
  let generatedBytes = 0;
  const budget = (value: string) => { generatedBytes += Buffer.byteLength(value); if (generatedBytes > HTML_BUNDLE_LIMITS.outputBytes) throw new EngineError(413, 'html_bundle_limit', '打包页面超过 32 MiB'); return value; };
  const dataUrl = (value: string, from: string) => {
    if (value.startsWith('data:')) return value;
    const name = resolve(value, from), file = read(name), type = mime(name);
    if (!type) fail('不支持的静态资源类型：' + name);
    return budget('data:' + type + ';base64,' + file.bytes.toString('base64') + (value.includes('#') ? '#' + value.split('#').slice(1).join('#') : ''));
  };
  await init;
  const checkJs = (source: string, name: string) => {
    const [refs] = imports(source);
    if (refs.some(r => r.d >= 0 && !r.n)) fail('动态 import 必须使用固定路径：' + name);
    if (/new\s+URL\s*\([^)]*import\.meta\.url/.test(source)) fail('请将 new URL 资源改为静态 import 后重新提交：' + name);
  };
  const virtual = new Map<string, { source: string; loader: Loader; from: string }>();
  const plugin: Plugin = { name: 'fixed-artifacts-only', setup(api) {
    api.onResolve({ filter: /.*/ }, args => {
      if (virtual.has(args.path)) return { path: args.path, namespace: 'artifact' };
      if (args.kind === 'url-token' && args.path.startsWith('#')) return { path: args.path, external: true };
      if (args.path.startsWith('data:')) { if (args.kind !== 'url-token') fail('模块和样式导入须使用已提交的本地文件'); return { path: args.path, external: true }; }
      const from = virtual.get(args.importer)?.from ?? args.importer;
      if (!args.path.startsWith('.') && !args.path.startsWith('/') && !['entry-point','url-token','import-rule'].includes(args.kind)) fail('模块依赖须使用包内相对路径：' + args.path);
      const name = args.kind === 'entry-point' ? args.path : resolve(args.path, from);
      read(name);
      return { path: name, namespace: 'artifact' };
    });
    api.onLoad({ filter: /.*/, namespace: 'artifact' }, args => {
      const v = virtual.get(args.path);
      if (v) { if (v.loader === 'js') checkJs(v.source, v.from); return { contents: v.source, loader: v.loader }; }
      const f = read(args.path), ext = path.posix.extname(args.path).toLowerCase();
      if (['.js', '.mjs', '.css', '.json'].includes(ext)) {
        const source = utf8(f, args.path); if (ext === '.js' || ext === '.mjs') checkJs(source, args.path);
        return { contents: source, loader: ext === '.css' ? 'css' : ext === '.json' ? 'json' : 'js' };
      }
      if (!mime(args.path)) fail('不支持的静态资源类型：' + args.path);
      return { contents: f.bytes, loader: 'dataurl' };
    });
  } };
  let sequence = 0;
  const bundle = async (source: string, from: string, loader: 'js' | 'css') => {
    const name = 'nebu-internal:virtual-' + sequence++ + (loader === 'css' ? '.css' : '.js');
    virtual.set(name, { source, from, loader });
    const result = await build({ entryPoints: [name], bundle: true, write: false, outfile: 'bundle.' + loader, platform: 'browser', format: 'esm', target: 'es2020', legalComments: 'none', logLevel: 'silent', plugins: [plugin] });
    if (result.warnings.length) fail(result.warnings.map(w => w.text).join('; '));
    return { js: budget(result.outputFiles.find(f => f.path.endsWith('.js'))?.text ?? ''), css: budget(result.outputFiles.find(f => f.path.endsWith('.css'))?.text ?? '') };
  };
  const document = parse(utf8(read(entry), entry));
  const elements: Element[] = [];
  const inert = new Set<Element>();
  const walk = (n: Node, insideTemplate = false) => { if ('tagName' in n) { elements.push(n); if (insideTemplate) inert.add(n); } if ('childNodes' in n) n.childNodes.forEach(child => walk(child, insideTemplate)); if ('content' in n) walk((n as DefaultTreeAdapterMap['template']).content, true); };
  walk(document);
  const body = elements.find(e => e.tagName === 'body')!, head = elements.find(e => e.tagName === 'head')!;
  const append = (tagName: string, value: string, type?: string) => {
    const parentNode = tagName === 'style' ? head : body;
    const el: Element = { nodeName: tagName, tagName, attrs: type ? [{ name: 'type', value: type }] : [], namespaceURI: 'http://www.w3.org/1999/xhtml' as Element['namespaceURI'], childNodes: [], parentNode };
    text(el, value); parentNode.childNodes.push(el);
  };
  const modules: string[] = [], deferred: string[] = [];
  for (const el of elements) {
    if (el.tagName === 'base' || ['iframe','object','embed'].includes(el.tagName)) fail('页面不支持 base 或嵌入子页面');
    if (el.tagName === 'meta' && /refresh/i.test(attr(el, 'http-equiv') ?? '')) fail('页面不支持自动跳转');
    if (el.tagName === 'script') {
      if (inert.has(el)) fail('包含脚本的 template 暂不支持，请将脚本移至页面入口');
      const type = attr(el, 'type') ?? '';
      if (type && !['module','text/javascript','application/javascript'].includes(type)) {
        if (type === 'importmap' || attr(el, 'src')) fail('请将 importmap 或非标准脚本预先构建为静态模块');
        continue;
      }
      if (attr(el, 'async') !== undefined) fail('请移除 async 脚本属性后重新提交');
      const src = attr(el, 'src'), from = src ? resolve(src, entry) : entry;
      const source = src ? utf8(read(from), from) : content(el);
      checkJs(source, from);
      if (type === 'module') {
        const name = 'nebu-internal:module-' + sequence++ + '.js'; virtual.set(name, { source, from, loader: 'js' }); modules.push('import ' + JSON.stringify(name) + ';'); detach(el);
      } else {
        if (imports(source)[0].some(ref => ref.d !== -2)) fail('普通脚本含模块导入，请设为 type="module" 后重新提交：' + from);
        const result = await transform(source, { loader: 'js', target: 'es2020', legalComments: 'none' });
        const code = budget(result.code);
        if (src && attr(el, 'defer') !== undefined) { deferred.push(code); detach(el); }
        else { remove(el, 'src'); remove(el, 'integrity'); remove(el, 'crossorigin'); text(el, code); }
      }
    } else if (el.tagName === 'style' || el.tagName === 'link' && attr(el, 'rel')?.toLowerCase() === 'stylesheet') {
      const href = attr(el, 'href'), from = href ? resolve(href, entry) : entry;
      const result = await bundle(href ? utf8(read(from), from) : content(el), from, 'css');
      el.tagName = el.nodeName = 'style'; el.attrs = el.attrs.filter(a => ['media','nonce'].includes(a.name)); text(el, result.css.replace(/<\/style/gi, '<\\/style'));
    } else if (el.tagName === 'link') {
      if (/^(?:icon|shortcut icon)$/i.test(attr(el, 'rel') ?? '')) set(el, 'href', dataUrl(attr(el, 'href') ?? '', entry));
      else detach(el); // Preloads are unnecessary after bundling; no external requests survive.
    }
    for (const attribute of ['src','poster','background']) if (el.tagName !== 'script' && attr(el, attribute)) set(el, attribute, dataUrl(attr(el, attribute)!, entry));
    if (el.tagName === 'image' && attr(el, 'href')) set(el, 'href', dataUrl(attr(el, 'href')!, entry));
    if (el.tagName === 'use' && attr(el, 'href') && !attr(el, 'href')!.startsWith('#')) fail('SVG use 仅支持单页内的元素引用');
    if (attr(el, 'srcset')) {
      const value = attr(el, 'srcset')!;
      if (value.startsWith('data:')) { if (/\s\d+[wx]\s*,/.test(value)) fail('请将混合 data URL 的 srcset 拆为本地资源'); }
      else set(el, 'srcset', value.split(',').map(item => { const [url, ...descriptor] = item.trim().split(/\s+/); return [dataUrl(url!, entry), ...descriptor].join(' '); }).join(', '));
    }
    if (attr(el, 'style')) {
      const result = await bundle('x{' + attr(el, 'style')! + '}', entry, 'css');
      set(el, 'style', result.css.slice(result.css.indexOf('{') + 1, result.css.lastIndexOf('}')).trim());
    }
    if (el.tagName === 'a' && attr(el, 'href') && !attr(el, 'href')!.startsWith('#')) fail('首期仅支持单页内的锚点链接：' + attr(el, 'href'));
  }
  for (const source of deferred) append('script', source);
  if (modules.length) {
    const result = await bundle(modules.join('\n'), entry, 'js');
    if (result.css) append('style', result.css.replace(/<\/style/gi, '<\\/style'));
    append('script', result.js, 'module');
  }
  const html = serialize(document);
  if (Buffer.byteLength(html) > HTML_BUNDLE_LIMITS.outputBytes) throw new EngineError(413, 'html_bundle_limit', '打包页面超过 32 MiB');
  return html;
}

export async function createHtmlBundle(p: Principal, project: string, input: unknown, store: Pick<Store, 'artifact'>, objects: Pick<Objects, 'get' | 'authorize'>) {
  assertScope(p, 'engine:read', project);
  const request = htmlBundleSchema.parse(input), entryPath = bundlePath(request.entryPath);
  const refs = [{ path: entryPath, artifactId: request.artifactId, version: request.version }, ...request.resources];
  const files = new Map<string, File>(), source: unknown[] = [];
  let total = 0;
  for (const ref of refs) {
    const name = bundlePath(ref.path); if (files.has(name)) fail('重复的资源路径：' + name);
    const a: Artifact = await store.artifact(p, ref.artifactId, ref.version);
    if (a.projectId !== project || a.version !== ref.version) throw new EngineError(404, 'not_found', '成果版本不属于当前项目');
    if (name === entryPath && (!/\.html?$/i.test(name) || a.size <= 0 || a.size > HTML_BUNDLE_LIMITS.entryBytes)) fail('入口须为非空且不超过 2 MiB 的 HTML/HTM');
    if (a.size < 0 || total + a.size > HTML_BUNDLE_LIMITS.inputBytes) throw new EngineError(413, 'html_bundle_limit', '配套产物总计不能超过 20 MiB');
    objects.authorize(p.tenantId, p.ownerId, a.objectKey);
    const response = await objects.get(a.objectKey), parts: Buffer[] = []; let size = 0;
    for await (const part of response.Body as AsyncIterable<Uint8Array>) { const bytes = Buffer.from(part); size += bytes.length; if (size > a.size || total + size > HTML_BUNDLE_LIMITS.inputBytes) throw new EngineError(413, 'html_bundle_limit', '资源内容超过声明的大小'); parts.push(bytes); }
    const bytes = Buffer.concat(parts);
    if (size !== a.size || hash(bytes) !== a.sha256) throw new EngineError(502, 'object_corrupt', '产物内容校验失败');
    total += size; files.set(name, { bytes, mediaType: a.mediaType });
    source.push({ ...ref, sha256: a.sha256, size, mediaType: a.mediaType, sessionId: a.sessionId, runId: a.runId });
  }
  try {
    const html = await compileHtmlBundle(entryPath, files);
    return { html, sha256: hash(Buffer.from(html)), size: Buffer.byteLength(html), source: { kind: 'html-bundle', compilerVersion: 1, projectId: project, entryPath, artifactId: request.artifactId, version: request.version, files: source } };
  } catch (e) { if (e instanceof EngineError) throw e; return fail('页面静态资源无法打包：' + (e instanceof Error ? e.message : String(e))); }
}
