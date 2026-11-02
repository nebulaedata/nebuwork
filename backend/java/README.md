# NebuWork Java 后端

这里是独立的 `nebuwork-backend-api` Maven 工程，直接位于 `backend/java/`。包含业务 API、新增的本地账号服务和文件预览辅助进程；没有原 Java 合集的父 POM、共享源码模块、网关或原用户模块。

整套本地/局域网联调请在仓库根目录执行 `.\scripts\Start-Dev.ps1`，使用全新组件和账号。详见 [Docker dev 与账号 API](../../deploy/dev/README.md)。下方单工程启动方式仍使用迁移时的 Nacos 和数据库配置。

保持 Java 8、Spring Boot 2.7.6、MyBatis 及既有接口，默认端口 `42020`、上下文 `/nwaa`。默认从 `192.168.204.128:8848` 的 Nacos `nebuwork-dev` 命名空间加载配置，沿用原数据库和组件。

## 本地直接启动

安装并启动 Docker Desktop 后，在仓库根目录执行：

```powershell
.\backend\java\scripts\Start-Local.ps1
```

脚本默认使用 `compose.nacos.yml`，只构建并启动 API，等待 `http://127.0.0.1:42020/nwaa/api/health` 返回成功；不创建 MySQL / Redis，也不替换原加密密钥。Nacos 凭据已配置在 Git 忽略的 `config/nacos.properties`，以只读方式挂入容器。新检出工程时，从 `config/nacos.example.properties` 创建该私有文件并填写密码。

本地 Compose 项目名默认为 `nebuwork-java`。在本目录运行 `docker compose -f compose.nacos.yml -p nebuwork-java logs -f api` 查看日志，运行 `docker compose -f compose.nacos.yml -p nebuwork-java down` 停止服务。`.env` 仅用于本机对外端口等 Compose 参数；数据库、Redis、模型/知识库密钥和组件连接以 Nacos 配置为准。

账号登录现由本服务 `/nwaa/api/auth/*` 提供，使用 V29 的本地账号/会话表和 Redis；不再解析原统一用户服务的 Redis token。新 dev 的管理员由根目录启动脚本生成。独立启动其他环境时，需明确配置 `NEBU_AUTH_BOOTSTRAP_ENABLED=true`、`NEBU_AUTH_ADMIN_ID`、`NEBU_AUTH_ADMIN_ACCOUNT` 和 `NEBU_AUTH_ADMIN_PASSWORD` 才会在首次运行创建管理员；已有账号不会被重置。

## 使用已有基础设施或 IDE

在本目录执行：

```powershell
mvn clean verify
java '-Dfile.encoding=UTF-8' -jar target/nebuwork-backend-api.jar
```

也可启动 `NebuworkBackendApiApplication`，或使用 `scripts/Run-Local.ps1 -Build`。工作目录设为本目录，启动阶段自动读取私有的 `config/nacos.properties`。本机需要 JDK 8+ 和 Maven 3.6+；Docker 启动方式自带 Java/Maven，不要求宿主机安装。

必须使用 `nebuwork_1` 数据库；启动时 Flyway 校验并执行 V1–V29 迁移，禁止 clean 和跨库迁移。版本库不包含真实密码、业务数据或用户数据。

主要环境变量：

| 变量 | 用途 |
| --- | --- |
| `NEBU_NACOS_SERVER_ADDR` | Nacos 地址，默认 `192.168.204.128:8848` |
| `NEBU_NACOS_NAMESPACE` | namespace ID，默认 `nebuwork-dev` |
| `NEBU_NACOS_USERNAME`、`NEBU_NACOS_PASSWORD` | Nacos 认证，保存在私有 properties 文件或进程环境中 |
| `NEBU_PROFILE` | 配置环境，默认 `dev`，读取对应的服务及共享配置 |
| `NEBU_NACOS_ENABLED` | 默认开启；隔离开发和普通自动化测试关闭 |
| `NEBU_API_PORT` | 原生 Java 服务端口，或 Compose 对外端口 |
| `NEBU_ALLOWED_ORIGINS` | 写请求来源；本地默认为 `*`，部署时可设具体来源列表 |

扩展市场、数据库资源、文件预览等功能继续遵守原有默认开关及权限。高级知识库/预览配置参考 `config/examples/`，需要时合入本地配置。智能体引擎连接仍在系统设置中管理，不从旧工程读取配置。

## 显式使用隔离环境

需要全新的本地 MySQL / Redis 时，执行 `scripts/Start-Local.ps1 -Isolated -ProjectName nebuwork-java-isolated`。该模式使用 `compose.yml`，关闭 Nacos，首次生成 Git 忽略的 `.qa/isolated.env`，与正常环境的 Nacos 配置分开。配置模板见 `.env.isolated.example`；本机数据库端口为 `43316`，Redis 为 `46389`。本地新 Redis 不包含原账号会话。

## 目录与验证

- `src/main`：业务代码、28 份原始迁移和 HTML 服务资源。
- `src/test`：既有 Java 与 HTML 宿主测试，测试账号和种子仅存在于测试源码。
- `preview-worker`：本模块原有可选文件预览进程，使用其独立 Java 17 工程；API 启动不需要它。
- `README-*.md`：历史功能交付记录；当前启动说明以本文件为准。

执行 `mvn clean verify` 验证 Java 工程，执行 `node --test src/test/js/workbench-service-page.test.cjs` 验证 HTML 宿主逻辑。普通测试强制关闭 Nacos；实际配置验收使用显式开启的测试，并只加载配置、不启动业务 Bean 或连接业务数据库。见 [Nacos 配置记录](../../docs/nacos-configuration.md) 和 [Java 迁入说明](../../docs/java-migration.md)。
