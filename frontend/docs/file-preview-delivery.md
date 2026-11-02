# React 文件预览与 2 GiB 文件传输

本次改动跨三个仓库：NebuWorkAgent（React）、content-cloud-cluster-service/nebuwork-backend-api（Java）、NebuAgentCoreNew2（对象存储及任务输入）。工作流 3.5 的代码和知识库上传流程不在本次变更中。

## 行为与入口

任务附件、项目“成果文件”、指挥中心和情报复用的任务文件入口、知识库原文和证据阅读器使用共享 `DocumentPreview`。来源只能是固定版本成果、当前授权的知识库资源或任务证据 ID。关闭、切换文件和账号会取消读取，销毁 Office/PDF 实例、媒体和对象 URL；关闭页面只停止预览轮询，持久化后台任务继续。

| 格式 | 浏览器 | 后台 |
| --- | --- | --- |
| DOCX | docx-preview | LibreOffice PDF + 每页文本索引 |
| PPTX | React 生命周期封装 pptx-preview JavaScript API | LibreOffice PDF；验证原始幻灯片数与 PDF 页数后使用页码映射 |
| XLSX / XLS / CSV / TSV | SheetJS 表格 | POI 事件读取 / 流式 CSV，SQLite 按工作表和原始坐标分页 |
| PDF | 普通预览 iframe；引用使用 PDF.js | 受控 Range；引用按服务端索引读取目标页 |
| Markdown | markdown-it + KaTeX + highlight.js | 保持 5 MiB 文本预览限制；原文仍可流式下载 |
| 图片、音视频 | 浏览器原生标签 | 大文件使用受控地址，音视频支持 Range |
| HTML | 保留任务 allow-scripts 的不透明源沙箱；知识库禁用脚本 | 仅提供下载，不转换或在应用 DOM 执行 |

Office 前端阈值 20 MiB。小文件若 ZIP 展开量、表格行数或幻灯片数超出前端预算，也会进入后台；解析异常保留后台预览和下载入口。PPTX 保留预览副本修复、渲染页数校验及引用定位，已移除 Vue 及 @vue-office/pptx。

