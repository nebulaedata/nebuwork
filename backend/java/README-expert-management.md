> 历史功能交付记录：其中的 Nacos、原父工程和部署说明仅描述旧环境。当前独立工程的启动、配置及构建方式以 [README.md](README.md) 为准。

# NebuWork Java 专家管理模块

当前用户的模型配置、Nacos 加密密钥及 V2 迁移见 [模型配置交付说明](README-model-configuration.md)。

当前用户的专业工作台、本体发布版本与项目、V4 迁移见 [专业工作台交付说明](README-workbench-management.md)。

## 启动与配置

业务代码仅在 nebuwork-backend-api。保持 Java 8、Spring Boot 2.7.6、MyBatis、Flyway；端口 42020，context-path=/nwaa，默认 dev profile，配置来自现有 Nacos。

本轮删除了旧 AuthController。请在 Java 合集根目录清理旧编译产物后重新打包，避免已删除的登录控制器 class 残留：

```powershell
mvn clean package -DskipTests
.\scripts\Run-Local.ps1
```

也可在 IDE 重新构建该模块后启动 NebuworkBackendApiApplication。脚本 -Build 会先 clean package 并运行测试；本轮由使用方决定何时执行，助手没有运行这些命令或重启服务。

## 统一身份与 Nacos

模块不再提供独立账号登录、退出、会话查询，也不再使用 nebu.auth.username/password、NEBU_APP_USERNAME/NEBU_APP_PASSWORD 或 NEBUWORK_SESSION。

页面通过统一用户服务登录、恢复用户资料与退出：

| 功能 | 网关地址 |
| --- | --- |
| 登录 | POST /nebulaedev/web/punterapi/login |
| 当前用户 | POST /nebulaedev/web/punterapi/power/getPunterPowerInfoInHeader |
| 退出 | POST /nebulaedev/web/punterapi/loginOut |
| 专家接口 | /nebulaedev/nwaa/api/... |

Java 的 SessionFilter 根据 token 请求头、sessionKey 请求头及 token Cookie 的现有顺序尝试有效会话。UnifiedSessionStore 使用 StringRedisTemplate 读取现有记录，兼容 JSON 数组和 GenericFastJsonRedisSerializer 包装的 JSON 数组字符串；只解析数据，不启用动态类型反序列化。实际操作者取会话记录的 punterId，不信任 userId、visitorId 等客户端请求头，不使用父账号字段替代实际操作者。

无有效会话返回 401；Redis 连接/访问失败返回 503。模块不创建第二份会话、不续期、不删除统一 token；现有网关负责续期，统一用户服务负责注销。当前专家数据仍沿用共享可见范围，本批不扩展租户隔离或权限体系。

Nacos 的 spring.redis 必须与现有网关和用户服务使用同一 Redis 实例、端口、database、认证及连接方式。可沿用共享配置，勿用示例占位值覆盖已有配置。spring.datasource 仍指向 nebuwork_1。配置样例见 config/application-local.example.yml；所有服务端连接凭据留在 Nacos，不引入 .env。

网关 42000 及规则由使用方管理。网关去掉 /nebulaedev 后将 /nwaa/api/... 转发到本模块。健康检查 GET /nwaa/api/health 不要求登录。来源限制继续由 nebu.auth.allowed-origins 控制，支持带引号的星号或逗号分隔的精确来源；该设置不代替会话认证，也不是网关 CORS 配置。

## 数据与初始化

- V1 迁移包含专家、SOP、规则集/规则、扩展与绑定、案例与引用、市场专家、文件及引用、配置审计和初始化标记。
- 首次启动由 ExpertSeed 在事务及数据库行锁内导入 seed/expert-config-v1.json。后续启动检查标记并跳过，不覆盖用户配置。
- 初始数据：10 位专家、12 个 SOP 集（5 个已有集与 7 个旧步骤转换集）、扩展/案例目录、规则与绑定。知识库、运行记录、用量、成长、命中和市场热度不导入。
- JSON 种子由前端 scripts/export-expert-seed.mjs 从既有配置中筛选生成。运行期只读取打包后的 JSON，不执行 JavaScript。
- SOP 定义使用经过 Java 校验的 JSON 文本；材料关系、规则集关系与资源绑定独立建表。节点/步骤有稳定 ID，x/y 仅表示画布位置。
- 当前均为配置草稿。扩展绑定不安装或执行代码，规则启用不等于发布，SOP 不自动转为可执行工作流。
- 专家 SOP 素材通过新引擎 HTTP 接口存入共享对象存储，使用 artifactId 与 version；Java 不保存本机文件。发布专家运行资源时固定 SOP、规则、素材内容及版本。已有名称但无实体文件的材料显示“待补充文件”。
- 移除素材或 SOP 只解除引用，保留文件字节和元数据，避免误删其他引用。文件垃圾回收不在本阶段。
- 配置变化与审计记录同事务提交。SOP 和规则修改、删除需要 revision，过期返回 409；绑定 PUT/DELETE 为幂等操作。
- 数据库/文件系统无法形成一个物理事务：上传登记失败会清理新文件；进程意外退出留下的孤立文件需后续维护处理。

