import type { IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ReadResourceRequestSchema, ListResourcesRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { PlatformMcpServerConfig } from './platform-mcp-server.js';

/** Public service MCP adapter. A service token is revalidated by Java for every action. */
export async function handleWorkbenchServiceMcp(config: PlatformMcpServerConfig, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const match = /^\/services\/([A-Za-z0-9_-]{1,128})\/mcp$/.exec(req.url ?? '');
  if (!match) return false;
  res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff');
  if (req.method !== 'POST') { res.writeHead(405, { allow: 'POST' }); res.end(); return true; }
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) { res.writeHead(401); res.end(); return true; }
  const workbenchId = match[1]!;
  const upstream = async (action: string, args: unknown = {}, name?: string): Promise<any> => {
    const response = await fetch(config.businessUrl.replace(/\/$/, '') + '/internal/workbench-services/protocol', {
      method: 'POST', headers: { authorization: 'Bearer ' + config.serviceKey, 'x-service-token': auth.slice(7), 'content-type': 'application/json' },
      body: JSON.stringify({ workbenchId, action, arguments: args, ...(name ? { name } : {}) }), redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    const value = await response.json() as any;
    if (!response.ok) { const error = new Error(value.msg ?? 'Service authorization or execution failed') as Error & { status: number }; error.status = response.status; throw error; }
    return value;
  };
  let server: Server | undefined, transport: StreamableHTTPServerTransport | undefined;
  try {
    const context = await upstream('context');
    const tools = context.capabilities.filter((c: any) => c.channels.mcp).map((c: any) => ({
      name: c.key, description: c.name + (c.description ? ': ' + c.description : ''),
      inputSchema: { type: 'object' as const, properties: { requestKey: { type: 'string', minLength: 1, maxLength: 128 }, body: { type: 'object', properties: { projectId: { type: 'string' }, releaseId: { type: 'string' }, input: c.inputSchema }, required: ['projectId', 'input'], additionalProperties: false } }, required: ['requestKey', 'body'], additionalProperties: false },
      outputSchema: { type: 'object' as const, properties: { operationId: { type: 'string' }, status: { type: 'string' }, result: { anyOf: [c.outputSchema ?? {}, { type: 'null' }] } }, required: ['operationId', 'status'] },
      ...(c.pageKey && context.pages.some((p: any) => p.key === c.pageKey) ? { _meta: { ui: { resourceUri: 'ui://workbench/' + context.releaseId + '/' + c.pageKey } } } : {}),
    }));
    const helpers: Record<string, { action: string; properties: Record<string, unknown>; required: string[] }> = {
      __service_operation_get: { action: 'operation.get', properties: { operationId: { type: 'string' } }, required: ['operationId'] },
      __service_operation_events: { action: 'operation.events', properties: { operationId: { type: 'string' }, after: { type: 'integer', minimum: 0 } }, required: ['operationId'] },
      __service_operation_command: { action: 'operation.command', properties: { operationId: { type: 'string' }, command: { type: 'object' }, requestKey: { type: 'string' } }, required: ['operationId', 'command', 'requestKey'] },
      __service_page_open: { action: 'page.open', properties: { pageKey: { type: 'string' }, body: { type: 'object' }, requestKey: { type: 'string' } }, required: ['pageKey', 'body', 'requestKey'] },
      __service_page_get: { action: 'page.get', properties: { instanceId: { type: 'string' } }, required: ['instanceId'] },
      __service_page_state: { action: 'page.state', properties: { instanceId: { type: 'string' }, body: { type: 'object' } }, required: ['instanceId', 'body'] },
    };
    const helperTools = Object.entries(helpers).map(([name, h]) => ({ name, description: 'Authorized page runtime: ' + h.action, inputSchema: { type: 'object' as const, properties: h.properties, required: h.required, additionalProperties: false }, _meta: { ui: { visibility: ['app'] } } }));
    const all = [...tools, ...helperTools], byName = new Map(all.map((t: any) => [t.name, t]));
    const validator = new AjvJsonSchemaValidator();
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) { size += Buffer.byteLength(chunk); if (size > 1048576) { res.writeHead(413); res.end(); return true; } chunks.push(Buffer.from(chunk)); }
    let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { res.writeHead(400); res.end(); return true; }
    server = new Server({ name: 'nebuwork-workbench-service', version: '1' }, { capabilities: { tools: {}, resources: {}, extensions: { 'io.modelcontextprotocol/ui': {} } } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: all }));
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: context.pages.map((p: any) => ({ uri: 'ui://workbench/' + context.releaseId + '/' + p.key, name: p.name, mimeType: 'text/html;profile=mcp-app' })) }));
    server.setRequestHandler(ReadResourceRequestSchema, async request => {
      const uri = request.params.uri, prefix = 'ui://workbench/' + context.releaseId + '/';
      if (!uri.startsWith(prefix) || !context.pages.some((p: any) => uri === prefix + p.key)) throw new Error('UI resource is not granted');
      const value = await upstream('resource', { releaseId: context.releaseId, pageKey: uri.slice(prefix.length) });
      return { contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: value.html, _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] } } } }] };
    });
    server.setRequestHandler(CallToolRequestSchema, async request => {
      const tool = byName.get(request.params.name) as any;
      if (!tool || !validator.getValidator(tool.inputSchema)(request.params.arguments ?? {}).valid) return { isError: true, content: [{ type: 'text' as const, text: 'Unknown tool or invalid arguments' }] };
      try { const helper = helpers[tool.name]; const value = await upstream(helper?.action ?? 'invoke', request.params.arguments ?? {}, helper ? undefined : tool.name); return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: value }; }
      catch (error) { return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] }; }
    });
    transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport?.close(); void server?.close(); });
    await server.connect(transport); await transport.handleRequest(req, res, body);
  } catch (error) { if (!res.headersSent) { res.writeHead((error as { status?: number }).status ?? 502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'workbench_service_unavailable' })); } else res.end(); }
  return true;
}
