> 历史功能交付记录：其中的 Nacos、原父工程和部署说明仅描述旧环境。当前独立工程的启动、配置及构建方式以 [README.md](README.md) 为准。

# 专业工作台与项目

实现位于 `api/workbench`，当前使用 V4–V6 迁移。V6 已取消六类固定预置及通用模板强制依赖，目录从核心接口获取，允许直接空白创建和发布。当前部署与接口以 [核心联通说明](README-core-integration.md) 为准；下文其他内容保留 V4 阶段记录。

## 启动与迁移

沿用本模块现有 Nacos 数据源（`nebuwork_1`）和统一登录 Redis。不新增账号表或跨库外键，不修改网关和 NebuAgentCore。V4 不修改 V1–V3，不导入演示工作台/项目数据；已有正式数据源保护会在库名不正确时停止迁移。

使用方重新编译并启动 `NebuworkBackendApiApplication`，由 Flyway 执行 V4；Java 42020、context-path `/nwaa`，网关 42000、开发前缀 `/nebulaedev/nwaa` 保持不变。未替使用方运行构建、测试、服务、迁移或浏览器验收。

## 接口与约束

全部沿用 `{code,data,msg}`，拥有者由 `RequestIdentity.actor()` 决定，他人对象为 404。模块内接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/workbench-templates` | 核心真实模板目录及兼容状态，允许为空 |
| GET / POST | `/api/workbenches` | 本人列表 / 创建 |
| GET / POST / DELETE | `/api/workbenches/{id}` | 基本信息 / 修改 / 无项目时删除 |
| GET / POST | `/api/workbenches/{id}/config` | 聚合配置 / 保存本体草稿与默认专家 |
| PUT / DELETE | `/api/workbenches/{id}/bindings/{kind}/{target}` | kind 为 agents 或 tpls |
| POST | `/api/workbenches/{id}/publish` | 按 revision 发布 |
| GET | `/api/workbenches/{id}/versions`、`/versions/{version}` | 历史列表 / 详情 |
| GET / POST | `/api/projects` | 本人列表（可按 workbenchId 筛选） / 创建 |
| GET / POST | `/api/projects/{id}` | 聚合详情 / 基本信息及状态修改 |

创建工作台/项目必须提供 `Idempotency-Key`。相同用户的同键同内容重试返回首次对象，不同内容 409。修改/发布使用 body.revision；删除和绑定使用 query.revision，过期返回 409。工作台基本信息、草稿、引用共用 revision，发布不增加 revision，同 revision 只生成一个版本。

本体字段：bizName、domain、bizDef、wikiMd、entities、relations、applicabilityMd、exclusionsMd、systemPrompt、defaultAgentId。实体/关系有稳定 ID；关系限本体实体，默认专家限已绑定专家。发布要求前三项非空，并校验全部引用。快照包含引用 ID 与当时展示信息，不冻结专家内部配置，不含私人模型凭据。

项目必须关联本人的已发布工作台；在事务中锁定工作台并固定当时发布版本。项目仅可修改 name/desc/status（active、paused、archived），归属和版本不可更换。项目 detail 返回固定快照、空资源与零用量，runtime=null、capabilities.execution/resources=false。

有任何项目时禁止删除工作台。无项目时删除草稿、绑定、发布版本，主表留删除标记和请求键防止旧请求复活；不删除专家或案例目录。全部配置变更同事务写 nw_config_audit。

## 用例（未运行）

`WorkbenchApiTest` 使用隔离 H2 与模拟会话，覆盖两账号归属、幂等创建、草稿校验、并发修改/发布、固定项目快照、删除限制和迁移不覆盖。使用方运行测试前按原 Java 工程方式构建依赖即可；本次没有实际连接或变更数据库。
# V5 联通补充

当前专属模板发布、核心项目创建及失败恢复见 [核心联通说明](README-core-integration.md)。下文保留 V4 配置阶段说明；新项目现在要求已联通的核心发布版本，历史项目不自动迁移。
