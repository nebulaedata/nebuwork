import { afterEach, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { McpClient, type McpTransport } from '@earendil-works/pi-mcp';
import { listenHttp } from './http-listen.js';
import { mcpExtension, RefreshingMcpTransport } from '../src/mcp.js';

const captured = vi.hoisted(() => ({ options: undefined as any }));
vi.mock('@earendil-works/pi-coding-agent', () => ({ createMcpExtension: (options: any) => { captured.options = options; return () => {}; } }));
afterEach(() => { vi.unstubAllGlobals(); });
const run = { id: 'run', workerId: 'worker', fence: 4 } as any;
async function transport(mcp: any, business: any, sandbox: any, onStatus = vi.fn(async () => {})) {
  await mcpExtension({ mcp: [mcp] } as any, run, business, sandbox, onStatus);
  return captured.options.createTransport({ name: mcp.id }) as McpTransport;
}
it('refreshes HTTP headers for each request/reconnection and refuses redirects', async () => {
  const sent: RequestInit[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_: any, init: RequestInit) => { sent.push(init); return new Response(null, { status: 202 }); }));
  let key = 'first';
  const business = { credential: vi.fn(async () => ({ headers: { Authorization: key } })) };
  const connection = await transport({ id: 'market-mcp-ext', transport: 'http', url: 'https://mcp.test/api', args: [], credentialRef: 'market-mcp:installation' }, business, {});
  await connection.start(); connection.setProtocolVersion?.('2025-03-26');
  await connection.send({ jsonrpc: '2.0', method: 'notifications/test' });
  key = 'rotated';
  await connection.send({ jsonrpc: '2.0', method: 'notifications/test' });
  expect(sent.map(init => new Headers(init.headers).get('authorization'))).toEqual(['first', 'rotated']);
  expect(new Headers(sent[1]!.headers).get('mcp-protocol-version')).toBe('2025-03-26');
  expect(sent.every(init => init.redirect === 'error')).toBe(true);
  expect(business.credential).toHaveBeenLastCalledWith(run, 'market-mcp:installation', 'mcp', 'worker_http');
  await connection.close();
});
it('keeps managed stdio credentials out of the task sandbox and closes its container once', async () => {
  const isolated = { stdio: vi.fn(async () => ({ input: new PassThrough(), output: new PassThrough(), error: new PassThrough() })), close: vi.fn(async () => {}) };
  const task = { stdio: vi.fn(), isolatedMcp: vi.fn(async () => isolated) };
  const business = { credential: vi.fn(async () => ({ env: { API_KEY: 'shared-secret' } })) };
  const onStatus = vi.fn(async () => {});
  const connection = await transport({ id: 'managed', transport: 'stdio', command: 'node', args: ['server.js'], credentialRef: 'market-mcp:installation' }, business, task, onStatus);
  await connection.start();
  expect(task.stdio).not.toHaveBeenCalled();
  expect(isolated.stdio).toHaveBeenCalledWith('node', ['server.js'], { API_KEY: 'shared-secret' });
  expect(business.credential).toHaveBeenCalledWith(run, 'market-mcp:installation', 'mcp', 'isolated_stdio');
  await connection.close(); await connection.close();
  expect(isolated.close).toHaveBeenCalledTimes(1);
  expect(onStatus).toHaveBeenCalledWith('managed', 'unavailable');
});
it('fails closed without isolation and leaves manual stdio compatible', async () => {
  const business = { credential: vi.fn(async () => ({ env: { TOKEN: 'manual' } })) };
  const task = { stdio: vi.fn(async () => ({ input: new PassThrough(), output: new PassThrough(), error: new PassThrough() })) };
  const managed = await transport({ id: 'managed', transport: 'stdio', command: 'node', args: [], credentialRef: 'market-mcp:installation' }, business, task);
  await expect(managed.start()).rejects.toThrow('MCP authentication or connection unavailable');
  expect(business.credential).not.toHaveBeenCalled(); expect(task.stdio).not.toHaveBeenCalled();
  const manual = await transport({ id: 'manual', transport: 'stdio', command: 'node', args: [], credentialRef: 'personal' }, business, task);
  await manual.start(); expect(task.stdio).toHaveBeenCalledWith('node', [], { TOKEN: 'manual' }); await manual.close();
});
it('reclaims a container even when cancellation races with authentication/container creation', async () => {
  let complete!: (value: any) => void;
  const dispose = vi.fn(async () => {}), inner = { close: vi.fn(async () => {}) } as any;
  const connection = new RefreshingMcpTransport(() => new Promise(resolve => { complete = resolve; }));
  const starting = connection.start();
  await connection.close(); complete({ transport: inner, dispose });
  await expect(starting).rejects.toThrow('MCP authentication or connection unavailable');
  expect(inner.close).toHaveBeenCalled(); expect(dispose).toHaveBeenCalledTimes(1);
});
it('authenticates real HTTP MCP initialization and tool calls, then rotates credentials without interrupting the client', async () => {
  let expected = 'first', available = true;
  const received: string[] = [];
  const server = createServer(async (req, res) => {
    received.push(String(req.headers.authorization));
    if (req.headers.authorization !== expected) { res.writeHead(401); res.end(); return; }
    if (req.method === 'GET') { res.writeHead(405); res.end(); return; }
    if (req.method === 'DELETE') { res.writeHead(204); res.end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!('id' in body)) { res.writeHead(202); res.end(); return; }
    const result = body.method === 'initialize' ? { protocolVersion: body.params.protocolVersion, serverInfo: { name: 'authenticated-test', version: '1' }, capabilities: { tools: {} } }
      : body.method === 'tools/list' ? { tools: [{ name: 'check', description: 'Check', inputSchema: { type: 'object', properties: {} } }] }
      : { content: [{ type: 'text', text: 'authenticated' }] };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  const base = await listenHttp(server), client = new McpClient({ name: 'market-test', version: '1', requestTimeoutMs: 2000 });
  try {
    const business = { credential: vi.fn(async () => { if (!available) throw Error('Lease lost'); return { headers: { Authorization: expected } }; }) };
    await client.connect(await transport({ id: 'managed', transport: 'http', url: base + '/mcp', args: [], credentialRef: 'market-mcp:installation' }, business, {}));
    expect((await client.listTools()).map(tool => tool.name)).toEqual(['check']);
    expected = 'rotated';
    expect((await client.callTool('check', {})).content).toEqual([{ type: 'text', text: 'authenticated' }]);
    expect(received.at(-1)).toBe('rotated'); expect(client.connectionState).toBe('connected');
    available = false; const before = received.length;
    await expect(client.callTool('check', {})).rejects.toThrow(); expect(received).toHaveLength(before);
  } finally { await client.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
