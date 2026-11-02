> 历史功能交付记录：其中的 Nacos、原父工程和部署说明仅描述旧环境。当前独立工程的启动、配置及构建方式以 [README.md](README.md) 为准。

# V12 统一记忆 / V13 页面配置

记忆由 `memory` 包统一管理，Java 为唯一授权边界。全系统连接配置在 **设置 → 记忆设置** 维护，仅指定管理员可以修改或测试。默认关闭。使用方执行 V12/V13 迁移、Maven 测试/构建、服务部署及联调；本次没有运行这些操作。

## 管理员首次配置

1. 备份数据库并由使用方安排 Flyway 顺序执行 V12/V13，再部署新版 Java 和前端。当前 Java 启动会调用 `flyway.migrate()`。V12/V13 现在支持先手工执行同一份 SQL，再由启动迁移补登记：已有表跳过，缺失表创建，V13 初始配置行存在时保持原值。原有 Flyway 失败记录仍需按下文一次性处理。
2. 在 Nacos 的 `nebu.memory.admin-ids` 填写允许管理记忆系统的统一用户 ID，多个 ID 用英文逗号分隔。页面对未授权账号显示其当前 ID，便于部署方核对。空列表拒绝所有修改和测试，不接受浏览器角色或客户端提交的账号作为授权依据。管理员名单只能由部署方维护，不允许用户自行提权。
3. 管理员进入 **设置 → 记忆设置**，填写服务地址、可选访问密钥、启用开关、召回总超时、同步超时和内容预算，按需测试并保存。当前地址 `http://192.168.77.152:8888` 无访问认证，密钥留空。

页面配置保存在 `nw_memory_settings`。第一次保存前沿用 `nebu.memory.*` 部署默认值；保存后数据库为准，后续请求立即读取，Nacos 中同名业务参数不再覆盖。管理员名单与凭据加密主密钥仍属于部署权限。访问密钥使用现有 `nebu.models.encryption-key`（Base64 32 字节）AES-GCM 加密，独立 AAD，不回显、不写入审计正文；无认证服务不需要此加密主密钥。密钥留空表示保留，勾选清除才会删除；轮换密钥不影响已有 Bank。

保存必须带 revision 和 `Idempotency-Key`，响应丢失使用同一请求重试；版本冲突重新加载。`nw_memory_settings_audit` 保存操作者、版本和不含密钥的配置快照。普通账号只返回启用状态、是否配置和本人 ID，不返回地址或密钥状态。

