import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { Business } from './business.js';
import type { Run } from './contracts.js';
import type { PlatformTool } from './platform-mcp-server.js';

/** Per-run transport. Tokens stay in this closure; call IDs are supplied by the engine. */
export class PlatformMcpClient {
  private client?:Client; private token=''; private expires=0; private url='';
  tools:PlatformTool[]=[];
  constructor(private business:Business,private run:Run){}
  private async grant(){if(this.expires>Date.now()+30000)return;const grant=await this.business.request<{token:string;expiresAt:number;url:string}>('platform-mcp/grants',this.business.identity(this.run));this.token=grant.token;this.expires=grant.expiresAt;if(this.url&&this.url!==grant.url)throw new Error('Platform MCP endpoint changed during run');this.url=grant.url;}
  async connect(){await this.grant();this.client=new Client({name:'nebuwork-worker',version:'1'},{capabilities:{}});const transport=new StreamableHTTPClientTransport(new URL(this.url),{fetch:async(url,init)=>{await this.grant();const headers=new Headers(init?.headers);headers.set('authorization',`Bearer ${this.token}`);return fetch(url,{...init,headers,redirect:'error'});},reconnectionOptions:{maxRetries:0,initialReconnectionDelay:1000,maxReconnectionDelay:1000,reconnectionDelayGrowFactor:1}});await this.client.connect(transport);let cursor:string|undefined;do{const result=await this.client.listTools(cursor?{cursor}:{});this.tools.push(...result.tools as PlatformTool[]);cursor=result.nextCursor;}while(cursor);return this.tools;}
  definitions():ToolDefinition[]{return this.tools.map(tool=>({name:`mcp__nebuwork__${tool.name}`,label:tool.description??tool.name,description:tool.description??tool.name,parameters:tool.inputSchema as ToolDefinition['parameters'],execute:async(callId,args,signal)=>{const result=await this.client!.callTool({name:tool.name,arguments:args as Record<string,unknown>,_meta:{'cn.nebulaedata/callId':callId}},undefined,{signal,timeout:35000});if(result.isError)throw new Error((result.content as {type:string;text?:string}[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')||'系统 MCP 业务调用失败');return {content:result.content as any,structuredContent:result.structuredContent as any,details:{platformMcp:true,tool:tool.name}};}}));}
  replay(name:string){return this.tools.find(t=>`mcp__nebuwork__${t.name}`===name)?.replay;}
  async authorize(name:string,args:unknown,callId?:string){await this.business.request('platform-mcp/authorize',{...this.business.identity(this.run),name:name.replace('mcp__nebuwork__',''),arguments:args,callId});}
  async reconcile(name:string,callId:string){const result=await this.business.request<{status:'completed'|'not_started'|'unknown';result?:unknown}>('platform-mcp/reconcile',{...this.business.identity(this.run),name:name.replace('mcp__nebuwork__',''),callId});return result.status==='completed'?{...result,result:{content:[{type:'text',text:JSON.stringify(result.result)}],structuredContent:result.result,details:{platformMcp:true}}}:result;}
  async close(){await this.client?.close();this.token='';this.expires=0;}
}
