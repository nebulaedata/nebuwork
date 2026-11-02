# 扩展市场接入

实现范围为 NebuWorkAgent、Java nebuwork-backend-api 和 NebuAgentCoreNew2；没有修改 Workflow 3.5，也没有部署或重启共享服务。沿用现有页面样式、账号身份、运行资源、固定版本 Artifact、对象存储和 Worker 租约。

## 使用规则

- 市场仅发布 Skills 和 MCP，没有示例条目、热度或使用审批。旧设置的 `#/settings?tab=extauth` 转入真实市场。服务端管理员名单决定维护权限，与浏览器中的角色无关。
- 管理员创建条目，保存草稿，再发布不可变版本。完整 Skill 目录必须有根目录 `SKILL.md`，包含脚本、参考文件和素材；每个文件最多 20 MiB。重新上传完整目录会替换本次编辑的文件清单；部分上传失败时禁止保存不完整包，可使用原请求编号继续上传。
- MCP 支持 HTTP URL/Headers 与 stdio 命令/参数/环境变量。认证由管理员单独加密维护；认证输入留空保留，`{}` 清空。认证不会在详情、普通凭据列表、运行快照或操作结果中返回。
- 安装选择有权限的专家、工作台或活动项目及固定版本。安装完成显示“已加入运行资源草稿”，用户到目标页保存并发布后，新一轮执行才生效。手动升级同样进入草稿，保留原必需能力选项。移除本层引用后恢复上级扩展；继承项只读并提供来源入口。
- 下架禁止新安装和升级，已有安装和运行快照保留原固定版本。历史目录和专家绑定保留为“历史引用，未安装”，不会推断技能包或 MCP 配置。旧扩展绑定写接口返回迁移提示，模板绑定保持原逻辑。

### 当前目标页快速安装（2026-10-20）

专家、工作台和项目的“添加扩展 → 从市场安装”现在直接打开页内弹框，固定安装到当前对象。弹框包含搜索、类型筛选、目录分页、详情、版本说明与技能文件清单；升级入口复用同一弹框并预选扩展，不跳转市场页面。

有未保存的运行资源时，按钮显示“保存草稿并安装”，先保存完整文档，再使用返回的 revision 安装指定版本。安装状态和错误在弹框内展示；成功后重新读取当前对象并更新扩展表，可继续安装、完成，或明确点击“保存并发布资源”。不会自动发布。

未知提交保留原版本、目标及草稿 revision，只在用户点击时核对原请求。失败/未知操作可重试原编号；草稿冲突可在弹框内确认重新载入。关闭停止读取，已提交后台操作继续；重新打开可恢复保留的操作或查看当前对象最近安装。查看已成功的历史操作时，如果本页还有未保存的更改，会先保留这些更改，需明确确认后才能重新载入，避免列表刷新覆盖人工编辑。

该调整只改前端，复用现有市场和运行资源 API。补充 `MarketInstallDialog.test.jsx` 与 `RuntimeExtensionsMarket.test.jsx`，覆盖三种固定目标、页内安装及发布、保存失败不安装、未知请求原 revision 恢复、关闭后恢复轮询、账号切换、历史操作保留未保存内容及升级预选。本次完成 JSX/CSS/相对导入及 diff 静态检查；按仓库既有约定未执行前端测试、构建、服务或浏览器验收。

## 数据与接口

追加 Java `V26__extension_market.sql`，新建 `nw_market_extension`、`nw_market_asset`、`nw_market_version`、`nw_market_auth`、`nw_market_installation`、`nw_market_operation`。已发布的名称/描述与管理草稿分开保存；版本、文件源引用和安装载荷不可变。

接口均经过现有 Java 身份校验，浏览器只访问 Java：

| 接口 | 用途 |
| --- | --- |
| GET `/api/market/extensions` | 分页、名称/用途搜索、skill/mcp 分类；`manage=true` 仅管理员 |
| GET `/api/market/extensions/{id}` | 详情、不可变版本说明、文件目录及当前账号真实安装状态 |
| GET `/api/market/settings`、`/targets` | 功能状态、服务端管理权限、可安装目标 |
| POST `/api/market/extensions` | 创建市场草稿 |
| POST `/api/market/extensions/{id}/draft`、`/files` | 保存带 revision 的草稿；上传独立不可变文件，校验草稿 revision |
| POST `/api/market/extensions/{id}/auth` | 更新当前固定连接配置对应的托管认证 |
| POST `/api/market/extensions/{id}/publish`、`/withdraw`、`/restore` | 发布新版本、下架、重新上架，校验 revision |
| POST `/api/market/extensions/{id}/install`、`/upgrade` | 固定目标、扩展版本与目标草稿 `runtimeRevision`，返回持久操作 |
| GET `/api/market/installations?targetKind=...&targetId=...` | 当前目标的安装与继承项 |
| POST `/api/market/installations/{id}/remove` | 以目标 revision 移除本层引用，保留其他运行配置 |
| GET `/api/market/operations`、`/operations/{id}` | 当前账号最近操作、实际复制进度和最终结果 |
| POST `/api/market/operations/{id}/retry` | 用户明确重试原失败/未知操作，复用原编号及已准备文件 |

所有写入使用 POST 和稳定 `Idempotency-Key`。安装由 Java 持久任务执行，具有执行令牌和租约；过期执行者不能提交草稿。部分文件失败不创建安装记录或修改草稿。固定 Artifact 内容校验后复制为安装账号拥有的对象，全部准备完成后，安装记录、草稿引用和成功结果在同一事务提交。并发 revision 冲突保留原操作和草稿，需重新加载后发起新的安装。

