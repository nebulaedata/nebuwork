# 模型配置页交付

保留现有三个区域和添加/删除弹窗。模型列表、模型目录查询、未保存/已保存连接测试、默认/备用选择、三个开关全部对接 Java。接口前缀 `/nebulaedev/nwaa/api`；沿用统一用户 Cookie 身份，没有恢复 Node 后端。

## 页面行为

- 进入 `#/settings?tab=model` 查询当前用户配置。列表真实为空时显示空态；失败显示错误和重新加载，不回退演示模型。
- 添加模型的“厂商”仅支持 mrtoken、自定义，接口 `type` 分别为 `mrtoken`、`custom`，默认选择 mrtoken。URL 由用户填写；两者沿用 OpenAI 兼容目录和执行接口，可获取目录，也可直接输入模型名保存。失败保留弹窗输入；Key 不进入 DB 缓存或本地存储，关闭弹窗时清空输入。
- 测试只查询模型目录，不执行推理。目录可访问但模型未列出时明确提示未匹配；已保存模型的最近测试结果由 Java 持久化。
- 默认和备用选项仅包含本人配置，以模型名、厂商、服务地址区分，保存配置 ID。初始均未选择；保存按钮仅提交这两个字段。
- 三个开关点击后即时保存，失败恢复原值；每次提交携带最新 `revision`，写入按顺序执行。发生冲突需重新加载，不自动覆盖。
- 默认模型及三个开关统一使用 `POST /api/model-settings` 保存，GET 查询不变。Java 同时兼容 PATCH；页面使用 POST 适配现有网关 CORS 方法白名单中未包含 PATCH 的情况。
- 删除会清空指向该配置的默认/备用引用及专家模型关联，保留专家原模型名称，并重新查询列表和设置；弹窗已说明影响。
- 查询/写入失败不提示成功；默认选择草稿保留在当前页面。退出、换账号清空缓存，旧响应不能更新新账号的数据。
- 创建专家的基础模型使用 Ant Design Select，每次打开查询本人已保存配置，支持搜索，以模型名、厂商和服务地址区分。提交 `modelProviderId`，由 Java 校验归属并保存关联；未选择、空列表或加载失败不能创建，失败保留输入并可重试。旧账号或已关闭弹窗的响应不会更新当前弹窗。
- 任务、工作台模板默认模型和项目执行设置均支持两种厂商。历史配置继续可读取和测试，历史 OpenAI 兼容配置继续可执行，但旧协议不再作为新增厂商选项。此调整不新增迁移，需更新并重启 Java 后再测试新增模型。
- 审计轨迹、自动归档、记忆回流目前是配置偏好，相关执行能力仍待接入。专家绑定模型仅保存配置，不触发推理。

## 启动前准备

Java Nacos 必须补充 `nebu.models.encryption-key`：**32 字节随机密钥的 Base64 编码**，不能为空，没有默认密钥或明文回退。需要访问内网、本机模型服务时配置 `nebu.models.allowed-internal-origins`（逗号分隔的完整来源，不支持 `*`），默认总超时 `request-timeout-ms: 12000`。

完整的生成命令、Nacos 样例、数据库迁移和接口说明见 Java 模块 [模型配置交付文档](D:/Work/Code/cccs/content-cloud-cluster-service/nebuwork-backend-api/README-model-configuration.md)；可合并的 [Nacos 样例](D:/Work/Code/cccs/content-cloud-cluster-service/nebuwork-backend-api/config/nacos/nebuwork-backend-api-dev.example.yml) 在 classpath 外，不会作为本地配置加载。

重建并启动 Java 后，Flyway V2 在 `nebuwork_1` 创建 `nw_model_provider`、`nw_user_model_settings`。没有创建用户表或修改统一用户数据库。不要修改 V1，已应用的 V2 不会在重启时重复执行或覆盖数据。密钥必须在重启及多实例间保持一致。

新增 V3 在同库 `nw_expert` 添加可空的 `model_provider_id`、索引和外键，并将模型名容量扩为 255 字符。由 Java 启动时自动迁移，不修改 V1/V2。历史专家和市场专家保留原模型名称及空关联，不根据名称自动匹配私人配置。本次只接入手动创建专家的选择器。

前端在项目根目录运行 `npm run dev`，打开 `http://localhost:5173/#/settings?tab=model`。Java 42020、网关 42000 的启动和路由仍由你管理。

## 使用方验收清单

1. 初次访问为空列表、默认/备用均未选择、三个开关开启；请求由网关进入 Java。
2. 分别添加 mrtoken、自定义配置，目录获取、连接测试及任务选择符合实际；同用户相同厂商重复添加被拒绝，不同用户可独立添加。
3. 保存默认/备用和开关，刷新页面及重启 Java 后保留；删除默认配置清空引用。
4. A/B 账号不串数据，越权测试/删除/引用返回 404；并发设置修改返回 409。
5. 错误 Key/限流不退出本站，超时/空目录/分页异常明确失败；非法内网与特殊地址不能访问。
6. Key 在数据库加密保存，不出现在列表、错误或审计中；失败保留输入，开关恢复，重新加载可继续操作。
7. 创建专家仅显示当前账号保存的配置；同名模型可分别选择，详情返回正确的 `modelProviderId`。提交他人或已删除配置返回 404，只传模型名返回 422。删除已关联模型后专家名称保留、关联清空且版本递增。

新增前端用例：`apps/web/src/services/modelApi.test.js`、`apps/web/src/features/settings/modelSettings.test.js`、`apps/web/src/features/agents/createExpertModal.test.js`。Java 用例和更多网络限额验收点见上述 Java 文档。

本轮只修改代码、迁移文件、样例及测试用例：**未运行测试、构建、服务或浏览器验收，未连接数据库执行迁移，未修改 Nacos 或网关**。
