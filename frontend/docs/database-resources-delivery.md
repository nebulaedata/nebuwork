# 专家、工作台与项目数据库交付

实现覆盖 NebuWorkAgent、Java `nebuwork-backend-api` 和 NebuAgentCoreNew2；Workflow 3.5 保持原状。功能默认关闭，未改动共享开发服务或生产配置。

## 使用入口

- 专家详情「数据库」、工作台配置「数据库」资源卡、项目详情「数据库」。项目同时展示自己与所属工作台的数据库，继承项通过来源入口管理配置。
- 可新建 SQLite，或连接 MySQL/MariaDB、PostgreSQL。外部连接默认只读；SQLite 默认开放读取、数据写入与结构修改。密码仅在 Java 加密保存。
- 数据库详情支持表/视图目录、分页筛选排序、字段/主键/索引、Monaco SQL、可视化建表、行新增修改删除、操作记录、连接草稿与发布。视图只读；无可靠唯一键的表禁止修改/删除行；原值变化返回 409 并保留编辑内容。
- CSV/XLSX 可上传或从已有成果选择固定版本，预览、选择工作表、映射字段与类型，再追加到已有表或新建表。导入默认保留文本与前导零。可导出表/查询结果、下载一致 SQLite 快照；任务导出进入版本化成果栏。

## 授权与运行规则

资源按账号与 expert/workbench/project 独立保存。主执行冻结工作台、项目、主专家数据库引用；协作执行冻结公共数据库和自己的专家数据库。即使专家定义共享，数据库仍按账号隔离。每次调用与后台执行均检查冻结授权、当前范围和当前权限，停用/移除阻止后续数据操作。

九个工具为 `database_list`、`database_schema`、`database_query`、`database_execute`、`database_insert_rows`、`database_create`、`database_import`、`database_export`、`database_operation_get`。主执行可以创建项目 SQLite，协作专家可以创建自己的 SQLite；创建操作和本轮授权持久化，不改写原 Manifest。工作台服务发布固定数据库配置引用，执行时继续复查权限。旧 Manifest 缺少字段时视为空列表。

Java 使用独立 JDBC 会话执行数据库操作。JSqlParser 4.9 验证单条 SQL，查询与写入/DDL 分入口；限制数据库及 Schema、可用语法和函数，拒绝文件访问、扩展、管理/授权语句、存储过程与任意事务控制。外部账号权限仍是第二道约束。MySQL/MariaDB 批量数据写入只接受 InnoDB；外部 DDL 独立提交，不能承诺跨 DDL/DML 回滚。新建 MySQL 表后导入失败会回滚数据并明确提示空表保留。

## 持久化与失败恢复

V25 新增数据库主表、配置版本、SQLite 数据快照、持久操作及本轮授权表。配置 revision 防覆盖，数据版本独立于配置发布。外部连接移除只影响平台配置；SQLite 软删除并保留持久对象。

SQLite 活动文件只在 Java 本地临时目录内打开。写入按库串行，关闭事务和文件后上传 New2 的账号隔离 S3/MinIO 不可变二进制对象，再原子提交对象指针、数据版本和操作结果。业务库锁、版本比较及执行权校验防止并发覆盖；对象上传失败、过期节点或版本冲突不会替换当前快照。对象存储身份变化时拒绝读取，必须先迁移原对象。备份/恢复需同时包含 Java 业务库和 New2 对象存储，不可仅恢复其中之一；不自动清理历史快照。

所有操作有稳定幂等键，相同键不同内容返回 409。SQL/导入/导出返回持久 `operationId`；排队、执行中、成功、失败、取消、结果待核对分别展示。页面退出停止读取/轮询，提交的操作继续由后端执行。外部提交结果不确定时标记结果待核对，不重放 SQL；导出可按原编号核对原成果回执，不重新查询或生成文件。大整数和精确小数以字符串传输，NULL 保留。

## 部署

