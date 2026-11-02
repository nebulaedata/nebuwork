> 2026-10-15：本文保留为历史阶段记录。当前执行链路、部署与验收以 [新智能体引擎交付说明](agent-engine-delivery.md) 为准；文中的旧核心、模板和未接通状态不适用于当前实现。

# 专业工作台需求对齐与交付

> 本文记录 V4 配置阶段。V5 已接入专属核心模板发布与项目空间创建；V6 已取消下文的六类固定预置，改为核心接口目录和可选来源，空白创建无需任何预先导入模板。部署和当前接口字段以 [工作台核心联通交付](workbench-core-integration.md) 为准，下文 templateId 及固定预置说明仅作为历史记录。历史项目仍保持本文的配置快照语义。

## 已确认边界

本批交付当前账号独立的工作台配置与项目入口：创建工作台 → 保存本体草稿和引用 → 发布不可变配置版本 → 创建固定该版本的项目 → 查看、编辑项目基本信息。

| 页面 | 本批真实能力 |
| --- | --- |
| 专业工作台 | 空白/六类模板创建、基本信息、无项目时删除 |
| 业务本体 | 业务名称/领域/定义、术语 wiki、实体关系、适用/排除规则、系统提示词、默认专家 |
| 资源引用 | 现有专家和案例目录绑定/解绑；知识库为空态 TODO |
| 发布 | 草稿 revision、发布校验、不可变快照、历史查看；不自动修改已有项目 |
| 项目 | 列表/工作台筛选、创建、概览、固定配置版本、名称/说明/状态修改 |
| 运行与资源 | 真实空态和零用量；未接入功能禁止假保存 |

六类只读创建模板为文件审查、业务分析、舆情监测、研发协同、系统运维、法律文书。首次个人列表为空，不导入演示项目、知识库、用量或模型凭据。不调用 NebuAgentCore，不实现任务执行、文件管理、数据库连接、策略编排及回流。

## 数据与版本

全部业务位于 Java `nebuwork-backend-api` 和 `nebuwork_1`。V4 新增工作台、草稿、专家/案例绑定、发布版本、项目六张表；不修改 V1–V3。用户使用统一登录的 `RequestIdentity.actor()`，不新建用户模块。引用不复制专家，不授予模型凭据访问权。

工作台基本信息、草稿和绑定共用 revision；发布固定本体、引用 ID 和展示快照，不冻结专家内部 SOP/规则/密钥。只有发布过的工作台允许创建项目，项目固定创建时版本，不提供升级和回滚。解除默认专家绑定同时清空草稿默认专家。有任何项目的工作台禁止删除。

工作台删除时事务删除草稿、绑定和历史，主表保留已删除标记及创建请求编号。这样旧的创建请求重试不会重新生成已删除对象；普通查询和接口均不可再访问该工作台。目录中的专家、案例不删除。

发布状态为 `unpublished`（从未发布）、`published`（当前 revision 已发布）、`draft`（已有发布但还有草稿修改）。发布本身不增加 revision；同一 revision 重复发布返回同一个版本。草稿里的引用有稳定顺序，新增引用追加在末尾。

## 接口契约

下表为模块内路径，浏览器统一添加 `/nebulaedev/nwaa`，成功使用 `{code:0,data,msg}`。拥有者由统一登录会话确定，不接受 ownerId/userId 字段。其他账号对象返回 404；revision 冲突、不能删除、不能创建项目或幂等键内容冲突返回 409；非法参数返回 400/422；无效登录返回 401。

| 方法 | 路径 | 输入 / 输出 |
| --- | --- | --- |
| GET | `/api/workbench-templates` | 六类只读预填模板 |
| GET | `/api/workbenches` | 本人工作台；包含真实 projectIds、revision 和发布状态 |
| POST | `/api/workbenches` | `name,desc,icon,color,templateId?`；返回工作台 |
| GET / POST | `/api/workbenches/{id}` | 查询 / 保存基本信息；保存带 revision |
| DELETE | `/api/workbenches/{id}?revision=...` | 无项目时删除 |
| GET / POST | `/api/workbenches/{id}/config` | 聚合查询 / 保存本体；返回 workbench、config、agents、templates、knowledgeBases |
| PUT / DELETE | `/api/workbenches/{id}/bindings/{kind}/{targetId}?revision=...` | kind 仅 agents / tpls；返回新聚合配置 |
| POST | `/api/workbenches/{id}/publish` | `{revision}`；返回 workbench 和 version（含快照） |
| GET | `/api/workbenches/{id}/versions` | 发布历史摘要，按版本倒序 |
| GET | `/api/workbenches/{id}/versions/{versionId}` | 完整发布快照 |
| GET | `/api/projects?workbenchId=...` | 本人项目，可选工作台筛选 |
| POST | `/api/projects` | `name,desc,workbenchId`；返回项目 |
| GET | `/api/projects/{id}` | project、workbench、workbenchVersion、空资源、零用量与 capabilities |
| POST | `/api/projects/{id}` | `revision,name?,desc?,status?`；状态 active / paused / archived |

两种创建请求均必须带 `Idempotency-Key`（1–128 位字母、数字或 `._:-`）。相同用户、相同接口、相同键和相同规范化内容返回首次对象；相同键但不同内容返回 409。不同用户的键互不影响。前端同一个表单内容失败重试复用键，改变内容后生成新键。重试创建项目仍返回首次固定的版本，即使工作台已有新发布版本。

草稿保存允许提交指定字段，未提交的保留；数组整体替换。示例：

