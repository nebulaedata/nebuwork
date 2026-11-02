# 条款参数提取引擎

本目录迁移自 nebuwork 的 SpecFlow v3。specflow/v3 保留文档分类、
六字段提示词、组块、引文与数值校验、覆盖登记、修复及输出过长时的拆分。
仅运行 v3，不包含 v2 入口、原文件重新解析、OCR 或外部用户系统。

- adapter.py 将第一阶段保存的完整解析块和来源引用转换为提取单元。
  不拼接有重叠的检索分块，不把图片描述作为原文，不生成替代页码。
- runner.py 负责并发、每块 SQLite 检查点和 JSONL 协议。
  model_request 事件携带请求 ID；Go 通过 stdin 回送同 ID 的结果。
  提取服务通过内部 HTTP 接口请求主系统调用模型，复用主系统的凭证、
  总并发及单模型并发限制；Python 不接收供应商密钥。
- block_result 在检查点提交后发出，Go 以运行、分块和记录 ID 幂等保存。
  重启时先回放成功检查点，再调用模型处理未完成分块。
- phase、block_progress 和 block_done 上报实际阶段、并行根分块、校验、
  修复、覆盖检查、重试和缓存复用。Go 在任务 checkpoint.pipeline 保存
  当前租约的四阶段计时，checkpoint.extraction 保存持久化计数、当前并行块
  和最近 20 个结束块；SSE 通知客户端获取快照。子块和重复回放不重复计数。
  新租约重新计时；历史运行缺少计时不会补造阶段耗时，也不自动重提取。
- workbook.py 使用现有 openpyxl 导出四张表，所有原文内容均写为文本。

运行目录为 /data/extractions/{knowledge_id}/{run_id}，包含输入快照、
IR、SQLite 检查点、模型响应和最终结果；随文档删除清理。
PostgreSQL 是任务及页面查询的事实来源。输入、提示词或冻结模型配置变化
时应新建运行，避免混用旧检查点。

程序校验不能证明语义和表格对应关系完全正确。machine_checked
表示“程序校验通过”；来源位置粗略、引文歧义和检查异常标记为待核验。

测试程序：

- extractor/test_extraction.py 验证适配、校验、检查点和 Excel。
- extractor/test_progress.py 验证修复、重试、长度拆分及检查点回放的事件。
- tests/extraction_progress.py 验证四阶段、实时并行计数及 SSE 续接。
- tests/extraction_flow.py 验证 API、历史、取消和导出。
- tests/extraction_formats.py 验证 DOCX、文字 PDF、Excel、扫描 PDF。
- tests/extraction_recovery.py 在宿主机运行，接受 app 或 extraction 参数，
  只重启对应的隔离测试服务。
- tests/extraction_split.py 验证直连与旧入口一致、跨容器并发及停机隔离。

提取容器通过 Dockerfile.extraction 构建，不包含 LibreOffice、FFmpeg、
OCR、Neo4j 或前端。主容器不再包含本目录或启动提取 Worker。
提取容器只读取已有安装身份和数据库结构，不运行数据库迁移；
内部模型接口通过安装密钥派生的专用令牌认证，并校验运行、租约和冻结模型。
主系统停止时提取任务等待恢复，已完成分块和历史记录保留。

使用 tests/compose.yaml 和 tests/compose.extraction.yaml 启动隔离服务。
协议测试桩只验证流程及来源链路，不代表实际模型的提取质量。
