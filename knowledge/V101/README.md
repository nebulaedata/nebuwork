# Nebulae V101 · NebuWork 知识库

新增「知识库问答」栏目：支持多轮追问、全局/会话系统提示词、模型读取原图、回答插入原文图片和点击引用直接定位。问答沿用已有检索、模型与版本化来源；SSE 支持断线续接、停止和重试。使用说明与公共接口见 [知识库问答](docs/知识库问答.md)。

新增「条款参数提取」工作台。文件详情分为「数据处理 / 扩展应用」两类，原文、解析、分块、图片、Wiki 和图谱归入数据处理，参数提取归入扩展应用，并预留统一应用接入结构。进度跟随当前模块显示，参数提取提供独立流水线，记录四个执行阶段、并行分块、重试与实际耗时；历史运行不补造计时。解析版本可用后逐篇手动启动，默认全文、可选章节，保留六字段及版本化原文引用，支持定位和四表 Excel 导出。模块独立于现有数据处理，不自动执行或写入 Wiki、图谱。每次运行保留历史，重启继续未完成分块；提取模型可独立设置，默认沿用系统文本模型。接口与存储说明见 [提取引擎说明](extractor/README.md)。

独立知识库服务，采用 Go API、Python 解析进程、React + TypeScript + TDesign React 后台。主系统与条款参数提取分别部署在两个应用容器中。当前版本 `0.1.0`。完整产品约定见 [设计方案](docs/NebulaeKno-完整方案.md)，已实现范围及验证结果见 [实施与验收](docs/实施与验收.md)。

已接通创建知识库、上传、解析/OCR、目录树、分块、图片和音视频处理、Wiki、知识图谱、八种检索及版本化来源定位。后台和其他项目使用同一套 `/api/v1` 公共接口，无需登录或调用方鉴权。

本目录是迁入 NebuWork 的独立知识库服务。统一开发环境使用仓库根目录 `scripts/Start-Dev.ps1`，由 `deploy/dev` 管理基础设施、知识库和参数提取容器；入口为 NebuWork 的「设置 → 知识库 → Nebulae V101」。不包含或启动原仓库的智能体核心。迁移边界及授权说明见 [NebuWork 接入说明](NEBUWORK.md)。

后台主题色在「设置 → 外观」修改，默认紫蓝色 `#6254e8`，支持预设颜色、自定义调色板、效果预览和恢复默认。保存到服务端后全局生效，其他已打开的页面刷新后同步。`GET/PUT /api/v1/settings/appearance` 读写 `{ "brand_color": "#6254e8" }`；更新主题不会触发文档处理。

## 部署

准备固定的三个外部服务：PostgreSQL 17 + pgvector 0.8.x、Neo4j Community 5.26 LTS + 匹配 APOC Core、Redis 7.4。

1. 将 `.env.example` 复制为 `.env`，填写三个连接 URL。
2. 执行 `docker compose up -d --build`。
3. 查看 `docker compose logs -f app`，就绪检查为 `http://localhost:8080/health/ready`。
4. 打开 `http://localhost:8080`，在「设置」添加模型并绑定用途，再创建知识库和上传文件。

正式 Compose 包含 `app` 与 `extraction` 两个应用服务，共享现有数据库、Redis 和 `/data` 文件卷。主系统负责解析、Wiki、图谱、任务分发和模型调用；提取容器负责提取 API、执行及导出。原接口由主系统转发，页面地址和功能不变。提取直连默认 `http://localhost:19082/api/v1`，文档 `/api/docs`；该端口只提供提取功能，原文定位仍由主系统提供。文件卷保存源文件、派生文件、安装身份和模型凭证加密密钥；升级时保留原文件卷。账号或密码中的 `@ : / ? # %` 等保留字符必须按 URL 规范编码。

镜像构建：`docker build -t nebulaekno:0.1.0 .`。镜像内包含 Go、Python、LibreOffice、中文字体、Tesseract、FFmpeg 和 React 静态文件。默认预算为 4 CPU、8 GiB 内存；外部数据库、图数据库、Redis 和模型服务需要各自的运行资源。现有镜像启动时可使用 `docker compose up -d --no-build`。

