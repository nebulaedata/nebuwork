# 任务 HTML 产物发布为服务页面

任务成果列表和 HTML/HTM 预览栏增加「发布为 HTML 服务」。选择页面名称、标识、入口路径及已提交的配套文件，保存草稿、预览，再显式发布整个工作台服务版本。发布前可核对当前正式版本与完整草稿；其他已保存的能力和页面不会被覆盖。同名页面需明确选择替换，或修改标识。

## 内容、权限与版本

- 沿用统一登录、工作台服务应用授权、页面/项目范围和当前权限检查。没有匿名分享入口。
- 默认关联来源项目。新页面的 `projectIds` 允许纯静态页面在没有业务能力时发现项目；旧页面缺省该字段仍沿用已有逻辑。公共实例响应不暴露应用未授权的项目列表。
- 资源清单固定入口及每个配套产物的 ID、版本、SHA-256、大小和任务来源。Java 独立保存编译后的不可变 HTML 与来源清单；后续产物更新和任务容器消失不改变已发布内容。
- 预览不会激活正式版本。版本切换、停用、页面实例固定版本和授权撤销继续使用现有逻辑。
- 保存冲突保留本地编辑；重新读取服务草稿后手动核对。保存响应丢失时，完全相同的下一修订可恢复；发布重试返回原发布版本，不重新激活或重复创建。
- 浏览器切换账号或关闭弹窗时停止读取并清理预览；已经提交的服务写入通过原请求恢复，不自动重新提交。

## 支持范围

支持一个 HTML/HTM 入口及本地 JS/MJS、CSS、静态 JSON import、PNG/JPEG/GIF/WebP/AVIF/ICO、自包含 SVG、WOFF/WOFF2/TTF/OTF。CSS 支持嵌套 `@import`、`url()` 和单页内 SVG 片段引用。模块可静态导入及使用字面量动态 import；多个模块入口共享同一模块初始化。普通脚本保留全局变量，defer 脚本放到文档内容之后执行。

资源根据已提交产物的 `source.path` 建议匹配，默认仅自动勾选同任务且路径无歧义的依赖；可以手动补选同项目其他产物并修改包内相对路径。服务端重新校验全部依赖，不信任建议结果。

限制：入口非空且最多 2 MiB；入口与配套资源合计最多 100 个文件、20 MiB；生成 HTML 最多 32 MiB。所有文本采用 UTF-8。重复路径、越界路径、缺失资源、外部模块/样式/图片都会明确失败。

首期不执行 npm 安装、项目脚本或源码构建；已构建单页应用使用 Hash 路由。多 HTML 跳转、async 脚本、importmap、非字面量动态 import、`new URL(..., import.meta.url)` 资源、含脚本的 template 和嵌套页面需要预先整理为支持的静态资源。有模块依赖的脚本必须声明 `type="module"`。运行时 fetch/XHR 读取配套文件不受支持；业务数据继续通过 `window.NebuService`。SVG 内的外部资源需先内联。

HTML 在原有 opaque-origin `sandbox="allow-scripts"` 中运行。宿主、SDK 和 MCP 页面保持同一限制：脚本及样式内联，图片和字体使用 data URL；不开放直接网络、同源访问、弹窗或顶层导航。字体的 data 来源同时声明在宿主响应及内层策略中。

## 接口与引擎

现有 `POST /api/workbenches/{wb}/service/assets` 保留 `{html}` 和固定单产物导入，新增资源包形式：

```json
{
  "projectId": "<project>",
  "artifactId": "<html-artifact>",
  "version": 2,
  "entryPath": "index.html",
  "resources": [{"path":"assets/main.css","artifactId":"<css-artifact>","version":3}]
}
```

资产详情增加 `id/sha256/size/source`，保留 `html`。页面定义增加可选 `projectIds`，无需新数据库迁移。原 V23/V24 资产和版本表继续使用。

New2 `/v1/capabilities` 增加 `htmlArtifactBundles:true`。签名内部接口 `POST /v1/projects/{id}/html-bundles` 接收上面的入口和资源字段（不含 `projectId`），返回 `{html,sha256,size,source}`。这是无持久化副作用的编译；读取指定版本、校验所属账号/项目及对象 SHA，使用 parse5、esbuild 和 es-module-lexer，只从清单虚拟文件系统解析依赖，不访问项目文件系统、不执行项目插件。

Java 使用稳定请求编号调用编译，再校验结果哈希并保存服务资产。旧引擎返回明确升级提示，不降级发布缺失依赖的页面；原有上传入口仍可使用。

## 验证与交付

- New2：HTML 编译、签名 HTTP API、项目权限、字节校验、缺失/外部依赖、模块共享、CSS/字体/图片、原有服务 MCP 和成果契约专项，共 17 项测试通过；TypeScript 构建通过。
- 前端：发布弹窗、依赖建议、不可变版本、冲突/账号清理、原有服务页面与任务，以及传输专项，共 18 项测试通过；类型检查、Vite 构建、Sites 包装验证通过。
- Java：`HtmlServicePublicationTest` 和原有 `WorkbenchServiceIntegrationTest` 在隔离 Docker/H2 中验证，共 33 项测试通过；SDK/宿主 Node 测试通过。
- 浏览器：`scripts/html-service-acceptance.mjs` 使用真实 React 弹窗、实际 New2 编译器、Java 的实际页面壳/host/SDK，配合隔离的脚本化服务存储与授权接口。验证桌面/390px 窄屏、预览后发布、CSS/字体/图片/模块、沙箱、网络阻断、状态保存、来源更新后版本不变、未授权读取和撤销访问。报告和截图保存在 `apps/web/.qa/html-service/`。该浏览器测试不代表目标部署环境已验收。

先升级 New2 API（含生产编译依赖），再升级 Java 和前端。现有 `nebu.workbench-services.enabled` 开关继续生效；无需新增 SQL，不修改 Workflow 3.5。本次没有部署、重启共享服务或切换目标环境开关。

## 项目概览服务入口（2026-10-21）

项目 → 概览在业务配置和最近任务之间新增“已发布服务”区块，展示工作台当前启用的正式发布版本中、当前项目获授权的入口：

- HTML 页面：带当前 `projectId` 打开页面，或复制完整地址。
- API：显示实际 POST 地址，支持复制及查看该发布版本的 OpenAPI 文档。
- MCP：展示当前项目可用的工具，共用一个 Streamable HTTP 连接地址，支持复制。

区块显示发布版本、时间及状态，并提供刷新和工作台管理入口。页面按显式 `projectIds` 及全部引用能力的项目权限筛选，保留历史页面授权语义；草稿、预览和非当前版本不进入列表。无服务、停用、运行开关未开启和读取失败分别展示；刷新失败移除旧入口，切换项目/页签或账号时中止读取并清理数据。运行功能未开启时保留已发布信息，隐藏运行入口。

仅复用既有 Java 服务配置和版本读取接口，无新增后端、SQL 或运行资源修改。26 项前端专项/回归测试、类型检查、构建及 4 项 Sites 包装检查通过。`scripts/project-services-acceptance.mjs` 使用真实项目概览、组件和 URL 生成器，配合隔离脚本化服务响应，验证 HTML 项目入口、API 文档、MCP 剪贴板、桌面/390px/深色布局、状态切换及导航/账号清理；截图和报告位于 `apps/web/.qa/project-services/`。本增量只需更新前端，未部署共享环境。
