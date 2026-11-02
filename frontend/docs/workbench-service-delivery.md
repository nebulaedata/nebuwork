# 工作台 API、MCP 与页面服务交付

本次在 Java、New2 和工作台前端实现平台托管的服务发布。入口位于工作台配置的「服务发布」，包含业务能力、页面、版本、调用记录及应用授权。新增功能默认关闭；本次未部署、迁移或重启共享环境。

## 版本与执行边界

- 服务草稿和正式版本独立于工作台原有业务配置发布；预览版本仅当前账号可用，不进入正式历史，也不能激活。
- 正式版本固定接口契约、能力绑定、智能体执行配置及 HTML 资产。页面资产存入 Java 独立服务表，保留成果版本或任务/Run 来源，任务工作区消失后仍可读取。
- **Workflow 3.5 没有代码、数据库或部署修改。** Java 仅保存 Workflow ID、输入映射和结果选择器，调用现有接口。源码及环境按 Workflow 原有规则生效；切换服务版本不会恢复 Workflow 的实现。
- 工作流结果必须来自本次远端任务、指定节点、指定名称、task scope 且 published/effective 的 JSON 产物；输出契约不符明确失败。
- 智能体执行创建独立任务。只有主任务可提交结果，且必须等引擎真实完成后才成为成功响应；未提交、等待输入、中断和取消分别保留真实状态。
- 首期平台白名单：`project.get`、`project.update`、`task.list`、`knowledge.search`。扩充操作需实现 Java 适配、权限及测试，没有任意 URL 转发或任意 REST 路由。
- 指挥官、情报中心未改动，可后续使用相同公共接口。

## 启用与部署

1. 先升级 New2 API/Worker 和独立 MCP 协议适配进程；API 能力声明须含 `workbenchServiceResults: true`。不兼容引擎会阻止智能体服务发布。
2. 升级 Java，执行新增 `V23__workbench_services.sql` 和 `V24__workbench_service_usage.sql`；旧迁移未改动。没有种子业务数据。
3. 部署工作台前端。保持功能关闭，配置网关、统一登录、公开地址及内部回调。
4. 在目标环境以指定账号完成真实模型、业务数据和跨系统接入验收，再开启功能和发布首个服务。

Java 配置示例，实际值放到现有配置中心：

```yaml
nebu:
  workbench-services:
    enabled: false # 目标环境验收后改为 true
    public-base-url: https://work.example.com/nebulaedev/nwaa
    frontend-url: https://work.example.com
    polling-enabled: true
  platform-mcp:
    url: http://protocol-adapter:42120/mcp
    service-key: <与协议适配进程一致，至少32字符>
```

New2 MCP 进程沿用现有 `BUSINESS_API_URL`、`PLATFORM_MCP_SERVICE_KEY`、`PLATFORM_MCP_PORT`、`PLATFORM_MCP_HOST` 配置及 `npm run start:platform-mcp`。Java 地址须包含模块 context path，例如 `http://java:42020/nwaa`。适配进程默认只监听本机，跨容器部署需配置受信内部监听地址。API/Worker 继续使用原有签名和业务回调配置，不复用服务访问令牌。

### 页面入口报“来源未登记”或问号（2026-10-21）

服务清单读取成功、页面实例 POST 返回 `403 {"code":403,"msg":"?????"}` 时，检查 Java 的 `nebu.workbench-services.public-base-url`。缺失时，旧 CORS 过滤器把前端来源与空地址比较并拒绝请求；拒绝响应又使用默认 ISO-8859-1 编码，将“来源未登记”替换成问号。`GET /api/workbench-services/{wb}/oauth-protected-resource` 返回 503“请配置工作台服务公开访问地址”可确认这一配置缺失。

对于浏览器通过 `http://localhost:5173` 及 `/nebulaedev/nwaa` 网关访问的开发环境，在当前 Java 配置中心补充：

```yaml
nebu:
  workbench-services:
    public-base-url: http://localhost:5173/nebulaedev/nwaa
    frontend-url: http://localhost:5173
```

公开地址采用浏览器实际访问的来源和完整网关模块路径；不能以内部 Java 的 `42020` 地址代替。同一来源的主机名和端口必须匹配，`localhost` 和 `127.0.0.1` 是不同来源。两项配置由现有 Java Bean 注入，更新配置后需要按目标环境流程重启 Java，再刷新页面。