## 外部服务要求

| 服务 | 必需准备 |
| --- | --- |
| PostgreSQL | 数据库账号；允许连接维护库 `postgres`；目标库不存在时需要 CREATEDB；目标库内有创建 schema、表、索引和 vector 扩展的权限。服务器先安装 pgvector 二进制。 |
| Neo4j | 默认库 `neo4j`；允许读写、约束和索引创建、SHOW PROCEDURES/CONSTRAINTS；允许 `apoc.merge.node`、`apoc.merge.relationship`、`apoc.coll.union`、`apoc.periodic.iterate` 及 `db.awaitIndexes`。 |
| Redis | 数据库 0；AOF=yes、maxmemory-policy=noeviction；允许 INFO、CONFIG GET、PING、GET/SET/DEL、队列读写、EXPIRE 和 EVAL 脚本。应用不会 CONFIG SET 或清空实例。 |

Neo4j URL 中的账号密码由应用拆出传给驱动，固定使用 `neo4j` 库。应用不创建远程服务器账号、不安装远程服务器插件，也不创建第二个 Neo4j 数据库。

## 启动与恢复

- 配置错误、认证或权限失败、插件缺失、结构冲突均导致非零退出。
- 连接暂时不可用时有界重试；初始化完成前业务路由返回 503。
- PostgreSQL 自动建库、事务迁移和默认值补齐；迁移使用固定连接的 advisory lock，保存校验和和结构指纹。
- 图谱约束与安装身份必须匹配。Redis 使用安装专属前缀，任务事实保存在 PostgreSQL。
- 初始化失败保留合法检查点，下次启动继续；不会自动删库、回退迁移版本或重置用户配置。
- `/health/live` 表示进程存活；`/health/ready` 表示基础设施、迁移和解析进程均可用。
- 外部依赖失联时业务返回 503；恢复检查通过后重新开放。超过恢复预算或关键解析进程退出，应用退出。
- 数据库必须与 `/data/config/installation.json` 配套；该文件包含加密密钥，须随文件卷备份，不能公开。

基础设施配置通过环境变量提供，业务模型及解析默认值保存在数据库。接口不要求调用方身份验证，模型供应商凭证仍加密保存且不回显。

模型查询、PaddleOCR-VL 连接和按知识库配置解析引擎，见 [模型与解析设置](docs/模型与解析设置.md)。

解析内容的排版视图、分块和图片页均展示已入库的图片。Office 内嵌 PNG/JPEG 及 WMF/EMF/SVG 图形会转换为可预览图片；旧 DOC/PPT/XLS 会补提取解析库遗漏的内嵌资源。转换得到的结构位置明确标注“转换后”，不假定与 Word 原始分页一致。HTML/Markdown 支持内嵌 data 图片，MHTML/EPUB 读取包内图片；未随文件上传的外链图片不自动下载。PDF 整页扫描图仍仅用于预览。

`GET /api/v1/knowledge/{id}/content` 增加 `image_occurrences`，图片插入点使用原始解析文本的 Unicode 偏移，`unplaced=true` 的图片单独显示。`POST /api/v1/knowledge/{id}/images/rebuild` 只补充缺失的图片理解，保留已有描述、Wiki 和图谱。历史 Office 文件可用 `scripts/repair_embedded_images.py` 做增量修复：默认预检，显式指定文档及容器名，`--apply` 前自动备份；不会重建文字分块或改变已有引用 ID。

## 模型与处理默认值

