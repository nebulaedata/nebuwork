// Uses a supplied fixture and a disposable library. Use a store-only .bin ZIP to avoid model calls.
import { readFileSync, statSync, createReadStream, openAsBlob } from 'node:fs';
import { createHash, randomUUID, publicEncrypt, constants } from 'node:crypto';
import { basename, resolve } from 'node:path';

const fixture = resolve(process.argv[2] || 'deploy/dev/generated/knowledge-upload-768m-20261027.zip');
const size = statSync(fixture).size;
if (size <= 100 * 1024 * 1024 || size > 2 * 1024 ** 3) throw Error('Supply a fixture above 100 MiB and at most 2 GiB');
const env = Object.fromEntries(readFileSync(new URL('.env', import.meta.url), 'utf8').split(/\r?\n/).filter(s => s && !s.startsWith('#')).map(s => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
const base = `http://localhost:${env.DEV_HTTP_PORT}/nebulaedev/nwaa/api`;
let cookie = '', connection, kb;
async function api(path, body) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  const result = await response.json();
  if (!response.ok || result.code !== 0) throw Error(path + ': ' + result.msg);
  return result.data;
}
try {
  const publicKey = await api('/auth/public-key');
  await api('/auth/login', { account: env.DEV_ADMIN_ACCOUNT, encryptedPassword: publicEncrypt({ key: publicKey.publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(env.DEV_ADMIN_PASSWORD)).toString('base64') });
  connection = (await api('/knowledge-mcp/connections')).find(c => c.driver === 'nebulae-v101-rest' && c.enabled);
  if (!connection) throw Error('No active V101 connection');
  const management = '/knowledge-mcp/connections/' + connection.id + '/manage';
  const created = await api(management, { operation: 'kb.create', requestKey: randomUUID(), payload: { name: '大文件上传临时验收-' + randomUUID().slice(0, 8), config: { wiki_enabled: false, graph_enabled: false, image_caption: false, image_embedding: false, outline_enabled: false } } });
  kb = created.result.data;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(fixture)) hash.update(chunk);
  const digest = hash.digest('hex');
  const form = new FormData();
  form.set('file', await openAsBlob(fixture, { type: 'application/zip' }), basename(fixture));
  form.set('fileName', basename(fixture));
  form.set('relativePath', '验收资料/' + basename(fixture));
  form.set('collectionId', kb.id);
  form.set('requestKey', randomUUID());
  console.log(`Uploading ${(size / 1024 ** 2).toFixed(1)} MiB through the main frontend proxy and Java multipart endpoint...`);
  const start = Date.now();
  const response = await fetch(base + '/knowledge-mcp/connections/' + connection.id + '/upload', { method: 'POST', headers: { Cookie: cookie }, body: form, signal: AbortSignal.timeout(300000) });
  const result = await response.json();
  if (!response.ok || result.code !== 0) throw Error('Upload: ' + result.msg);
  const documentId = result.data.result.data.knowledge_id;
  const documents = (await api(management, { operation: 'documents.list', collectionId: kb.id, page: 1, pageSize: 100 })).result.data;
  const document = documents.find(item => item.id === documentId);
  if(!document) throw Error('Uploaded document missing from the version-enriched listing');
  if (document.size !== size || document.hash !== digest || document.relative_path !== '验收资料/' + basename(fixture)) throw Error('Stored size, SHA-256 or relative path differs');
  console.log(`Large upload passed in ${((Date.now() - start) / 1000).toFixed(1)} s: ${size} bytes, exact SHA-256 and folder path verified.`);
} finally {
  if (kb) await api('/knowledge-mcp/connections/' + connection.id + '/manage', { operation: 'kb.delete', collectionId: kb.id, requestKey: randomUUID(), payload: {} });
  if (cookie) await api('/auth/logout', {}).catch(() => {});
}
