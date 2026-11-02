# Agent Core v2.0.0 迁入记录

2026-10-26 将 `D:/Work/Code/AiCode/NebuAgentCoreNew2` 迁入 `agent-core/v2.0.0/`。来源目录和 Git 状态保留；包含原工程尚未提交的修改，以及新增的 HTML 打包源码和测试。

## 导入与启动

从来源工作区导入 82 个代码、契约、部署和说明文件，逐文件 SHA-256 核对通过。未复制原 `.git`、依赖目录、构建目录、历史运维备份、日志及 27 个 QA / 验收证据文件。来源摘要和后续修改记录见 [agent-core-v2-import.json](agent-core-v2-import.json)。

私有 `.env` 单独原样复制，已排除 Git 和 Docker 构建上下文。没有生成新凭据，没有重写数据库、Redis、S3、Java 回调或平台 MCP 设置。原 README 保存在新目录的 `README-upstream.md`，启动说明以新的 [引擎 README](../agent-core/v2.0.0/README.md) 为准。

工程版本及镜像为 `2.0.0`，Compose 项目名为 `nebu-agent-engine-v2-0-0`。HTTP / RuntimeManifest 契约仍为 v1，pi SDK 仍为 1.1.0。依赖声明、解析后的依赖图及四份契约文件均与来源一致；只调整工程版本元数据、启动脚本、部署标识、验收路径和存活接口的版本标记。

在仓库根目录运行：

```powershell
.\agent-core\v2.0.0\scripts\Start-Local.ps1
```

部署保留两个 API、三个 Worker 和一次性迁移服务；不附带新的数据库、Redis 或对象存储。迁移服务沿用原 schema 初始化逻辑，启动脚本不调用基础设施创建、业务重置、历史配置迁入或用量回填操作。可选平台 MCP 使用 `-PlatformMcp`。

原生 Node 启动命令自动加载本工程 `.env`，不依赖原目录的 Node 模块或环境加载器。跨项目验收的报告和输入元数据改为本工程 `.qa/` 或显式指定的路径。

## 保持的基础设施

| 项目 | 校验结果 |
| --- | --- |
| 私有环境配置 | 与来源逐字节相同，全部变量解析值相同 |
| MySQL | 原 `192.168.204.128:3306/nebu_agent_engine` 可连接，schema 已存在 |
| Redis | 原地址、认证、database 和频道前缀保持一致，PING 成功 |
| S3 | 原 endpoint、bucket `mrtoken` 和 `nebu-agent-engine/` 前缀保持一致，HeadBucket 成功 |
| 业务 / 平台组件 | 原回调地址、签名密钥、回调密钥、平台 MCP 密钥和沙箱镜像保持一致 |

对现有基础设施仅执行只读检查，没有创建数据库、写入对象、发布 Redis 通知、执行共享库迁移或启动共享业务任务。集成测试使用新项目 `nebu-engine-v2-test` 的本地 MySQL / Redis / MinIO。

## 验证

- `npm ci --ignore-scripts` 完成，独立目录安装依赖成功。
- 类型检查和 TypeScript 构建通过。
- 14 个常规测试文件、64 项测试通过，包括真实 pi SDK、Docker、SQL、对象存储、HTML 打包、文件传输及恢复逻辑。
- 独立 Docker 镜像 `nebu-agent-engine:2.0.0` 构建成功；确认镜像不含私有 `.env`。
- 新镜像运行两个 API、三个 Worker 的分布式验收复跑通过：Worker 被终止、Redis 重启后恢复，固定配置、成果读取和事件重放保持有效。
- 原目录 109 个版本化 / 未忽略文件摘要、原 Git 状态、私有环境文件和原依赖图核对一致。

故障注入验收中修正了一处仍引用旧 Redis 容器名的测试代码。另一次恢复曾返回通用 `execution_error`，随后带诊断日志的复跑通过；该次失败原因未确定，未修改生产恢复逻辑。诊断日志保留在新工程本地 `.qa/distributed/`。

依赖保持原锁文件版本。安装时 npm 审计报告 7 项告警（4 moderate、3 high），本次迁入没有执行依赖升级或 `npm audit fix`。
