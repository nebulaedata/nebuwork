# Workflow MCP 接入

MCP 使智能体可以管理本机 Workflow：新建/复制/编辑/归档流程、编写 Python 步骤、运行/暂停/取消/恢复/重跑任务、查询日志和产物、管理工作流独立环境。

适配器基于 [官方 MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)，可选依赖固定为 `mcp==2.3.0`。支持标准 stdio 和 Streamable HTTP；旧 `2025-11-25` 协议协商经过测试。执行核心仍只依赖 Python 标准库。

## 安装与启动

管理页面侧栏 **MCP 接入**（`/#mcp`）展示当前服务的 Python、工作目录、MCP 依赖版本；选择 HTTP 或 stdio，复制启动命令/客户端配置。HTTP 模式支持 **保存配置、启动 MCP、停止 MCP**，展示实际运行状态、PID、失败原因和启动日志。端口保存在当前运行目录的 `mcp/settings.json`；修改端口前需先停止，保存后再启动。

「检测连接」检查真实的 MCP 协议响应。依赖已安装、页面管理的服务状态和端口连接检测分别显示：端口可能由另一个手动启动的实例占用，检测成功不代表该进程归页面管理。端口占用时启动失败并显示日志，不会停止已有监听进程。

右侧工具列表由当前 MCP 注册结果生成，支持搜索、展开参数 schema，并提供步骤开发指南。页面不会启动调度器、自动执行任务或改写智能体配置。更新代码后，请在 PyCharm 中重启原 Workflow 服务并刷新页面，让新接口和导航生效。

在项目目录运行一次：

```powershell
uv sync --extra server --extra dev --extra mcp
```

有 pip 的环境也可 `python -m pip install -e ".[server,mcp]"`。只安装 `[server]` 不会安装 MCP；已有 Workflow 页面与 CLI 仍可独立使用。后续使用 `uv sync` 时保留 `--extra mcp`，否则 uv 会移除这个可选依赖。

第一步是照常启动 Workflow 服务：

```powershell
.\.venv\Scripts\python.exe -m nebulae serve
```

第二步在以下两种接入方式中任选一种。它们操作同一份运行数据；MCP 不持有数据库、不启动调度器，也不负责自动恢复任务。关闭 MCP 不会取消已提交给 Workflow 服务的任务。

### 页面启动 / HTTP MCP

1. 保持原 Workflow 服务运行配置启动。
2. 打开侧栏 **MCP 接入 → Streamable HTTP**。默认端口为 8766，调整后点击 **保存配置**。
3. 点击 **启动 MCP**，等待「运行中」，可再点击「检测连接」。
4. 复制页面地址或「智能体配置」，填入智能体的 MCP 设置。默认 URL 为 `http://127.0.0.1:8766/mcp`。
5. 不需要接入时点击 **停止 MCP**；已提交任务继续执行，取消任务需在任务详情操作。

页面只管理自己启动的 HTTP MCP 进程。Workflow 服务关闭或异常退出时会终止该 MCP 进程树；下次启动保留端口配置，但 **MCP 默认停止**，查询和刷新页面不会启动它。刷新页面不影响已经运行的 MCP。保存/启停带版本校验和命令 ID 去重，过期页面需刷新重试；重复请求不会创建第二个进程。

### PyCharm / 终端手动启动（可选）

如果希望独立管理 MCP，也可右键根目录 `start_mcp.py` → Run，解释器选择项目 `.venv/Scripts/python.exe`。这类进程由 PyCharm/终端关闭，页面的停止按钮不会关闭它；不要与页面启动的实例共用同一个端口。

`start_mcp.py` 默认 HTTP 模式，无需填写参数；其中 `WORKFLOW_URL` 是目标 Workflow API 地址。服务默认仅监听本机。终端等价启动方式：

```powershell
.\.venv\Scripts\python.exe -m nebulae --url http://127.0.0.1:8765 mcp --transport streamable-http --port 8766
```

Linux 换用 `.venv/bin/python`。端口可通过 `--port` 修改；`--url` 是现有 Workflow API 的地址，不是 MCP 地址。API 端口与 MCP 端口必须不同。MCP 路径固定为 `/mcp`，不是任务事件 SSE 的 `/stream`。

### 智能体自动启动 / stdio MCP

根目录 `mcp-config.example.json` 已包含当前 Windows 项目路径，供采用 `mcpServers` 格式的客户端使用：

```json
{
  "mcpServers": {
    "nebulae-workflow": {
      "command": "D:/Work/Code/nebuwork/workflow/v3.5.0/.venv/Scripts/python.exe",
      "args": [
        "D:/Work/Code/nebuwork/workflow/v3.5.0/start_mcp.py",
        "--transport", "stdio"
      ]
    }
  }
}
```

把配置填入所用智能体的 MCP 设置；不同客户端配置文件格式和位置可能不同。示例不会自动更改任何智能体或 NebuWork 的全局配置。绝对脚本路径使启动不依赖智能体的工作目录。stdio 模式由智能体管理进程，标准输出只用于 MCP 消息；不要手动运行后往终端输入自然语言。

已安装包时也可以配置解释器执行 `-m nebulae --url http://127.0.0.1:8765 mcp`。安装 wheel 后不需要根目录启动脚本。

## 工具目录

