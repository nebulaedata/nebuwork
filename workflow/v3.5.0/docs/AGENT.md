# Pi 工作流助手

工作流助手使用官方 `@earendil-works/pi-coding-agent` 1.1.0。它通过与 MCP 共用的工具创建、编辑和调试工作流，任务仍由原有 Python 调度器执行。

## 安装与 PyCharm 启动

需要 Python 3.12+、Node.js 22.19+ 和 npm。Node 仅用于可选助手，未安装时仍可使用流程、任务、产物和 MCP 页面。

在项目根目录运行一次：

```powershell
.\.venv\Scripts\python.exe -m nebulae agent-install
```

依赖按提交的 npm 锁文件安装到 `.runtime/v1/agent/runtime/<版本摘要>`，禁止依赖安装脚本。更换 SDK 或工作器后再次运行此命令；安装到新目录，保留旧版本。不自动升级、不修改共享 Python 包。

PyCharm 继续使用原来的运行配置：解释器选择项目 `.venv`，模块名称为 `nebulae`，参数为 `serve`，工作目录为本项目根目录。更新后重启该运行配置，再打开 `http://127.0.0.1:8765`。不需要单独启动 Pi 或 MCP HTTP 服务。

若 Node 不在 PATH：

```powershell
.\.venv\Scripts\python.exe -m nebulae agent-install --node-path "C:\Program Files\nodejs\node.exe"
```

同时在「智能体设置 → 高级设置」填写相同的 Node 绝对路径。Linux 使用 `.venv/bin/python`。自定义运行目录时，CLI 全局参数放在命令前：`python -m nebulae --runtime /path/to/runtime agent-install`。

## 配置与使用

1. 在「智能体设置」填写模型 Base URL、模型 ID 和 API Key，选择 Chat Completions 或 Responses。
2. 保存配置后点击「测试已保存配置」。测试实际请求模型并调用一个无业务副作用的测试工具，检查流式文本和工具调用。
3. 点击工作流列表的「AI 创建」，填写工作流 ID、名称和需求；或打开已有流程，点击「工作流助手」。
4. 描述工作内容，例如：“读取文本，分别统计字数和转为大写，汇合后显式保存报告；执行一次，失败时查看日志、修复并重跑。”
5. 执行过程以紧凑记录显示中文操作、目标文件和状态。连续调用默认显示最近四项，点击「展开全部」查看历史；失败或待核对的调用会在记录摘要中提示。文件名悬停可查看完整路径。
6. 点击一项操作，切换「返回结果」「调用参数」查看详情；任务可直接打开，修改文件可打开 Monaco 差异视图。长结果独立滚动。

第一版使用一套全局模型配置，每轮执行时固定。配置保存仅影响之后开始的轮次。上下文长度和最大输出长度应与模型服务匹配。没有认证的本地接口可以留空密钥。

密钥存于服务端 `agent/credentials.json`，Windows 使用当前用户 ACL，Linux 使用 `0600`。页面只返回是否已设置；留空保持原值，「清除已保存密钥」需保存后生效。运行时通过私有管道传入密钥，不放入命令行、源码、会话配置或 SQLite。

## 会话、编辑与执行

- 每段会话固定到一个工作流。一个工作流可有多段历史；尚未完成创建的会话可从列表「待完成的 AI 构建」打开。
- 助手直接保存用户委托的修改，复用源码修订、语法检查、流程校验和版本冲突检查。它不会覆盖页面中的未保存草稿；页面会提示远端变更。
- 构建请求只编辑、校验。执行、调试或修复请求可调用任务和环境工具。环境重建、归档、取消已有任务必须属于用户委托。
- 不开放通用终端或任意文件写入工具，不加载本机 `.pi` 插件、技能和项目指令。服务端检查工作流、任务、环境和产物的归属。
- 运行中的步骤继续使用已有快照，下一步使用新代码；修改流程结构后应创建新任务。两级产物空间、成功发布与重跑失效语义不变。
- 重跑必须先预览，提交相同的范围、任务版本和环境标识。
- 全局同时处理一个助手请求，忙时提示，不自动排队。每轮最多 50 次工具调用、20 分钟，达到限制后可手动继续。
- 等待任务和安装使用可中断工具；大型工具结果分段读取，完整记录保留。Pi 自动整理长对话上下文，页面历史不删除。

