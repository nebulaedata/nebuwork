# 前端迁入记录

日期：2026-10-26。

- 来源：`D:/Work/Code/AiCode/NebuWorkAgent`。
- 目标：当前工程的 `frontend/`。
- 来源 Git 提交：`d3ccd6e004a486dcb72db59f7b4c576ff657e107`。
- 导入 397 个文件，约 17.5 MB，包含来源工作区尚未提交的修改及 9 个新增文件。
- 保留 `apps/web`、npm workspace、锁文件、辅助脚本、原型参考、架构资料和交付文档的相对结构。
- 未复制 `.git`、依赖目录、构建产物、运行数据、QA 临时文件、日志、本地环境配置和其他 Git 忽略文件。原目录及原 Git 历史保持原状。

## 路径适配

普通开发、类型检查、单元测试和构建的 npm 脚本及锁文件保持不变，执行目录为 `frontend/`。主应用位于 `frontend/apps/web/`。

两个跨项目辅助脚本原先按旧目录布局寻找 Java / New2；现在显式指定外部路径，不依赖原前端工程的位置：

- `scripts/export-platform-mcp-tools.mjs`：通过首个参数或 `NEBU_PLATFORM_MCP_CATALOG` 指定 Java 导出的 `platform-mcp-catalog.json` 文件。
- `scripts/html-service-acceptance.mjs`：通过 `NEBU_ENGINE_DIST` 指定已构建的 New2 `dist` 目录，通过 `NEBU_SERVICE_ASSET_DIR` 指定 Java 的 `src/main/resources/workbench-service` 目录；保留原 `PLAYWRIGHT_MODULE` 配置。

这些脚本用于跨项目目录导出或集成验收，普通前端开发与 `npm run check` 不调用它们。其他服务后续迁入时，再确定统一目录布局及集成路径。

## 校验

导入时已对全部 397 个文件进行 SHA-256 校验，与来源工作区逐字节一致。原始文件摘要、来源工作区状态及后续适配文件的校验结果见 [frontend-import.json](frontend-import.json)。

迁入后的修改仅包括前端 README、忽略规则和上述两个脚本。业务源码、npm 配置及锁文件保持来源内容。

依照前端 `apps/web/AGENTS.md` 中关于迁移由使用方验证的约定，本次仅执行文件完整性、路径、npm workspace 和脚本语法检查；未安装依赖、运行测试/构建、启动服务或进行浏览器验收。