| 用途 | 接口要求 |
| --- | --- |
| 文本生成 `text` | OpenAI 兼容 `/chat/completions`，用于 Wiki、图谱、目录候选提取；结果另做来源核验 |
| 文本向量 `embedding` | OpenAI 兼容 `/embeddings`，所有向量维度一致；可设置维度以检查供应商响应 |
| 图片理解 `vision` | 支持图片输入的 `/chat/completions`；图片描述与 OCR 原文分开记录 |
| 语音识别 `asr` | `/audio/transcriptions`，支持 `verbose_json` 和分段 `start/end/text`；只有纯文本的响应不能用于时间定位 |
| 重排 `rerank` | `/rerank`，返回覆盖候选索引的相关性分数 |
| 多模态向量 `multimodal_embedding` | Jina 兼容 `/embeddings`，支持 `input: [{text: ...}]` 与 `input: [{image: dataURL}]` |
| 目录辅助 `outline` | 可选文本生成用途；未绑定时回退到 `text`，原生标题和书签不依赖大模型 |

Base URL 填 API 前缀（例如供应商的 `/v1`），不要包含 `/chat/completions` 等具体操作路径。使用后台的真实输入测试检查兼容性；视觉、语音、多模态向量测试需要上传样本。容器访问宿主机服务时使用 `host.docker.internal` 或宿主机可达地址。

默认分块 512 字符、重叠 80；目录、Wiki 和中文通用图谱开启。混合检索默认 top_k=10、candidate_k=50、RRF k=60，向量/关键词权重 0.7/0.3。视频代表帧默认间隔 30 秒、最多 240 帧，达到预算时扩大采样间隔并记录实际值。原文偏移以 Unicode 码点计，媒体时间为毫秒。

新知识库保存全局配置快照。原生解析和关键词检索不需要模型；缺少其他用途模型时，相应任务阶段返回 `waiting_configuration`，已成功阶段保留。绑定模型后可继续任务。关闭的阶段返回 `disabled`，局部重建未执行的阶段返回 `skipped`。

## 接口使用

后台地址 `/`；接口目录 `/api/docs`；OpenAPI `/api/openapi.json`（同一份定义也在 `/api/v1/openapi.json`）。接口通常返回 `{success, data}` 或 `{success: false, error: {code, message, retryable}}`，分页列表另有 `meta`。异步处理返回 HTTP 202 和 `task_id`。

```bash
# 1. 创建知识库，将返回的 data.id 作为下方 KB_ID
curl -X POST http://localhost:8080/api/v1/knowledge-bases \
  -H 'Content-Type: application/json' -d '{"name":"产品资料"}'
# 2. 上传；文件必须绑定已存在的知识库
curl -X POST http://localhost:8080/api/v1/knowledge-bases/KB_ID/knowledge/file \
  -H 'Idempotency-Key: example-upload-001' -F 'file=@document.pdf'
# 3. 任务详情与事件续接
curl http://localhost:8080/api/v1/tasks/TASK_ID
curl -N http://localhost:8080/api/v1/tasks/TASK_ID/events -H 'Last-Event-ID: 123'
# 4. 关键词检索无需模型；更换 mode 可选择其他通道
curl -X POST http://localhost:8080/api/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"knowledge_base_ids":["KB_ID"],"query_text":"数据库初始化","mode":"keyword","top_k":10,"include_sources":true,"rerank":{"mode":"disabled"}}'
# 5. 解析来源引用，preview_url 可直接打开后台原文定位页面
curl http://localhost:8080/api/v1/sources/SOURCE_REF_ID
```

检索模式：`keyword`、`vector`、`hybrid`、`graph`、`wiki`、`image_text`、`image_vector`、`multi`。多路检索可用 `multi.channels` 指定通道；允许部分成功时在 `meta` 中报告未就绪通道。图片检索先上传到 `/search/query-images`，再传 `query_image_id`，查询图片不会成为知识库文档。

图谱召回可查询当前版本中已成功同步的部分证据，无需等待全部分块完成。部分覆盖时仍返回结果，`meta.warnings` 提供 `GRAPH_PARTIAL_COVERAGE`，`meta.graph_coverage` 报告所选范围的文档数、完成数、已有同步证据的文档数及待同步证据数。未同步及旧解析证据不参与召回；没有可用内容时明确区分尚未生成与等待同步。检索页将覆盖不足显示为提示，不阻止查看结果。该调整不重跑文档或修改已有图谱数据。

