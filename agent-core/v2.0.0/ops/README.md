# 开发环境切换与回退

这些命令是显式运维操作，应用启动不会清理数据。所有私密输出保存在 `.ops/dev-cutover`，已排除 Git 与 Docker 构建上下文。备份含业务数据和加密凭据，不能上传到公共位置。

仅更换或复用 MySQL、Redis、MinIO 时，按根目录 README 的部署步骤更新 `.env` 并启动即可，不执行下列业务重置流程。

1. 停止目标 NebuWork Java 实例的入口和派发；保留统一网关、账号服务和独立业务引擎。
2. 执行 `reset-business.mjs --bootstrap=<Java bootstrap-dev.yml> --output=.ops/dev-cutover --expected-host=<数据库主机> --expected-schema=<NebuWork schema>`。脚本核对独立 schema、导出 SQL、内容哈希和表清单。
3. 设置 `REHEARSAL_DATABASE_URL` 指向隔离的本机 MySQL，执行 `node ops/rehearse-reset.mjs .ops/dev-cutover`。演练重新导入备份、核对每张业务表内容、执行重置、确认历史迁移记录保留。
4. 核对 inventory.json 后执行同一 reset 命令，额外传入 `--apply=<inventory.digest> --entries-paused=true`。目标内容或备份变化都会拒绝执行；完成记录写入 reset-result.json。
5. 从 `.env.example` 准备根目录私密 `.env`，填写已有 MySQL、Redis、MinIO 连接及服务密钥（已有部署保持原密钥）。平台连接通过“设置 → 智能体引擎”管理，不向 Nacos 发布 `nebu.agent.*`。模型连接和业务连接通过现有管理入口重新配置。
6. 执行 `npm run infra:prepare -- --create-database --verify-write` 新建独立引擎库并检查共享基础设施。在每台 Worker 主机构建 sandbox 镜像；执行 `docker compose --env-file .env -f deploy/compose.yml up -d --build`。API 42110/42111、三个 Worker 复用外部基础设施，不再部署 MySQL、Redis、MinIO 容器。
7. 用最新 Java JAR 启动原业务模块，保持 42020、/nwaa 和现有网关路由。Windows 可运行 `java -Dfile.encoding=UTF-8 -jar <jar> --spring.profiles.active=dev`。页面中的 API 地址须从 Java 所在主机/容器可达。模型和服务密钥不应放到命令行。

## 平台连接改为页面管理

日常调整打开 `http://127.0.0.1:5173/#/settings?tab=agent-engine`，可添加同一集群的 API 节点、测试并保存连接，查看 Worker 心跳。配置保存在 NebuWork 数据库，密钥加密；保存后下一次请求生效，不需重启 Java。已有请求使用接收时的连接快照。Nacos 仅继续提供数据库、统一登录、加密根密钥等部署配置。

首次安装先运行新版后端应用 Flyway V20，并由运维在 `nw_agent_engine_admin` 授予经核验的管理员账号 ID；普通用户无权配置连接。页面填写与引擎 `.env` 对应的签名和回调密钥。Worker 扩容仍需在目标主机启动服务，心跳会自动出现在页面；增加 API 地址本身不会部署 Worker。

从已有 Nacos 配置迁移时，使用以下显式一次性操作，不执行业务重置：

```powershell
node ops/migrate-engine-settings.mjs --bootstrap=<Java-bootstrap-dev.yml> --output=.ops/engine-settings --expected-schema=<NebuWork-schema> --phase=import --api-urls=http://127.0.0.1:42110,http://127.0.0.1:42111
# 确认新后端读取数据库配置、引擎回调通过鉴权后，退役 Nacos 原连接项：
node ops/migrate-engine-settings.mjs --bootstrap=<Java-bootstrap-dev.yml> --output=.ops/engine-settings --expected-schema=<NebuWork-schema> --phase=retire
node ops/check-dev.mjs --bootstrap=<Java-bootstrap-dev.yml> --output=.ops/engine-settings
```

导入保留既有凭据与 Workflow 指定管理员，不覆盖已经配置的记录。退役步骤备份原 Nacos 模块并通过 CAS 删除 `nebu.agent`，保留其他设置。应用运行中没有旧配置回退。检查脚本只读，不要求业务库为空。

业务重置清理仅涉及目标 schema 的 nw_* 业务表，保留 flyway_schema_history。旧核心任务、映射和模板表在清空后退役。重置后须重新配置业务连接及管理员授权。不清理统一账号、独立工作流/知识/记忆数据，也不向旧服务导入任何数据。

如需恢复数据，先停止新入口和 Worker，再在审核目标 schema 后导入 business-backup.sql；Nacos 配置原文在 nacos-module-backup.yml。恢复备份会恢复旧业务表结构，应作为显式事故恢复操作；新代码不提供旧引擎兼容模式。禁止一边接收新写入一边还原。

隔离验收使用 tests/acceptance-host.ts 和 Java 的 AgentAcceptanceHostTest。它们使用脚本模型和测试会话，仅验证协议与执行链路；生产部署没有测试登录绕过或默认模型。