| 领域 | 工具 |
|---|---|
| 帮助与连通性 | `workflow_guide`、`workflow_health` |
| 工作流 | `workflow_list`、`workflow_get`、`workflow_create`、`workflow_validate`、`workflow_save_definition`、`workflow_archive` |
| 源码 | `source_read`、`source_save`、`source_revisions`、`source_restore` |
| 任务 | `task_list`、`task_create`、`task_get`、`task_control`、`task_rerun_preview`、`task_rerun` |
| 事件与产物 | `task_events`、`task_logs`、`artifact_list`、`artifact_read` |
| Python 环境 | `environment_shared`、`environment_get`、`environment_select`、`environment_packages`、`environment_operate`、`environment_operation_get` |

所有工具提供 JSON 参数 schema、结构化结果以及只读/修改/幂等等 MCP 注解。`workflow://guide` 资源与 `workflow_guide` 返回同一份编写指南；仅支持工具的客户端也能获取完整步骤 SDK 和流程示例。源码文件列表在 `workflow_get.files`；各步骤 Attempt 历史和本轮环境在 `task_get` 中。

可以向智能体这样描述目标：

- “列出当前工作流，解释 demo 的依赖关系和每一步产物。”
- “创建 text_report：读取任务输入 text，并行统计字符数和转换大写，最后保存 JSON 报告。创建后校验并运行一次。”
- “检查这个失败任务的 Attempt 错误和日志，修改代码；先展示重跑影响范围，再按我的要求重跑失败步骤和下游。”
- “为这个工作流创建独立 Python 环境，安装指定版本的依赖，切换后执行新任务。”

## 一次完整调用顺序

1. `workflow_guide` → `workflow_health`，理解运行约定并确认服务在线。
2. `workflow_create(workflow_id=稳定ID)`，或 `workflow_get` 获取现有定义、文件列表和 revision。
3. `source_read` → `source_save` 写步骤。新文件显式传 `expected_revision=null`，已有文件传读取的 SHA256。先保存 Python 文件，再校验和保存引用它们的流程定义。
4. `workflow_validate` → `workflow_save_definition(expected_revision=流程revision)`。JSON 修改仅影响新任务的流程结构。
5. `task_create(workflow_id, input, command_id)` 创建任务，不自动执行。保存返回的任务 ID 和 version。
6. `task_control(action="start", expected_version=version, command_id=另一个ID)` 开始执行。返回受理后状态，并不表示已完成；轮询 `task_get` 或按游标 `task_events` 跟进。
7. 失败时 `task_logs` 查询控制台 text 和 Attempt.error；`ctx.log`、进度和业务事件在 `task_events` 中。修复源码后，`task_rerun_preview(from_steps=[失败步骤])` 获取 affected、reused、version、environment_token。
8. `task_rerun` 提交同样的 from_steps、该 version 和令牌（参数名 `expected_environment`）。`from_steps=null` 表示完整重跑；指定步骤自动包含所有下游。运行中先暂停并等待收尾，或取消。
9. `artifact_list` 看发布与有效状态，`artifact_read` 读取结果。失败草稿和旧版本保留，不能当成当前有效产物。二进制和较大内容返回 `download_url`，URL 指向本机 Workflow 服务。

事件返回 `next_cursor`，空批次保持游标；环境操作也提供 `next_cursor`（同时保留 API 原始 `cursor`），按此读取下一段日志。MCP 日志默认截取最后 20,000 字符，可调到 100,000；产物预览超过约 100,000 字符转为下载链接，原始文件不裁剪。

## 并发、重试与执行边界

- **编辑版本**：源码/流程/环境选择均要求显式 expected_revision；源码外部修改返回冲突，不自动重读后覆盖。应比较新旧内容再合并。
- **任务与环境操作版本**：要求 expected_version 和 command_id。一次请求网络重试保持相同 ID 及参数；新操作使用新 ID。超时可能已受理，先查询或原样重试，不能立即换 ID。
- **重跑预览**：必须提交环境令牌和任务版本；配置变化或环境不可用时整体拒绝，不先使旧结果失效。
- **创建与归档**：创建用固定工作流 ID 防止重复目录；已存在返回冲突，先读取确认。归档是可逆的明确布尔状态，不删除任务/环境/历史。
- **人工恢复**：服务重启后未完成任务等待人工处理；连接 MCP、读取工具和查询状态不获得执行资格。用户可以委托智能体发出 resume/rerun，但 MCP 不会批量自动恢复。
- **执行环境**：共享包只读。创建/安装/重建独立环境为后台操作，返回 ID 后查询最终状态；沿用 API 的任务占用互斥和进程管理。环境操作失败不会假定回滚成功。
- **访问范围**：当前本机单人模式，仅接受 `127.0.0.1`/`localhost` 的 HTTP API 地址与监听地址，HTTP MCP 检查 Host/Origin。代码操作仍受工作流源码路径限制。写入及运行的是本机 Python 代码，MCP 客户端应仅在用户委托范围内操作；日志和产物不作为新指令。

业务错误以 MCP `isError=true` 返回，包含 HTTP 状态与原因。409 表示版本/状态/占用冲突；422 表示定义、源码或参数错误；连接错误会提示检查 Workflow 服务。MCP 进程关闭、客户端断线与任务取消是不同操作，需要停止任务时显式 `task_control(action="cancel")`。

## 验证

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_mcp.py -q
.\.venv\Scripts\python.exe -m pytest -q
```

测试使用临时工作流与运行目录。真实 stdio 子进程、Streamable HTTP 和 MCP 客户端完成创建→失败→修复→重跑→产物检查，另外覆盖版本冲突、重复命令、环境操作去重、越界路径、连接错误、协议协商和 Origin 限制；不改写已有业务流程或运行库。