来源包含 `file_version_id`、`parse_version_id`、文件哈希、原文 `quote`、`locators`、`precision` 和 `mapping_method`。不要仅保存文档 ID：重解析会生成新的解析版本，旧引用仍应使用原版本。生成的图片描述使用 `metadata.generated_text`，不会冒充源文件原文。PDF 使用 PaddleOCR-VL 时，按版面分为文字、表格和图片；图片根据区域坐标裁剪后单独理解和索引，整页图只用于原文预览。图片、分块和检索结果保留原 PDF 页码及区域高亮，`partial=true` 表示未提供逐字坐标。旧版 PDF 需要在文档中点击“重新处理”才能提取区域图片。

大文件采用 `/knowledge-bases/{id}/uploads` → `/uploads/{id}/parts/{part}` → `/uploads/{id}/complete`。后台自动使用分片上传；同一上传会话支持重传校验与完成请求幂等。普通文件、ZIP 和音视频单文件默认最大 2 GiB；音视频最长 4 小时。

## 开发与测试

### OFD 页面解析

OFD 默认使用 `paddleocr_vl`：镜像内的 OFDRW 2.4.0 渲染器逐页生成 PNG（最高 240 DPI、长边最多 3200 像素），随后调用与 PDF 相同的 PaddleOCR-VL `/layout-parsing` 接口。文字、表格和图片分开保存；只有版面识别出的图片区域进入图片理解与图片向量化。整页图仅作 OCR 输入和原文预览。

预览使用同一批页面图生成的无损图片 PDF，沿用分页、缩放及区域高亮。下载接口始终返回原 OFD，来源保留原 `file_version_id`、页码及归一化区域坐标，`source_format=ofd`、`mapping=source_page_raster`。页面渲染不是电子签章验签。渲染器不支持的页面或 OCR 服务错误会明确失败，不会自动改回 XML 碎片解析；详细渲染日志保存在对应派生目录的 `ofd-render.log`。

首次升级将原 OFD 默认 `native` 选择改为 `paddleocr_vl`，保留已有任务、解析版本和引用。已有文件需点击“重新处理”生成新版本；旧版内置文本提取仍可显式选择。没有配置 PaddleOCR-VL 服务时任务等待配置。`POST /api/v1/knowledge/{id}/preview/rebuild` 可独立生成 OFD 图片版预览，无需调用模型。流水线分别显示“OFD 逐页渲染”和“PaddleOCR-VL 逐页解析”的实际页数进度。

OFD 运行依赖随单容器镜像构建，无需额外部署转换服务。渲染代码及固定依赖位于 `reader/ofd-renderer`，依赖清单由 Maven 解析并随镜像保留相应 JAR 中的许可证。

开发构建使用 Go 1.26；可以直接使用 Docker Go 构建环境。外部依赖测试位于 `tests/compose.yaml`，使用独立的 `nebulaekno-test` 项目、网络和数据卷。

```powershell
docker compose -f tests/compose.yaml up -d postgres graph redis
docker build -t nebulaekno:0.1.0 .
docker build -f Dockerfile.extraction -t nebulaekno-extraction:0.1.0 .
python tests/startup.py
docker compose -f tests/compose.yaml --profile functional up -d model-fixture
Get-Content -Raw tests/generate_samples.py | docker compose -f tests/compose.yaml exec -T app python3 -
docker compose -f tests/compose.yaml cp app:/tmp/nebulaekno-fixtures tests/fixtures
python tests/functional.py
python tests/versions.py
python tests/contracts.py
python tests/recovery.py
```

上述命令适用于 PowerShell。首次复制样本前确保 `tests/fixtures` 不存在，重复运行可直接使用已有样本。

功能测试的模型服务是显式隔离的协议测试桩，只验证真实 HTTP 调用、数据落库、检索和引用链路，不能代表真实模型的语义、OCR 或语音识别质量。它不包含在正式部署文件中。

