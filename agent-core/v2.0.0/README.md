# NebuAgentCore v2.0.0

独立的 TypeScript / Fastify 智能体引擎，位于 `agent-core/v2.0.0/`。由原 NebuAgentCoreNew2 工作区复制，包含未提交的修改和新增文件，不依赖原目录或其他源码工程。Node.js 要求 22.19.0+；pi SDK 保持 1.1.0，业务 HTTP 契约仍为 v1。

## 直接启动

Docker Desktop 使用 Linux 容器模式时，在仓库根目录运行：

```powershell
.\agent-core\v2.0.0\scripts\Start-Local.ps1
```

脚本复用本目录已迁入的私有 `.env`，构建 `nebu-agent-engine:2.0.0` 并启动一次性迁移服务、两个 API 和三个 Worker，等待两个 API 就绪。若指定的沙箱镜像不存在，会先构建它；已有 `nebu-agent-sandbox:1` 保持使用原镜像。

API 就绪地址为 `http://127.0.0.1:42110/health/ready`、`http://127.0.0.1:42111/health/ready`。需要原有平台 MCP 进程时增加 `-PlatformMcp`；已构建镜像可使用 `-NoBuild`。

新的 Compose 项目名为 `nebu-agent-engine-v2-0-0`，与原工程容器分开。数据库、Redis 和 S3 没有加入部署 Compose，也不会重新生成服务密钥。

在本目录查看状态、日志和停止服务：

```powershell
docker compose --env-file .env -f deploy/compose.yml ps
docker compose --env-file .env -f deploy/compose.yml logs -f --tail 100 api1 api2 worker
docker compose --env-file .env -f deploy/compose.yml stop
```

## 保持现有连接

私有 `.env` 与原文件逐字节一致，并已被 Git 和镜像构建上下文忽略。新检出工程时才需要从 `.env.example` 配置自己的连接；使用现有部署时沿用原值。

| 项目 | 沿用的配置 |
| --- | --- |
| MySQL | `192.168.204.128:3306/nebu_agent_engine` |
| Redis | 原地址、认证和 database，通知前缀 `nebu-agent-engine` |
| S3 / MinIO | `http://192.168.204.1:9000`，bucket `mrtoken`，对象前缀 `nebu-agent-engine/` |
| Java 回调 | `http://host.docker.internal:42020/nwaa` |
| 认证与组件 | 原 ENGINE_SIGNING_KEY、BUSINESS_API_KEY、PLATFORM_MCP_SERVICE_KEY 及沙箱镜像 |

保持数据库中的 cluster ID、对象存储指纹和 Java 中已保存的引擎设置，不创建第二套业务数据。启动迁移服务沿用原来的 schema 初始化逻辑；只有显式运行基础设施准备命令的 `--create-database` 才会创建数据库。Java 的引擎连接仍通过“设置 → 智能体引擎”管理，不写入 Nacos。

只读检查现有基础设施：

```powershell
npm ci --ignore-scripts
npm run infra:check
```

默认检查 MySQL 版本及现有 schema、Redis PING 和 S3 HeadBucket，不写对象、发布消息、创建数据库或执行迁移。

## 原生 Node 启动

在本目录执行：

```powershell
npm ci --ignore-scripts
npm run build
npm start
```

`npm start` 默认启动 API，`npm run start:worker` 启动 Worker，`npm run start:platform-mcp` 启动平台 MCP。开发模式使用 `npm run dev`。这些启动命令自动读取本目录的 `.env`；Worker 仍需要可用的 Linux Docker daemon。镜像中的默认命令直接使用 Compose 注入的环境变量，不要求镜像包含 `.env`。

## 隔离验证

测试使用独立项目 `nebu-engine-v2-test`，端口为 43306、46379、49000。不会把私有 `.env` 加载为测试连接。

```powershell
docker compose -f deploy/compose.test.yml up -d --wait
npm run typecheck
npm test
npm run build
docker build -t nebu-agent-engine:2.0.0 .
npm run test:distributed
```

分布式测试直接运行新版本镜像；可用 `TEST_ENGINE_IMAGE` 和 `TEST_COMPOSE_PROJECT` 指定另一套隔离测试资源。测试完成后，可用 `docker compose -f deploy/compose.test.yml down -v` 清理该测试项目。

跨项目验收的资料和报告默认位于本目录 `.qa/`，也可显式设置 SERVICE_BROWSER_METADATA、SERVICE_PROTOCOL_REPORT、SERVICE_EXECUTION_REPORT；不再写入旧 NebuWorkAgent 目录。这些跨项目验收需要各自的隔离 Java / Workflow 测试宿主，不属于正常引擎启动依赖。

运维迁移、重置与恢复脚本保留在 `ops/`，不由启动脚本调用。引擎运行和业务契约说明见 [原工程说明](README-upstream.md)、[架构](docs/architecture.md)、[平台 MCP](docs/platform-mcp.md) 和 [工作台服务](docs/workbench-services.md)。本次迁入和验证见 [迁移记录](../../docs/agent-core-v2-migration.md)。
