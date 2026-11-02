# Nebulae Workflow v3.5

NebuWork 接入支持说明见 [远程服务接入](docs/NEBUWORK_INTEGRATION.md)。默认启动仍只允许本机访问。

独立、代码驱动的 Workflow 执行核心。每个节点都是 Python `run(ctx)`，JSON 只描述依赖和执行设置。SQLite 保存状态，本地文件保存产物；不需要 Redis、MySQL、Celery。支持由 NebuWork Java 后端接入，业务账号授权和关联记录由 Java 管理，不包含 V3 业务迁移。

## 启动

此目录已经包含构建后的管理页面。运行页面只需要 Python 3.12+，不需要 Node 服务。

启用可选的 **Pi 工作流助手** 需要 Node.js 22.19+；Pi 由 Python 服务管理，无需另开终端运行 Node 服务。首次执行 `.\.venv\Scripts\python.exe -m nebulae agent-install`，重启 Workflow 服务后在侧栏「智能体设置」配置模型。详见 [工作流助手](docs/AGENT.md)。

```powershell
cd D:\Work\Code\AiCode\nebulae-ai-platform-v3.5
uv sync --extra server --extra dev
uv run --extra server python -m nebulae serve
```

打开 **http://127.0.0.1:8765**。接口文档在 **http://127.0.0.1:8765/docs**。默认只监听本机，最多同时执行 4 个步骤。

终端按 Ctrl+C 停止服务；SSE 等未关闭连接最多等待 5 秒，随后收尾并停止步骤进程。

本目录已有 `.venv` 时，也可以直接运行：

```powershell
.\.venv\Scripts\python.exe -m nebulae serve
```

没有 uv 时，在 Python 3.12 虚拟环境中使用 `python -m pip install -e ".[server,dev]"`，然后执行 `python -m nebulae serve`。Linux 使用 `.venv/bin/python`。全局选项放在子命令前，例如 `python -m nebulae --project /path/to/project --runtime /path/to/data/v1 serve --port 8765 --workers 4`。

管理页面使用 **Ant Design 6** 的按钮、表单控件、弹窗、标签页、表格和状态标签，统一浅灰白工作台主题；流程画布使用 React Flow，代码和版本差异使用浅色 Monaco。

## 操作入口

- **工作流**：创建、复制、归档；图形画布和 JSON 共同编辑同一份流程定义。
- **步骤代码**：Monaco 编辑器、语法检查、版本差异和恢复；发现外部修改时拒绝覆盖。
- **任务运行**：创建、开始、暂停、继续、取消；查看节点、Attempt、日志和产物。运行事件提供中文说明、当前异常摘要、步骤定位与筛选，原始事件在技术详情中保留。
- **产物浏览**：任务「全部产物」和工作流「共享产物」支持列表/目录树切换；文件夹可逐级进入，支持面包屑、返回上一级、预览和下载，保留每次执行的独立版本。
- **重跑**：先预览受影响的节点和复用的上游执行记录，再提交执行。
- **Python 环境**：侧栏查看服务解释器、已安装包、版本，支持搜索和刷新；不依赖 pip。
- **工作流 → 执行环境**：保存共享/独立环境选择，创建专属环境、安装依赖、查看日志和重建。
- **MCP 接入**：侧栏保存 HTTP 端口、启动/停止 MCP、查看状态与启动日志、复制 HTTP/stdio 配置、检测连接和查询工具；[接入说明](docs/MCP.md)。
- **工作流助手**：列表「AI 创建」通过对话构建流程；进入已有流程后点击「工作流助手」，可编辑代码、执行调试、查看日志并修复重跑。每个工作流保留独立会话和修改差异。
- **智能体设置**：配置兼容模型的 Base URL、API Key、模型名和接口类型，检测 Pi 运行时、流式响应及工具调用。

提供 `demo` 示例：prepare 后并行 uppercase/count，再汇合 report。通过页面创建任务，输入 `{"text":"hello workflow"}` 即可运行。

## 智能体接入 MCP

