# Nebulae Workflow v3.5.0

独立的 Python Workflow 工程，位于 `workflow/v3.5.0/`，包含执行核心、管理页面、工作流源码、MCP 及可选 Pi 助手。Python 固定为原环境的 3.12.12，第三方依赖沿用原锁文件；HTTP 接入契约仍为 v1。

## 直接启动

在仓库根目录执行：

```powershell
.\workflow\v3.5.0\scripts\Start-Local.ps1
```

打开 `http://127.0.0.1:8765`，接口文档为 `http://127.0.0.1:8765/docs`。首次缺少项目虚拟环境时，脚本通过 uv 按锁文件安装 server / dev / mcp 依赖；已有环境直接启动。按 Ctrl+C 停止。

本目录已经配置私有 `.env`。新代码默认连接原运行目录：

```text
D:/Work/Code/AiCode/nebulae-ai-platform-v3.5/.runtime/v1
```

这是继续引用的现有数据资源：SQLite、历史产物、源码快照、独立 Python 环境、Pi 设置与密钥、MCP 设置都保持原位置和原值。工作流源码已复制到本工程 `workflows/`；本工程使用自己的 `.venv`，不依赖原项目的 Python 源码或服务虚拟环境。

数据库记录保存了历史文件和解释器的绝对路径，因此本次保留运行目录路径。启动入口会检查原 SQLite 是否存在，配置缺失时停止，不会静默新建空库。新检出工程时，从 `.env.example` 建立本机配置并填入已有运行目录。

## 独立验证与原生启动

隔离运行 demo，使用新建的临时 SQLite 和产物目录：

```powershell
.\workflow\v3.5.0\scripts\Start-Local.ps1 -Isolated -Port 18768
```

此模式跳过私有 `.env`，只复制 demo 到本工程的 `.qa/isolated-*/`，保留原数据库和业务工作流。

在本工程目录使用原生 Python：

```powershell
uv sync --frozen --extra server --extra dev --extra mcp
.\.venv\Scripts\python.exe -B start_workflow.py
```

仅检查路径配置，保持数据库关闭：

```powershell
.\.venv\Scripts\python.exe -B start_workflow.py --check
```

`python -m nebulae` 继续提供原始 CLI。使用它启动现有数据时，显式指定 `--project` 和 `--runtime`；不带参数的原始 CLI 仍使用其当前目录的默认数据位置。Linux 可使用 `.venv/bin/python start_workflow.py`，并在私有配置中选择该机器现有的运行目录。

## 配置与组件

| 配置 | 当前行为 |
| --- | --- |
| `NEBULAE_RUNTIME_DIR` | 原 SQLite / 产物 / 环境目录，路径保持不变 |
| `NEBULAE_HOST`、`NEBULAE_PORT` | 默认本机 `127.0.0.1:8765` |
| `NEBULAE_WORKERS` | 保持 4 个并行步骤 |
| `NEBULAE_REMOTE_ACCESS`、`NEBULAE_TRUSTED_HOSTS` | 保持原本机模式；需要远程接入时显式配置 |
| `NEBULAE_SERVICE_API_KEY` | 远程模式沿用已有服务密钥，不自动生成替代密钥 |
| `NEBULAE_WORKFLOW_URL` | MCP 客户端继续连接既有 Workflow API |

Workflow 使用 SQLite 和本地文件，不需要额外 MySQL / Redis。模型配置、私有 API Key、已安装的 Pi 1.1.0 及 MCP 设置继续保存在原运行目录。Pi 助手可选，仍需要 Node.js 22.19+；参考 [助手说明](docs/AGENT.md)。MCP 的启动方式保持 `start_mcp.py` / `python -m nebulae mcp`，示例客户端路径已指向本工程；详见 [MCP](docs/MCP.md) 和 [NebuWork 接入](docs/NEBUWORK_INTEGRATION.md)。

同一运行目录由原有调度器锁保证只有一个服务调度。重启后的未完成任务仍等待人工处理；查询和打开页面不自动执行历史任务。

## 开发和打包

运行服务只需要 Python，管理页面已经构建在 `nebulae/web/`，无需独立 Node 服务。前端修改后在 `frontend/` 执行 `npm ci --ignore-scripts` 和 `npm run build`，继续由 Python 提供静态资源。

```powershell
uv run --frozen --extra server --extra dev --extra mcp python -m pytest -q
uv build
```

可选 Pi 集成测试需要先在 `nebulae/agent_runtime/` 执行 `npm ci --ignore-scripts`。前端 `npm run test:e2e` 使用临时项目和独立端口，不读取原运行数据。

原说明保存在 [README-upstream.md](README-upstream.md)，本次数据保持策略和验证见 [迁移记录](../../docs/workflow-v3.5-migration.md)。