源码已将过滤器错误统一为 UTF-8 JSON，并在公开地址缺失时返回明确的 503 配置提示。已配置地址的来源校验、会话认证和项目权限继续执行。`ServiceCorsFilterTest` 4 项与 `WorkbenchServiceIntegrationTest` 23 项在隔离 Docker/H2 中全部通过，覆盖配置缺失、中文错误、合法来源的页面创建、未登录与越权拦截。变更没有写入配置中心或重启现有服务。

### 网关要求

浏览器仍访问 `/nebulaedev/nwaa/api/...`，不要删除环境前缀。公网只开放 Java 的业务入口；New2 的 `/services/{workbench}/mcp` 及 Java `/internal/workbench-services/protocol` 留在受信网络。

| 外部路径 | Java 模块内部路径 |
| --- | --- |
| `/nebulaedev/nwaa/api/workbenches/.../service/**` | `/api/workbenches/.../service/**` |
| `/nebulaedev/nwaa/api/workbench-services/**` | `/api/workbench-services/**` |
| `/nebulaedev/nwaa/api/service-oauth/**` | `/api/service-oauth/**` |
| `/.well-known/oauth-authorization-server/nebulaedev/nwaa/api/service-oauth` | `/.well-known/oauth-authorization-server/api/service-oauth` |
| `/.well-known/oauth-protected-resource/nebulaedev/nwaa/api/workbench-services/{id}/mcp` | `/.well-known/oauth-protected-resource/api/workbench-services/{id}/mcp` |

最后两条是公开地址带路径时的发现重写，需按实际公开前缀配置。401 的 `WWW-Authenticate` 也提供可直接读取的受保护资源元数据地址。授权服务器发现遵循 [MCP 2025-11-25 授权规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)；首期采用预登记客户端，无动态客户端登记。

保留 `Authorization`、`Idempotency-Key`、`Last-Event-ID`、`MCP-Protocol-Version` 和 `X-Host-Origin`。SSE 禁止代理缓冲，读取超时至少 310 秒；断线可按事件编号补取。MCP 为无会话的 Streamable HTTP POST，GET/DELETE 返回 405。OAuth 和页面使用 HTTPS（本机测试例外）；不要将令牌放在 URL、日志或生成的 HTML 中。网关规则由环境维护者应用。

## 定义、预览和发布

定义示例中的项目、知识库引用和工作流必须属于当前账号，并在发布时可用。Schema 使用 Draft 7，只允许文档内引用。

```json
{
  "name": "项目服务",
  "description": "查询项目当前状态",
  "capabilities": [{
    "key": "overview", "name": "项目概览",
    "inputSchema": {"type":"object","additionalProperties":false},
    "outputSchema": {"type":"object","required":["id","name"]},
    "projectIds": ["<project-id>"],
    "channels": {"api":true,"mcp":true,"page":true},
    "binding": {"type":"platform","operation":"project.get"}
  }],
  "pages": []
}
```

Workflow 的 `binding`：

```json
{"type":"workflow","workflowId":"<owned-workflow>","inputMapping":{"query":"/query"},"resultStep":"finish","resultName":"result"}
```

省略 `inputMapping` 会原样传递业务输入；映射值为 JSON Pointer。智能体绑定为 `{"type":"agent","projectId":"<project-id>","instructions":"业务指令"}`，可选 `expertId`；首期只绑定一个明确项目。指令、专家、文件、技能、模型选择及资源策略在发布时保存，执行时再检查当前权限。模型连接地址改变需重新发布，避免将当前凭据发送到旧地址。

上传 HTML：`POST /api/workbenches/{wb}/service/assets`，请求为 `{"html":"<!doctype html>..."}`。也可提供 `projectId/artifactId/version` 导入已有成果。单页最多 2 MiB。将返回的 `assetId` 写入 `pages`：

```json
{"key":"board","name":"项目看板","assetId":"<asset-id>","capabilities":["overview"],"refreshSeconds":30}
```

以 `POST /api/workbenches/{wb}/service` 保存 `{revision,definition}`，冲突返回 409。通过 `.../preview` 和 `.../test/{key}` 测试当前已保存草稿；测试会真实执行，可能写入业务数据。用户通过 `.../publish` 正式发布。`.../releases`、`.../activate` 和 `.../disable` 管理历史、活动版本和停用。

