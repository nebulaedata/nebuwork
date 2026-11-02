# NebuWork 独立 Docker dev 环境

首次部署请先阅读 [快速部署指南](../README.md)（[English](../README.en.md)）；本文保留详细配置、账号 API 和历史验证记录。

在仓库根目录执行（需要 Docker Desktop，使用 Linux containers）：

```powershell
.\scripts\Start-Dev.ps1
.\scripts\Get-DevAccess.ps1
```

第一个命令生成独立凭据、启动组件、构建业务、引擎、Workflow 和 V101 知识库、执行数据库迁移、创建管理员，并检查及保存引擎、Workflow 和 V101 知识库连接。第二个命令显示访问地址、管理员账号和初始密码。首次构建需要下载依赖；已有镜像时可用 `Start-Dev.ps1 -NoBuild`。

主入口是 <http://localhost:18080>。局域网设备使用 `http://本机局域网IP:18080`，浏览器 API 和 Cookie 都走同一个入口，无需重新打包前端。Windows 防火墙需允许所在专用网络访问 TCP 18080；脚本不会修改系统防火墙。该配置用于本地开发验证，默认 HTTP；如配置 HTTPS，可同时设置 `nebu.auth.cookie-secure=true`。

## 两个 Compose

| 项目 | 配置文件 | 服务 |
|---|---|---|
| `nebuwork-dev-component` | `compose.component.yml` | MySQL、Redis、MinIO、Nacos、知识库 PostgreSQL/pgvector、Neo4j/APOC、数据库及配置初始化 |
| `nebuwork-dev-app` | `compose.app.yml` | 前端/Nginx、Java API/账号服务、引擎迁移、2 个引擎 API、3 个 Worker、平台 MCP、Workflow 3.5、V101 知识库/解析及条款提取、应用接入初始化 |

两个项目共享专用网络 `nebuwork-dev`。引擎沙箱镜像为 `nebuwork-dev-sandbox:2.0.0`，由启动脚本独立构建，Worker 按任务创建短期沙箱容器。镜像、网络和所有数据卷均使用 `nebuwork-dev-*` 名称。

`preview-worker` 是 `preview` profile 下的可选 Office 大文件转换进程，需 `Start-Dev.ps1 -Preview` 构建启动，并在新 Nacos 的 `cccs-config-base-dev.yml` 设置 `nebu.files.enabled=true`。默认关闭大文件接口，避免把未启用的转换能力显示为可用。该进程需要 `NET_ADMIN` 隔离文档转换网络，并可能占用较多内存。

## 独立配置和持久化

启动脚本只读取 `deploy/dev/.env`，不读取各工程迁移时的私有 `.env`、旧 `nacos.properties` 或原 Workflow 运行目录。`init.mjs` 仅在第一次运行时生成随机凭据；`.env` 和生成的 SQL 已被 Git 忽略，镜像构建也排除了私有配置。

MySQL 内有三个独立库和账号：

| 数据库 | 用途 | 数据库账号 |
|---|---|---|
| `nebuwork_1` | Java 业务、用户和会话 | `nebuwork` |
| `nebu_agent_engine` | 引擎任务、集群和执行状态 | `nebuengine` |
| `nacos_dev` | Nacos 配置、命名空间及管理账号 | `nacosdev` |

