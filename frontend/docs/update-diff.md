# agent-hub-proto-update 差异说明

与 `agent-hub-proto` 相比，更新版只有 5 个文件发生变化，共增加约 814 行、删除 16 行。

| 文件 | 更新内容 | 同步目标 |
| --- | --- | --- |
| `app.js` | 新增通用 `UI.modal`，统一标题、关闭按钮、内容与挂载回调 | `apps/web/src/app/runtime.js` |
| `mock.js` | 新增工作台配置、SOP 集、规则场景集和专家业务规则 | `apps/web/src/data/mock.js`，同时作为 API 种子 |
| `styles.css` | 新增弹窗内表单修正和 SOP 工作流画布/节点/连线样式 | `apps/web/src/styles.css` |
| `views/workbench.js` | 专业工作台新增配置入口、业务本体编辑、知识库/专家/模板引用管理 | `apps/web/src/features/workbench/view.js` |
| `views/agents.js` | SOP 集编排、标准流程、拖拽节点画布；规则集与规则增删改、筛选和启停 | `apps/web/src/features/agents/view.js` |

## 新增数据集合

- `wbConfigs`：6 个专业工作台的业务名称、领域、本体定义和资源引用。
- `sopSets`：为经营分析、运维、法律文书专家提供工作流编排和标准化流程样例。
- `ruleSets`：10 位专家的规则场景注册表。
- `agentRules`：10 位专家的自然语言业务规则、启停状态、命中次数和更新时间。

## 同步机制

- `npm run sync:prototype` 从 `agent-hub-proto-update` 机械同步 15 个源文件与资产，不修改源目录。
- parity 测试逐字节校验运行时、mock、API 桩、图标、样式和 7 个视图模块。
- 后端种子加载器改为直接读取 `agent-hub-proto-update/mock.js`，避免维护第二份 mock。
