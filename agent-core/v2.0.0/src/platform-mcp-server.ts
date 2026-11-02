import { handleWorkbenchServiceMcp } from './workbench-service-mcp.js';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ReadResourceRequestSchema, ListResourcesRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';

export interface PlatformMcpServerConfig { businessUrl: string; serviceKey: string; host?: string; port?: number }
export interface PlatformTool extends Tool { group?: string; replay?: 'read'|'idempotent'|'reconcile'; write?: boolean }
export const PLATFORM_MCP_PROTOCOL_VERSION='2025-11-25';
/** Stateless protocol adapter. All identity, schemas and business operations are owned by Java. */
export function createPlatformMcpServer(config: PlatformMcpServerConfig): HttpServer {
  if (config.serviceKey.length < 32) throw new Error('PLATFORM_MCP_SERVICE_KEY must have at least 32 characters');
  const base = new URL(config.businessUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid business URL');
  const validator = new AjvJsonSchemaValidator();
  const upstream = async (token: string, path: string, body: unknown) => {
    const response = await fetch(`${config.businessUrl.replace(/\/$/,'')}/internal/platform-mcp/${path}`, {
      method:'POST', headers:{authorization:`Bearer ${config.serviceKey}`,'X-Platform-Mcp-Grant':token,'content-type':'application/json'},
      body:JSON.stringify(body), redirect:'error', signal:AbortSignal.timeout(30000),
    });
    const result = await response.json() as any;
    if (!response.ok) { const error = new Error(result.msg ?? result.error?.message ?? `Business service returned ${response.status}`) as Error & {status:number}; error.status=response.status; throw error; }
    return result;
  };
  return createServer(async (req,res) => {
    if(await handleWorkbenchServiceMcp(config,req,res)) return;
    if (req.url === '/health/live' && req.method === 'GET') { res.setHeader('content-type','application/json');res.end('{"status":"ok","service":"nebuwork-platform-mcp"}');return; }
    if (req.url !== '/mcp') {res.writeHead(404);res.end();return;}
    res.setHeader('cache-control','no-store');res.setHeader('x-content-type-options','nosniff');
    if(req.headers.origin || req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
    if(req.method!=='POST'){res.writeHead(405,{allow:'POST'});res.end();return;}
    const auth=req.headers.authorization;
    if(!auth?.startsWith('Bearer ')){res.writeHead(401);res.end();return;}
    const token=auth.slice(7);
    let server:Server|undefined,transport:StreamableHTTPServerTransport|undefined;
    try {
      const context = await upstream(token,'context',{});
      const tools = context.tools as PlatformTool[];
      const byName = new Map(tools.map(t=>[t.name,t]));
      const chunks:Buffer[]=[];let size=0;
      for await(const chunk of req){size+=Buffer.byteLength(chunk);if(size>1048576){res.writeHead(413);res.end();return;}chunks.push(Buffer.from(chunk));}
      let body:unknown;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{res.writeHead(400);res.end();return;}
      const message=body as {method?:string;params?:{protocolVersion?:string}};
      if(req.headers['mcp-protocol-version']&&req.headers['mcp-protocol-version']!==PLATFORM_MCP_PROTOCOL_VERSION||message?.method==='initialize'&&message.params?.protocolVersion!==PLATFORM_MCP_PROTOCOL_VERSION){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:'unsupported_protocol_version',supported:PLATFORM_MCP_PROTOCOL_VERSION}));return;}
      server = new Server({name:'nebuwork-platform-mcp',version:String(context.catalogVersion)},{capabilities:{tools:{},resources:{}}});
      server.setRequestHandler(ListToolsRequestSchema,async()=>({tools}));
      server.setRequestHandler(ListResourcesRequestSchema,async()=>({resources:[]}));
      server.setRequestHandler(CallToolRequestSchema,async request=>{
        const tool=byName.get(request.params.name);
        if(!tool) return {isError:true,content:[{type:'text' as const,text:'Tool is not granted or implemented'}]};
        const checked=validator.getValidator(tool.inputSchema as any)(request.params.arguments??{});
        if(!checked.valid)return {isError:true,content:[{type:'text' as const,text:'Invalid tool arguments'}]};
        const callId=request.params._meta?.['cn.nebulaedata/callId'];
        if(typeof callId!=='string'||!callId||callId.length>255)return {isError:true,content:[{type:'text' as const,text:'Engine call identity is required'}]};
        try{
          const result=await upstream(token,'execute',{name:tool.name,arguments:request.params.arguments??{},callId});
          if(tool.outputSchema&&!validator.getValidator(tool.outputSchema as any)(result).valid)throw new Error('Invalid business tool output');
          return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};
        }catch(error){return {isError:true,content:[{type:'text' as const,text:(error as Error).message}]};}
      });
      server.setRequestHandler(ReadResourceRequestSchema,async request=>{
        const result=await upstream(token,'resources/read',{uri:request.params.uri});
        if(result.nextOffset!=null)return {contents:[{uri:request.params.uri,mimeType:'application/json',text:JSON.stringify({...result,continuation:{tool:'nw_resource_read',arguments:{uri:request.params.uri,offset:result.nextOffset,limit:65536}}})}]};
        return {contents:[{uri:request.params.uri,mimeType:result.mimeType??'application/json',...(result.encoding==='base64'?{blob:result.data}:{text:result.encoding==='utf8'?result.text:JSON.stringify(result)})}]};
      });
      transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
      res.on('close',()=>{void transport?.close();void server?.close();});
      await server.connect(transport);
      await transport.handleRequest(req,res,body);
    }catch(error){if(!res.headersSent){res.writeHead((error as {status?:number}).status??502,{'content-type':'application/json'});res.end(JSON.stringify({error:'platform_mcp_unavailable'}));}else res.end();}
  });
}
