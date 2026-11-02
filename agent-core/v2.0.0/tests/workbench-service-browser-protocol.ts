import { createUuid } from '../src/uuid.js';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
// Real HTTP Java -> official MCP adapter -> Java integration against the disposable browser fixture.
const metadata = JSON.parse(await readFile(process.env.SERVICE_BROWSER_METADATA ?? '.qa/workbench-service-browser.json', 'utf8'));
const root = 'http://127.0.0.1:42024/nwaa';
async function call(path: string, body?: unknown) {
  const response = await fetch(root + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { token: 'alice-token', 'content-type': 'application/json', 'Idempotency-Key': createUuid() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json() as any; assert.ok(response.ok, JSON.stringify(value)); return value.data;
}
const scope = { capabilities: ['overview', 'rename'], pages: ['board'], projects: [metadata.projectId], redirectUris: ['http://localhost:8760/callback'], origins: ['http://localhost:8760'] };
const app = await call('/workbenches/' + metadata.workbenchId + '/service/apps', { name: 'Isolated MCP consumer', enabled: true, scope });
const response = await fetch(root + '/api/service-oauth/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: app.id, client_secret: app.clientSecret }) });
const grant = await response.json() as any; assert.equal(response.status, 200);
const client = new Client({ name: 'isolated-service-protocol', version: '1' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(root + '/api/workbench-services/' + metadata.workbenchId + '/mcp'), { requestInit: { headers: { authorization: 'Bearer ' + grant.access_token } } }));
  const tools = await client.listTools(); assert.ok(tools.tools.some(t => t.name === 'overview'));
  const result = await client.callTool({ name: 'overview', arguments: { requestKey: createUuid(), body: { projectId: metadata.projectId, input: {} } } });
  assert.equal(result.isError, undefined); assert.equal((result.structuredContent as any).status, 'succeeded'); assert.equal((result.structuredContent as any).result.id, metadata.projectId);
  const resources = await client.listResources(); assert.equal(resources.resources.length, 1);
  const ui = await client.readResource({ uri: resources.resources[0]!.uri }); assert.equal(ui.contents[0]!.mimeType, 'text/html;profile=mcp-app'); assert.ok(String((ui.contents[0] as any).text).includes('NebuService'));
  await call('/workbenches/' + metadata.workbenchId + '/service/apps', { id: app.id, revision: app.revision, name: app.name, enabled: false, scope });
  await assert.rejects(() => client.listTools());
  const reportPath = process.env.SERVICE_PROTOCOL_REPORT ?? '.qa/workbench-service-protocol.json';
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ status: 'passed', service: metadata.workbenchId, toolCount: tools.tools.length, resourceCount: resources.resources.length, revokedGrantRejected: true }, null, 2));
  console.log('PASS: real Java HTTP -> official MCP SDK -> shared business execution; UI resource and grant revocation verified.');
} finally { await client.close().catch(() => {}); }
