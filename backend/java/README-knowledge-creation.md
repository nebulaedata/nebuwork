> 历史功能交付记录：其中的 Nacos、原父工程和部署说明仅描述旧环境。当前独立工程的启动、配置及构建方式以 [README.md](README.md) 为准。

# 管理员模板与 AI 建库（V16）

Nebulae V100 连接由管理员维护创建模板，普通账号填写业务描述后通过持久化任务创建 document 知识库。默认模板同时开启向量/关键词 RAG、Wiki、实体关系图谱、图像理解；实际内容在上传资料后处理。FAQ、独立 Wiki 和旧驱动沿用原入口。NebuAgentCore 不增加创建工具。

## 上线顺序

1. 先更新本地 `nebulae-weknora` 服务。新增 `GET/POST /api/v1/initialization/generate/knowledge-base-config`；GET 返回版本、指定创建 ID 支持与 Neo4j 连通性，POST 调用空间内已配置的模型生成业务配置。保持现有 full-access Key / 管理模型权限边界。
2. 备份 Java 数据库和现有 AES 密钥，部署 Java。Flyway 在 V15 后执行 `V16__knowledge_creation_templates.sql`，不修改旧迁移。新增模板表、不可变模板版本表、账号所属的创建任务表；现有连接密文、归属和引用不变。
3. 更新 NebuWorkAgent 前端。在“设置 → 知识库 → 连接 → 创建模板”配置并校验模板后启用；需要给普通用户建库时连接本身也必须启用且开放新建。

Nacos `nebu.knowledge.admin-ids` 仍是唯一配置管理员来源。`nebu.knowledge.creation-worker-enabled` 默认 true，每实例最多同时处理两个任务；暂停工作器只停止领取新任务，不取消已发出的上游请求。保留原凭据加密密钥，不能用测试配置替换。

## 管理员配置

- 必选：生成、Embedding、摘要模型；启用 Wiki 时选 Wiki 模型，启用图像理解时选 VLLM 视觉模型。模型 ID 来自当前远端空间，不存储第二份模型地址或凭据。
- 默认：分块大小 1000、重叠 200、Wiki 提取粒度 standard。图片向量和音频转录默认关闭；图片向量开启时额外检查 Embedding 图片输入能力。
- 解析按文件类型选择实际可用引擎，同一类型只能出现在一条规则中。未覆盖的类型沿用 WeKnora 默认路由；管理员应覆盖业务所需的文件类型。存储可选明确实例或空间默认资源；`__env_` 向量目录项不可当绑定 ID。
- 启用和设为默认都会重新检查模型目录、解析引擎、索引能力、Neo4j 实际连接及 APOC 扩展、新生成接口。Neo4j 必须提供 `apoc.merge.node`、`apoc.merge.relationship`、`apoc.periodic.iterate` 和 `apoc.coll.union`；仅端口可连不算通过。缺失依赖直接拒绝，不静默关闭功能。模型目录可用不等于供应商推理永远可用，生成失败会保留任务供手动重试。
- 每次保存产生新版本；任务使用提交时的快照。连接地址、空间、驱动或认证目标变化后，旧模板不可提交，旧任务停止；管理员须重新校验模板。凭据身份纳入不可逆目标指纹，防止同 URL 更换空间 Key 后错误建库。

## Java HTTP 接口

所有路径在 `/api/knowledge-mcp` 下，使用已验证统一账号；浏览器写操作均为 POST。

| 路径 | 方法 | 用途 |
|---|---|---|
| `/connections/{id}/creation-resources` | GET | 管理员读取脱敏模型、解析和存储目录 |
| `/connections/{id}/creation-templates` | GET / POST | 管理员列表 / 新增模板 |
| `/connections/{id}/creation-templates/{template}` | POST | 按 revision 保存、启停、设默认 |
| `/connections/{id}/creation-templates/validate` | POST | 校验技术配置 |
| `/creation-templates/{id}` | GET | 管理员模板详情 |
| `/creation-templates` | GET | 普通用户可用模板摘要，无技术参数和密钥 |
| `/creation-jobs` | POST / GET | 幂等提交 / 当前账号最近 100 个任务 |
| `/creation-jobs/{id}` | GET | 当前账号任务详情和业务草稿 |
| `/creation-jobs/{id}/confirm` | POST | 确认预览中的业务字段 |
| `/creation-jobs/{id}/retry` | POST | 手动重试尚未发出建库的失败任务 |
| `/creation-jobs/{id}/recover` | POST | 核验并登记原库，不再次创建 |