```powershell
docker run --rm --network nebulaekno-test_default -e NEBULAEKNO_TEST_INTEGRATION=1 -v "${PWD}:/src" -v nebulaekno-gomod:/go/pkg/mod -v nebulaekno-gobuild:/root/.cache/go-build -w /src golang:1.26-bookworm sh -c 'go test -race ./... && go vet ./...'
cd web
npm ci
npm run build
```

Go 测试启用 `NEBULAEKNO_TEST_INTEGRATION=1` 时，需要在测试网络中运行。默认测试不连接外部服务。测试地址和密码仅用于隔离测试环境。

测试后可以用 `docker compose -f tests/compose.yaml down` 停止测试服务；这不会停止正式部署或删除文件卷。正式数据的完整备份需要 PostgreSQL、Neo4j、文件卷和加密密钥共同完成。

### 单篇文档 Wiki 与知识图谱

文档详情新增 Wiki、知识图谱标签。进入时收起原文目录和来源侧栏，复用 Wiki 阅读器、圆点关系图和右侧详情。Wiki 默认只展示本文件可核验的贡献正文；共享页面可通过“查看完整 Wiki 页面”进入知识库并选中该页。缺少贡献标记的手工合并内容只展示已有引用和提示，不将整页内容归属本文件。

实体图谱读取 PostgreSQL 中所选版本的已验证证据。保留同名实体的不同描述、全部来源及 Neo4j 同步状态；画布将同一事实关系的重复连线合并，详情仍逐条展示证据。支持搜索、类型筛选、邻居聚焦、全屏及原文定位。每次加载 100 条证据，标明已加载/总数，可继续加载；搜索及类型筛选针对已加载范围。Wiki 每 5 秒、图谱每 10 秒刷新已生成结果，失败不抹去可用成果。

新增只读接口（前缀 `/api/v1`）：

| 接口 | 用途 |
| --- | --- |
| `GET /knowledge/{id}/related/stats` | Wiki 页面、实体、关系证据数量、处理阶段及同步状态 |
| `GET /knowledge/{id}/wiki/pages` | 本文件页面列表，支持 `q`、`page`、`page_size` |
| `GET /knowledge/{id}/wiki/pages/{page}` | 本文件贡献正文、引用、共享标记及完整页面链接 |
| `GET /knowledge/{id}/wiki/graph` | 本文件贡献内容中的 Wiki 节点与关系 |
| `GET /knowledge/{id}/graph` | 按证据记录游标分页返回实体、关系和引用 |

全部支持 `file_version_id`、`parse_version_id`，缺省采用当前解析版本，错误或不匹配版本返回 404。响应回传实际版本，后续分页应固定该版本。Wiki 列表分页信息位于顶层 `meta`；图谱分页信息位于 `data.meta`，含 `total_records`、`returned_records`、`has_more` 和 `next_cursor`（下一请求使用 `cursor`）。`page_size` 默认 20、上限 100。跨页按实体 `name`、关系 `id` 合并，同时保留各实体的 `descriptions`、`types`、`source_ids`。证据 `source_ref_id` 沿用 `/sources/{id}` 的原文定位入口。

历史 Wiki 优先从匹配来源的最近修订提取正文；没有可核验区段时明确说明。升级只新增查询索引，不改生成提示词、不自动重跑文件，也不改写已有解析、Wiki、图谱或来源记录。完整接口字段见 `/api/v1/openapi.json`。`tests/document_related_flow.py` 仅在隔离的 `tests/compose.settings.yaml`（19081）验证共享页面、历史版本、同名实体、103 条证据分页、状态及只读性。

### OCR 循环重复的展示清理

PaddleOCR 保持服务端默认生成参数。`region-loop-v1` 仅清理单个 OCR 文字/图片块内相邻、完全相同的短语序列（至少 8 轮，重复部分至少 160 个字符），保留首轮及前后内容。不跨块或跨页去重，不清理表格、纯数字、原生解析文本和 AI 描述。此保守规则不能检出所有异常，也不证明去重后的识别内容完整或准确。