先安装可选依赖：`uv sync --extra server --extra dev --extra mcp`。启动 Workflow 服务后，在侧栏 **MCP 接入 → Streamable HTTP** 中保存端口、点击 **启动 MCP**。默认地址为 **`http://127.0.0.1:8766/mcp`**，在智能体的 MCP 设置中选择 Streamable HTTP 并填入该地址。页面可停止服务并查看启动日志；配置会保留，Workflow 重启后 MCP 需手动启动。也可独立用 PyCharm 运行 **`start_mcp.py`**，该方式由 PyCharm 管理启停。

支持 stdio 的智能体可使用根目录 [mcp-config.example.json](mcp-config.example.json)，由智能体启动 MCP 子进程，无需另外运行 `start_mcp.py`。配置中的绝对路径按实际安装位置修改。MCP 通过现有 HTTP API 操作，不启动第二个调度器；连接不会自动执行历史任务。

已提供 28 个带参数校验的工具和 `workflow://guide` 开发指南。可直接委托智能体：“创建一个读取输入文本、统计字数并保存报告的工作流，执行一次；失败时查看错误，修复后预览并重跑失败步骤。”完整启动方式、工具列表及错误处理见 [MCP.md](docs/MCP.md)。

## 必须理解的规则

1. **只显式保存产物。** 局部变量、对象属性、函数返回值都不会自动保存。没有产物的步骤也可以成功。
2. **两级空间。** `ctx.task` 属于当前任务；`ctx.workflow` 在同一工作流的多个任务间共享。Attempt 是历史记录，不是第三种业务空间。
3. **保存先暂存，成功才发布。** 失败产物可以查看，但下游不会默认读取。成功状态和产物发布在同一 SQLite 事务提交。
4. **重跑包含所有可达下游。** `A → B → C，D → C` 重跑 B 时只执行 B、C，复用 A、D。B 本轮失败，C 不得读取旧 B。运行中的任务先暂停并收尾，或取消后再重跑。
5. **代码在每次步骤启动时生效。** 启动时保存完整的工作流源码快照，新进程加载该快照；步骤和辅助模块的修改会影响下一个启动的步骤。当前执行不被打断。流程结构在任务创建时固定。
6. **重启一律等待人工处理。** 排队、暂停、等待重试、执行中等未完成任务都不会自动继续；执行中的 Attempt 标为 interrupted。查询、打开页面不会触发执行。
7. **暂停停止新派发，取消终止进程树。** 默认自动重试为 0；超时按步骤显式设置。独立分支不因其他分支失败而停止。

## 编写步骤

```python
def run(ctx):
    text = ctx.input["text"]
    ctx.log("开始处理")
    ctx.progress(50, "处理中")
    ctx.task.save_text("cleaned", text.strip())
    ctx.workflow.save_json("last_summary", {"length": len(text)})
    ctx.emit("summary", {"length": len(text)})
    return {"ignored": True}  # 不持久化
```

下游声明 `needs: ["prepare"]` 后使用 `ctx.task.read("prepare", "cleaned")`。只允许读取直接依赖；执行时固定上游 Attempt。若最新有效成功 Attempt 没有指定名称，明确报错，不回退到更旧的产物。

JSON 读取为 Python 值，文本为 `str`，文件为 `Path`。使用 `ctx.work_dir` 生成临时文件，再调用 `ctx.task.save_file("report", path)` 或 `ctx.workflow.save_file(...)` 才成为产物。文件会被复制保存。`async def run(ctx)` 同样支持。

