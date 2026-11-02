# 文件、文件夹与 ZIP 上传

知识库中点击「上传文件」，可选择多个文件、整个文件夹，或拖入文件和 ZIP。文件夹使用浏览器目录选择能力，保留根目录和子目录的相对路径；空文件夹不产生文档。

文件保存与解析独立：未知格式、空文件均保存并可下载，显示「已保存，暂不解析」，不创建解析任务。音视频处理关闭时也保留原文件。可解析的文件沿用该知识库的解析配置，未配置模型的阶段继续等待配置。

上传接收与每层 ZIP 解压统一过滤文件名以 `~$` 开头的 Office 临时锁文件，例如 `~$任务书.docx`、`~$表格.xlsx`。这些文件不保存为文档、不创建解析任务；前端选择文件或文件夹时直接跳过并提示数量。规则只匹配文件名开头，不影响名称中间含 `~$` 的文件或 `~$` 开头目录中的正常文件。该规则对新的上传与解压生效，已有文档和历史任务不自动删除。

## ZIP 行为

- 原 ZIP 独立保存并可下载，后台创建 `extract_archive` 任务。
- 递归展开内部 ZIP，子文件各自生成文档与文件版本。支持解析的子文件自动排队；未知格式只保存。
- 临时文件在读取和落盘前过滤；解压报告通过 `skipped_files` 单独统计，不计为解压错误。原 ZIP 内容完整保留。
- 来源路径示例：`上传目录/资料.zip/附件/内层.zip/说明.txt`。同名文件可以存在于不同路径；同一压缩包中重复名称的条目也独立保存。
- 每个子文件记录 `source_archive_id`，指向直接来源压缩包。删除 ZIP 文档不会删除已经展开的独立文档。
- 任务中心和 ZIP 详情展示解压报告，支持取消、重试。任务与进度保存在 PostgreSQL；中断后重新遍历不可变原 ZIP，按父文件版本和条目序号复用已保存文件，避免重复创建。
- 解压时禁止绝对路径、上级目录穿越、符号链接和特殊文件。加密、损坏、不支持的压缩方法或超限条目会报告未展开；原 ZIP 保留。未知**文件格式**不是跳过理由。
- 普通文件解析结果仍通过文件版本、来源引用定位；解压文件保留完整相对路径。

## 接口

所有接口使用 `/api/v1` 前缀，无调用方鉴权。

| 接口 | 说明 |
| --- | --- |
| `GET /uploads/policy` | 实际部署的上传及递归解压限制、未知格式策略 |
| `POST /knowledge-bases/{id}/uploads` | 建立分片上传；`file_name`、`file_size`（允许 0），可选 `sha256`、`relative_path` |
| `PUT /uploads/{id}/parts/{part}` | 上传分片，支持校验和与续传 |
| `POST /uploads/{id}/complete` | 合并保存、按类型排队；重复完成返回原结果 |
| `POST /knowledge-bases/{id}/knowledge/file` | 单文件 multipart 上传，ZIP 同样适用 |
| `POST /knowledge-bases/{id}/knowledge/files` | 多文件 multipart 上传，单请求最多 1000 个；逐项返回结果 |
| `GET /knowledge-bases/{id}/knowledge?q=...` | 搜索名称或相对路径；返回 `relative_path`、`source_archive_id`、`storage_reason` |
| `GET /knowledge/{id}/download` | 下载任意已保存文件，包括未知格式、空文件、原 ZIP |
| `GET /knowledge/{id}/stages` | 文档相关任务；ZIP 的检查点含 `archive_report` |
| `POST /tasks/{id}/cancel`、`POST /tasks/{id}/retry` | 取消或重试原解压任务 |

单文件 multipart 可在查询参数提供 `relative_path`，或在对应 `file` 字段前放同名文本字段；也可通过 multipart 的 `filename` 携带相对路径。浏览器目录上传逐文件创建分片会话，避免整批文件占满内存。

上传结果继续包含 `knowledge_id`、`file_version_id`、`file_hash`、`task_id`、`state`，新增 `relative_path`、`source_archive_id`、`storage_reason`。只保存的文件返回 `state=stored`、`task_id=""`；ZIP 先返回 `state=queued`，实际解压结果查询任务。ZIP 文档最终为 `extracted` 或 `partially_extracted`，其子文件有各自独立解析状态。

过滤临时文件时，分片会话创建和单文件上传返回 HTTP 200，`data` 为 `{ "state": "skipped", "skip_reason": "office_temporary_file", "file_name": "~$任务书.docx", "relative_path": "资料/~$任务书.docx" }`，不返回 `upload_id`、文档 ID 或任务 ID。批量上传仍返回 HTTP 202，逐项 `data.state=skipped` 表示已跳过。`GET /uploads/policy` 返回 `ignored_file_prefixes: ["~$"]`。

## 限制与部署

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `NEBULAEKNO_MAX_UPLOAD_MIB` | 2048 | 普通文件上限（二进制 MiB）；优先于旧 MAX_UPLOAD_MB 配置 |
| `NEBULAEKNO_MEDIA_MAX_UPLOAD_MIB` | 2048 | 音视频上限 |
| `NEBULAEKNO_ARCHIVE_MAX_UPLOAD_MIB` | 2048 | 单 ZIP 上限 |
| `NEBULAEKNO_ARCHIVE_MAX_EXPANDED_MIB` | 4096 | 单个根 ZIP 整次递归累计展开字节数，包括内层 ZIP 本身 |
| `NEBULAEKNO_ARCHIVE_MAX_DEPTH` | 8 | 解压层数；根 ZIP 为第 1 层 |
| `NEBULAEKNO_ARCHIVE_MAX_FILES` | 10000 | 单个根 ZIP 累计扫描条目数，包括目录和内层 ZIP |

解压后的单文件也遵循对应类型大小限制。达到限制的条目保留在原 ZIP 中，报告明确原因。解压报告最多展示前 100 条异常并返回完整异常计数。大文件通过临时磁盘分片合并、流式解压；容量预算不等同于可用磁盘容量，请为 `/data` 留出原件、临时分片、展开文件的空间。

正式 `compose.yaml` 仍只有一个应用容器，通过 `.env` 配置上述值。首次升级自动执行迁移 `010_upload_sources.sql`。本地开发环境使用默认预算，更新命令：

```powershell
cd D:\Work\Code\AiCode\nebulae-weknora-api
docker compose -f compose.dev.yaml up -d --build --no-deps --wait --wait-timeout 120 app
```

## 验证

`go test ./...` 覆盖递归、路径安全、链接、加密条目、字节/条目/层数预算、取消与损坏 ZIP。

`tests/upload_archives.py` 仅允许隔离环境 `19081`，验证分片与批量上传幂等、中文路径、同名文件、空文件、未知格式下载、递归解压后真实解析与检索定位、部分解压报告、取消重试、容器重启后 400 个文件不重复不遗漏。模型使用协议测试桩，不请求用户模型服务。

`tests/temporary_uploads.py` 在相同隔离环境验证分片入口与单文件过滤、混合批量及幂等重试、递归 ZIP 过滤、全临时文件 ZIP、原包保留，以及正常文件不被误过滤。浏览器目录上传验证临时文件跳过提示和正常文件保存。