提交字段为 `templateId`、`revision`、`description`、可选 `name`、`preview` 和 `requestKey`。同账号同幂等键同输入返回原任务，改变输入返回冲突。用户指定的名称优先于生成结果。预览只接受业务字段，拒绝模型、服务地址、凭据、存储及功能开关注入。

## 执行与恢复

阶段为 `preflight → generating → validate → creating → verifying → registering → completed`，预览在生成后停到 `preview`。队列使用数据库领取和租约；长网络调用在事务外，任务领取、权限复核和归属登记使用短事务。租约超时标为失败或待核对，不自动重放创建。

创建前由 Java 固定 UUID 并持久化，WeKnora 保留此 ID。发出请求前记录原操作回执；丢失响应后进入 `unknown`。恢复只 GET 这个固定 ID，完整核对模板和业务配置，再登记归属。若远端查无此库，继续待核对，禁止自动 POST。已取得 ID 而登记失败同样只恢复原库。一般处理记录入口不重复展示 AI 创建回执，统一从“我的创建任务”恢复。

所有任务、草稿、确认、重试、恢复均按发起账号隔离。已创建库权限被撤销后不再返回业务草稿或库 ID。待登记的固定 ID 不能被管理员分配给其他账号；配置管理员身份不授予正文权限。引用失败保留已创建库，用户可重新引用。

## 超时与代理

WeKnora 生成窗口 900 秒；Java 仅此生成调用使用 910 秒独立预算。Java 到 WeKnora 之间的反向代理读取超时建议至少 930 秒，本仓库 WeKnora Nginx 配置已有 3600 秒。不要让代理重放 POST。原普通内容接口保留既有超时策略。

浏览器提交后立即获得任务号，只轮询短请求。活动页每 3 秒刷新，5 分钟后提示手动刷新；关闭窗口、导航、账号切换会取消浏览器请求并忽略迟到响应，后台任务继续。服务重启后的过期租约需发起者明确重试或恢复。

## 验证

常规专项：`mvn -am -Dtest=Knowledge*Test -Dsurefire.failIfNoSpecifiedTests=false package`。覆盖 V1–V16 隔离 H2 迁移、模板管理权限、账号隔离、生成预览、幂等、版本冻结、目标变化、过期租约、失效依赖、恶意业务字段、长生成超时及响应丢失/登记失败恢复。

`KnowledgeCreationLiveTest` 默认跳过。仅对可丢弃的隔离 WeKnora 空间设置 `KNOWLEDGE_LIVE_TEST=true`、`KNOWLEDGE_LIVE_ORIGIN`、`KNOWLEDGE_LIVE_KEY` 后执行；该测试使用真实 Java HTTP、持久化工作器和远端模型，会创建一个真实知识库。身份存储为测试替身，业务数据库为独立 H2，不连接正式 Java 数据库。验收人员仍应检查实际部署的统一会话、网关路径与反向代理配置。

联调时可指定 `KNOWLEDGE_LIVE_PORT`（默认随机端口）和 `KNOWLEDGE_LIVE_HOLD_SECONDS`（最多 300 秒），在断言完成后短暂保留隔离 Java HTTP 服务供浏览器检查或上传验收资料。不要将测试会话替身用于业务部署。

2026-10-14 已执行：58 项知识库常规专项通过，真实 HTTP/模型 `KnowledgeCreationLiveTest` 单独通过，JAR 构建及隔离 V1–V16 迁移通过。通过 Java 上传正文、表格、图片 DOCX 后，已验证混合检索来源、图片描述索引、10 个业务 Wiki 页面及 Index、8 个图谱实体和 8 条关系；配置示例未混入内容。图谱依赖验收补齐 APOC 检查。附加 OCR 子任务出现 180 秒供应商超时，图片描述本身成功；这属于实际记录的局部失败，不能宣称所有解析子任务成功。正式数据库及现有业务进程未更新，部署时按上文顺序执行。