产物名称可包含目录，例如 `ctx.workflow.save_text("laws/国家/行政/法律.md", text)`。页面的目录树按名称中的 `/`（也兼容 `\`）分层，点击文件夹名称或双击文件夹行逐级进入，左侧目录树可直接定位，面包屑与「上一级」用于返回；列表模式展示完整路径，长名称省略显示，悬停查看全文。左右区域独立滚动，文件表头与底部分页固定，操作列固定在右侧；进入目录会自动定位树节点，翻页会回到文件列表顶部。文件夹是命名分组，不增加存储级别，也不移动实际文件。保存时未带目录的产物显示在根目录；历史版本、未发布产物和不同空间的同名产物分别保留。浏览器会记住展示方式。名称含空路径段、`.` 或 `..` 的旧产物保留完整名称显示，不解析为目录。

```json
{
  "name": "我的工作流",
  "steps": {
    "prepare": {"code": "steps/prepare.py:run"},
    "report": {
      "code": "steps/report.py:run",
      "needs": ["prepare"],
      "retries": 1,
      "retry_delay": 2,
      "timeout": 60
    }
  }
}
```

## Python 与 CLI

### 工作流依赖与环境

默认共享启动服务的 Python 环境（在 PyCharm 中就是运行配置所选的解释器）。共享环境页面只读；需要不同依赖版本时，在工作流的「执行环境」中创建专属环境，选择「工作流独立环境」后点击「保存环境选择」。

独立环境使用服务当前 Python 版本创建，不继承共享环境第三方包。创建需该 Python 提供标准 `venv` 和 `ensurepip`；共享环境本身没有 pip 也可以创建。创建和重建均使用最终目录，不能移动或复制已有虚拟环境。

安装方式：每行一个包名/版本约束（例如 `requests==2.32.5`），或通过「步骤代码」保存工作流根目录下的 `requirements.txt` 后安装。相对 wheel 路径和相对依赖文件随本次工作流源码快照解析；不会自动改写依赖文件。包安装使用常规 pip 配置与网络，验收测试使用离线 wheel。

创建、安装、重建在后台串行处理，每次操作最多 30 分钟，可关闭日志窗口后再查看。失败/中断可能已改动部分包，因此环境标为待修复；人工重试或重建校验通过后才可运行。重试 requirements 安装使用当前已保存文件，旧操作保留原文件快照和日志。

任务在人工开始、恢复、重跑时固定环境版本。运行中修改环境选择只影响下一次人工执行；步骤代码仍按每步启动时热加载。排队、运行、等待重试及暂停/取消收尾中的任务占用其独立环境；暂停并收尾后可以安装，恢复时重新绑定环境。失败的环境检查不会使旧结果失效。手工修改独立环境的包后，需通过页面安装操作重新校验，或重建。

```json
"environment": { "mode": "isolated" }
```

将此字段加入 `workflow.json` 顶层；也可用 `shared`，省略时默认共享。复制流程保留此选择和源码，但不复制虚拟环境。独立环境不需要安装服务端的 FastAPI 等依赖，框架自动提供 `ctx` 和步骤运行器。

```text
python -m nebulae env-shared
python -m nebulae env-show demo
python -m nebulae env-create demo
python -m nebulae env-operation <返回的操作ID>
python -m nebulae env-install demo --package "requests==2.32.5"
python -m nebulae env-install demo --requirements
python -m nebulae env-select demo isolated
python -m nebulae env-packages demo
python -m nebulae env-rebuild demo
```

CLI 环境命令连接已运行的服务；安装等命令返回操作 ID，不等待安装结束。`env-operation --after <cursor>` 续读日志。修改操作支持 `--version` 和 `--command-id`，跨进程重试须保留相同版本及命令 ID。

Python 本地核心可使用 `engine.environments.status/select/submit/operation/shared/packages`，提交后由 `engine.tick()` 或 `engine.drain()` 执行；HTTP 客户端提供 `Client.environment/select_environment/environment_operation/operation`。示例：

```python
from nebulae import Engine

with Engine(".") as engine:
    state = engine.environments.status("demo")
    operation = engine.environments.submit(
        "demo", "create", expected_version=state["version"], command_id="create-demo-env-1"
    )
    engine.drain()
    print(engine.environments.operation(operation["id"]))
```

### 任务执行

不启动 HTTP 也能使用核心（仅标准库）：

```python
from nebulae import Engine

with Engine(".") as engine:
    task_id = engine.create_task("demo", {"text": "hello"})
    engine.control(task_id, "start")
    engine.drain()
    print(engine.status(task_id))