**停止生成**仅停止助手继续调用模型和派发工具。已提交的任务和环境操作由原调度器继续管理；取消任务需打开任务详情。已完成的源码修改不会回滚。

页面断线后通过 SSE 游标续读；不会重复发送消息。服务关闭时终止 Pi 进程树；服务重启后未完成轮次标为中断，不自动续聊、安装或运行任务。手动继续会读取上轮操作记录，核对实际状态，不重放结果未知的写操作。

## API 与存储

所有接口位于 `/api/v1/agent`，请求示例和字段见本地 `/docs`。

| 接口 | 用途 |
|---|---|
| `GET /settings`、`PUT /settings` | 配置读取、带版本和命令 ID 的保存 |
| `GET /runtime` | Node/Pi 依赖状态、当前会话和进程 |
| `POST /check` | 检测已保存的模型配置 |
| `GET /sessions?workflow_id=...`、`POST /sessions` | 会话列表、新建或预留工作流 ID |
| `GET /sessions/{id}` | 状态、轮次、工具调用和修改差异 |
| `POST /sessions/{id}/messages` | 携带 `text`、`expected_version`、`command_id` 发送消息 |
| `POST /sessions/{id}/stop` | 携带版本与命令 ID 停止生成 |
| `GET /sessions/{id}/events?after=...` | 增量事件 |
| `GET /sessions/{id}/stream?after=...` | SSE，支持 Last-Event-ID |

网络重试必须使用原命令 ID、参数和版本。冲突时读取实际状态，不换新 ID 盲目重试。

SQLite 模式从 v2 增量迁移到 v3，迁移前生成 `state.sqlite3.v2-*.bak`，保留任务、产物和历史。首次迁移要求停止旧服务，避免两个版本同时操作一个运行目录。

`agent/sessions/<会话>/<轮次>/context.jsonl` 保存 Pi 上下文；成功轮次形成会话检查点。失败、中断轮次独立保留。SQLite 保存管理状态、完整用户消息、工具结果、差异和事件。助手记录不增加业务产物存储级别。

备份时先停止服务，复制工作流源码和完整运行目录。包含凭据的备份应按私密文件保存。跨操作系统恢复后重新运行 `agent-install`，不复制使用另一平台的 Node 依赖。第一版不自动清理会话、旧运行时和备份。

## 测试与开发

```powershell
npm --prefix nebulae/agent_runtime ci --ignore-scripts
.\.venv\Scripts\python.exe -m pytest -q
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix frontend run test:e2e
```

自动化测试使用本地模型协议模拟服务，但实际加载官方 Pi SDK，覆盖 Chat Completions、Responses、工具执行、会话恢复、压缩、预算限制、进程崩溃、离线包安装和页面操作。不会请求付费模型或修改用户的工作流。

可选的 Linux 验收容器（只用于测试；产品运行不依赖 Docker）：

```powershell
docker build -f tests/Dockerfile.agent -t nebulae-workflow-agent-test nebulae/agent_runtime
docker run --rm --mount "type=bind,source=D:\Work\Code\nebuwork\workflow\v3.5.0,target=/source,readonly" nebulae-workflow-agent-test
```

容器只读挂载源码，将测试文件复制到临时目录执行。`NEBULAE_AGENT_RUNTIME` 是服务端开发测试覆盖项，不接受页面设置；正常使用无需配置。

真实模型的兼容性需要在填写实际服务配置后用页面连接测试及一次构建验证。本次自动化验收不等同于所有模型服务均支持工具调用。