`POST /settings/test` 测试当前表单，不保存、不创建 Bank、不调用模型。只 GET Hindsight `/health`，2xx 表示健康接口可达；不会把它当作访问密钥、提取或召回已验证。[官方健康检查契约](https://hindsight.vectorize.io/api-reference)

已有记忆范围（包括草稿）后固定 REST 地址，防止作业和 Bank 映射意外转到另一实例。页面不提供远端数据迁移。地址修改与首个范围创建共用事务锁；未建立范围时，改址也必须重新填写或清除旧凭据。连接不跟随重定向，不发送 Cookie，目标地址按实际 DNS 结果连接，支持本机、局域网、Fake-IP 及其他地址（2026-10-26 已取消网络地址分类拦截）。

关闭开关暂停后续自动召回与同步，保留内容及队列；已开始的请求可能完成，已固定 Run 快照不替换。重新启用后待处理同步继续。

## API

### V12 失败记录导致 Java 无法启动

`Detected failed migration to version 12 (unified memory)` 表示 Flyway 历史中存在失败记录；后续 `coreController`、`coreMapper`、`sqlSessionTemplate` 的 Bean 错误是初始化被阻断的结果。这段校验日志不包含最初失败的 SQL，不能据此断定所有记忆表都已建好。

对已经手工执行本仓库 V12/V13 的环境，按以下顺序恢复：

1. 保持 Java 实例停止，备份 `flyway_schema_history`。
2. 重新构建 Java，使 `target/classes/db/migration` 或部署包包含新版可重复执行的 V12/V13。无需删除或重建已存在的记忆表。
3. 使用方执行 `scripts/Reset-FailedMemoryMigrations.sql`。脚本只移除脚本名和校验和均匹配已知版本的 V12/V13 **失败**记录，不写入成功记录、不修改业务数据；会输出处理前历史、移除数量及剩余状态。
4. 若没有报告未知失败或 `CHECKSUM_REVIEW_REQUIRED`，启动 Java。Flyway 会执行新版脚本，跳过已存在表、补建缺失表，并自行写入成功历史。

V12 的六张表、V13 的两张表使用 `CREATE TABLE IF NOT EXISTS`；V13 的初始行使用不改变原值的重复键处理，已保存开关、地址、加密凭据、预算、版本和审计全部保留。它们允许重放同一套结构，不会自动修复另一套同名表缺失字段/索引的情况。

如果不确定手工执行的版本、提示未知校验和，或库里已有 V12/V13 **成功**记录，请先执行只读脚本 `scripts/Inspect-MemoryMigration.sql`，核对迁移历史、八张表、字段与索引。若设置表存在，再执行脚本末尾的配置行只读查询。此次按用户要求修改了 V12/V13，因此以前成功执行的版本会有校验和变化；核实结构与脚本一致后，由使用方通过 Flyway `repair` 对齐成功历史。不要把成功记录删掉来绕过校验。

不要直接把 success 改成 1、删除整张历史表、关闭校验或删除记忆表。`repair` 修复的是迁移历史，不会补全业务表。若重启时仍使用旧的非幂等 SQL，清理失败记录后会再次遇到已有表，所以必须先更新构建产物。[Flyway 官方 repair 说明](https://documentation.red-gate.com/flyway/reference/commands/repair)

`MemoryMigrationIdempotencyTest` 覆盖重复执行保留条目、配置、凭据和审计，以及补建缺失表；测试、SQL 和服务重启均由使用方执行，本次未运行。

### 业务接口

所有公共接口复用登录身份、`{code,data,msg}` 和当前账号，路径经现有 `/nebulaedev/nwaa` 网关转发。

| 方法与路径 | 作用 |
|---|---|
| GET `/api/memory/settings` | 后端权限与配置视图，密钥不回显 |
| POST `/api/memory/settings` | 管理员保存全系统配置，需要 `Idempotency-Key` |
| POST `/api/memory/settings/test` | 管理员测试未保存表单，只请求健康接口 |
| GET `/api/memory/targets` | 可提升目标，受账号归属约束 |
| GET `/api/memory/scopes/{kind}/{id}?offset=0` | 条目分页、功能与只读状态 |
| POST `/api/memory/scopes/{kind}/{id}/search` | `{query}`，只检索已生效、有效版本 |
| POST `/api/memory/scopes/{kind}/{id}/entries` | `{title,content}` |
| GET `/api/memory/entries/{id}` | 内容、版本、来源、已提取事实（最多 50 条） |
| POST `/api/memory/entries/{id}` | `{title,content,revision}` 编辑 |
| POST `/api/memory/entries/{id}/{approve,reject,disable,delete,retry}` | `{revision}` |
| POST `/api/memory/entries/{id}/promote` | `{revision,kind,scopeId,title,content}`，项目直接同步，用户/工作台/专家新建草稿 |
| GET `/api/memory/tasks/{id}/context` | 准备快照、实际注入和按需检索记录 |
| GET `/api/memory/cleanup` | 当前账号待清理条目，包含已删除任务，最多 100 条 |

`kind` 为 user/task/project/workbench/expert；user 只接受 `self`，由服务端映射账号。修改接口必须带 `Idempotency-Key`；同账号同键不同内容返回 409。条目 revision 冲突返回 409。归档项目只读；已删除条目仅允许所属账号重试清理。

内部接口 `/internal/core/executions/{run}/memory/search` 和 `/proposals` 复用 `CoreBridgeFilter`；proposals 必须带 `X-Nebu-Call-Id`，且仅能在固定允许范围内创建待审草稿。不得传入任意账号、Bank 或 Hindsight 地址。

## 运行行为

`MemoryRuntime` 在新 Run 写入 policy，在提交 Core 前持久化一次召回快照。`TaskWorker` 收齐终态事件后在同一事务写入来源和同步作业。未标记启用的旧 Run 不处理。任务失败/取消只沉淀任务范围，成功才同时触发独立项目提取规则。来源正文保留用户/助手/状态/待办/成果引用区别，无文件正文或全量工具日志。

`MemoryWorker` 有独立线程池、持久化租约与版本顺序；Retain 使用固定文档编号与 UUID 操作编号，轮询确认 completed 后才标记同步成功。旧版同步未结束时阻止新版越过。网络/429/5xx 持续退避，其他错误或反复提取失败需要手动重试。删除为文档删除，404 视为已清理。历史来源、版本、使用审计保留，不承诺物理抹除业务审计。

Recall 并行请求共享 3 秒网络截止，结果总预算默认 3,000 tokens，按 UTF-8 字节数保守裁剪。只接受 world/experience 且必须验证账号、范围、document_id、metadata.entry_id / revision 与当前有效版本。Bank 的观察合成默认关闭。空结果、部分失败、不可用、禁用、旧 Core 不支持分别记录。

请保持 `nebu.core.instance-id` 和当前 Bank 映射稳定。Hindsight 只接受后端管理员配置的 REST origin；当前访问密钥留空，不配置模型服务密钥。关闭开关仅停止后续召回/同步，保留已固定快照和待处理作业。

验证代码位于 `src/test/java/.../memory/`。仍需使用方在真实 MySQL/Hindsight 0.10.3 验证提取规则、operation 重试、编辑覆盖、删除以及跨账号隔离。完整三端验收清单在前端仓库 `docs/unified-memory-delivery.md`。