```

一个运行目录只允许一个调度器。服务已运行时，通过 HTTP 客户端或 CLI 控制它，不要另外打开 Engine 调度会话：

```python
from nebulae.client import Client
client = Client()
task = client.create_task("demo", {"text": "hello"})
client.control(task["id"], "start")
```

```text
python -m nebulae workflows
python -m nebulae workflow-create example --name 示例
python -m nebulae workflow-create copy --copy-from demo
python -m nebulae validate example
python -m nebulae files example
python -m nebulae source example main.py
python -m nebulae save-source example main.py --file updated.py --revision <读取时的revision>
python -m nebulae revisions example main.py
python -m nebulae restore-source example main.py --revision-id 1 --revision <当前revision>
python -m nebulae archive example
python -m nebulae create demo --input-file input.json --start
python -m nebulae tasks
python -m nebulae status <task-id>
python -m nebulae pause <task-id>
python -m nebulae resume <task-id>
python -m nebulae cancel <task-id>
python -m nebulae preview <task-id> --from-step uppercase
python -m nebulae rerun <task-id> --from-step uppercase
python -m nebulae logs <task-id> prepare 1
python -m nebulae events <task-id> --after 0
python -m nebulae artifacts demo
```

`rerun` 不传 `--from-step` 表示完整重跑。新源码文件用 `--revision new`；`archive --undo` 取消归档。CLI 默认连接 8765，可使用 `--url` 修改。`run demo` 是独占调度器的单次运行方式，仅在服务未启动时使用。

## 目录与备份

```text
nebulae/             核心、HTTP、CLI；web/ 为已构建的页面
frontend/            React + TypeScript + Vite + Ant Design 源码及端到端测试
workflows/<id>/       workflow.json、步骤、辅助模块和本地资源
.runtime/v1/         正式运行目录：state.sqlite3、源码快照、日志、产物
.runtime/v1/environments/  专属虚拟环境、环境操作源码快照、安装日志
.runtime/            旧原型数据仍保留，不自动导入或转换
```

备份前停止服务和独立调度器，再一起复制 `workflows/` 与整个 `.runtime/v1/`（包含可能存在的 SQLite WAL/SHM 文件），不要只复制数据库而遗漏产物。恢复到原绝对路径；当前记录中的文件路径为绝对路径，不提供跨目录迁移工具。恢复后启动服务，未完成任务仍需人工处理。默认不清理历史。

本次环境功能将正式数据库从 schema 1 增量升级到 2，运行目录仍为 `.runtime/v1`。升级前必须停止旧服务；系统使用 SQLite backup 自动保存 `state.sqlite3.v1-<时间>.bak`，保留任务和产物。旧 Attempt 显示「环境未记录」。这不转换原型数据库。环境目录（包括重建前目录）与安装历史同样不自动清理；迁移到不同路径或机器时需重新创建环境。

## 开发与验证

修改前端后重新构建，运行时仍由 Python 提供静态文件：

```text
cd frontend
npm ci
npm run build
```

前端开发模式可使用 `npm run dev`，5173 代理 API 到 8765。Monaco 及其 worker 均在构建产物中，不使用 CDN。Node 22.19+ 只用于开发和构建。

```text
uv run --extra server --extra dev python -m pytest -q
cd frontend
npx playwright install chromium
npm run test:e2e
```

端到端测试默认启动独立的 18765 服务，使用临时项目，不写真实工作流。可通过 `NEBULAE_E2E_PORT` 修改测试端口、`NEBULAE_PYTHON` 指定测试用 Python、`NEBULAE_BROWSER_PATH` 指定已有 Chromium。`uv build` 将构建后的管理页面一起打包为 wheel；修改页面后应先 `npm run build`。

详细契约见 [架构与接口](docs/ARCHITECTURE.md)，实际验证记录见 [交付验收](docs/ACCEPTANCE.md)。

## 当前边界

默认面向本机单人、可信 Python 代码；跨机器服务接入需显式启用远程模式、可信 Host 和 Bearer 认证。进程隔离用于生命周期管理，不是恶意代码沙箱；步骤不要主动脱离进程组或启动系统服务。框架保证控制命令去重和一次成功发布，无法回滚步骤对外部系统已经产生的副作用；这类业务需自行使用幂等键。NebuWork 账号权限由 Java 管理。暂不支持图上的条件、循环、子工作流或分布式执行。