Java 自动执行 V1–V30；引擎执行自身迁移；Nacos 首次导入随 `nacos/nacos-server:v2.4.2` 发布的官方 MySQL schema（`nacos/mysql-schema.sql`，保留原 Apache 2.0 许可）。Nacos 使用 `nebuwork-dev` 命名空间和 `DEFAULT_GROUP`，自动创建三份新配置：`cccs-database-base-dev.yml`、`cccs-config-base-dev.yml`、`nebuwork-backend-api-dev.yml`。其中仅包含本环境 Docker 服务名和新凭据。[Nacos 2.4 鉴权说明](https://www.nacos.io/docs/v2.4/manual/admin/auth/)

Redis DB 0 用于 Java 会话，DB 1 用于引擎通知；MinIO 使用私有 bucket `nebuwork-dev`。Workflow 的项目目录和 SQLite/运行数据分别位于新卷 `nebuwork-dev-workflow-project`、`nebuwork-dev-workflow-runtime`，首次仅放入仓库的无模型 demo 工作流。Java 文件使用 `nebuwork-dev-backend` 卷。

重复启动会保留账号、密码、Nacos 配置、引擎/Workflow 接入设置与业务数据。完成首次接入后，初始化不再使用管理员的初始密码登录，因此管理员改密不会导致重启失败。保留 `.env` 和数据卷作为一组；删除 `.env` 后生成的新密钥不能解密原有数据。普通 `stop`、`down` 不删除数据卷；不要使用 `down -v` 清理有用数据。

## 账号服务

账号服务位于当前 Java 工程，已替换前端对原统一用户服务的调用。初始账号为 `admin`，随机初始密码由 `Get-DevAccess.ps1` 显示；原用户模块不参与此环境。

V29 新增两张表：

- `nw_user_account`：稳定用户 ID、唯一账号、BCrypt 密码摘要、显示名、admin/user 角色、启用状态和时间。
- `nw_account_session`：会话 token 的 SHA-256 摘要、所属账号、创建/过期/撤销时间；原始 token 只通过 `HttpOnly; SameSite=Lax` 的 `nebuwork_session` Cookie 传输。

账号名使用 3–64 位字母、数字或 `_.@-`，忽略大小写。密码至少 12 字符、至多 64 UTF-8 字节。登录获取当次运行的 RSA 公钥并加密密码；12 小时会话同时经 Redis 和 SQL 校验。注销、停用或重置密码立即撤销相关会话，重新启用账号也不会恢复旧会话。登录按账号和客户端连接设置五分钟限流；管理接口仅管理员可访问。

浏览器接口统一前缀 `/nebulaedev/nwaa/api/auth`，内部 Java 前缀 `/nwaa/api/auth`，返回 `{code:0,data:...,msg:...}`。

| 方法与路径 | 请求 / 作用 |
|---|---|
| `GET /public-key` | 返回 `publicKey`，RSA 2048 / PKCS#1 v1.5 |
| `POST /login` | `{account, encryptedPassword}`，写入 Cookie |
| `GET /me` | 当前账号的公开资料 |
| `POST /logout` | 撤销当前 Cookie 会话并清除 Cookie |
| `GET /accounts` | 管理员查看账号列表 |
| `POST /accounts` | 管理员新增普通账号，`{account,password,name}` |
| `POST /accounts/{id}/enabled` | 管理员启用/停用，`{enabled:true/false}` |
| `POST /accounts/{id}/password` | 管理员重置密码，`{password}`；同时撤销全部已有会话 |

暂不提供自助注册、找回密码、第三方登录或账号管理页面；账号可通过以上管理 API 创建。前端现有登录、退出和用户资料显示已接入。

## 端口和凭据

| 入口 | 默认地址 | 凭据位置 |
|---|---|---|
| NebuWork | `0.0.0.0:18080` | `DEV_ADMIN_ACCOUNT` / `DEV_ADMIN_PASSWORD`（初始密码） |
| V101 原生知识库 | `http://localhost:18081` | 原生管理页面 |
| Workflow 管理页面 | `http://localhost:18082` | `WORKFLOW_UI_ACCOUNT` / `WORKFLOW_UI_PASSWORD` |
| Neo4j Browser | `http://localhost:27474/browser/` | `neo4j` / `KNOWLEDGE_GRAPH_PASSWORD` |
| Neo4j Bolt | `bolt://localhost:27687` | 同上 |
| MySQL | `127.0.0.1:13316` | `JAVA_DB_PASSWORD` / `ENGINE_DB_PASSWORD` / `NACOS_DB_PASSWORD` |
| Redis | `127.0.0.1:16389` | `REDIS_PASSWORD` |
| Nacos | `http://localhost:28848/nacos` | `nacos` / `NACOS_PASSWORD` |
| Nacos 客户端 gRPC | `127.0.0.1:29848` | Nacos HTTP 端口 + 1000 |
| MinIO S3 | `http://localhost:29000` | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` |
| MinIO Console | `http://localhost:29001` | 同上 |

有前端界面的服务按 `DEV_BIND`（默认 `0.0.0.0`）发布端口，可将上述 localhost 换为宿主机局域网 IP；MySQL、Redis 和 Nacos gRPC 保持本机访问。V101 直接入口提供原生管理页面，主站知识库工作区沿用 Java 账号授权。Workflow 独立入口由 Nginx 提供 HTTP Basic 登录并在服务端附加原服务令牌；凭据和旧配置由初始化脚本保留，Workflow 源码和原服务鉴权不变。Neo4j Browser 的连接地址使用对应主机的 27687 端口；可用 `DEV_NEO4J_ADVERTISED_HOST` 设置对外通告主机。Java、引擎、条款提取 API 和平台 MCP 继续在 Docker 网络中提供服务。外部配置填写浏览器可达的地址时，不要使用 Docker 服务名。管理员可在设置页添加自己的模型厂商与密钥；没有预置真实模型凭据，因此 AI 对话/智能体执行需完成模型配置后验证。V101 知识库已迁入 knowledge/V101 并自动登记独立连接；模型需管理员配置。记忆服务仍未迁入。依赖原有可选服务的功能不会自动连接原环境。

2026-10-26 起，模型、知识库及数据库连接默认关闭网络地址分类拦截和目标白名单；记忆、智能体引擎、Workflow 连接也按实际 DNS 结果连接。本机、内网与代理 Fake-IP 均可使用，填写容器实际可达的地址即可（如 `http://host.docker.internal:11434`）。HTTP(S)/主机端口格式、登录授权、账号归属和密钥加密照常执行。

## 运维与验证

```powershell
# 保留数据停止两套服务
.\scripts\Stop-Dev.ps1

# 查看状态及日志（在仓库根目录）
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.component.yml ps
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml ps
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml logs --tail 100 backend

# API 验证（需要宿主机 Node 22；读取本地 .env 的管理员密码）
node deploy/dev/verify.mjs
# 可换成实际局域网地址
node deploy/dev/verify.mjs http://192.168.x.x:18080
```

验证脚本检查真实登录/注销、CSRF、普通用户权限和数据隔离、停用会话、双引擎 API/Worker、Java → Workflow 创建及 Python 执行。它会创建带随机 `qa_` 前缀的账号和验证工作流，结束后停用测试账号、删除临时工作台、归档验证工作流，保留执行记录。若管理员已改密，先同步本地 `.env` 中的 `DEV_ADMIN_PASSWORD` 再执行该验证脚本；正常重启无需同步这个初始密码。

Linux/macOS 或直接使用 Compose 时，请按 [快速部署指南中的 Bash 步骤](../README.md#linux--macos--bash) 依次生成配置、设置文件权限、启动全部基础组件、初始化、构建和启动应用。每个 Compose 命令均显式传入同一个 `--env-file deploy/dev/.env`。

本机前端热更新可在 `frontend` 中执行 `npm ci`、`npm run dev`，Vite 默认转发到新 dev 入口 `http://127.0.0.1:18080`，保留浏览器 Host 和 Cookie。如有旧的私有 `apps/web/.env*`，将其中的代理地址改为新入口。

## 本次验证（2026-10-26）

- 四个应用镜像及独立引擎沙箱构建通过，两套 Compose 实际启动并完成初始化。
- Java 定向验证共 34 个不同测试通过（账号安全、HTTP 路由/来源检查、专家接口和模型密钥安全）；前端登录/会话测试 10 个通过。
- 本机及局域网 IP 的真实浏览器登录、专家列表空态、HttpOnly Cookie、当前账号和注销通过。
- HTTP 验证通过：普通账号隔离、管理权限、CSRF、停用/重新启用后的旧会话失效，Java 调用 Workflow 创建工作流并完成实际 Python 任务。
- 两个引擎 API 就绪，三个 Worker 均有在线心跳。重复启动保留三份 Nacos 配置、管理员和已保存的连接。
- 新凭据未出现在 Git 可见文件中；运行时挂载仅为新 dev 卷及引擎所需 Docker socket。

未进行付费模型调用；可选预览 Worker 尚未启动。局域网地址已从本机浏览器验证，其他物理设备需根据本机防火墙策略访问。

## UUID 与局域网 HTTP（2026-10-26）

主前端、Workflow UI、Java 发布页面 SDK、Agent Core 和开发脚本统一使用 `createUuid()`，通过 `crypto.getRandomValues` 生成标准 UUID v4。业务代码不再调用 `crypto.randomUUID`，也不使用时间戳或 `Math.random` 作为 UUID 退路；不改变原有请求重试时的幂等键复用规则。

各工程保留独立的 UUID 工具文件。两个前端的 `tooling/secure-uuid.mjs` 将浏览器依赖中对原生 UUID 接口的访问指向同一生成器，覆盖 PDF/PPT 预览、Monaco 及其 Worker；开发服务器排除这些依赖的预打包，让相同转换生效。Java 的 `java.util.UUID` 不属于浏览器接口，保持原样。

```powershell
# 源码、标准 UUID 格式、随机性和独立工程副本一致性
node scripts/check-uuid.mjs
# 两个前端构建后，同时检查浏览器产物
node scripts/check-uuid.mjs --bundles
```

本次 UUID 定向测试 69 个通过，主前端、Workflow 和引擎类型检查/构建通过，四个应用镜像重建并启动。本机和局域网 HTTP 的浏览器验证覆盖登录、工作台/工作流创建、运行场景新增/复制/保存以及 Monaco 代码编辑器；验证时访问原生 UUID 接口会直接抛错。源码 Vite 热更新模式也通过同样的页面验证。临时工作台已删除，验证工作流已归档。

网络地址放开回归：`node deploy/dev/verify-network-access.mjs` 使用一次性 Docker 服务验证内网 DNS、198.18.0.0/15 模型目录和 V101 内网页面导入，结束后清理测试库、容器及网络，不调用真实模型。

知识库上传（2026-10-27）：主站支持单文件 2 GiB，Java multipart 文件上限 2048 MiB、请求上限 2100 MiB，原代理 2100 MiB 上限可覆盖表单开销。V101 的普通文件/ZIP/音视频默认 2 GiB。`node deploy/dev/verify-knowledge-large-upload.mjs <测试ZIP路径>` 可在临时库中验证超过 100 MiB 文件的真实上传、SHA-256 和来源路径，结束后清理临时库。
