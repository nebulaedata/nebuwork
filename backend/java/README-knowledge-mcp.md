> 历史功能交付记录：其中的 Nacos、原父工程和部署说明仅描述旧环境。当前独立工程的启动、配置及构建方式以 [README.md](README.md) 为准。

# 知识库 MCP 接入

> 以下为 V8 历史记录。V15 已新增管理员统一配置和 Nebulae V100 REST：Nacos 配置 `nebu.knowledge.admin-ids`（默认空），迁移为 `V15__knowledge_administration.sql`。旧连接 ID/密文/引用保留，默认不开放新建。详细接口、迁移和验证结果见 NebuWorkAgent 的 `docs/knowledge-v100-delivery.md`。本轮已执行隔离数据库迁移、专项测试、构建和本地 HTTP 服务验证；真实远端与正式数据库尚未联调。

实现位于 api/knowledge，提供账号内统一连接、对象局部连接、单集合引用、只读浏览与检索、工作台发布固定引用和项目继承。

连接目录返回每个知识库的 description、documentCount 和计数来源。GET /api/knowledge-mcp/connections/{id}/collections?includeDocumentCounts=true 会对缺失计数的集合读取文档列表，返回按 ID 去重后的可见文件数；远端已有的有效计数直接保留。计数失败保留目录并返回提示，未知数量为 null。未带该参数的发现/选择流程不额外读取文档列表。此变更不需要数据库迁移，相关测试已提供但未执行。

配套迁移为 src/main/resources/db/migration/V8__knowledge_mcp.sql，Nacos 示例为 config/examples/knowledge-mcp.example.yml。使用现有 nebuwork_1 数据源、统一身份和 /api 路由，认证信息由独立知识库 AES-GCM 密钥加密，不在发布包中保存。

前后端完整接口、配置和验收说明见 NebuWorkAgent 仓库 docs/knowledge-mcp-delivery.md。本批没有执行迁移、测试、构建或启动服务；KnowledgeMcpClientTest 和 KnowledgeApiTest 待使用方执行。不要把本批代码交付描述为已经完成实际 Nebulae 服务联调。

本模块不升级 Java 8，不引入 Node BFF，不改模型网络策略或凭据密钥，不接入任务执行。

## Nacos 内网白名单开关

2026-10-26 起，知识库内网白名单与特殊网络地址拦截默认关闭。开关为，在当前环境的模块配置（开发环境为 DEFAULT_GROUP / nebuwork-backend-api-dev.yml）合并以下配置：

```yaml
nebu:
  knowledge:
    internal-allowlist-enabled: false
```

internal-allowlist-enabled 默认 false，设为 true 才按 allowed-internal-origins 校验来源。block-special-addresses 默认 false，设为 true 才拦截特殊地址。默认允许本机、内网、Fake-IP 和其他已解析地址；DNS 校验、HTTP(S) 地址格式和账号权限继续生效。

首次部署此代码后，在启用 Nacos 动态刷新的环境中，修改开关会影响配置刷新后的新操作；不会中断已经开始的操作，无需因开关变化重启后端。

新增 KnowledgeNetworkPolicyTest，以及 KnowledgeMcpClientTest 中的开关刷新用例，覆盖默认开启、关闭放行、恢复开启、无效配置及关闭后仍保留的网络校验。本次未执行测试、构建或服务重启。
# 全能力浏览与任务证据（2026-10-16）

REST 驱动的只读 `/read` 新增 `capabilities/chunk/graph/gallery/wiki.folders/wiki.graph/wiki.stats`，保留 `search/document/documents`，支持 `contentKind`、分页和命中分块。旧 MCP 驱动仅支持原有文档能力；能力中的 supported、enabled 与 available 分别表示驱动支持、当前库配置和运行可用性，未探测为 unknown。

POST `/api/knowledge-mcp/connections/{id}/preview|media` 和 `/api/knowledge-scopes/{kind}/{id}/references/{reference}/preview|media` 只接受资源标识、download，不接受下载地址。每次获取二进制均校验当前账号、连接、库和文档/分块/图片归属。响应 no-store、nosniff，不向浏览器暴露上游凭据或签名地址。

V21__knowledge_evidence.sql 新增稳定任务证据。GET `/api/tasks/{task}/evidence/{id}`、POST `/read`、`/preview`、`/media` 读取当前仍有权限的已绑定来源。证据和工具调用回执同一事务提交，重试复用 ID；历史结果不补造证据。Wiki 导航返回授权引用标识，后续仍走原引用接口检查权限。New2 工具新增能力、文档、Wiki、图谱和画廊只读工具，模型不能读取停用分块。

部署顺序 WeKnora → Java 及 Flyway V21 → NebuAgentCoreNew2 → 前端。完整行为、专项及隔离真实联调结果见 NebuWorkAgent 仓库 docs/knowledge-full-delivery.md。本批未修改正式数据库和原运行服务。

