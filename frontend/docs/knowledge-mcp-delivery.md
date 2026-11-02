> 2026-10-15：本文保留为历史阶段记录。当前执行链路、部署与验收以 [新智能体引擎交付说明](agent-engine-delivery.md) 为准；文中的旧核心、模板和未接通状态不适用于当前实现。

# 知识库 MCP 接入交付说明

> 此文保留 V8 历史说明。当前管理员统一配置、Nebulae V100 REST、内容归属与任务只读接入以 [V100 交付说明](knowledge-v100-delivery.md) 为准。

本批在 NebuWorkAgent 前端和 Java nebuwork-backend-api 中实现知识库连接管理、引用、文档浏览与检索验证。所有远端访问均由 Java 发起，浏览器只访问现有同源网关。未修改 NebuAgentCore，没有接通任务调用、上传、索引或远端文档写入。

## 使用方式

1. 设置 → 知识库 → 新增知识库：填写名称，选择「Nebulae V1 HTTP」驱动，输入完整 Streamable HTTP 地址，例如 http://实际服务器:3001/mcp/common-knowledge。
2. 默认选择无认证；若反向代理要求认证，可选择 Bearer Token 或自定义认证 Header。不要使用前端 5173、Gateway 18789 端口，也不要替换为 /sse 地址。
3. 点击「测试连接并读取知识库」。统一连接允许先保存配置；只有测试成功才显示连接正常。空集合会明确提示，不创建演示数据。
4. 专家、工作台、项目 → 知识库 → 引用知识库：先选连接，再选一个集合。同一 MCP 的另一个集合可以再次引用。
5. 对象内「新增知识库」创建局部连接，必须测试当前表单、选择一个集合，再原子保存连接和引用。局部连接不进入设置的统一目录，可在当前对象的「局部连接」区域维护。
6. 广场 → 共享知识库：选择当前账号的统一连接，浏览发现的集合，可直接选择专家、工作台或项目引用。
7. 点击「浏览 / 检索」查看远端文档、搜索片段和引用。索引未就绪、空结果、partial 和 warnings 均按远端结果显示。文档正文缺省时保留说明，不承诺完整文档导出或原文件下载。
8. 连接保存后，设置页自动在连接下展示「包含的知识库」及数量，每个知识库显示名称、说明、索引状态和文件数。对象的局部连接区、广场目录也展示说明与文件数。每个连接可独立刷新；禁用项停止读取，失败项提供重试，不影响已保存连接的管理。

说明读取远端集合的 description，缺失时显示「暂无说明」。文件数优先使用有效的 documentCount；缺失时按指定集合调用文档列表工具，按文档 ID 去重，并标为「可见文件数」，不推断远端完整总数。文档列表读取失败显示「暂不可用」，不会按 0 处理；部分列表附带提示。

集合 ID、文档 ID 是远端不透明标识，不能改为名称或自行解码。每个引用绑定 connectionId + collectionId，检索不接受客户端覆盖 collections；不存在引用、集合失效或连接禁用均失败关闭，不退回全库检索。

## 归属与版本

- 统一连接、局部连接、知识库引用均关联统一登录服务验证的当前账号；不信任请求里的 owner/userId。
- 当前共享专家配置模型保持不变。知识库数据额外按当前账号和专家 ID 隔离，从我的专家移除后不可访问，重新加入恢复原知识引用。
- 引用专家不会自动将该专家的私有知识库加入工作台。
- 工作台知识引用增删使用现有工作台 revision，产生新草稿；本体编辑、发布与知识绑定之间发生冲突时返回 409。
- 专家和项目知识配置使用独立 revision，不推进共享专家配置或项目核心同步的 revision。
- 工作台发布固定引用 ID、连接 ID、集合 ID及展示信息，并保存独立发布引用记录。历史空知识快照保持兼容，不自动补库。
- 项目继承创建时发布版本的引用，继承项只读；项目可以另外引用统一连接或创建局部连接。新发布不升级旧项目。
- 修改连接地址/认证信息统一影响已有引用；固定的是集合选择，不是远端内容或地址。连接切换到不包含原集合的服务器时，读取失败并提示集合失效。
- 有草稿、发布版本或项目引用的连接不能删除，可以禁用。移除草稿引用不会删除远端知识库或清除历史发布引用。
- 核心发布包仅加入白名单化的知识库 ID、名称及 executionIntegrated=false，不携带地址、认证信息或可执行 MCP 配置。没有知识引用的旧发布包编译内容保持原行为。

## 数据库与 Nacos

迁移文件：Java 模块 src/main/resources/db/migration/V8__knowledge_mcp.sql。