原始 `content`、`quote`、`recognized_text` 和 Unicode 引用偏移始终保留。接口新增对应的 `display_content`、`display_quote`、`display_recognized_text`；`ocr_cleanup` 含异常提示和原始文本内被隐藏的 Unicode 区间。页面默认显示清理结果，可切换查看原始 OCR，并继续按原页码、区域定位。新解析同时保存 `display_text` 和 `ocr_cleanup`；旧解析读取时生成展示投影，无需重新调用 OCR，也不迁移或覆盖成功结果。

异常区域仍标记待核验，不用清理后的文本冒充可信原文。新解析的异常循环区域不加入关键词/文本向量索引，Wiki 和图谱沿用证据质量检查；独立的图片理解可以继续。升级不会删除或重建已有索引、Wiki、图谱及图片理解结果。


### XLS / XLSX 工作表处理

新建知识库默认使用专用 `excel` 引擎：XLSX 直接通过 openpyxl 读取，XLS 通过 xlrd 读取；也可以继续选择 anydoc、原生兼容选项。升级时保留已有知识库的引擎选择，不触发历史文件重解析。全局默认选项可在“设置 → 文件格式与引擎”修改。

默认不推断表头，第一行也是数据，列名使用 A、B、C。可在“解析策略 → Excel 表格”设置知识库默认表头行，或在文件“原文预览 → 设置表头”指定各工作表的表头。文件设置保存后不会更改已有解析；点击“按新表头重新处理”才产生新解析版本。旧解析及其原文引用保持可访问。

- 预览直接使用原文件的工作表、行列、单元格和合并范围，按范围分页读取；Excel 默认不走 PDF 预览。表格支持切换工作表、跳转行列、合并区域显示和来源高亮。
- 分块不跨工作表、不跨空行区段；普通行保持完整，超长单元格拆为多个片段但保留同一单元格引用。表头、合并主单元格的补充上下文单独记录来源，不移动正文引用偏移。
- anydoc 的表格与图片保留；位置通过源工作表核验。内容不一致、重复匹配等情况标记“位置未核验”，不猜测单元格。解析失败不会静默切换引擎。
- 普通 XLSX 内嵌图片、可读取的 WPS DISPIMG 图片使用原工作表锚点。XLS 补提图片使用转换副本，明确标记“转换后位置”，不作为原工作表精确坐标。图片 OCR 与 AI 理解仍分开保存。
- 保留原始值、显示文本、数字格式、可读取的公式及合并范围。百分比、日期、数字、文本分别处理，文本前导零不丢弃。公式只读已保存缓存，不执行公式或宏；XLS 只提供缓存值，不提供公式文本。缺失缓存、未完整支持的数字格式、图片提取失败会提示。
- 复杂 Excel 图表不承诺完整渲染或语义还原，源文件可下载。单个工作表最多 200000 行；工作簿各表行列包围范围合计最多 2000000 个单元格。超过限制、损坏或加密文件明确失败，不截断后报告完整成功。解析仍受容器的时间、内存和压缩包限制约束。

接口（均以 `/api/v1` 为前缀）：

| 接口 | 用途 |
| --- | --- |
| `GET /knowledge/{id}/sheets` | 工作表列表、行列数、合并范围和文件设置 |
| `GET /knowledge/{id}/sheets/{sheet_id}/cells` | `row_start`、`column_start`、`row_count`、`column_count` 范围读取；单次最多 200 行、50 列 |
| `PUT /knowledge/{id}/spreadsheet-settings` | 保存 `{file_version_id, excel:{header_rows:[], sheets:{工作表名:{header_rows:[1,2]}}}}`，返回 `requires_reparse=true` |
| `GET /knowledge/{id}/preview/manifest` | Excel 返回 `type=spreadsheet` 和 `sheets_url` |
| `GET /sources/{id}` | 正文位置及独立的 `context_source_ref_ids`、`context_sources` |

