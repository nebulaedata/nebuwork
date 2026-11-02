> 历史功能交付记录：其中的 Nacos、原父工程和部署说明仅描述旧环境。当前独立工程的启动、配置及构建方式以 [README.md](README.md) 为准。

# NebuAgentCoreNew2 接入

Java 的 `agent` 包替代旧 core/task/template 执行链路。统一登录、专家/工作台/项目管理以及现有知识、记忆、Workflow 服务保留。不存在旧引擎选择、模板同步 Worker、Java 模型执行转发或旧协议回退。

## 配置与部署

平台连接在 **设置 → 智能体引擎**（`#/settings?tab=agent-engine`）管理，唯一配置来源为 V20 的 `nw_agent_engine_settings`，应用不再读取 Nacos `nebu.agent.*`。可配置 1–8 个同集群 API 地址或一个负载均衡入口、请求超时、沙箱镜像、初始业务命名空间与服务密钥。签名密钥对应引擎 `ENGINE_SIGNING_KEY`，回调密钥对应 `BUSINESS_API_KEY`；至少 32 字符，留空保留已有密钥。凭据复用现有服务端加密根密钥加密存储，页面和审计不返回明文。数据库连接、统一登录和加密根密钥仍是部署配置。

`nw_agent_engine_admin` 保存经运维指定的现有管理员账号 ID；默认无授权，不允许首个登录用户自行取得管理权限。只允许指定管理员编辑、检查连接或查看节点详情。保存支持版本冲突检测和幂等请求。所有地址保存前必须通过协议、共享数据库集群 ID 和对象存储配置指纹校验；首次绑定后保持集群及业务命名空间，避免丢失已有会话映射。节点列表使用轮询分配；连接失败或 502/503/504 时，读请求和带原始幂等键的写请求可以切换到下一节点，未带幂等键的写请求不会自动重放。文件开始向浏览器输出后不自动重放。

现有 Nacos 配置的一次性迁入工具位于引擎 `ops/migrate-engine-settings.mjs`，先运行 V20、`--phase=import` 迁入现有凭据和指定管理员，验证新后端后以 `--phase=retire` 删除旧 Nacos 连接项。此工具不属于应用启动路径，不保留运行时回退。

执行 `mvn clean package`，Windows 启动增加 `-Dfile.encoding=UTF-8`，按既有统一网关运行 Java 42020、上下文 /nwaa。页面填写的 API 地址必须能从 Java 所在主机/容器访问。浏览器业务请求仍使用 `/nebulaedev/nwaa/api/...`，不直接连接引擎；仅管理员设置页面显示节点地址，不回显密钥。

V16 保留正在开发的知识库创建功能；V17 增加任务关联、运行资源、版本、调用账本和加密 MCP 凭据；V18 增加配置写请求的幂等账本；V19 将专家 SOP 素材改为共享产物引用，发布时固定其内容和版本。历史 Flyway 迁移保持校验稳定。应用启动只迁移结构，不删除业务数据；旧表退役由独立重置脚本执行。

## HTTP 接入

- `/api/agent-engine/settings`：读取状态/管理员配置，POST 保存；`/test` POST 检查草稿但不保存；`/status` GET 检查当前集群与 Worker 心跳。

- `/api/runtime-resources/{workbench|project|expert}/{id}`：资源草稿、完整目录文件上传、独立发布。
- `/api/runtime-credentials`：MCP 加密凭据创建/修订；`/{id}/revoke` 撤销，执行前重新校验。
- `/api/projects/{id}/tasks`、`/api/tasks/{id}/runs`：任务创建与新轮次；GET runs 返回轻量状态，不反复传输整段历史。
- `/api/tasks/{id}/runs/{run}/commands`：补充输入、下一轮、恢复、取消。
- `/api/tasks/{id}/history`、`/events`：历史与可重放 SSE，定期复核统一会话。
- `/api/projects/{id}/artifacts`：上传/列表；`/{artifact}/versions`、`/{artifact}/content?version=N`：版本与正文代理。
- `/api/tasks/{target}/session-grants`：显式授权源任务会话片段。
- `/internal/agent/{context|credentials|authorize|tools/execute|tools/reconcile}`：独立 Bearer 鉴权的 Worker 回调。

每个回调从引擎查询 Run 后核对租户、账号、项目、会话和 Manifest hash。当前授权优先于原快照。主任务知识范围包含项目知识库（含固定工作台版本的继承项），以及项目固定版本中已引用、当前可见且已发布运行资源的专家所关联的当前账号知识库。只注入启用且有读取权限的引用。委派专家仅取得项目公共库和自身知识库，不能访问其他专家专属库；跨任务会话必须额外授权。工具默认无审批。Workflow 使用现有执行控制和幂等操作；知识只读检索与文档访问沿用现有授权；记忆使用现有草稿与事实处理流程。

Manifest 的 `knowledgeRefs` 固定允许调用的 ID；`knowledgeReferences` 提供不含连接地址及凭据的名称、`scopeKind`、`scopeId`，用于模型发现与回调路由。专家 `runtime` 同时携带独立的引用目录和工具声明。每次检索/读文档按快照来源调用 `KnowledgeService.readReference`，再次检查专家可见性、引用和当前库权限；解绑、停用或撤权后旧快照也不能继续读取。旧 Manifest 无来源目录时保留项目来源解释。上线时先更新所有引擎 API/Worker，再更新 Java；新字段由新版引擎接受，既有 Run 快照不重写，下一轮新 Run 才加载新目录，无数据库迁移。

## 验证

`AgentClientTest` 验证真实 HTTP/JWT/幂等头；`AgentIntegrationTest` 覆盖发布→项目→任务、幂等、账号隔离、快照和凭据。`AgentAcceptanceHostTest` 仅在 NEBU_AGENT_ACCEPTANCE=1 时启动隔离验收服务器，它使用 H2 和测试登录桩，且不进入生产 JAR。配合新引擎 tests/acceptance-flow.ts 验证真实 Java、pi、MySQL、S3、Docker 和前端链路；模型上游明确使用脚本测试服务。

业务重置、备份恢复演练及开发环境配置脚本在 NebuAgentCoreNew2/ops。它们只清理明确指定的 NebuWork schema，保留统一账号以及独立业务引擎数据；不得复用数据库重置来丢弃源代码改动。


## Token 统计

AgentUsage 从引擎持久化账本批量读取账号范围的记录，关联 Java 的任务、项目和工作台；不复制会话，也不建立价格配置。专家列表、专家详情的参与任务分页、项目列表/详情、工作台列表/详情共用 totalTokens、usageKnown、unknownCalls 和输入/输出/缓存拆分。旧 cost 为 null。引擎不可用时保留配置入口并明确返回 unavailable，不能用零代替失败。专家详情 GET /api/agents/{expert} 可用 taskOffset 分页；任务总数与成功率来自完整参与记录。Java 无额外业务库迁移，本次新增表在引擎库。

2026-10-16 验证：AgentUsageTest、AgentIntegrationTest、ExpertApiTest 共 31 项通过；JDK 8 打包通过。新增集成算例核对任务/项目/工作台同为 200 Tokens、专家独立用量、未调用专家零参与、主专家冻结和引擎故障的未知展示。