新增 nw_knowledge_connection、nw_knowledge_reference、nw_knowledge_scope、nw_knowledge_publication 四张表。连接认证密文保存于业务库；文档和向量索引仍在远端。本批没有修改 V1–V7、没有执行迁移。部署前由使用方确认迁移顺序，尤其是并行需求新增迁移的情况；数据库仍为 nebuwork_1。

独立配置示例：Java 模块 config/nacos/knowledge-mcp.example.yml。

| 配置 | 说明 |
| --- | --- |
| nebu.knowledge.internal-allowlist-enabled | 默认 true；false 关闭知识库内网来源白名单匹配，允许普通内网/回环地址；只接受 true/false，每次操作读取刷新后的配置 |
| nebu.knowledge.allowed-internal-origins | 开关为 true 时生效：用逗号分隔的内网来源白名单，例如 http://192.168.1.100:3001；不带路径，不与模型白名单混用 |
| nebu.knowledge.encryption-key | Base64 编码的随机 32 字节 AES 密钥；只有使用认证时才需要，保存凭据后保持稳定 |
| nebu.knowledge.request-timeout-ms | 默认 60000；允许 100–120000 毫秒，覆盖 DNS、初始化、工具发现和所有调用 |

关闭内网白名单时，在当前环境的 Java 模块 Nacos 配置中合并（不要重复创建已有 nebu 节点）：

```yaml
nebu:
  knowledge:
    internal-allowlist-enabled: false
```

首次部署新增开关的后端代码后，开启 Nacos 动态刷新的环境会在配置刷新后对新操作生效，不中断已经开始的操作。恢复 true 或删除开关即恢复白名单匹配；仅清空 allowed-internal-origins 不会关闭校验。关闭时该列表不参与解析和匹配，特殊地址限制仍保留。

出站请求校验 DNS 并固定实际连接 IP，禁止特殊/元数据地址和自动重定向。认证 Header 不允许覆盖 Host、Cookie、MCP 协议头等。不会透传本站 Cookie、模型密钥或核心凭据。响应和审计不返回认证明文；保留现有 Apache HTTP wire/header 日志关闭配置。

MCP 客户端只实现本驱动需要的 2025-11-25 协议，不自动升级协议或降级为旧版 SSE。兼容 JSON/SSE 响应、202 初始化通知、无会话；服务端提供会话 ID 时随请求携带，结束时允许 DELETE 405。503 在总超时内最多重试两次，不重试业务写入。累计响应上限 8 MiB；超限或工具目录分页异常显示失败，不返回截断成功。

## 接口

下列为 Java /api 相对路径。开发浏览器统一使用 /nebulaedev/nwaa 前缀，响应沿用 code/data/msg。

| 方法 | 路径 | 内容 |
| --- | --- | --- |
| GET | /knowledge-mcp/drivers | 当前驱动目录 |
| GET | /knowledge-mcp/targets?kind=expert/workbench/project | 当前账号可引用目标 |
| GET | /knowledge-mcp/connections?kind=user&scopeId= | 统一连接；提供对象 kind/scopeId 时返回统一连接及该对象局部连接 |
| POST | /knowledge-mcp/connections | 新建统一连接 |
| POST | /knowledge-mcp/connections/test | 测试未保存表单；body 为 connection，可选 connectionId 用于保留已有认证 |
| POST / DELETE | /knowledge-mcp/connections/{id} | 编辑连接 / 带 revision 删除 |
| POST | /knowledge-mcp/connections/{id}/test | 测试已保存连接并记录状态 |
| GET | /knowledge-mcp/connections/{id}/collections | 发现可见集合；可选 includeDocumentCounts=true 补充缺失的文件数，默认不额外调用文档列表 |
| GET | /knowledge-mcp/connections/{id}/references | 草稿、发布版本、项目引用位置 |
| POST | /knowledge-mcp/connections/{id}/read | 广场只读访问，必须指定 collectionId，且只能使用当前账号统一连接 |
| GET | /knowledge-scopes/{kind}/{id} | 返回配置 revision、knowledgeBases、connections |
| POST | /knowledge-scopes/{kind}/{id}/references | body：revision、connectionId、collectionId |
| POST | /knowledge-scopes/{kind}/{id}/connections | body：revision、connection、collectionId；局部连接与绑定同事务 |
| DELETE | /knowledge-scopes/{kind}/{id}/references/{reference}?revision=... | 移除自身引用，继承项拒绝修改 |
| POST | /knowledge-scopes/{kind}/{id}/references/{reference}/read | 按绑定集合浏览/检索 |