读取接口支持 `file_version_id`、`parse_version_id`。表格派生数据位于 `/data/derived/{knowledge_id}/{parse_version}/spreadsheet`；旧解析首次预览时只建立独立源文件缓存，不修改历史解析内容。精确定位使用 Sheet、行列范围和单元格地址；未核验位置只展示证据，不高亮推测位置。

本地更新（保留现有数据卷）：

```powershell
docker compose -f compose.dev.yaml up -d --build --no-deps --wait app
```

访问 `http://localhost:19080`；前端开发入口仍为 `http://localhost:15173`。Excel 验收脚本为 `tests/test_spreadsheet.py` 和 `tests/spreadsheet_flow.py`，后者只允许隔离的 19081 测试服务，不能对正式数据库运行。

### WPS 文字、表格、演示及模板

支持 `.wps/.wpt`、`.et/.ett`、`.dps/.dpt`，六种格式在“文件格式与引擎”分别配置。文字与演示默认 anydoc，可选内置解析；表格默认专用表格解析，可选 anydoc。没有修改旧知识库的选择，也不会自动重跑已上传文件。此前只保存的文件可手动重新处理。

处理先识别文件的实际 OLE/OOXML 容器与文字、表格、演示类型，拒绝扩展名错配、损坏、加密及未识别的专有版本。原文件始终保留，下载返回原始字节。派生副本和转换记录放在本次解析目录的 `wps/` 下；转换失败日志为 `conversion.log`，不会把转换失败当成解析成功。

- WPS 兼容的二进制文字、演示及其模板通过镜像内 LibreOffice 转为 DOCX/PPTX，再进入所选解析引擎。转换副本中的图片继续进入图片提取与理解流程。
- ET/ETT 的 BIFF/OOXML 结构直接复用 XLS/XLSX 结构读取，不经过 PDF、不执行公式。BIFF 只读已保存的计算值；转换仅用于补提图片，图片锚点标记“转换后位置”。这样避免转换重算改变正文中的数值。
- 普通 OOXML 兼容容器直接读取结构副本；文字/演示模板或宏容器按需转换为标准文档，转换配置禁止执行宏。原始文件中的宏只随原文件保留，不用于处理。
- 文字、演示转换后的来源带 `mapping=converted_structure`、`coordinate_space=converted_document`。页面及图片说明明确“转换后位置”；下载仍指向同一原始文件版本。不能把转换后段落、幻灯片或 PDF 页码宣称为原文件精确坐标。未唯一匹配的位置继续标记未核验。
- ET/ETT 共用工作表列表、范围读取、表头设置、分块和检索接口。`/knowledge/{id}/content` 新增 `conversion`，提供识别容器、源/目标格式、适配方法及字节校验和；所有接口保持原有字段兼容。
- 任务流水线显示格式核验、结构读取或转换阶段和真实耗时。错误区分加密、损坏、类型错配、不支持版本、转换超时、转换失败、产物核验失败，不静默改用另一引擎；重试失败不会覆盖已有成功解析及其引用。

镜像启动检查六种导入过滤器及 olefile 依赖，无需额外转换服务。支持范围是当前 LibreOffice 可读的 Office 兼容 WPS 容器，并不承诺所有早期 WPS 专有版本、复杂图表、公式或版式都可无损还原。遇到不支持的内部版本，提示使用 WPS 另存为 DOCX/XLSX/PPTX；直接改扩展名不能修复损坏或转换真实格式。

兼容性依据：[LibreOffice 转换过滤器表](https://help.libreoffice.org/latest/en-US/text/shared/guide/convertfilters.html)。`tests/wps_compatibility.py` 使用该过滤器生成六种 Office 兼容二进制测试文件，验证中文、表格、合并范围、多工作表和内嵌图片的真实往返转换；这些是受控样本，不代表已测试所有 WPS 软件版本生成的文件。`tests/test_wps.py` 覆盖两种解析引擎、容器识别、原文件不变、图片及位置、加密/损坏/超时/缺少转换产物等错误；`tests/wps_flow.py` 仅针对隔离的 19081 服务验证上传、检索、预览、版本和失败保留。
