import fs from 'node:fs';
const base='.archify/architecture-nebuwork-system-20261019-123627';
const dest='.archify/architecture-nebuwork-layered-20261019-125100';
fs.mkdirSync(dest,{recursive:true});
const prior=JSON.parse(fs.readFileSync(base+'/candidate.json','utf8'));
const nodes=Object.fromEntries(prior.components.map(c=>[c.id,c]));
const configure=(id,label,sublabel,pos,size=[210,100])=>Object.assign(nodes[id],{label,sublabel,pos,size});
configure('web','浏览器 · React 工作台','开发 :5173 / 生产静态资源',[40,60]);
configure('gateway','业务网关 :42000','/nebulaedev → /nwaa',[440,60],[240,100]);
configure('identity','统一账号与会话','用户服务 / Redis token',[940,60]);
configure('business-db','业务 MySQL','nebuwork_1 / nw_*',[40,360]);
configure('java','Java 业务 API :42020','nebuwork-backend-api /nwaa',[440,360],[260,110]);
nodes.nacos={id:'nacos',type:'cloud',label:'既有 Nacos 配置中心',sublabel:'DB / Redis 基础连接与管理员',tag:'引擎连接在业务数据库中维护',pos:[940,360],size:[210,110],sources:[{path:'docs/workbench-delivery.md',line:87,end_line:92},{path:'docs/unified-auth-migration.md',line:20,end_line:22},{path:'docs/workflow-integration-delivery.md',line:25,end_line:32}]};
configure('engine-api','New2 API × 2',':42110 / :42111 · /v1',[40,700]);
configure('worker','Worker × 3 · pi SDK','Linux Docker / 每实例并发 2',[340,700]);
configure('sandbox','Run / 专家任务容器','独立工作区 / 文件与命令',[640,700]);
configure('platform-mcp','系统 MCP :42120','独立 HTTP 协议适配进程',[940,700]);
configure('engine-db','引擎 MySQL 8','ae_* / Run·事件·检查点',[40,1030]);
configure('engine-redis','Redis 通知','异步唤醒 / SQL 扫描兜底',[340,1030]);
configure('objects','S3 / MinIO','资源包·工作区·成果正文',[640,1030]);
configure('knowledge','知识库 · WeKnora','Go :8080 可配置 / 知识内容',[40,1390]);
configure('workflow','Workflow 3.5','Python :8765 / DAG 执行',[340,1390]);
configure('memory','记忆 · Hindsight','REST / 五类范围 Bank',[640,1390]);
configure('model','模型供应商 / 模型网关','Worker 直连 / 流式响应',[940,1390]);
const edges=[
 ['web-request','web','gateway','REST / Cookie','emphasis'],
 ['gateway-business','gateway','java','/nwaa/api','emphasis'],
 ['gateway-auth','gateway','identity','统一登录','security'],
 ['java-session','java','identity','会话校验','security'],
 ['business-state','java','business-db','业务 SQL'],
 ['deployment-config','java','nacos','基础配置'],
 ['create-run','java','engine-api','JWT / 幂等 Run','emphasis'],
 ['persist-run','engine-api','engine-db','Run / 事件','emphasis'],
 ['claim-run','worker','engine-db','领取 / 检查点','emphasis'],
 ['model-call','worker','model','模型请求','emphasis'],
 ['sandbox-tools','worker','sandbox','容器工具','emphasis'],
 ['worker-files','worker','objects','工作区 / 成果','emphasis'],
 ['api-files','engine-api','objects','上传 / 下载'],
 ['redis-notify','engine-api','engine-redis','提交后通知','dashed'],
 ['redis-wakeup','engine-redis','worker','异步唤醒','dashed'],
 ['worker-redis-notify','worker','engine-redis','提交后通知','dashed'],
 ['worker-business','worker','java','回调 / 当前鉴权','security'],
 ['sse-api-java','engine-api','java','事件 / 文件代理'],
 ['sse-java-gateway','java','gateway','SSE'],
 ['sse-gateway-web','gateway','web','事件重放'],
 ['knowledge-call','java','knowledge','启用后检索 / 管理'],
 ['workflow-call','java','workflow','启用后 DAG'],
 ['memory-call','java','memory','启用后召回 / 同步'],
 ['worker-mcp','worker','platform-mcp','授权后调用','security'],
 ['mcp-java','platform-mcp','java','凭据 / Run 复核','security']
].map(([id,from,to,label,variant])=>({id,from,to,label,...(variant?{variant}:{})}));
const out={schema_version:1,diagram_type:'architecture',meta:{...prior.meta,title:'NebuWorkAgent · 分层部署与数据流总图',output:dest+'/nebuwork-layered.html'},components:Object.values(nodes),
 boundaries:[
  {kind:'region',label:'01 访问层 · 浏览器、网关与统一登录',wraps:['web','gateway','identity'],pad:22},
  {kind:'region',label:'02 业务层 · Java 服务、业务数据库与部署配置',wraps:['business-db','java','nacos'],pad:22},
  {kind:'region',label:'03 智能体运行层 · New2 容器与配套存储，各自独立部署',wraps:['engine-api','worker','sandbox','platform-mcp','engine-db','engine-redis','objects'],pad:22},
  {kind:'security-group',label:'可信 Worker 主机 · Docker socket 只交给 Worker',wraps:['worker','sandbox'],pad:16},
  {kind:'region',label:'04 独立依赖层 · 知识、工作流、记忆与模型服务',wraps:['knowledge','workflow','memory','model'],pad:22}
 ],connections:edges,
 cards:[
  {dot:'cyan',title:'主流程 · 从上往下读',items:[
   '浏览器 → 网关 → Java：统一登录，校验账号、项目和资源权限。Java → New2 API：提交固定 Manifest 和幂等 Run。',
   'API → 引擎 MySQL：持久化执行。Worker 主动用 SQL 租约领取，运行 pi SDK；工具进入独立 Run / 专家容器。',
   'Worker 将事件与检查点提交到 MySQL，将文件正文放入 S3；API → Java → 网关 → 浏览器回传 SSE，支持游标重放。'
  ]},
  {dot:'violet',title:'数据归属 · 相关数据跟着服务走',items:[
   'Java 的 nw_* 保存业务配置、项目/任务关联、权限、版本、加密连接与审计；New2 的 ae_* 保存真实执行状态、会话、事件、工具结果、租约和 Token。',
   'New2 MySQL 是执行权威；Redis 只做通知，API / Worker 均发布事务 Outbox，Worker 每 500ms 扫描 SQL 兜底。S3 保存资源、工作区与不可变成果正文。',
   'Workflow 自己保存 SQLite、源码、日志和产物。WeKnora 的文档解析、向量、Postgres、可选 Neo4j/对象存储属于知识子系统，图中按一个独立服务合并。'
  ]},
  {dot:'amber',title:'接入条件 · 模型、业务工具与 MCP',items:[
   '模型由 Worker 按已保存配置直连；密钥只在服务端使用，任务容器不持有模型密钥、服务凭据或 Docker socket。',
   '知识 / Workflow / 记忆启用后，由 Java 统一授权并调用远端。Worker 通过 Java 回调使用这些能力；工具结果进入当前 Run，知识可生成稳定 evidence 引用。',
   '系统 MCP profile 默认可选：授权启用后 Worker → :42120 → Java；未启用保留原业务回调。每次调用复核冻结权限与当前权限的交集。'
  ]},
  {dot:'slate',title:'部署口径 · 配置拓扑，不等于在线盘点',items:[
   'New2 标准 Compose：2 个 API、3 个 Worker、一次性 migrate；共用引擎镜像，基础设施复用现有 MySQL / Redis / S3。横向分区是逻辑部署层，不表示所有组件在同一主机。',
   '任务容器运行在可信 Linux Worker 主机。Workflow 的 Python 步骤使用服务进程权限，不能当作 New2 的容器沙箱。',
   'Nacos 维护既有基础配置；引擎 API 连接和加密凭据由 Java 管理页保存到业务库。端口和副本数以目标环境配置为准。',
   '主仓库证据固定于 3b9293c，跨 5 个仓库的本地核对记录见同目录 evidence.json。未提交的 commander/、intelligence/、AgentTask.jsx 等界面修改未冒充提交证据；本次仅生成架构产物。'
  ]}
 ]};
fs.writeFileSync(dest+'/candidate.json',JSON.stringify(out,null,2)+'\n');
fs.copyFileSync(base+'/evidence.json',dest+'/evidence.json');
console.log(dest);
