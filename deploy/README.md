# NebuWork 快速部署

**简体中文** · [English](README.en.md) · [返回项目首页](../README.md)

本指南使用仓库自带的 Docker Compose，从源码构建并启动完整的本地开发与评估环境，包括 Web、Java 业务后端、智能体引擎、Workflow、知识库和基础组件。

Windows 用户在仓库根目录执行以下命令即可开始：

```powershell
.\scripts\Start-Dev.ps1
.\scripts\Get-DevAccess.ps1
```

完成后访问 [http://localhost:18080](http://localhost:18080)，使用脚本显示的管理员账号和随机初始密码登录。Linux / macOS 用户请按下方的 Compose 步骤操作。

> 这是开发与评估部署，默认使用 HTTP，并开放部分管理端口。公网部署需要额外配置 TLS、访问控制和网络隔离。模型密钥及业务资料由使用者自行配置。

## 1. 准备环境

- 获取当前仓库的完整源码，打开终端并进入**仓库根目录**，不要在 `deploy/` 目录执行下方命令。
- 安装并启动 Docker Engine 或 Docker Desktop；Docker Desktop 使用 **Linux containers**。
- 使用支持 `up --wait` 的 Docker Compose v2。
- 确保能够访问镜像仓库及 npm、Maven、Python、Go 等构建依赖源。
- 为多服务运行、镜像构建和知识库资料预留内存及磁盘。使用远端模型时不要求在本机运行模型；本地模型所需资源另计。

检查 Docker 是否可用：

```text
docker info --format '{{.OSType}}'
docker compose version
```

第一个命令应返回 `linux`。容器构建会安装各模块的工具链，宿主机无需同时安装 Java、Node.js、Python 和 Go。

## 2. 启动服务

选择与你的系统对应的方式。两种方式均使用 `deploy/dev/.env` 和独立的 `nebuwork-dev-*` 数据卷。

### Windows / PowerShell

```powershell
.\scripts\Start-Dev.ps1
.\scripts\Get-DevAccess.ps1
```

脚本依次完成：生成凭据 → 启动数据库和中间件 → 初始化配置 → 构建应用及沙箱 → 启动服务并执行迁移 → 初始化管理员和服务连接。

首次需要构建镜像，请等待命令成功结束。已有镜像且未修改源码时，可使用：

```powershell
.\scripts\Start-Dev.ps1 -NoBuild
```

### Linux / macOS / Bash

以下步骤对应 PowerShell 脚本的启动顺序。现有集成验证环境为 Windows + Docker Desktop Linux containers；其他宿主机及 CPU 架构需确认所用镜像的兼容性。

先生成凭据，再按需编辑端口和监听地址：

```bash
set -e

docker run --rm --user "$(id -u):$(id -g)" \
  --mount "type=bind,source=$(pwd)/deploy/dev,target=/workspace/dev" \
  -w /workspace/dev node:22.19.0-slim node init.mjs

# Nginx Worker 需要读取此登录校验文件；它保存密码摘要。
chmod 644 deploy/dev/generated/workflow-ui.htpasswd
```

`--user` 让生成的文件归当前用户所有，避免后续 Compose 无法读取 `.env`。仅调整上述 Nginx 校验文件的读取权限，保留 `.env` 和其他凭据文件的私有权限。

在同一终端中继续启动：

```bash
set -e

component() {
  docker compose --env-file deploy/dev/.env -f deploy/dev/compose.component.yml "$@"
}
app() {
  docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml "$@"
}

component config --quiet
app config --quiet
component up -d --wait --wait-timeout 600 \
  mysql redis minio nacos knowledge-postgres knowledge-graph
component run --rm --no-deps init

docker build -t nebuwork-dev-sandbox:2.0.0 \
  -f agent-core/v2.0.0/deploy/sandbox.Dockerfile agent-core/v2.0.0
app build frontend backend engine-api1 workflow knowledge-v101 knowledge-v101-extraction
app up -d --wait --wait-timeout 900 \
  frontend backend engine-api1 engine-api2 engine-worker platform-mcp \
  workflow workflow-ui knowledge-v101 knowledge-v101-extraction
app run --rm --no-deps init
```

这会启动两个引擎 API 和三个 Worker。最后的 `init` 命令用于登记应用连接，不应省略。

登录凭据位于生成的 `deploy/dev/.env`：`DEV_ADMIN_ACCOUNT` 为账号，`DEV_ADMIN_PASSWORD` 为初始密码。该文件包含其他服务的密钥，不要公开或提交到 Git。

## 3. 登录并配置第一个任务

| 入口 | 默认地址 | 登录方式 |
| --- | --- | --- |
| NebuWork | [localhost:18080](http://localhost:18080) | `DEV_ADMIN_ACCOUNT` / `DEV_ADMIN_PASSWORD`，默认账号 `admin` |
| 知识库原生管理页面 | [localhost:18081](http://localhost:18081) | 独立开发管理入口；日常使用优先从主站进入授权知识库 |
| Workflow 管理页面 | [localhost:18082](http://localhost:18082) | `WORKFLOW_UI_ACCOUNT` / `WORKFLOW_UI_PASSWORD`，与主站密码不同 |

管理员改密后，脚本和 `.env` 中显示的仍是初始密码，登录应使用修改后的密码。正常重启不会重置账号密码。

首次配置顺序：

1. **模型**：在“设置 → 模型设置”添加模型服务地址、模型名和 API Key，测试连接并设置默认模型。
2. **专家**：创建专家，配置角色和需要的知识、规则或工具，在专家“设置 → 运行设置”点击“保存并发布资源”。
3. **工作台**：定义业务、关联专家，发布业务配置与运行资源。只将已接入且可用的能力设为“必需”。
4. **项目**：从已发布工作台创建项目，添加文件与知识引用。
5. **任务**：提交需求，查看执行状态、工具调用和成果，核验引用及输出。

知识库的向量、生成、OCR 等能力还需按使用范围配置相应模型。记忆服务不包含在默认 Compose 中；服务发布、扩展市场及大文件预览等可选功能也有独立启用条件，详见 [开发环境说明](dev/README.md)。

## 4. 验证部署

在仓库根目录查看服务状态：

```text
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.component.yml ps --all
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml ps --all
```

长期服务应处于运行状态；配置了健康检查的服务应显示 `healthy`。初始化和迁移容器成功后退出是正常现象；Worker 等服务没有健康检查，不会显示 `healthy`。

检查前端入口：

```powershell
# Windows
curl.exe --fail http://localhost:18080/healthz
```

```bash
# Linux / macOS
curl --fail http://localhost:18080/healthz
```

这个接口只检查前端入口。还需确认能登录主站、模型连接有效，并完成一次实际任务，才能验证模型和执行链路。

查看异常服务的日志：

```text
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml logs --tail 100 backend engine-api1 engine-worker
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.component.yml logs --tail 100 mysql nacos knowledge-postgres
```

## 5. 修改端口与局域网访问

编辑已有 `deploy/dev/.env` 中的对应项，随后重新执行启动流程使容器端口配置生效。

| 配置项 | 默认值 | 用途 |
| --- | --- | --- |
| `DEV_BIND` | `0.0.0.0` | Web 及相关公开端口的监听地址；仅本机访问可改为 `127.0.0.1` |
| `DEV_HTTP_PORT` | `18080` | NebuWork |
| `DEV_KNOWLEDGE_HTTP_PORT` | `18081` | 知识库原生管理页面 |
| `DEV_WORKFLOW_HTTP_PORT` | `18082` | Workflow 管理页面 |

局域网访问使用 `http://服务器局域网IP:18080`，并确保防火墙允许访问。客户端浏览器不能把 `localhost` 当作远程服务器地址。

如果需要在**首次启动前**更改端口，Windows 用户可以先仅生成配置：

```powershell
$devDirectory = (Resolve-Path .\deploy\dev).Path
docker run --rm --mount "type=bind,source=$devDirectory,target=/workspace/dev" -w /workspace/dev node:22.19.0-slim node init.mjs
```

编辑生成的 `.env` 后，再运行 `Start-Dev.ps1`。Linux / macOS 在上方生成凭据步骤后编辑即可。不要手写一个缺少密钥的 `.env`，初始化脚本不会补齐所有首次初始化字段。

完整端口清单、Nacos 和 MinIO 等管理入口见 [详细部署文档](dev/README.md#端口和凭据)。

## 6. 停止、重新启动与更新

### 停止服务并保留数据

```powershell
# Windows
.\scripts\Stop-Dev.ps1
```

```bash
# Linux / macOS
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml --profile preview stop
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.component.yml --profile preview stop
```

Windows 重新启动使用 `Start-Dev.ps1 -NoBuild`。Linux / macOS 可重新执行第 2 节的流程；已有且未变更的镜像可跳过 `docker build` 与 `app build` 两步。

### 更新源码

先备份 `.env`、当前 Nacos 配置和业务数据卷，检查本地修改，再拉取目标版本。使用 Git 的部署可通过 `git pull --ff-only` 更新当前跟踪分支。

拉取成功后，Windows 重新执行 `Start-Dev.ps1`，Linux / macOS 重新执行第 2 节的完整流程，包含镜像构建。仅重启容器或使用 `-NoBuild` 不会应用源码变更。已启用预览 Worker 的部署需继续带上 `-Preview`，或单独重建并启动其 profile。

数据卷和加密密钥需要一起保留。不要删除 `.env` 来“重置配置”，也不要对有用数据执行 `down -v`。数据库迁移可能影响版本回退，应结合目标版本说明和备份安排更新。

## 7. 可选的大文件预览

Windows：

```powershell
.\scripts\Start-Dev.ps1 -Preview
```

Linux / macOS 在基础服务启动后执行：

```bash
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml --profile preview build preview-worker
docker compose --env-file deploy/dev/.env -f deploy/dev/compose.app.yml --profile preview up -d preview-worker
```

还需在 Nacos 的 `nebuwork-dev` 命名空间、`DEFAULT_GROUP`、`cccs-config-base-dev.yml` 中启用 `nebu.files.enabled=true`，并核对后端配置生效状态。仅启动容器不代表预览功能已经启用。转换进程需要 `NET_ADMIN`，并使用额外的内存和临时空间。

## 8. 常见问题

| 现象 | 排查方向 |
| --- | --- |
| Docker 无法连接或不是 Linux 模式 | 启动 Docker 服务，检查当前 context 和容器模式 |
| 镜像或依赖下载失败 | 查看构建日志，检查网络、镜像源、代理及磁盘空间；解决后重新构建 |
| 端口被占用 | 修改 `.env` 中对应的 `DEV_*_PORT`，重新执行启动流程 |
| Linux 无法读取 `.env` | 检查是否由 root 生成；恢复为部署用户可读的私有文件，不要开放所有凭据的全局读取权限 |
| Workflow 登录返回 500 | 检查 `workflow-ui` 日志及 `generated/workflow-ui.htpasswd` 的读取权限 |
| 初始化超时或服务不健康 | 查看对应服务及初始化容器日志，确认基础组件就绪后重新运行 |
| 页面能打开，但模型调用失败 | 检查模型地址、模型名、Key 和容器到模型服务的网络；容器里的 `localhost` 指向容器自身 |
| 已配置专家，但任务列表中没有 | 检查项目业务版本是否包含专家，以及专家自身运行资源是否已发布 |
| 请求失败且 Token 为 0 | 检查模型绑定、引擎及必需能力；未接入记忆时不要把记忆设为必需 |

更详细的配置、账号 API 和验证记录见 [Docker 开发环境文档](dev/README.md)。
