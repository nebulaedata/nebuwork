# SOP 与 Workflow 3.5 接入交付

2026-10-16 的四项执行概览、两端运行输入预设与产物列表优化见 [Workflow 样式与运行场景交付](workflow-input-presets-delivery.md)。

专家 SOP 后续统一布局及画布编辑说明见 [sop-layout-delivery.md](sop-layout-delivery.md)：真实 Workflow 现已在 SOP 详情内读取并编辑 3.5 节点和依赖，两种 SOP 共用四项描述卡片与节点画布。

## 2026-10-15 创建持续等待修复

Java 模块缺少启用 Spring 定时调度的配置，导致 `WorkflowWorker.tick()` 未被自动调用，创建记录可长期停留在 `pending`。新增自动扫描的 `BackgroundJobScheduling` 配置，启用持久化工作流、知识创建和记忆队列的定时 worker。更新并重启 Java 后，接入启用时会消费已有待创建记录，不需要删除 SOP、重复创建或修改数据库状态。

专家 SOP 画布区分“等待后台创建”和“正在创建”，持续等待五分钟后停止轮询并提示手动刷新，保留服务端的真实状态。失败时可通过“重试原操作”调用当前账号原工作流的 `/retry`，不会新建另一条工作流。关闭接入或离开页面后停止自动刷新。

补充 Spring 实际调度消费待创建记录的 H2 回归用例，以及画布状态流转、五分钟停止、手动刷新、原操作重试和关闭接入的前端用例。依照当前仓库的使用方验证约定，本次未执行测试、构建、迁移或服务重启；尚未验证部署环境。

## 本批行为

侧栏新增 Workflow。新建 SOP 选择“Workflow（在 Workflow 中配置真实工作流）”时，Java 在同一事务内保存 SOP、当前账号的工作流记录和关联，然后由持久化创建 worker 请求 3.5。页面先显示等待/创建中，只有 3.5 确认后显示已创建并开放编辑。Workflow 列表也可直接新建，无需已有工作流或先绑定。

站内支持 React Flow 编排、JSON、Monaco 源码编辑、文件新增、版本差异与恢复、校验、归档、手动运行、暂停/继续/取消、预览后重跑、节点执行记录、日志及产物。真实输入、状态、错误、日志和产物来自 3.5；没有专家自动调用、Python 环境管理、工作流助手或 MCP 设置入口。

旧 SOP 的节点描述与连线保留，不转成可执行代码。在旧 SOP 中点击“新建真实工作流”可创建当前账号的独立工作流。标准化流程保持原接口。删除 SOP 移除关联，不删除工作流、任务或产物；工作流通过归档管理。

## 由使用方部署与配置

1. 备份业务数据库，按原迁移顺序执行 Java 模块 `V14__workflow_integration.sql`。新增表使用 `IF NOT EXISTS`，重复应用不覆盖现有配置及记录。原 V1–V13 不变。
2. Java Nacos 设置 `nebu.workflow.admin-ids` 为允许配置接入的统一用户 ID，逗号分隔。默认没有管理员。密钥加密沿用 `nebu.models.encryption-key`，必须保持与已保存的模型和记忆凭据一致。
3. 3.5 默认 `python -m nebulae serve` 保留本机模式。Java 同机部署时可配置 `http://127.0.0.1:8765`，密钥可留空。
4. 跨机器部署使用升级后的 3.5，在服务进程环境中设置至少 32 个非空白 ASCII 字符的 `NEBULAE_SERVICE_API_KEY`，然后启动 `python -m nebulae serve --host 0.0.0.0 --remote-access --trusted-host <服务IP或域名>`。多个可信 Host 重复传入 `--trusted-host`。该模式的 `/api/` 请求都需要 Bearer；不要把服务密钥放到浏览器。原独立 UI 不提供服务密钥登录，远程模式应从 NebuWork 使用。
5. 管理员进入“设置 → Workflow 设置”，填写 Java 能访问的服务根地址及对应密钥，测试并保存。测试核对 `service=nebulae-workflow`、`integration_version=1`、健康状态及调度器就绪；不创建或启动任务。初始保持接入关闭，验证后开启。
6. 前端依赖和锁文件已更新；使用方安装依赖，执行测试和构建，再部署前端、Java 与 3.5。网关仍走 `/nebulaedev/nwaa/api/...`，浏览器写入使用 POST。网关路由由使用方管理。

页面保存的配置优先于 `nebu.workflow.enabled/base-url/api-key` 部署初始值。超时默认 15000 毫秒，页面支持 1000–60000。关闭后保留记录，暂停新的管理请求及尚未完成的创建派发；已经在 3.5 运行的任务继续遵循 3.5 自身状态，不被自动取消。

创建任何工作流记录后锁定服务地址。密钥轮换、启用开关和超时仍可更新；更换实例需要单独迁移工作流、SQLite 状态及产物，本页面不执行服务迁移。