智能体获得 `service_draft_get`、`service_draft_save`、`service_page_register`，仅生成草稿；服务执行主任务另有 `service_result_submit`。不存在服务自动发布工具。

## 应用授权和调用

在「应用授权」登记能力、页面、项目、精确回调地址和允许来源。凭据只显示一次，服务端仅存哈希；创建响应丢失后复用原请求编号恢复原应用，再轮换凭据。修改范围或轮换会使旧访问令牌失效；停用应用阻止后续读取、工具回调和结果提交。每次都检查当前账号与资源权限，旧版本不能恢复被撤销权限。

后台固定授权示例：

```bash
curl -X POST "$BASE/api/service-oauth/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode "client_id=$CLIENT_ID" \
  --data-urlencode "client_secret=$CLIENT_SECRET" \
  --data-urlencode "resource=$BASE/api/workbench-services/$WB/mcp"
```

其中 `BASE` 是配置的公开模块地址。访问令牌有效期 10 分钟。应用密钥留在接入系统后端。

用户委托使用 `/api/service-oauth/authorize` 的授权码流程：`response_type=code`、预登记 `client_id/redirect_uri`、随机 `state`、`code_challenge_method=S256`、`code_challenge` 和目标 `resource`。跳转统一登录后的独立同意页面，用户确认后返回一次性授权码；`token` 端点以 `authorization_code`、`code_verifier` 换令牌。授权请求 5 分钟、授权码 60 秒；首期仅同账号应用和资源。没有刷新令牌，过期后重新获取固定授权令牌或重新委托。`POST .../revoke` 接受待撤销令牌。

```bash
curl -X POST "$BASE/api/workbench-services/$WB/capabilities/overview/invoke" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: request-20261016-001' \
  --data '{"projectId":"<project-id>","input":{}}'
```

结果外层沿用 `{code:0,data:...}`，`data` 包含 `operationId/status/result/error/releaseId`。HTTP 200 仍须检查 `data.status`；异步受理是 202，通过 `operations/{id}` 查询，`events?after={cursor}` 补取，或 `/stream` 订阅 SSE。`commands` 支持 cancel、input、resume、reconcile；Workflow 当前不支持 input。中断时先核对原操作，不自动重新执行不确定的写入。

可传 `releaseId`；省略时使用活动版本。原请求编号重试返回原操作，不因活动版本变化换实现；同编号不同内容返回 409。调用记录保存入口、应用、版本、执行目标、错误及实际 Tokens。Workflow 或上游未提供 Tokens 时返回未知，不伪造为 0，也不计算费用。

`manifest` 与 `openapi.json` 按授权裁剪；OpenAPI 3.1 从相同能力契约生成。外部 MCP 地址为 `$BASE/api/workbench-services/$WB/mcp`，工具参数：

```json
{"requestKey":"request-20261016-001","body":{"projectId":"<project-id>","input":{}}}
```

MCP Apps 页面通过 `_meta.ui.resourceUri` 关联 `ui://workbench/{releaseId}/{pageKey}`，支持 UI 的客户端执行初始化及宿主桥接；普通客户端仍取得结构化结果。`__service_*` 工具仅声明为 app 可见，不暴露原有平台管理目录。资源规范参见 [MCP Apps](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)。本次验证了真实官方 SDK 的资源读取和调用；第三方宿主的 UI 渲染仍需其自身支持。

## 单 HTML 的刷新与状态

页面不直接请求业务地址，统一使用注入的 `window.NebuService`。发布地址：`$BASE/api/workbench-services/{wb}/pages/{key}?projectId={projectId}`。首次打开创建实例并将 `instanceId` 放回地址；重新打开该地址保留状态和页面版本。升级页面需显式打开新版本创建新实例，旧实例保持原版本。

```html
<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<h1>项目看板</h1><p id="value">读取中…</p><p id="time"></p><p id="error" role="alert"></p>
<script>
const api = window.NebuService;
async function refresh() {
  try {
    const operation = await api.invoke('overview', {});
    if (operation.status !== 'succeeded') throw Error(operation.error || operation.status);
    document.getElementById('value').textContent = operation.result.name;
    document.getElementById('time').textContent = '更新于 ' + new Date().toLocaleString();
    document.getElementById('error').textContent = '';
  } catch (error) {
    document.getElementById('error').textContent = '数据可能已过期：' + error.message;
  }
}
api.ready().then(refresh);
api.on('refresh', refresh);
</script></html>
```