Markdown 保留成果、证据和 Wiki 的来源动作。未知语言转义显示，KaTeX 强制 `trust:false`、独立宏、展开和尺寸预算，坏公式显示错误文本。依据 [KaTeX 安全选项](https://katex.org/docs/security)。PPTX 使用 [官方 JavaScript API](https://github.com/501351981/pptx-preview)；转换使用 [LibreOffice 命令行](https://help.libreoffice.org/latest/en-GB/text/shared/guide/start_parameters.html) 和 [POI 事件模型](https://poi.apache.org/components/spreadsheet/how-to.html)。

## 传输和发布

最大输入 **2,147,483,648 字节**，允许精确边界。启用能力后，大小文件均通过新流式上传会话，单块 16 MiB、浏览器最多 3 块并发；小文件也不再经过旧的 Base64 链路。能力关闭时原有小附件流程保留，大文件明确提示未启用。

浏览器只读取切片并计算分块 SHA-256；Java 流式代理，New2 流式写私有 S3 multipart。进度只计已确认块。刷新后重新选择文件会逐一核对已确认块；恢复信息只在本机保存账号范围的会话 ID 和稳定请求键。完成结果不确定时查询原会话，后台流式计算完整 SHA-256 后才发布固定版本成果。重复完成复用原成果，不产生新版本。任务执行时大附件流式写入隔离容器，检查点复用经流式哈希核对的不可变对象，避免再缓冲整个附件。

Java 公开接口使用现有环境前缀、Cookie 会话及当前来源权限：

- `/api/projects/{project}/artifact-uploads`：POST 创建；`/{id}` GET 查询；`/{id}/parts/{number}` POST 二进制块；`complete` / `cancel` POST。
- `/api/file-previews`：POST 创建或复用；`/{id}` GET 状态；`content` GET Range 原文/PDF；`download` GET 附件下载；`retry` / `cancel` POST。
- `/{id}/sheets/{sheet}/rows`：默认 200 行、50 列；`cell` 分段读长单元格；`/{id}/locate` 根据文本索引返回唯一页、缺失或多处匹配。
- `/api/file-previews/capabilities`：已登录账号读取当前开关。`downloadOnly:true` 创建只允许原文下载的受控会话，不内联 HTML 等非预览格式。

Java 管理预览任务、独占账号租约和缓存。Worker 使用独立 Bearer 密钥及有期限的租约访问 `/internal/file-preview`；端点不会接受任意 URL。缓存键包含账号、来源身份、固定版本、来源指纹和渲染器版本，每次读取重新验证当前权限。转换后的 DOCX 按引用文本定位，不把原解析页码当成转换页码。缺失、重复和失效映射保留真实状态。

## 迁移与启用

1. 在目标环境按既有发布流程备份，并由 Flyway 顺序执行 **V27__file_previews.sql** 和 **V28__file_preview_account_lease.sql**。V27 保持已执行版本不变，V28 增加账号租约字段和唯一索引。V26 已由扩展市场使用，不要改号或覆盖旧迁移。
2. 升级 New2：启动迁移新增 `ae_file_uploads`、`ae_file_parts`、`ae_preview_objects`。参考 `deploy/file-previews.env.example`；API 和执行 Worker 都设置 `FILE_TRANSFERS_ENABLED=true`，确保大附件工作目录使用临时容器磁盘。默认关闭。
3. 合并 Java `config/nacos/file-preview.example.yml`，先保持 `nebu.files.enabled=false`。配置独立、至少 32 字符的 Worker 密钥；Java 与 Worker 配置一致。内部端口保持私有。
4. 在 `preview-worker` 构建并启动独立 Docker Compose。LibreOffice 子进程清空凭据环境，禁用宏与链接更新，使用独立 UID；iptables 禁止该 UID 的 IPv4/IPv6 网络。Java Worker 只通过内部 API 传输。根文件系统只读，SQLite 本地库放在专用磁盘 `.native`，避免 noexec `/tmp` 导致加载失败。
5. 网关二进制块路由允许至少 16 MiB 加头部，关闭请求/响应整段缓冲，配置长流读取和 Range 转发。保留旧 multipart 与知识库 JSON 的现有限制。S3 保持私有，并设置未完成 multipart 的清理策略。不要对不可变成果对象应用预览过期规则。
6. 完成隔离验证后，在目标环境启动 Worker、开启 Java/New2 能力，再发布前端。回滚先关闭开关，保留数据库与私有对象，避免损坏既有成果。

| 配置 | 默认 |
| --- | --- |
| Worker 每实例并发 / CPU / 内存 | 1 / 4 CPU / 16 GiB；JVM 最大堆 8 GiB |
| `PREVIEW_SCRATCH_BYTES` / `PREVIEW_TIMEOUT_MS` | 64 GiB / 3,600,000 ms |
| `FILE_UPLOAD_TTL_MS` | 86,400,000 ms（24 小时） |
| `FILE_PREVIEW_TTL_MS` / `nebu.files.preview-ttl-ms` | 604,800,000 ms（7 天），两端保持一致 |
| `nebu.files.worker-timeout-ms` | 3,600,000 ms，与 Worker 保持一致 |
| `nebu.files.preview-cache-bytes` | Java 本地索引缓存 128 GiB，按过期和容量清理 |

每个 Worker 实例使用独立 scratch volume；启动文件锁防止共用，重启清理本实例遗留临时目录。宿主机为该 volume 配置 64 GiB 文件系统/卷配额；应用也监控临时目录容量。Java 本地 SQLite 缓存使用独立目录，部署时留足磁盘并保证 SQLite 本地库目录可执行。派生索引允许超过原文大小，私有派生对象单个上限 64 GiB。

资源限制会明确失败：ZIP 声明展开量最多 32 GiB；单元格最多 16 MiB；CSV 单行最多 32 MiB、16,384 列；单页 PDF 提取文本最多 8 MiB。公式只读取缓存值，不执行。知识库读取复用原网络校验和授权，新增流式通道绕过旧 100 MiB 内存缓冲，未改变知识库上传。

## 隔离验证记录（2026-10-20）

使用独立 MySQL / MinIO / Redis、Java H2 会话与生成的测试资料；未重启或发布共享业务服务。

- React 类型检查、完整前端测试、生产构建和 Sites 包装测试通过。
- 最终完整前端套件 399 项、Sites 4 项，Java 19 项（含 opt-in 隔离 HTTP host）、Worker 5 项通过；Java V27 在隔离 H2 全迁移和独立 MySQL 库中执行通过。
- New2 分块、幂等完成、账号/项目隔离、错误长度/校验、精确 2 GiB 边界、空文件、私有派生物过期与 Range 测试通过；13 项真实 Docker 执行集成测试通过。
- Java 预览迁移、权限撤销、租约 fencing、过期和原文网络传输测试通过；真实 128 MiB HTTP 流读取越过旧 100 MiB 限制。
- Worker 单测覆盖 CSV 多行/前导零、XLS/XLSX 缓存公式与坐标、PDF 页索引、XXE 拒绝和过长 CSV 字段；独立 Docker 镜像构建通过。
- 独立转换进程在最大堆 **512 MiB** 下完整解析有效 2 GiB CSV，首、中、末行校验通过。
- 六种格式的原文上传、后台预览与权限校验通过。有效大 DOCX 25,217,083 字节、PPTX 25,272,707 字节、XLS 32,467,456 字节、XLSX 43,541,012 字节验证了后台处理和随机访问；PPTX 共 32 页。
- **真实有效 2 GiB CSV**：2,048 行，每行 1 MiB；完整 SHA-256、首/中/末行和长单元格分段读取通过。上传客户端峰值 RSS 181.4 MiB。2 GiB 附件写入 Docker 和检查点恢复验证峰值 RSS 144.9 MiB，没有整文件缓冲。
- 在生产 Docker 配置下中断 2 GiB 原文读取，重启 Worker 并等待 SQL 租约失效后成功恢复到 ready；末行正确。同一镜像完成 32 页 PPTX 转换与第 32 页引用定位，并验证转换 UID 的网络请求被拒绝。
- 大 DOCX 与 PPTX 的首、中、末页（第 1、16、32 页）在生产镜像内逐页核对索引文本通过。
- 浏览器验证 React PPTX 三页实际内容、Markdown 公式/高亮、PDF 与 Office 引用、Excel 两工作表、2 GiB 表格随机跳行、任务 HTML 执行及知识库 HTML 禁止执行；窄屏检查滚动和分页控件。
- 原生图片实际解码 320×180，WAV 读取 1 秒时长并达到可播放状态；未将视频编码兼容性描述成已完成实测。

可重跑入口：`scripts/file-preview-acceptance.mjs`、`scripts/file-preview-recovery.mjs`，New2 的 `scripts/file-input-acceptance.ts`，Java opt-in `FilePreviewBrowserHostTest` 和 Worker `FormatAcceptance`。这些脚本固定隔离端口与测试身份，不得指向共享部署。生成的原文件和机器报告在 `apps/web/.qa/file-previews/`，不提交大体积测试数据。

知识库端到端 UI 使用授权发现适配器 fixture，实际文件字节经 Java/New2/私有 S3。真实目标知识库、网关 Range 和目标浏览器媒体编码兼容性应在该环境启用前验证；本次没有使用业务账号或业务资料替代验收。2 GiB 容量实测使用有效 CSV，Office 实测为上述 20 MiB 以上的有效文件，不将其描述成所有 Office 格式的 2 GiB 实测。

Chrome 扩展当前未开启文件 URL 访问，浏览器文件选择器的自动选文件步骤被扩展拒绝；未修改该权限。实际二进制上传通过隔离 HTTP 全链路和浏览器传输代码单测验收，项目上传/预览入口已在页面检查。

## V27 启动校验修复

若启动日志报告 V27 `Applied to database: -259110397`、`Resolved locally: -837472908`，原因是账号租约字段和唯一索引曾追加进已经执行的 V27。现已恢复原 V27（校验值 `-259110397`），将增量移至 V28。重新构建模块以刷新 `target/classes/db/migration`，再启动应用，Flyway 会保留 V27 历史并执行 V28。无需修改历史表、关闭校验或删除现有预览数据。

`FilePreviewMigrationsTest` 重现修改旧迁移时的启动校验失败，再验证恢复旧脚本后从 V27 升至 V28，以及新库初始化、重复启动和账号租约唯一约束。新增迁移回归与原预览测试共 9 项通过；独立 MySQL 8 上验证 V27→V28 后旧数据保留，字段及唯一索引完整。未修改实际业务数据库历史，也未重启共享后端。其他不同校验值的环境需要先核对实际执行脚本与表结构，不能直接套用修复历史表的操作。此处理符合 [Flyway 的 checksum mismatch 说明](https://documentation.red-gate.com/flyway/reference/exit-codes-and-error-codes/validate-error-codes)。
