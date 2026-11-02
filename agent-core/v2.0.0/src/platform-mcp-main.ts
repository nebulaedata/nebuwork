import { createPlatformMcpServer } from './platform-mcp-server.js';
const server=createPlatformMcpServer({businessUrl:process.env.BUSINESS_API_URL??'',serviceKey:process.env.PLATFORM_MCP_SERVICE_KEY??''});
const host=process.env.PLATFORM_MCP_HOST??'127.0.0.1',port=Number(process.env.PLATFORM_MCP_PORT??42120);
server.listen(port,host,()=>process.stdout.write(`NebuWork platform MCP listening on ${host}:${port}\n`));
process.on('SIGTERM',()=>server.close());process.on('SIGINT',()=>server.close());