浏览器不自动重放写入。安装提交结果不确定时固定原目标、版本和 revision，使用“核对原安装”复用原键；也可在最近安装操作中查看原结果。后台任务不因页面关闭而取消。导航/账号切换停止 UI 读取和轮询；密钥只存在编辑状态和必要的提交过程，不写入本地存储。安装轮询最多五分钟，之后可手动刷新。

运行资源文档增加可选 `extensionRefs: [{ installationId, required }]`，旧文档视为空数组。草稿只保存引用，模型、指令、普通文件和其他扩展均保留。发布时展开为现有 files/skills/mcp；发送给引擎的 bundle 不包含市场管理字段。市场 ID 和文件命名空间保留，不能通过手工 JSON 伪造托管引用。

## 执行与认证

Java `ExtensionRuntime` 按工作台 → 当前专家 → 项目合并。相同市场条目按整个包覆盖，包括删除旧版中、新版已不存在的文件。主执行、协作专家候选快照和工作台服务快照共用此解析器；候选专家只取得公共资源与自身私有资源。运行已冻结后不重新解析可变草稿。

托管认证引用使用 `market-mcp:` 命名空间。回调校验安装账号/目标权限、当前 Run 的固定 MCP、主执行专家或工作台/项目范围、Worker ID、fence、未过期租约、`managedAuthProtocol=1` 和执行上下文。缺少协议标记的旧 Worker 被拒绝。HTTP 要求 `worker_http`，stdio 要求 `isolated_stdio`。手工 MCP 继续使用现有凭据协议。

认证配置按传输、地址或命令及参数的摘要绑定；工具开放名单不改变认证目标。只轮换密钥时，同一配置的已有固定版本在后续连接/请求使用新值。更换连接目标产生独立认证配置，再发布新版本；旧版本不会向新目标发送新密钥。

New2 不再在扩展初始化时缓存认证。HTTP 每个实际请求及 SDK SSE 重连都重新读取认证，禁止重定向携带共享 Headers，已有流不强制断开。stdio 每次建立连接读取认证，再创建独立短生命周期 Docker 容器；只向该容器的非 root MCP 进程注入环境变量。它使用运行冻结的镜像摘要及现有资源限制，有独立工作区/PID 空间，没有宿主或任务挂载。连接关闭、父任务关闭、取消、旧 fence 接管会回收；租约心跳停止后容器 PID 1 自行退出。前端和任务容器不取得托管认证。

## 上线

默认配置已加入 Java application.yml：

```yaml
nebu:
  extension-market:
    enabled: false
    admin-ids: ""
```

管理员值为真实账号 ID 的逗号分隔列表。复用现有 `nebu.models.encryption-key`，不要更换已有加密密钥。备份需同时包含 Java 数据库与 New2 的固定 Artifact/对象存储；不自动清理历史版本或安装文件。

关闭功能开关会拒绝市场操作及托管 MCP 的认证/调用；它不是条目下架操作。需要保留已有安装使用时，应下架相应条目。

顺序：先升级 New2 API 和所有 Workers，确认 `/v1/capabilities` 的 `managedMarketMcp: true`；再更新 Java、应用 V26、更新前端；配置管理员并在目标环境验收后启用功能。stdio 使用同一个已配置执行镜像创建独立容器，管理员需要确认该镜像实际包含相应 MCP 命令与依赖。不下载或安装市场任意依赖到宿主环境。

## 本次验证

- Java 离线 Maven 编译及 `ExtensionMarketTest`：9 个用例通过。H2 MySQL 模式实际执行 V26，覆盖管理员默认拒绝、公开版本与草稿隔离、三种安装范围、两账号隔离、原键重复提交、部分复制失败恢复、过期操作原编号恢复与旧执行者拦截、revision 冲突、发布投影、必需选项保留、工作台发布继承、下架保留、凭据轮换、旧协议/过期租约/错误 fence/连接改绑拦截及整包覆盖。
- New2 类型检查通过；`market-mcp.test.ts`、`market-sandbox.test.ts` 共 8 个用例通过。包括真实本机 HTTP 服务与 pi MCP Client 的初始化、工具发现、实际调用及密钥轮换，以及模拟 Docker 的独立容器、无任务挂载/PID 共享、心跳、镜像摘要、旧 fence 回收和创建/关闭竞态及启动失败清理。
- 前端变更已做 JavaScript/JSX/TypeScript 语法、CSS 解析和 diff 空白检查。新增 API 原键恢复/账号切换及运行列表覆盖/继承/历史引用用例；按照 apps/web/AGENTS.md 的既有约定，本次没有执行前端测试、类型检查、构建、服务或浏览器验收。
- 本机 Docker API 返回 HTTP 500，未进行真实 stdio 容器联调；没有将模拟容器测试当作实际隔离验收。没有对共享环境应用迁移、启用功能或发起真实模型任务。

待目标环境验证：前端 `extensionMarketApi.test.js`、`RuntimeExtensions.test.jsx` 与市场管理/安装/升级/移除导航；真实 HTTP/stdio 管理认证；任务容器读取不到 stdio 认证；容器断连、取消、租约丢失后的实际回收；主执行、不同协作专家和服务执行的实际扩展调用；账号切换、并发编辑、下架、未知结果恢复。完成前保持功能关闭。
