# 界面风格改造验收

日期：2026-10-09

## 环境管理增量（2026-10-10）

- 新增共享包列表、工作流执行环境页签、安装日志窗口、任务与 Attempt 环境信息。使用 Ant Design 的 Radio、Table、Descriptions、Typography、Alert、Modal、Input 和 Button。
- 复用灰白工作台；实看截图后将共享环境信息提示的深灰背景修正为浅灰，提高文字对比度。长解释器路径可复制并换行。
- 保存环境选择使用明确按钮；版本冲突由后端拒绝，不覆盖外部修改。环境状态和占用任务均来自核心接口。
- Windows 与 Linux 服务端各 3 个 Playwright 场景通过；新增场景涵盖创建、安装、切换、执行、历史和重跑预览。
- 本轮桌面证据：[共享包](docs/ui/shared-environment.png)、[环境配置](docs/ui/workflow-environment.png)、[执行记录](docs/ui/task-environment.png)。

## 目标与依据

- 用户参考图：C:/Users/JYZ-SU~1/AppData/Local/Temp/codex-clipboard-1ddb5f14-342e-47ef-a01e-e080ffcbf94d.png
- 用户要求只采用页面风格，不复制 Agent 聊天内容。保留 Workflow 的列表、编排、代码与任务操作。
- 实现：Ant Design 6.6.5 的 Button、Input、Checkbox、Select、Modal、Tabs、Table、Tag、Alert、Progress、Spin、Tooltip；React Flow 和 Monaco 保留。
- 预览：http://127.0.0.1:8765/#workflow/demo
- 全视图证据：[最终代码页](docs/ui/code-desktop.png)、[最终编排页](docs/ui/graph-desktop.png)。
- 交互证据：[版本差异](docs/ui/history.png)、[重跑验收任务](docs/ui/task-acceptance.png)、[窄窗口](docs/ui/code-mobile.png)。
- 细节证据：[顶部导航细节](docs/ui/code-detail.png)。截图接口返回了左上角区域，因此该图仅用于导航、字体和分隔线核对，不作为代码区域裁切证据。

## 比较条件

参考图为 1920 × 945 像素。桌面截图和浏览器 CSS 视口为 1920 × 945，devicePixelRatio 为 1，没有缩放、拉伸或密度转换。
完整参考图与实际页面放入同一次图像对照输入进行比较；修正后再次以相同 viewport、demo 工作流、steps/count.py 文件比较。
另检查 1280 × 800、390 × 844 的代码页面；正文没有超出视口的横向溢出，长代码在编辑器内滚动，手机窗口允许页面纵向滚动。

参考图是聊天加代码工作台，实际产品是 Workflow 管理工作台。页面内容、侧栏宽度和工作流标题区属于明确保留的产品差异，不要求像素级复制聊天布局。

## 对照与修正记录

1. 初版对照：[code-before-qa.png](docs/ui/code-before-qa.png)。
   - P2：部分辅助文字偏浅，代码字号偏小。修正辅助文字为 #737373，Monaco 使用 14px；保留 13px 的控件字体。
   - P2：编排画布与底部说明合计高度超出桌面窗口。调整画布高度计算，1920 × 945 下 documentHeight 为 945；底部说明完整显示。
   - P2：列表最小高度使底部统计下面留下无意义白块。移除固定最小高度。
   - 本轮结果：blocked，待上述问题修正。
2. 修正后的同尺寸全视图对照：code-desktop.png、graph-desktop.png。
   - 浅灰侧栏、白色编辑区、1px 中性边框、灰色选中项、黑色主按钮、紧凑工具条已统一。
   - 顶部导航细节与参考图同次输入查看；轮廓图标、常规字重、细分隔线保持一致。
   - 未保存确认框也改为 Ant Design Modal，避免视觉和交互分裂。
   - 没有剩余 P0/P1/P2 问题。

## 五项视觉核对

- 字体：系统无衬线中文控件、等宽代码；标题 20px，常用控件 13px，代码 14px。窄窗口标题自然换行，无被截断的主要操作。
- 间距：52px 顶栏、32px 控件、7–9px 圆角、8–16px 控件间距；分栏高度随窗口调整。
- 颜色：灰白背景与黑灰文字；移除紫色强调和深色侧栏。成功、失败等状态只使用克制的语义色。
- 图像与图标：使用现有 Lucide 轮廓图标及组件库图标；没有新增位图、仿制标志或聊天头像。
- 内容：全部为工作流、代码、任务、日志与产物文案；未引入参考图中的聊天、Agent 或部署功能。

## 实际交互验证

通过 Codex 内置浏览器操作独立临时项目（8766），不改正式 demo 源码：

- 新建工作流；添加 report 节点；Checkbox 声明 main 依赖；保存流程。
- 浅色 Monaco 编辑代码；语法错误时 Alert 显示且保存被拒绝；纠正后正常保存。
- 创建并运行任务，main 主动保存诊断产物后抛异常；任务失败，产物标记为未发布。
- 修改代码，查看 3 个历史版本及浅色差异视图。
- 指定 main 重跑，预览包含 main、report；执行后 2/2 步骤成功。
- 成功版本显示 new successful result；失败版本仍可查看 old diagnostic。
- 任务刷新后 SSE 重新连接；事件标签展示上游引用 main: 2。
- 任务输入标签、任务列表状态筛选、筛选空态、侧栏收起/展开正常。
- 未保存代码切换文件时出现组件确认框；继续编辑保留草稿，放弃并切换恢复目标文件内容。
- 浏览器错误/警告检查返回空列表。

构建检查：npm run build 通过（TypeScript + Vite）。
既有 Playwright 用例已更新为 Ant Design 的 tab、combobox、table row 选择器；本次实际端到端回归通过内置浏览器完成，未重新运行 Playwright CLI 测试套件。
本次未变更 Python 执行内核，未重新声明后端跨平台测试结果。

final result: passed
