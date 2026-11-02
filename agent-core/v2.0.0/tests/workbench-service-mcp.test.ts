import { listenHttp } from './http-listen.js';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createPlatformMcpServer } from '../src/platform-mcp-server.js';
let backend: Server, adapter: Server, client: Client | undefined, base: string, revoked: boolean;
const calls: any[] = [];
const listen = listenHttp;
const close = (server: Server) => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
beforeEach(async () => {
  revoked = false; calls.length = 0;
  backend = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push({ body, headers: req.headers });
    if (revoked || req.headers['x-service-token'] !== 'service-token') { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"msg":"revoked"}'); return; }
    res.setHeader('content-type', 'application/json');
    if (body.action === 'context') res.end(JSON.stringify({ releaseId: 'release-1', capabilities: [{ key: 'overview', name: '项目概览', channels: { mcp: true }, inputSchema: { type: 'object', additionalProperties: false }, pageKey: 'board' }, { key: 'private', channels: { mcp: false } }], pages: [{ key: 'board', name: '看板' }] }));
    else if (body.action === 'resource') res.end(JSON.stringify({ html: '<!doctype html><html><body>isolated</body></html>' }));
    else res.end(JSON.stringify({ operationId: 'operation-' + body.arguments.requestKey, status: 'pending', result: null }));
  });
  const businessUrl = await listen(backend);
  adapter = createPlatformMcpServer({ businessUrl, serviceKey: 'protocol-service-key-12345678901234567890' }); base = await listen(adapter);
});
afterEach(async () => { await client?.close(); client = undefined; await close(adapter); await close(backend); });
async function connect() { client = new Client({ name: 'service-acceptance', version: '1' }); await client.connect(new StreamableHTTPClientTransport(new URL(base + '/services/wb/mcp'), { fetch: (url, options) => fetch(url, { ...options, headers: { ...Object.fromEntries(new Headers(options?.headers)), authorization: 'Bearer service-token' } }) })); return client; }
it('discovers only published MCP capabilities and links allowed UI resources', async () => {
  const client = await connect(); const result = await client.listTools();
  expect(result.tools.some(t => t.name === 'overview')).toBe(true); expect(result.tools.some(t => t.name === 'private')).toBe(false);
  expect(result.tools.find(t => t.name === 'overview')?._meta).toEqual({ ui: { resourceUri: 'ui://workbench/release-1/board' } });
  expect(result.tools.find(t => t.name === 'overview')?.outputSchema?.properties).toHaveProperty('result');
  const resource = await client.readResource({ uri: 'ui://workbench/release-1/board' });
  expect(resource.contents[0]?.mimeType).toBe('text/html;profile=mcp-app');
  expect(resource.contents[0]?._meta).toEqual({ ui: { csp: { connectDomains: [], resourceDomains: [] } } });
  await expect(client.readResource({ uri: 'ui://workbench/another/board' })).rejects.toThrow();
});
it('uses ordinary tools/call with a public request key and a shared backend operation', async () => {
  const client = await connect();
  const argumentsValue = { requestKey: 'stable', body: { projectId: 'project', input: {} } };
  const first = await client.callTool({ name: 'overview', arguments: argumentsValue });
  const again = await client.callTool({ name: 'overview', arguments: argumentsValue });
  expect(first.structuredContent).toEqual(again.structuredContent);
  expect(first.structuredContent).toEqual({ operationId: 'operation-stable', status: 'pending', result: null });
  const executed = calls.filter(c => c.body.action === 'invoke');
  expect(executed).toHaveLength(2); expect(executed[0].body.arguments).toEqual(argumentsValue);
  expect(executed.every(c => c.headers.authorization === 'Bearer protocol-service-key-12345678901234567890')).toBe(true);
});
it('rejects unsupported tools and invalid inputs before executing a business action', async () => {
  const client = await connect();
  expect((await client.callTool({ name: 'private', arguments: {} })).isError).toBe(true);
  expect((await client.callTool({ name: 'overview', arguments: { body: { projectId: 'p', input: {} } } })).isError).toBe(true);
  expect(calls.some(c => c.body.action === 'invoke')).toBe(false);
});
it('revalidates the service grant for each protocol request and leaves the legacy health route intact', async () => {
  const client = await connect(); revoked = true;
  await expect(client.listTools()).rejects.toThrow();
  const health = await fetch(base + '/health/live'); expect(health.ok).toBe(true);
  expect((await fetch(base + '/services/wb/mcp')).status).toBe(405);
});