- `ready()` 提供 projectId、releaseId、context、state、revision 等实例上下文。
- `invoke(key,input,{requestKey?})` 返回操作；`subscribe(id,callback)` 追踪异步操作并返回取消函数，`operation(id)` 查询，`command(id,command,{requestKey?})` 控制。
- SDK 为当前页面生命周期内未确认的相同写入保留请求编号，错误对象带 `requestKey`。跨页面重开或业务步骤应由应用持久保存自己的编号，并先查原操作。
- `state.get()`、`state.save(newState,revision)` 保存筛选和布局，最多 64 KiB；409 后重新读取，不覆盖并发更新。业务记录仍由现有服务保存。
- 配置的刷新周期及宿主按钮触发 `refresh` 事件，页面自行选择能力与参数刷新；业务源无事件时使用查询。SDK 操作订阅在 SSE 断线后按游标查询，连续追踪 5 分钟后发出 `tracking-paused`。
- 页面宿主隐藏永久顶部栏，HTML 填满窗口；刷新操作使用右下角的 48px 圆形悬浮按钮，支持键盘、可见焦点及屏幕安全区域。加载/错误以浮动提示显示，手动刷新仅提示已发出事件；未指定项目的多项目入口仍可在浮动选择框中选择。页面名称保留在浏览器标题和 iframe 无障碍名称中。共享壳由 Java 的 `workbench-service/page-host.html` 输出，更新 Java 后生效，既有 HTML 资产继续使用。布局增量已通过 3 项 SDK/宿主 Node 测试、1 项 Java 页面资产/实例/壳集成测试及真实宿主的桌面/390px 隔离浏览器验证；截图为 `apps/web/.qa/html-service/published-desktop.png`、`published-mobile.png`。
- `on(name,handler)` 接收事件，`emit(name,data)` 向宿主发送选择等上下文。页面需保留最后成功数据并显示更新时间和失败提示。

生成 HTML 运行在 `sandbox=allow-scripts` 的 iframe，CSP 阻止外部网络、嵌套页、表单和顶层导航。脚本和样式内联，图片可用 data URL；不依赖 CDN。持久化不能依赖 opaque iframe 的浏览器存储。

跨系统嵌入需先登记来源。外层宿主验证 `message.origin`、`message.source === iframe.contentWindow`、workbenchId/pageKey，收到 `nebu-service-ready` 后，将短期服务令牌以 `nebu-service-authorize` 和原 nonce 发给平台宿主页面的**精确 origin**；令牌不传给生成 HTML。收到 `nebu-service-auth-required` 后重新授权。内部 MessageChannel 仅承接该实例声明的能力，服务端仍复核应用、页面、项目和版本。未授权空外壳不包含页面内容。

## 验证与回退

已完成：Java 模块测试；前端类型检查、319 项测试、构建与 Sites 打包；New2 类型检查、构建及 30 项测试；页面协议的伪造消息、身份切换迟到响应和不确定写入重试测试。

隔离浏览器验证覆盖项目查询/更新、SSE、刷新、页面状态重开、私有草稿预览和窄屏；Java → 官方 MCP SDK → Java 的发现、调用、UI 资源和撤销也通过。独立 H2 + MySQL/Redis/S3 + Docker + 真实 pi SDK 链路覆盖智能体结构化结果及页面草稿；模型上游是明确的脚本 HTTP 测试替身，尚未代替目标环境真实模型验收。独立 Workflow 实例验证同一服务版本在源码变化后使用新结果、输出不合约时失败。

关键测试入口：Java `WorkbenchServiceIntegrationTest`；`node --test src/test/js/workbench-service-page.test.cjs`；New2 `tests/workbench-service-mcp.test.ts`、`tests/workbench-service-acceptance.ts`（需配套 opt-in Java 测试宿主和隔离基础设施）。默认测试不会连接共享服务或自动开启这些验收宿主。

回退先在「服务发布」停用服务或应用，阻止新调用及后续数据访问；对已派发任务在对应执行系统确认取消结果。全局关闭 `nebu.workbench-services.enabled` 可停用入口和服务草稿工具。恢复时先恢复兼容 New2/Java，再开启功能；保留服务表和版本资产。服务版本回退仅切换契约/绑定/页面；Workflow 的源码、环境与业务写入均不会被回滚。
