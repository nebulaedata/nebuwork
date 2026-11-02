import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const folder = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(folder, '../..');
const javaBase = 'nebuwork-backend-api/src/main/java/cn/nebulaedata/cccs/nebuwork/backend/api/';
const sets = [
  {name:'NebuWorkAgent',root:project,files:[
    'README.md','apps/web/vite.config.mjs','apps/web/worker/index.js',
    'apps/web/src/services/apiEndpoint.js','apps/web/src/services/agentApi.js',
    'apps/web/src/services/authApi.js','docs/agent-engine-delivery.md',
    'docs/platform-mcp-delivery.md','docs/knowledge-full-delivery.md',
    'docs/knowledge-v100-delivery.md','docs/workflow-integration-delivery.md',
    'docs/unified-memory-delivery.md','docs/workbench-delivery.md',
    'docs/unified-auth-migration.md','docs/workbench-service-delivery.md'
  ]},
  {name:'NebuAgentCoreNew2',root:'D:/Work/Code/AiCode/NebuAgentCoreNew2',files:[
    'README.md','docs/architecture.md','deploy/compose.yml','src/main.ts',
    'src/store.ts','src/runtime.ts','src/worker.ts','src/sandbox.ts',
    'src/objects.ts','src/api.ts'
  ]},
  {name:'Java backend',root:'D:/Work/Code/cccs/content-cloud-cluster-service',files:[
    'nebuwork-backend-api/src/main/resources/application.yml',
    javaBase+'agent/AgentBridge.java',javaBase+'agent/AgentBridgeController.java',
    javaBase+'agent/AgentClient.java',javaBase+'workflow/WorkflowClient.java',
    javaBase+'memory/MemoryRuntime.java',javaBase+'memory/HindsightClient.java',
    javaBase+'memory/MemoryWorker.java'
  ]},
  {name:'Workflow 3.5',root:'D:/Work/Code/AiCode/nebulae-ai-platform-v3.5',files:[
    'README.md','nebulae/api.py','nebulae/engine.py','nebulae/store.py'
  ]},
  {name:'WeKnora',root:'D:/Work/Code/AiCode/nebulae-weknora',files:[
    'docker-compose.yml','internal/router/routes_knowledge.go',
    'website-docs/04-api/03-external-integration.md'
  ]}
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const repositories = sets.map(({name,root,files})=>{
  const git = args => execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  let origin = null;
  try {origin=git(['remote','get-url','origin']).replace(/(https?:\/\/)[^/@\s]+@/,'$1');} catch {}
  return {name,root,revision:git(['rev-parse','HEAD']),origin,files:files.map(relative=>{
    const bytes=fs.readFileSync(path.join(root,relative));
    let headBytes=null;
    try {headBytes=execFileSync('git',['show',`HEAD:${relative}`],{cwd:root,stdio:['ignore','pipe','pipe']});} catch {}
    const normalized=b=>b?.toString('utf8').replace(/\r\n/g,'\n');
    return {path:relative,sha256:sha(bytes),lines:bytes.toString('utf8').split(/\r?\n/).length,
      basis:headBytes&&normalized(bytes)===normalized(headBytes)?'unchanged committed source':'working-tree source; not represented as HEAD evidence',
      headSha256:headBytes?sha(headBytes):null};
  })};
});
const record={schemaVersion:1,recordedAt:new Date().toISOString(),
  scope:'Current local source and checked-in deployment configuration; no live infrastructure inventory.',
  artifact:'nebuwork-system.html',primarySourceMode:'Git-verified local-only Archify citations in NebuWorkAgent; cross-repository details verified against the working-tree files listed here.',
  facts:[
    {claim:'API x2, Worker x3, independent migrate, external MySQL/Redis/S3, Worker-only Docker socket',repository:'NebuAgentCoreNew2',path:'deploy/compose.yml'},
    {claim:'Both API and Worker roles publish transactional outbox notifications; Worker also scans SQL every 500 ms',repository:'NebuAgentCoreNew2',path:'src/main.ts',line:27,end_line:47},
    {claim:'SQL is the execution authority, sessions are claimed with SKIP LOCKED, tools/checkpoints persist',repository:'NebuAgentCoreNew2',path:'src/store.ts',line:416,end_line:590},
    {claim:'Separate per-run task containers',repository:'NebuAgentCoreNew2',path:'src/sandbox.ts',line:35,end_line:88},
    {claim:'Java validates scope and dispatches knowledge, Workflow and memory callbacks',repository:'Java backend',path:javaBase+'agent/AgentBridge.java',line:83,end_line:119},
    {claim:'Workflow uses its own SQLite runtime rather than the New2 execution database',repository:'Workflow 3.5',path:'nebulae/engine.py',line:22,end_line:22},
    {claim:'Knowledge service stack supports optional graph/vector/object-store profiles; this artifact merges that internal topology',repository:'WeKnora',path:'docker-compose.yml'}
  ],repositories};
fs.writeFileSync(path.join(folder,'evidence.json'),JSON.stringify(record,null,2)+'\n');
console.log(JSON.stringify({evidence:path.join(folder,'evidence.json'),repositories:repositories.length,sourceFiles:repositories.reduce((sum,r)=>sum+r.files.length,0)}));