```json
{
  "revision": 3,
  "bizName": "合同审查",
  "domain": "法务",
  "bizDef": "定义审查对象、风险和依据。",
  "wikiMd": "# 合同\n业务术语定义",
  "entities": [{"id":"contract","name":"合同","description":"被审查文件"}],
  "relations": [{"id":"related","name":"关联合同","description":"","sourceEntityId":"contract","targetEntityId":"contract"}],
  "applicabilityMd": "适用范围",
  "exclusionsMd": "排除范围",
  "systemPrompt": "专家处理此业务的提示词",
  "defaultAgentId": null
}
```

名称、领域、业务定义在发布时必填；实体/关系最多各 200 项，ID 必须唯一且稳定，关系只能引用当前本体实体，默认专家只能选已绑定对象。业务文本限制 24,000 字符、本体总量限制 256 KiB。编辑器提供 Markdown 安全预览，不执行原始 HTML、链接或图片。系统提示词仅存储，本批不执行。

项目详情的 `project.runtime=null`，项目及聚合详情均包含 `capabilities:{execution:false,resources:false}`。专家展示信息取固定快照；工作台新版本、目录改名及解绑不会修改历史快照。默认专家 ID 与专家展示信息不授予私人模型凭据访问权。

## 页面路径与兼容

- 专业工作台：`#/workbench?tab=pro`；配置：`#/workbench?tab=pro&id={id}`。
- 工作台项目：`#/projects?wb={id}`；项目详情：`#/project/{id}`；列表支持状态及名称/说明筛选。
- 创建后先编辑本体与引用，再发布；新建项目只显示本人已发布的工作台。
- 网络失败保留弹窗输入；409 显示重新加载提示，不自动覆盖。重新加载/账号变化/离开页面后，过时响应不回填页面。
- 配置及项目缓存仅来自 Java，退出和切换账号清理；专业列表不依赖项目接口加载。
- 广场的普通“使用模板”旧入口不再向写死的 `wb-doc` 创建项目，标为暂未接入；可以在工作台引用案例并发布后创建项目。广场“引用到当前专家”保持已有行为。
- 首页/统计显示当前账号真实数量、空任务及零用量；侧栏不展示演示配额。指挥官、情报中心和项目未接入标签页保留导航并明确标注。

## 使用方启动与迁移

1. Nacos 继续使用本模块现有 `spring.datasource`，库名为 `nebuwork_1`；沿用统一会话 Redis。无需新增工作台专用 Nacos 密钥或修改网关规则。
2. 在 Java 合集重新构建 `nebuwork-backend-api` 并启动 `NebuworkBackendApiApplication`（42020、`/nwaa`）。可在 IDE 操作，或从合集根目录执行 `mvn -pl nebuwork-backend-api clean package -DskipTests` 后使用原启动方式。
3. 启动时 Flyway 顺序执行待执行的 V1–V4；已执行的 V1–V3 不修改。V4 只新增六张表，无数据种子写入；重复启动不重建、不覆盖。现有迁移策略校验正式数据源只能指向 `nebuwork_1`，禁止跨库迁移。
4. 确认启动日志完成 V4；前端按原方式 `npm run dev`，刷新后进入专业工作台验证。网关仍为 42000，开发浏览器请求前缀保持 `/nebulaedev/nwaa`。

## 使用方验收清单

1. 账号 A 首次列表为空；空白创建和六类模板都能保存、刷新恢复，模板只预填定义。重启 Java 后配置仍存在。
2. 账号 B 的列表不出现 A 的工作台/项目；用 A 的对象 ID 读取或修改配置、绑定、版本、项目均返回 404；伪造 userId 请求头不能登录。审计 actor 为真实会话用户。
3. 绑定专家/案例、重复绑定、解绑后刷新一致。未绑定专家不能设为默认；解绑默认专家清空草稿默认，但旧发布版本保持原值。
4. 实体、关系、wiki、规则、系统提示词保存后恢复；重复 ID 或跨本体关系拒绝；原始 HTML 预览不会执行。名称/领域/业务定义未填不能发布。
5. 发布 v1，重复发布不增版本。修改草稿后历史仍不变；双页面同 revision 保存仅一次成功，另一次 409 且表单输入保留。
6. 未发布工作台不能创建项目。创建项目 P1 后发布 v2，P1 保持 v1，新项目 P2 使用 v2。已有项目本批不提供升级。
7. 重试同一创建请求不多建工作台/项目；同键不同内容 409，不同账号可用同键。项目创建重试不随新发布改变版本。
8. 项目直接地址可访问并编辑名称、说明、状态。任何状态下只要仍有项目，工作台删除均 409；无项目删除成功，公共目录不受影响。
9. 失败不显示成功、不开假数据；加载错误可重试；保存/读取中退出、换号或离开页面后，不出现旧账号数据或旧页面回填。
10. 首页与统计数量对应数据库；任务、用量、知识库为零/空，runtime 为 null，未接入资源按钮不能假保存。实际请求都由 Java 处理。

## 已补充但未运行的用例

- Java `WorkbenchApiTest`：模板/空态、归属隔离、绑定默认专家、实体关系校验、历史及项目快照、迁移幂等、删除限制、幂等键及并发写入/发布。
- 前端 `workbenchApi.test.js`：独立加载、缓存失败保护、POST 契约/幂等键、旧读取与账号变化、删除结果一致性。
- 前端 `editors.test.js`：创建失败保留输入和键、关闭/离开后忽略响应、稳定实体 ID、未发布工作台限制、项目状态、Markdown 安全预览。
- 前端 `views.test.js`：工作台服务失败重试、无 Mock 回退、真实空统计、runtime=null 详情、离开页面后的迟到响应。

## 验证安排

遵循用户要求：不代运行测试、构建、服务、浏览器验收或数据库迁移。补充测试代码与人工验收清单，最终由用户重建并启动 Java 执行 V4，再刷新前端验证。网关、统一用户服务、NebuAgentCore 不修改。