read body 的 operation 为 documents、document、search、answer；document 使用 documentId，search/answer 使用 query 和可选 topK（默认 5，范围 1–20）。未开放任意 tools/call 代理。answer 适配接口返回上游片段证据，不进行额外聊天模型生成；当前 UI 主要使用 search。

集合响应增加 description、documentCount（未知为 null）、documentCountSource（reported / visible / null），以及可选 documentCountError、documentCountWarning。目录总时限仍受 request-timeout-ms 控制；文件数统计失败保留已发现的集合。统计只在目录展示请求中开启，连接测试、单库选择、绑定和检索不会因此遍历所有集合的文档。

文档详情读取前重新读取所选集合文档列表，确认 ID 归属，再调用 get_document；不能凭猜测的文档 ID跨集合读取。若联邦文档未在远端可见列表中返回，正文读取会拒绝，检索片段仍可查看。检索/回答结果中的集合引用也必须符合当前绑定。

编辑连接不提交 secret 表示保留原凭据；改用 none 会清除凭据。修改认证方式或 Header 名称需要重新填写认证信息。上游 401/403 映射为业务 502，不会导致本站账号退出。

## 测试与验收状态

本批仅进行了代码与差异静态审阅；未运行测试、类型检查、构建、服务、浏览器验证或数据库迁移。以下为已提供、待使用方执行的覆盖，不能视为通过记录。

新增测试：
- 前端 services/knowledgeApi.test.js：请求契约、原始集合 ID、账号/调用方取消、迟到响应、冲突不重试；登录通知中创建的新账号请求不被误取消，旧账号请求仍会取消。
- 前端 features/knowledge/knowledge.test.js：单库显式选择、目录切换竞态、局部新增测试流程、关闭清理、继承项只读、错误与账号切换；登录初始化渲染知识库设置时，清理监听器收到同一次登录通知不取消刚创建的请求。
- Java KnowledgeMcpClientTest：本地协议夹具覆盖 JSON/SSE、初始化、会话、405、空集合、工具发现、限定集合、文档归属、partial/warnings、503 重试、404、认证错误、超时和网络策略。
- Java KnowledgeNetworkPolicyTest：默认/显式开启的精确匹配、关闭后内网放行、同一实例刷新开关、关闭后特殊地址拦截和开关配置错误；KnowledgeMcpClientTest 另覆盖同一客户端关闭/恢复开关后的真实协议夹具访问。
- Java KnowledgeApiTest：真实控制器/H2 事务和迁移，远端使用测试替身；覆盖账号隔离、原子新增、局部归属、乐观锁、删除保护、凭据加密、集中维护、发布继承和核心包脱敏。
- 更新原专家页面知识库 TODO 测试为真实组件接线测试，其余专家移除与工作台核心联通测试继续保留。
- 连接目录新增覆盖：前端保存后自动展示多个知识库、说明转义、0/未知/可见文件数、空目录、禁用与重试、并发限制、刷新及账号切换取消；Java 覆盖 JSON/SSE 元数据保留、按需补充计数、统计失败保留目录、部分结果提示和目录接口的账号隔离。

使用方可以按现有项目方式运行前端 npm run check，以及 Java 模块测试。Java 协议测试会由测试运行器临时启动本机 HTTP 夹具，不连接真实 Nebulae 实例。真实联调应另外配置已启用的 Nebulae V1 HTTP 服务。

建议验收：
1. 配置一个有 A/B 两个集合的 MCP，分别引用 A、B，验证每次只搜索所选集合。
2. 两个账号同时配置同一共享专家，确认连接和引用互不可见，伪造 ID 不能读取。
3. 工作台 v1 引用 A，创建 P1；v2 改为 B，创建 P2；确认 P1 保留 A，P2 为 B，项目新增项互不影响。
4. 修改统一连接地址/认证，确认已有引用使用新配置；禁用、删除受阻、远端集合消失均有明确反馈。
5. 服务断开后配置仍可查看；检索错误不回退演示数据或其他知识库。
6. 回归专家移除/重新添加、工作台空白创建和可选模板、发布重试、核心同步及编辑器不被后台状态刷新覆盖。
7. 已登录时直接刷新「设置 → 知识库」：connections 请求应完成并显示列表或服务错误，不能因同一次登录通知显示「已取消」并停留在加载中；切换账号和离开页面仍应取消旧请求。
8. 不配置内网来源时测试内网连接应被拦截；发布 internal-allowlist-enabled=false 并等待 Nacos 刷新后可连接；恢复 true 后重新拦截，再填入准确来源后可连接。关闭白名单期间特殊/元数据地址仍拒绝访问。