## 接口与数据隔离

- `GET/POST /api/workflow/settings`、`POST /api/workflow/settings/test`：全系统配置，仅指定管理员可以保存/测试；普通用户只看到本人 ID 和启用状态。访问密钥不出现在响应、审计或浏览器缓存中。
- `GET/POST /api/workflows`、`GET /api/workflows/{id}`、`POST /retry`：账号内工作流列表、持久化创建、状态和原操作重试。
- `/api/workflows/{id}/definition|validate|source|revisions|restore|archive`：真实定义和源码代理。浏览器保存为 POST，Java 转为 3.5 的 PUT/POST；保留 `expected_revision`。
- `GET/POST /api/workflows/{id}/tasks`：当前账号通过 NebuWork 创建的运行记录、创建并开始运行。
- `/api/workflow-tasks/{id}`、`/retry`、`/actions/{action}`、`/preview`、`/events`、`/logs`：任务查询、创建失败恢复、控制、重跑预览、事件及日志。
- `/api/workflows/{id}/artifacts`、`/artifacts/{artifact}/content|download`：产物访问。下载在 Java 校验所属工作流后流式转发，不跳转远端地址。
- `POST /api/agents/{expert}/sop-sets`：新建 workflow SOP 需 `Idempotency-Key`，返回当前账号的 `workflow` 信息。`POST /api/agents/{expert}/sop-sets/{sop}/workflow` 从已有历史 SOP 新建，保留 SOP revision 校验。

SOP 元数据仍沿用既有共享机制，真实工作流关联按账号保存在 `nw_sop_workflow`。其他账号无法获取该账号的工作流 ID、代码、任务或产物；可为同一 SOP 创建自己的工作流。不导入 3.5 原有工作流或原独立 UI 创建的任务。

这里的账号隔离针对 Java 管理和下载接口。Python 步骤继续沿用 3.5 服务进程的系统权限，本批没有增加面向不可信代码的操作系统沙箱；只应运行受信任的工作流代码。服务访问密钥不会继承到步骤进程环境中。

新建 workflow/SOP/任务使用持久化幂等记录；修改提交内容必须使用新键，响应不确定时使用原键。工作流固定远端 ID，创建响应丢失后先读取原 ID；任务创建和首次开始分别使用稳定命令 ID。失败时重试原操作。若 3.5 重启使任务进入等待人工处理，页面显示实际任务，并允许人工“继续”，不会自动恢复历史执行。

源码与定义冲突保留编辑草稿。任务控制重试保留原版本与原请求，重跑使用预览返回的版本和环境令牌。页面只轮询创建中/活跃任务，离开页面或切换账号取消请求，密码输入在销毁前清空。

## 待使用方执行的验证

本批未运行数据库迁移、测试、类型检查、构建、服务或浏览器验证，不代表已通过运行验收。

新增 Java `WorkflowIntegrationTest` 覆盖管理员权限、密钥与审计、配置幂等/地址锁定、连接握手、账号隔离、创建恢复、任务稳定命令和手动恢复、产物越权与源码冲突、迁移重放。`ExpertApiTest` 更新真实 workflow SOP 创建夹具并隔离 worker。

新增前端 `workflowApi.test.js`、`WorkflowSettings.test.jsx`，并扩展专家页面测试，覆盖 Java 路径、取消/迟到响应、管理员设置、SOP 直接新建及响应丢失重试。3.5 新增 `test_remote_integration.py`，覆盖远程 Bearer、可信 Host、服务握手及默认本机兼容；原 `test_api.py` 保留真实执行、源码、产物和重跑回归。

浏览器验收顺序：

1. 普通用户不能修改/测试接入配置；管理员配置服务、连接测试、启用并保存，刷新后配置持久化。
2. 新建 workflow SOP，直接进入 Workflow 创建/配置页面；不出现绑定已有工作流的前置要求。
3. 添加 Python 步骤、保存代码、配置依赖并保存流程；循环依赖、无效代码入口、语法错误显示实际校验错误。两个编辑窗口的版本冲突保留后提交窗口的草稿。
4. 输入 `{"text":"hello workflow"}` 运行，确认真实步骤、输入、状态、日志及显式保存的产物；预览、下载均经 Java。
5. 使用实际耗时步骤验收暂停/继续/取消，停止后预览并重跑，核对受影响节点及上游复用记录。重启 3.5 后不自动继续历史任务。
6. 模拟创建响应丢失/不可达，重试仍只有一个工作流、SOP 或任务；创建失败页面保留错误及原操作恢复入口。
7. 切换账号、直接请求另一账号的工作流/任务/产物 ID 均不得读取或执行；旧 SOP 可见历史内容且不触发运行。
8. 验收旧 SOP、标准化流程及既有专家/项目/记忆设置回归；窄屏检查布局、长路径和日志滚动。