1. 先更新 New2 API/Worker；其 `/v1/capabilities` 必须声明 `databaseResources: true`，二进制对象接口使用现有引擎认证、存储身份及 S3 配置。
2. 更新 Java，应用追加的 `V25__database_resources.sql`，保留 V1–V24；复用既有 `nebu.models.encryption-key`，不要更换现有加密密钥。Java 运行节点需要可写的本地临时目录和目标数据库网络权限。
3. 更新前端，浏览器继续经 `/nebulaedev/nwaa`。不新增公网任意 SQL 服务接口。
4. 在目标环境验收后启用 `nebu.databases.enabled=true`。`allowed-targets` 支持逗号分隔的精确主机/端口，或单独的 `*` 放行任意合法数据库目标；空配置拒绝全部外部目标。

Java 配置示例（按实际环境填写，无数据库凭据）：

```yaml
nebu:
  databases:
    enabled: false
    worker-enabled: true
    allowed-targets: mysql.internal:3306,postgres.internal:5432
    sqlite-max-mib: 128
    file-max-mib: 20
    query-timeout-seconds: 20
    query-max-rows: 1000
    query-max-bytes: 1048576
```

允许任意合法数据库主机和端口时，配置 `allowed-targets: "*"`（YAML 中必须加引号）。`*` 也可作为逗号列表中的独立项，与精确项混用；不支持部分通配符。主机格式、端口范围、DNS 解析及非指定地址/组播/链路本地地址检查继续生效。只使用 SQLite 时无需配置此项。

预览每页最多 100 行，导入最多 200 列/10000 行；SQLite 上限 128 MiB、导入/导出上限 20 MiB，服务端可调低。查询行数、返回字节数及超时由服务端约束。外部连接使用主机、端口、库名、Schema、账号、密码及 TLS 验证配置，不能传任意 JDBC URL。

## 验收记录（2026-10-19）

- 前端完整 Vitest：57 文件、366 测试通过；类型检查、生产构建和 Sites 包装检查通过。数据库交互测试覆盖行唯一键/原值、409 冲突、不确定操作原键恢复、账号切换和真实工具状态。
- Java 完整回归通过；新增数据库用例覆盖账号/范围/专家隔离、配置权限交集、本轮授权、取消、SQLite 并发/快照失败回滚、幂等与过期恢复、导入导出、精确数字/NULL/中文和公式转义。真实 MySQL 8.0、MariaDB 10.11、PostgreSQL 16 验证连接、只读查询、授权写入/建表、精确数字主键编辑；保留 PageHelper 分页兼容回归。
- New2 完整测试：10 文件、43 测试通过；类型检查、构建、契约导出通过。真实 MySQL/MinIO 验证账号隔离二进制对象，并覆盖旧 Manifest、专家委派引用和恢复规则。
- 隔离 HTTP 验收使用真实 pi SDK、Worker、Java 回调、JDBC 与 S3；模型为明确的本地脚本模型。Run `192bedee-b31e-4292-83b5-e5128fa00de1` 完成创建 SQLite → 建表 → 写入两行 → 查询 → CSV 成果，且新库未改写原 Manifest。见 [持久操作与成果记录](database-qa/agent-acceptance.json)。
- 浏览器实际完成 SQLite 创建、建表、行写入、服务重启后读取、Monaco SQL 查询，以及固定版本成果 CSV 预览/映射/新表导入。截图见 [SQL 结果](database-qa/query-result.png) 和 [导入结果](database-qa/imported-data.png)。

可复现的隔离验收入口：Java `scripts/database-compose.test.yml`、`DatabaseBrowserHostTest`（仅 `NEBU_DATABASE_BROWSER=true` 时启动）；New2 `scripts/database-browser-host.ts` 和 `scripts/database-agent-acceptance.ts`。它们使用独立端口与测试身份，不可作为部署配置。最终目标环境的网络/TLS、真实模型与账号验收需按实际部署完成后进行。