## 接口

下表列出控制器内部路径。Java 对外地址统一在前面加 /nwaa；开发网关地址统一在前面加 /nebulaedev/nwaa。

统一成功响应为 {"code":0,"data":...,"msg":"成功"}；错误使用对应 HTTP 状态并返回 {"code":状态码,"data":null,"msg":"错误说明"}。
认证失败 401，同源校验失败 403，对象或所属专家不匹配 404，修改冲突/名称冲突 409，参数错误 400/422，超限上传 413。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/auth/login | username/password；建立会话 |
| GET / POST | /api/auth/session / /api/auth/logout | 查询/退出会话 |
| GET | /api/health | 服务标识及 executionAvailable=false |
| GET / POST | /api/agents | 列表/创建；name、role、modelProviderId、tagline、可选 color；modelProviderId 必须为当前用户保存的配置 ID |
| GET | /api/agents/{id} | 专家聚合详情 |
| DELETE | /api/agents/{id}?revision={expertRevision}&membershipRevision={listRevision} | 从当前账号列表删除自建/预置专家，或移除市场专家；保留共享配置；被本人工作台草稿引用时返回 409 |
| GET / POST | /api/agents/{id}/sop-sets | 查询/创建 name、kind、desc、可选 wf 或 proc |
| POST / PATCH / DELETE | /api/agents/{id}/sop-sets/{sop} | 浏览器 POST 保存，兼容 PATCH；保存 body revision，DELETE query revision |
| POST | /api/agents/{id}/sop-sets/{sop}/materials | multipart：file、revision，单文件 20MB |
| DELETE | /api/agents/{id}/sop-sets/{sop}/materials/{material} | query revision；只解除引用 |
| GET | /api/agents/{id}/sop-sets/{sop}/materials/{material}/content | 受会话及归属校验的附件下载 |
| GET / POST | /api/agents/{id}/rule-sets | 查询/创建 name、desc；同专家名称唯一 |
| GET / POST | /api/agents/{id}/rules | 查询/创建 name、content、ruleSetId 或 scene；新 scene 同事务创建 |
| POST / PATCH / DELETE | /api/agents/{id}/rules/{rule} | 浏览器 POST 修改，兼容 PATCH；修改/删除需要 revision，enabled 是配置开关 |
| GET | /api/plaza/extensions、/api/plaza/templates、/api/plaza/agents | 配置目录 |
| PUT / DELETE | /api/agents/{id}/extensions/{extension} | 绑定/解除扩展 |
| PUT / DELETE | /api/agents/{id}/tpls/{template} | 引用/解除模板 |
| POST | /api/plaza/agents/{market}/hire | 幂等添加市场专家；已移除时恢复原专家及配置，返回专家资料 |

详情包含 agent、sopSets、ruleSets、rules、extensions、templates、knowledgeBases、tasks、growth、usage。后三类运行数据为空或零，successRate=null；knowledgeBases 始终为空。SOP 保留 wf/proc 的现有结构，额外提供 revision 和 materialRefs，材料以 ID 操作，不能通过修改 proc.materials 伪造上传。

## V7：从我的专家移除

