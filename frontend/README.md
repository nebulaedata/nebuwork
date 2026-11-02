# NebuWorkAgent

当前工程已迁入 NebuWork 汇总目录的 `frontend/`，主应用仍位于 `apps/web/`。在本目录执行 npm 命令；安装依赖使用 `npm ci`。迁入范围及跨项目辅助脚本的路径配置见 [前端迁入记录](../docs/frontend-migration.md)。

React / Vite 业务前端，Java 后端位于 `../backend/java`，智能体引擎位于 `../agent-core/v2.0.0`。整套本地容器环境见 [Docker dev 说明](../deploy/dev/README.md)。

- [新引擎与三栏任务界面](docs/agent-engine-delivery.md)
- [Workflow 3.5 接入](docs/workflow-integration-delivery.md)
- [知识库管理与创建](docs/knowledge-v100-delivery.md)
- [专家、工作台与项目数据库](docs/database-resources-delivery.md)

先在仓库根目录启动 `scripts/Start-Dev.ps1`，即可访问 `http://localhost:18080`。需要热更新时，在本目录执行 `npm ci`、`npm run dev`，打开 `http://localhost:5173`。Vite 默认代理到 Docker dev 入口；业务 API 和本地账号服务均由当前 Java 后端提供。引擎服务密钥不进入前端。

工作台业务版本与运行资源独立发布。新建项目使用稳定业务 ID，任务执行时物化独立工作区。任务页展示可重放的会话事实、工具活动、专家协作、版本化成果和实际运行上下文。

验证使用 npm run check（类型检查、测试、构建、Sites 包装验证）。当前系统使用 Java 本地账号；不依赖原统一用户服务、旧 AgentCore 服务或模板包。