- 部署前由使用方执行 `src/main/resources/db/migration/V7__expert_membership_visibility.sql`，新增 `nw_expert_membership`。本轮没有执行迁移、启动服务或连接真实数据库。
- 当前专家配置仍是共享记录，市场 ID 与专家仍为一对一。本次增加的是按统一会话真实账号保存的列表移除状态，不复制专家、不改为私有配置。没有状态记录时沿用原有可见行为，已有用户和专家无需回填。
- 专家列表、详情和创建/添加响应增加 `sourceMarketId`、`membershipRevision`；市场目录增加 `hiredAgentRevision`、`hiredMembershipRevision`。无状态记录时列表版本为 0；移除后为 1，恢复后为 2，以此递增。前端必须回传读取到的专家 `revision` 和列表 `membershipRevision`，不得自增猜测。
- V7 原先只支持市场专家，本轮已扩展为自建、预置和市场专家。本人未删除的工作台草稿仍引用该专家时返回 409，并提示至多 5 个工作台名称；先解除引用即可重试。解除默认专家引用时沿用原逻辑清空草稿默认项。其他账号的工作台引用不会阻止本人的列表删除。
- 成功后本人专家列表不再返回该专家；详情、SOP、规则、素材下载及配置修改不可继续访问。市场专家恢复“添加到我的专家”，重新添加后恢复访问。自建、预置专家没有恢复入口。
- 不删除 `nw_expert`、SOP、规则集、规则、扩展/案例绑定、素材元数据及文件；不改动历史发布版本、核心发布包和项目快照。市场重新添加复用相同专家 ID，并恢复当前共享配置。
- 重复相同移除请求幂等；专家配置或列表状态版本过期返回 409。重新添加后，之前的旧移除请求不会再次将其移除。移除、恢复都记录真实操作者审计，使用同一专家行锁；工作台绑定在相同行锁下校验可见状态，采用 READ_COMMITTED 避免并发绑定产生隐藏引用。
- 前端在市场、我的专家卡片和详情页提供确认移除。失败保留状态并展示服务端原因；成功后清理该专家缓存并刷新页面，刷新失败可重试。添加/移除串行，列表、详情、目录及配置响应校验账号版本和添加状态变更，丢弃晚到响应。

新增但尚未执行的验证：`ExpertApiTest` 覆盖身份、列表隔离、恢复、素材保留、过期请求；`WorkbenchApiTest` 覆盖引用阻止、历史快照保留、其他账号引用和并发绑定；前端 `expertApi.test.js`、`removeExpertModal.test.js` 及专家/广场视图用例覆盖缓存、确认、失败重试与页面离开。

## 专家设置与自建/预置专家删除

- 专家详情在“规则库”后新增“设置”页签。自建、预置专家显示“删除专家”，市场专家显示“从我的专家移除”；点击后确认，成功再返回列表，失败显示原因并允许重试。
- 复用上述 DELETE 接口和 `nw_expert_membership`，无需新增迁移；环境必须已执行 V7。账号来自统一会话，不接受前端指定操作者。当前配置仍共享，删除只持久化当前账号的不可见状态，不物理清除专家、SOP、规则、知识库引用、素材、历史发布版本或项目快照。
- 两类操作都要求读取到的 `revision` 与 `membershipRevision`。自建/预置专家响应的 `sourceMarketId` 为 null；审计类型仍为 `expert_membership`，动作记录为 `delete`，市场移除保持 `remove`。相同请求重复提交返回相同结果，初始化种子重新运行不会恢复已删除的列表项。
- 本轮补充但未运行：自建专家账号隔离、配置保留、幂等与越权身份头、预置专家种子重启后不可见、工作台引用阻止与删除后禁止新绑定；前端覆盖设置页入口、删除确认/取消/重试、缺失版本、晚到响应和无关缓存保留。

## 待使用方运行的验证

2026-10-09：工作流 SOP 的 `wf.edges` 保存为 `{id, source, target}` 数组，节点引用来自 `wf.nodes[].id`。支持分支和删除连接，允许最多 1000 条边；拒绝无效引用、自连、重复 ID 和重复有向连接。缺少 edges 的历史数据按节点顺序返回稳定的默认连接，显式空数组不会重新生成连接。旧客户端保存时省略 edges 会保留已存连接，仅清除指向已删除节点的边。数据仍存 `nw_sop.definition_json`，无新迁移，沿用 POST/旧 PATCH、统一身份和 revision 检查。需要重新构建并重启本模块；已补充 `ExpertApiTest` 用例，本轮未执行。此改动只保存编排配置，不包含执行引擎。

本轮仅更新用例，未执行测试、构建、服务启动或浏览器验收。

- ExpertApiTest：使用隔离 H2 和模拟统一会话，保留专家配置回归，并覆盖实际操作者审计。
- GatewayPathTest：模块前缀、token/Cookie/sessionKey、会话失效、伪造身份头、Redis 故障、来源限制和旧登录入口移除。
- UnifiedSessionStoreTest：现有 Redis 序列化格式及非法记录。
- 本轮没有连接或修改 MySQL、Redis、Nacos 或网关路由。真实环境的登录、重启和持久化验收由使用方执行。
