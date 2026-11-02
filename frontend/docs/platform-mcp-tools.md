# 系统 MCP 工具目录 v1

本文件由 Java 工具注册表导出，共 172 个工具。重新导出：先运行 Java 的 PlatformMcpAdapterTest，再运行 `node scripts/export-platform-mcp-tools.mjs`。完整嵌套 Schema 见 [platform-mcp-catalog.json](platform-mcp-catalog.json)。

所有工具仅供可信 Worker 使用。每次调用都校验真实 Run、工作台冻结授权与当前授权的交集、原业务账号/资源权限。

成功统一返回 `{ data, operationId }`：`data` 为下列原业务服务的脱敏返回投影；`operationId` 为持久化调用编号。结果超过 256 KiB 时返回受控资源与 `truncated:true`，通过 `nw_resource_read` 分段读取。列表的具体分页字段沿用业务服务；新增聚合列表使用 `items/hasMore/nextOffset`。空、未知、部分结果、不可用分别保留业务状态。

通用错误：401 运行凭证失效；403 工具/数据范围或原业务授权不足；404 对象不可见或不存在；409 版本冲突、目录变化或原操作结果待核对；413 大小限制；422 参数或能力不支持；502/503 上游不可用。MCP 以 `isError` 返回业务错误。

恢复列：read=同编号复用原结果且重新授权；idempotent=本地业务和成功台账在同一事务，重复编号不重复写入；reconcile=优先读取原业务回执，不自动重新创建未知的外部操作。所有恢复均重新检查当前权限；同编号不同参数拒绝。

## platform（8 项）

业务来源：PlatformMcpService / PlatformMcpDispatch 聚合。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_identity_get

当前调用身份与授权。性质：只读；恢复：read。所需工具授权：`nw_identity_get`，另叠加目标对象的范围和业务权限。

无模型输入参数，身份由真实运行推导。

返回：`data` 包含当前调用身份与授权的业务结果，来自 PlatformMcpService / PlatformMcpDispatch 聚合；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_capabilities_get

已实现能力与模块状态。性质：只读；恢复：read。所需工具授权：`nw_capabilities_get`，另叠加目标对象的范围和业务权限。

无模型输入参数，身份由真实运行推导。

返回：`data` 包含已实现能力与模块状态的业务结果，来自 PlatformMcpService / PlatformMcpDispatch 聚合；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_search

按关键词搜索授权业务对象。性质：只读；恢复：read。所需工具授权：`nw_search`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| query | string | 是 | query |
| projectId | string | 否 | projectId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含按关键词搜索授权业务对象的业务结果，来自 PlatformMcpService / PlatformMcpDispatch 聚合；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_task_overview_get

授权任务概览。性质：只读；恢复：read。所需工具授权：`nw_task_overview_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| projectId | string | 否 | projectId |
| workbenchId | string | 否 | workbenchId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含授权任务概览的业务结果，来自 PlatformMcpService / PlatformMcpDispatch 聚合；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_usage_get

实际 Tokens 用量；未知不计为零。性质：只读；恢复：read。所需工具授权：`nw_usage_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (user / task / run / project / workbench / expert) | 是 | kind |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| taskId | string | 否 | taskId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含实际 Tokens 用量；未知不计为零的业务结果，来自 PlatformMcpService / PlatformMcpDispatch 聚合；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_operation_get

读取调用记录与结果。性质：只读；恢复：read。所需工具授权：`nw_operation_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含读取调用记录与结果的业务结果，来自 PlatformMcpService / PlatformMcpDispatch 聚合；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_operation_reconcile

核对原调用，不重复提交未知操作。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_operation_reconcile`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含核对原调用，不重复提交未知操作的业务结果，来自 PlatformMcpService / PlatformMcpDispatch 聚合；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_resource_read

读取工具返回的受控资源句柄。性质：只读；恢复：read。所需工具授权：`nw_resource_read`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| uri | string | 是 | uri |
| offset | integer | 否 | 分页偏移，默认0 |
| limit | integer | 否 | 每页数量，默认50，最多100 |

返回：`data` 包含读取工具返回的受控资源句柄的业务结果，来自 PlatformMcpService / PlatformMcpDispatch 聚合；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## workbench（10 项）

业务来源：WorkbenchService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_workbench_list

工作台 · list。性质：只读；恢复：read。所需工具授权：`nw_workbench_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |
| query | string | 否 | query |

返回：`data` 包含工作台 · list的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workbench_get

工作台 · get。性质：只读；恢复：read。所需工具授权：`nw_workbench_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含工作台 · get的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workbench_config_get

工作台 · config_get。性质：只读；恢复：read。所需工具授权：`nw_workbench_config_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含工作台 · config_get的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workbench_version_list

工作台 · version_list。性质：只读；恢复：read。所需工具授权：`nw_workbench_version_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含工作台 · version_list的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workbench_version_get

工作台 · version_get。性质：只读；恢复：read。所需工具授权：`nw_workbench_version_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| version | string | 是 | version |

返回：`data` 包含工作台 · version_get的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workbench_save

工作台 · save。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_workbench_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| mode | string (create / update) | 是 | mode |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`name` (string)、`desc` (string)、`icon` (string)、`color` (string)、`revision` (integer)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含工作台 · save的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workbench_delete

工作台 · delete。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_workbench_delete`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |

返回：`data` 包含工作台 · delete的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workbench_config_save

工作台 · config_save。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_workbench_config_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`revision` (integer)、`bizName` (string)、`domain` (string)、`bizDef` (string)、`wikiMd` (string)、`applicabilityMd` (string)、`exclusionsMd` (string)、`systemPrompt` (string)、`entities` (array<业务对象>)、`relations` (array<业务对象>)、`defaultAgentId` (string / null)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含工作台 · config_save的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workbench_binding_set

工作台 · binding_set。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_workbench_binding_set`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| kind | string (agents / tpls) | 是 | kind |
| targetId | string | 是 | targetId |
| enabled | boolean | 是 | enabled |
| revision | integer | 是 | revision |

返回：`data` 包含工作台 · binding_set的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workbench_publish

工作台 · publish。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workbench_publish`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |

返回：`data` 包含工作台 · publish的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## project（3 项）

业务来源：WorkbenchService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_project_list

项目 · list。性质：只读；恢复：read。所需工具授权：`nw_project_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| workbenchId | string | 否 | workbenchId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |
| query | string | 否 | query |

返回：`data` 包含项目 · list的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_project_get

项目 · get。性质：只读；恢复：read。所需工具授权：`nw_project_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含项目 · get的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_project_save

项目 · save。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_project_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| mode | string (create / update) | 是 | mode |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`name` (string)、`desc` (string)、`workbenchId` (string)、`parameters` (object)、`status` (string)、`revision` (integer)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含项目 · save的业务结果，来自 WorkbenchService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## runtime（4 项）

业务来源：RuntimeResources。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_runtime_get

运行资源（不含凭据） · get。性质：只读；恢复：read。所需工具授权：`nw_runtime_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (project / workbench / expert) | 是 | kind |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含运行资源（不含凭据） · get的业务结果，来自 RuntimeResources；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_runtime_save

运行指令与完整技能资源 · save。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_runtime_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (project / workbench / expert) | 是 | kind |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |
| data | object | 是 | data |

业务字段：`instructions` (array<业务对象>)、`skills` (array<业务对象>)、`files` (array<object>)、`modelProviderId` (string / null)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含运行指令与完整技能资源 · save的业务结果，来自 RuntimeResources；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_runtime_publish

运行资源 · publish。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_runtime_publish`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (project / workbench / expert) | 是 | kind |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |

返回：`data` 包含运行资源 · publish的业务结果，来自 RuntimeResources；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_runtime_file_add

运行资源 · file_add。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_runtime_file_add`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (project / workbench / expert) | 是 | kind |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |
| path | string | 是 | path |
| file | object | 是 | 受控资源 URI，或已授权项目中的成果 ID 与固定版本；工作区文件先发布为成果 |

返回：`data` 包含运行资源 · file_add的业务结果，来自 RuntimeResources；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## expert（6 项）

业务来源：ExpertService / ExpertAbilityService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_expert_list

专家 · list。性质：只读；恢复：read。所需工具授权：`nw_expert_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |
| query | string | 否 | query |

返回：`data` 包含专家 · list的业务结果，来自 ExpertService / ExpertAbilityService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_expert_get

专家 · get。性质：只读；恢复：read。所需工具授权：`nw_expert_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含专家 · get的业务结果，来自 ExpertService / ExpertAbilityService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_expert_save

专家共享定义；成员关系账号独立 · save。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_expert_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| mode | string (create / update) | 是 | mode |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`name` (string)、`role` (string)、`tagline` (string)、`modelProviderId` (string / null)、`revision` (integer)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含专家共享定义；成员关系账号独立 · save的业务结果，来自 ExpertService / ExpertAbilityService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_expert_remove

专家共享定义；成员关系账号独立 · remove。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_expert_remove`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |
| membershipRevision | integer | 是 | membershipRevision |

返回：`data` 包含专家共享定义；成员关系账号独立 · remove的业务结果，来自 ExpertService / ExpertAbilityService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_expert_binding_set

专家共享定义；成员关系账号独立 · binding_set。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_expert_binding_set`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| kind | string (extensions / tpls) | 是 | kind |
| targetId | string | 是 | targetId |
| enabled | boolean | 是 | enabled |

返回：`data` 包含专家共享定义；成员关系账号独立 · binding_set的业务结果，来自 ExpertService / ExpertAbilityService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_expert_ability_complete

专家能力草稿 · ability_complete。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_expert_ability_complete`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| data | object | 是 | data |

业务字段：`name` (string)、`role` (string)、`tagline` (string)、`modelProviderId` (string / null)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含专家能力草稿 · ability_complete的业务结果，来自 ExpertService / ExpertAbilityService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## market_expert（2 项）

业务来源：ExpertService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_market_expert_list

市场专家 · list。性质：只读；恢复：read。所需工具授权：`nw_market_expert_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |
| query | string | 否 | query |

返回：`data` 包含市场专家 · list的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_market_expert_add

添加市场专家 · add。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_market_expert_add`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含添加市场专家 · add的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## sop（4 项）

业务来源：ExpertService / WorkflowService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_sop_list

专家 SOP · list。性质：只读；恢复：read。所需工具授权：`nw_sop_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| expertId | string | 是 | expertId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含专家 SOP · list的业务结果，来自 ExpertService / WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_sop_save

SOP · save。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_sop_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| mode | string (create / update) | 是 | mode |
| expertId | string | 是 | expertId |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`name` (string)、`desc` (string)、`kind` (string)、`revision` (integer)、`wf` (object)、`proc` (object)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含SOP · save的业务结果，来自 ExpertService / WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_sop_delete

SOP · delete。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_sop_delete`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| expertId | string | 是 | expertId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |

返回：`data` 包含SOP · delete的业务结果，来自 ExpertService / WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_sop_workflow_create

真实 Workflow SOP · workflow_create。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_sop_workflow_create`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| expertId | string | 是 | expertId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |

返回：`data` 包含真实 Workflow SOP · workflow_create的业务结果，来自 ExpertService / WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## sop_material（3 项）

业务来源：ExpertService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_sop_material_add

SOP 素材 · add。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_sop_material_add`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| expertId | string | 是 | expertId |
| sopId | string | 是 | sopId |
| revision | integer | 是 | revision |
| file | object | 是 | 受控资源 URI，或已授权项目中的成果 ID 与固定版本；工作区文件先发布为成果 |

返回：`data` 包含SOP 素材 · add的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_sop_material_read

SOP 素材 · read。性质：只读；恢复：read。所需工具授权：`nw_sop_material_read`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| expertId | string | 是 | expertId |
| sopId | string | 是 | sopId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含SOP 素材 · read的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_sop_material_remove

移除素材引用 · remove。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_sop_material_remove`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| expertId | string | 是 | expertId |
| sopId | string | 是 | sopId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |

返回：`data` 包含移除素材引用 · remove的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## rule_set（2 项）

业务来源：ExpertService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_rule_set_list

规则场景集 · list。性质：只读；恢复：read。所需工具授权：`nw_rule_set_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| expertId | string | 是 | expertId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含规则场景集 · list的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_rule_set_create

规则场景集 · create。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_rule_set_create`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| expertId | string | 是 | expertId |
| data | object | 是 | data |

业务字段：`name` (string)、`desc` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含规则场景集 · create的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## rule（3 项）

业务来源：ExpertService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_rule_list

业务规则 · list。性质：只读；恢复：read。所需工具授权：`nw_rule_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| expertId | string | 是 | expertId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含业务规则 · list的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_rule_save

业务规则 · save。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_rule_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| mode | string (create / update) | 是 | mode |
| expertId | string | 是 | expertId |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`name` (string)、`content` (string)、`scene` (string)、`ruleSetId` (string)、`enabled` (boolean)、`revision` (integer)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含业务规则 · save的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_rule_delete

业务规则 · delete。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_rule_delete`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| expertId | string | 是 | expertId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |

返回：`data` 包含业务规则 · delete的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## extension_catalog（1 项）

业务来源：ExpertService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_extension_catalog_list

扩展目录（不代表已安装） · list。性质：只读；恢复：read。所需工具授权：`nw_extension_catalog_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |
| query | string | 否 | query |

返回：`data` 包含扩展目录（不代表已安装） · list的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## case_template（1 项）

业务来源：ExpertService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_case_template_list

案例模板目录 · list。性质：只读；恢复：read。所需工具授权：`nw_case_template_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |
| query | string | 否 | query |

返回：`data` 包含案例模板目录 · list的业务结果，来自 ExpertService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## task（11 项）

业务来源：AgentTasks / AgentClient。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_task_list

任务元数据 · list。性质：只读；恢复：read。所需工具授权：`nw_task_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| projectId | string | 否 | projectId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |
| query | string | 否 | query |

返回：`data` 包含任务元数据 · list的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_task_get

任务元数据 · get。性质：只读；恢复：read。所需工具授权：`nw_task_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含任务元数据 · get的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_task_run_list

任务元数据 · run_list。性质：只读；恢复：read。所需工具授权：`nw_task_run_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含任务元数据 · run_list的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_task_run_get

任务元数据 · run_get。性质：只读；恢复：read。所需工具授权：`nw_task_run_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| runId | string | 是 | runId |

返回：`data` 包含任务元数据 · run_get的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_task_events_list

任务元数据 · events_list。性质：只读；恢复：read。所需工具授权：`nw_task_events_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| after | integer | 否 | after |
| limit | integer | 否 | 每页数量，默认50，最多100 |

返回：`data` 包含任务元数据 · events_list的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_task_expert_run_get

任务元数据 · expert_run_get。性质：只读；恢复：read。所需工具授权：`nw_task_expert_run_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| runId | string | 是 | runId |

返回：`data` 包含任务元数据 · expert_run_get的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_task_context_get

任务元数据 · context_get。性质：只读；恢复：read。所需工具授权：`nw_task_context_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| runId | string | 是 | runId |

返回：`data` 包含任务元数据 · context_get的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_task_update

任务元数据 · update。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_task_update`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`title` (string)、`context` (object)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含任务元数据 · update的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_task_create

真实项目任务 · create。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_task_create`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| projectId | string | 是 | projectId |
| data | object | 是 | data |

业务字段：`title` (string)、`content` (string)、`fileIds` (array<业务对象>)、`fileRefs` (array<业务对象>)、`context` (object)、`retryOf` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含真实项目任务 · create的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_task_run_start

真实项目任务 · run_start。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_task_run_start`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`title` (string)、`content` (string)、`fileIds` (array<业务对象>)、`fileRefs` (array<业务对象>)、`context` (object)、`retryOf` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含真实项目任务 · run_start的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_task_run_command

真实项目任务 · run_command。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_task_run_command`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| runId | string | 是 | runId |
| data | object | 是 | data |

业务字段：`type` (string (steer / follow_up / cancel / resume))、`content` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含真实项目任务 · run_command的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## session（3 项）

业务来源：AgentClient / engine Store。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_session_grant_list

已有会话授权 · grant_list。性质：只读；恢复：read。所需工具授权：`nw_session_grant_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含已有会话授权 · grant_list的业务结果，来自 AgentClient / engine Store；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_session_read

已有会话授权 · read。性质：只读；恢复：read。所需工具授权：`nw_session_read`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| after | integer | 否 | after |
| limit | integer | 否 | 每页数量，默认50，最多100 |

返回：`data` 包含已有会话授权 · read的业务结果，来自 AgentClient / engine Store；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_session_grant_revoke

撤销已有会话授权 · grant_revoke。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_session_grant_revoke`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含撤销已有会话授权 · grant_revoke的业务结果，来自 AgentClient / engine Store；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## artifact（5 项）

业务来源：AgentTasks / AgentClient。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_artifact_list

不可变成果版本 · list。性质：只读；恢复：read。所需工具授权：`nw_artifact_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| projectId | string | 是 | projectId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含不可变成果版本 · list的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_artifact_get

不可变成果版本 · get。性质：只读；恢复：read。所需工具授权：`nw_artifact_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| projectId | string | 是 | projectId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| version | integer | 是 | version |

返回：`data` 包含不可变成果版本 · get的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_artifact_version_list

不可变成果版本 · version_list。性质：只读；恢复：read。所需工具授权：`nw_artifact_version_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| projectId | string | 是 | projectId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含不可变成果版本 · version_list的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_artifact_read

不可变成果版本 · read。性质：只读；恢复：read。所需工具授权：`nw_artifact_read`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| projectId | string | 是 | projectId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| version | integer | 是 | version |

返回：`data` 包含不可变成果版本 · read的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_artifact_import

将授权文件导入目标项目 · import。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_artifact_import`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| projectId | string | 是 | projectId |
| taskId | string | 否 | taskId |
| file | object | 是 | 受控资源 URI，或已授权项目中的成果 ID 与固定版本；工作区文件先发布为成果 |
| name | string | 否 | name |

返回：`data` 包含将授权文件导入目标项目 · import的业务结果，来自 AgentTasks / AgentClient；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## workflow（11 项）

业务来源：WorkflowService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_workflow_list

真实工作流 · list。性质：只读；恢复：read。所需工具授权：`nw_workflow_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |
| query | string | 否 | query |

返回：`data` 包含真实工作流 · list的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_get

真实工作流 · get。性质：只读；恢复：read。所需工具授权：`nw_workflow_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含真实工作流 · get的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_source_get

真实工作流 · source_get。性质：只读；恢复：read。所需工具授权：`nw_workflow_source_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| path | string | 是 | path |

返回：`data` 包含真实工作流 · source_get的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_revision_list

真实工作流 · revision_list。性质：只读；恢复：read。所需工具授权：`nw_workflow_revision_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| path | string | 是 | path |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含真实工作流 · revision_list的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_create

真实工作流 · create。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workflow_create`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| data | object | 是 | data |

业务字段：`name` (string)、`description` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含真实工作流 · create的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_retry

真实工作流 · retry。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workflow_retry`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含真实工作流 · retry的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_definition_save

真实工作流 · definition_save。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workflow_definition_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`definition` (object)、`expected_revision` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含真实工作流 · definition_save的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_validate

真实工作流 · validate。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workflow_validate`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`definition` (object)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含真实工作流 · validate的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_source_save

真实工作流 · source_save。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workflow_source_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| path | string | 是 | path |
| data | object | 是 | data |

业务字段：`content` (string)、`expected_revision` (string / null)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含真实工作流 · source_save的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_restore

真实工作流 · restore。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workflow_restore`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| path | string | 是 | path |
| data | object | 是 | data |

业务字段：`revision_id` (integer)、`expected_revision` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含真实工作流 · restore的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_archive

真实工作流 · archive。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workflow_archive`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`archived` (boolean)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含真实工作流 · archive的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## workflow_task（8 项）

业务来源：WorkflowService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_workflow_task_list

工作流运行 · list。性质：只读；恢复：read。所需工具授权：`nw_workflow_task_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| workflowId | string | 是 | workflowId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含工作流运行 · list的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_task_get

工作流运行 · get。性质：只读；恢复：read。所需工具授权：`nw_workflow_task_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含工作流运行 · get的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_task_events_list

工作流运行 · events_list。性质：只读；恢复：read。所需工具授权：`nw_workflow_task_events_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| after | integer | 否 | after |
| limit | integer | 否 | 每页数量，默认50，最多100 |

返回：`data` 包含工作流运行 · events_list的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_task_log_get

工作流运行 · log_get。性质：只读；恢复：read。所需工具授权：`nw_workflow_task_log_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| step | string | 是 | step |
| attempt | integer | 是 | attempt |

返回：`data` 包含工作流运行 · log_get的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_task_create

工作流运行控制 · create。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workflow_task_create`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| workflowId | string | 是 | workflowId |
| data | object | 是 | data |

业务字段：`input` (JSON)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含工作流运行控制 · create的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_task_retry

工作流运行控制 · retry。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workflow_task_retry`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含工作流运行控制 · retry的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_task_command

工作流运行控制 · command。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workflow_task_command`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| action | string (start / pause / resume / cancel / rerun) | 是 | action |
| data | object | 是 | data |

业务字段：`expected_version` (integer)、`from_steps` (array<业务对象>)、`expected_environment` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含工作流运行控制 · command的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_task_preview

工作流运行控制 · preview。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_workflow_task_preview`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`from_steps` (array<业务对象>)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含工作流运行控制 · preview的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## workflow_artifact（2 项）

业务来源：WorkflowService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_workflow_artifact_list

工作流成果 · list。性质：只读；恢复：read。所需工具授权：`nw_workflow_artifact_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| workflowId | string | 是 | workflowId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含工作流成果 · list的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_workflow_artifact_read

工作流成果 · read。性质：只读；恢复：read。所需工具授权：`nw_workflow_artifact_read`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| workflowId | string | 是 | workflowId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含工作流成果 · read的业务结果，来自 WorkflowService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## knowledge（11 项）

业务来源：KnowledgeService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_knowledge_driver_list

授权知识目录 · driver_list。性质：只读；恢复：read。所需工具授权：`nw_knowledge_driver_list`，另叠加目标对象的范围和业务权限。

无模型输入参数，身份由真实运行推导。

返回：`data` 包含授权知识目录 · driver_list的业务结果，来自 KnowledgeService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_connection_list

授权知识目录 · connection_list。性质：只读；恢复：read。所需工具授权：`nw_knowledge_connection_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含授权知识目录 · connection_list的业务结果，来自 KnowledgeService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_target_list

授权知识目录 · target_list。性质：只读；恢复：read。所需工具授权：`nw_knowledge_target_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (project / workbench / expert) | 是 | kind |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含授权知识目录 · target_list的业务结果，来自 KnowledgeService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_scope_get

授权知识目录 · scope_get。性质：只读；恢复：read。所需工具授权：`nw_knowledge_scope_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (project / workbench / expert) | 是 | kind |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含授权知识目录 · scope_get的业务结果，来自 KnowledgeService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_reference_set

知识引用 · reference_set。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_knowledge_reference_set`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (project / workbench / expert) | 是 | kind |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| action | string | 是 | action |
| revision | integer | 是 | revision |
| connectionId | string | 否 | connectionId |
| collectionId | string | 否 | collectionId |
| referenceId | string | 否 | referenceId |

返回：`data` 包含知识引用 · reference_set的业务结果，来自 KnowledgeService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_capabilities_get

授权知识能力：capabilities。性质：只读；恢复：read。所需工具授权：`nw_knowledge_capabilities_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 否 | connectionId |
| collectionId | string | 否 | collectionId |
| kind | string (project / workbench / expert) | 否 | kind |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| referenceId | string | 否 | referenceId |
| data | object | 是 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含授权知识能力：capabilities的业务结果，来自 KnowledgeService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_search

授权知识能力：search。性质：只读；恢复：read。所需工具授权：`nw_knowledge_search`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 否 | connectionId |
| collectionId | string | 否 | collectionId |
| kind | string (project / workbench / expert) | 否 | kind |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| referenceId | string | 否 | referenceId |
| data | object | 是 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含授权知识能力：search的业务结果，来自 KnowledgeService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_answer

授权知识能力：answer。性质：只读；恢复：read。所需工具授权：`nw_knowledge_answer`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 否 | connectionId |
| collectionId | string | 否 | collectionId |
| kind | string (project / workbench / expert) | 否 | kind |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| referenceId | string | 否 | referenceId |
| data | object | 是 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含授权知识能力：answer的业务结果，来自 KnowledgeService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_chunk_get

授权知识能力：chunk。性质：只读；恢复：read。所需工具授权：`nw_knowledge_chunk_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 否 | connectionId |
| collectionId | string | 否 | collectionId |
| kind | string (project / workbench / expert) | 否 | kind |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| referenceId | string | 否 | referenceId |
| data | object | 是 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含授权知识能力：chunk的业务结果，来自 KnowledgeService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_entity_graph_get

授权知识能力：graph。性质：只读；恢复：read。所需工具授权：`nw_knowledge_entity_graph_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 否 | connectionId |
| collectionId | string | 否 | collectionId |
| kind | string (project / workbench / expert) | 否 | kind |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| referenceId | string | 否 | referenceId |
| data | object | 是 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含授权知识能力：graph的业务结果，来自 KnowledgeService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_gallery_get

授权知识能力：gallery。性质：只读；恢复：read。所需工具授权：`nw_knowledge_gallery_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 否 | connectionId |
| collectionId | string | 否 | collectionId |
| kind | string (project / workbench / expert) | 否 | kind |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| referenceId | string | 否 | referenceId |
| data | object | 是 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含授权知识能力：gallery的业务结果，来自 KnowledgeService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## knowledge_library（6 项）

业务来源：KnowledgeService / KnowledgeManagement。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_knowledge_library_list

可访问知识库 · list。性质：只读；恢复：read。所需工具授权：`nw_knowledge_library_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含可访问知识库 · list的业务结果，来自 KnowledgeService / KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_library_get

可访问知识库 · get。性质：只读；恢复：read。所需工具授权：`nw_knowledge_library_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |

返回：`data` 包含可访问知识库 · get的业务结果，来自 KnowledgeService / KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_library_references_get

可访问知识库 · references_get。性质：只读；恢复：read。所需工具授权：`nw_knowledge_library_references_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |

返回：`data` 包含可访问知识库 · references_get的业务结果，来自 KnowledgeService / KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_library_create

知识库业务信息 · create。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_library_create`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| data | object | 是 | data |

业务字段：`name` (string)、`description` (string)、`type` (string)、`faq_config` (object)、`wiki_config` (object)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含知识库业务信息 · create的业务结果，来自 KnowledgeService / KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_library_update

知识库业务信息 · update。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_library_update`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| data | object | 是 | data |

业务字段：`name` (string)、`description` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含知识库业务信息 · update的业务结果，来自 KnowledgeService / KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_library_delete

知识库业务信息 · delete。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_library_delete`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |

返回：`data` 包含知识库业务信息 · delete的业务结果，来自 KnowledgeService / KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## knowledge_document（11 项）

业务来源：KnowledgeManagement / KnowledgeContent。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_knowledge_document_list

知识文档 · list。性质：只读；恢复：read。所需工具授权：`nw_knowledge_document_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| data | object | 否 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含知识文档 · list的业务结果，来自 KnowledgeManagement / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_document_get

知识文档 · get。性质：只读；恢复：read。所需工具授权：`nw_knowledge_document_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含知识文档 · get的业务结果，来自 KnowledgeManagement / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_document_read

知识文档 · read。性质：只读；恢复：read。所需工具授权：`nw_knowledge_document_read`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 否 | connectionId |
| collectionId | string | 否 | collectionId |
| kind | string (project / workbench / expert) | 否 | kind |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| referenceId | string | 否 | referenceId |
| data | object | 是 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含知识文档 · read的业务结果，来自 KnowledgeManagement / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_document_parse_status

知识文档 · parse_status。性质：只读；恢复：read。所需工具授权：`nw_knowledge_document_parse_status`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含知识文档 · parse_status的业务结果，来自 KnowledgeManagement / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_document_export

知识文档 · export。性质：只读；恢复：read。所需工具授权：`nw_knowledge_document_export`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含知识文档 · export的业务结果，来自 KnowledgeManagement / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_document_source_read

知识文档 · source_read。性质：只读；恢复：read。所需工具授权：`nw_knowledge_document_source_read`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 否 | connectionId |
| collectionId | string | 否 | collectionId |
| kind | string (project / workbench / expert) | 否 | kind |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| referenceId | string | 否 | referenceId |
| data | object | 是 | data |

业务字段：`documentId` (string)、`chunkId` (string)、`imageId` (string)、`download` (boolean)、`media` (boolean)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含知识文档 · source_read的业务结果，来自 KnowledgeManagement / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_document_create

知识文档维护 · create。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_document_create`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| source | string | 是 | source |
| data | object | 是 | data |

业务字段：`title` (string)、`content` (string)、`status` (string)、`tag_ids` (array<业务对象>)、`process_config` (object)、`url` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含知识文档维护 · create的业务结果，来自 KnowledgeManagement / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_document_update

知识文档维护 · update。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_document_update`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`title` (string)、`content` (string)、`status` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含知识文档维护 · update的业务结果，来自 KnowledgeManagement / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_document_delete

知识文档维护 · delete。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_document_delete`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含知识文档维护 · delete的业务结果，来自 KnowledgeManagement / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_document_parse_command

知识文档维护 · parse_command。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_document_parse_command`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| action | string | 是 | action |

返回：`data` 包含知识文档维护 · parse_command的业务结果，来自 KnowledgeManagement / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_document_file_add

知识文档维护 · file_add。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_document_file_add`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| file | object | 是 | 受控资源 URI，或已授权项目中的成果 ID 与固定版本；工作区文件先发布为成果 |
| relativePath | string | 否 | relativePath |

返回：`data` 包含知识文档维护 · file_add的业务结果，来自 KnowledgeManagement / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## faq（7 项）

业务来源：KnowledgeManagement / PlatformMcpFaqFiles。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_faq_list

FAQ · list。性质：只读；恢复：read。所需工具授权：`nw_faq_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| data | object | 否 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含FAQ · list的业务结果，来自 KnowledgeManagement / PlatformMcpFaqFiles；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_faq_get

FAQ · get。性质：只读；恢复：read。所需工具授权：`nw_faq_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含FAQ · get的业务结果，来自 KnowledgeManagement / PlatformMcpFaqFiles；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_faq_export

FAQ · export。性质：只读；恢复：read。所需工具授权：`nw_faq_export`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| format | string | 是 | format |

返回：`data` 包含FAQ · export的业务结果，来自 KnowledgeManagement / PlatformMcpFaqFiles；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_faq_save

FAQ 内容维护 · save。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_faq_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| mode | string (create / update) | 是 | mode |
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`standard_question` (string)、`similar_questions` (array<业务对象>)、`negative_questions` (array<业务对象>)、`answers` (array<业务对象>)、`answer_strategy` (string)、`tag_id` (string)、`tag_name` (string)、`is_enabled` (boolean)、`is_recommended` (boolean)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含FAQ 内容维护 · save的业务结果，来自 KnowledgeManagement / PlatformMcpFaqFiles；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_faq_delete

FAQ 内容维护 · delete。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_faq_delete`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| data | object | 是 | data |

业务字段：`ids` (array<业务对象>)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含FAQ 内容维护 · delete的业务结果，来自 KnowledgeManagement / PlatformMcpFaqFiles；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_faq_batch_update

FAQ 内容维护 · batch_update。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_faq_batch_update`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| action | string | 是 | action |
| data | object | 是 | data |

业务字段：`by_id` (object)、`by_tag` (object)、`exclude_ids` (array<业务对象>)、`updates` (array<业务对象>)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含FAQ 内容维护 · batch_update的业务结果，来自 KnowledgeManagement / PlatformMcpFaqFiles；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_faq_import

FAQ 内容维护 · import。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_faq_import`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| data | object | 是 | data |
| file | object | 否 | 受控资源 URI，或已授权项目中的成果 ID 与固定版本；工作区文件先发布为成果 |
| format | string | 否 | format |

业务字段：`entries` (array<业务对象>)、`mode` (string)、`dry_run` (boolean)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含FAQ 内容维护 · import的业务结果，来自 KnowledgeManagement / PlatformMcpFaqFiles；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## knowledge_tag（3 项）

业务来源：KnowledgeManagement。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_knowledge_tag_list

知识标签 · list。性质：只读；恢复：read。所需工具授权：`nw_knowledge_tag_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| data | object | 否 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含知识标签 · list的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_tag_save

知识标签 · save。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_tag_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| mode | string (create / update) | 是 | mode |
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`name` (string)、`color` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含知识标签 · save的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_tag_delete

知识标签 · delete。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_tag_delete`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含知识标签 · delete的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## wiki_page（5 项）

业务来源：KnowledgeManagement。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_wiki_page_list

Wiki 页面 · list。性质：只读；恢复：read。所需工具授权：`nw_wiki_page_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| data | object | 否 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含Wiki 页面 · list的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_page_get

Wiki 页面 · get。性质：只读；恢复：read。所需工具授权：`nw_wiki_page_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含Wiki 页面 · get的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_page_save

Wiki 页面 · save。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_wiki_page_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| mode | string (create / update) | 是 | mode |
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`slug` (string)、`title` (string)、`content` (string)、`folder_id` (string)、`page_type` (string)、`version` (integer)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含Wiki 页面 · save的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_page_delete

Wiki 页面 · delete。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_wiki_page_delete`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含Wiki 页面 · delete的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_page_move

Wiki 页面 · move。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_wiki_page_move`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| data | object | 是 | data |

业务字段：`slug` (string)、`folder_id` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含Wiki 页面 · move的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## wiki_folder（3 项）

业务来源：KnowledgeManagement。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_wiki_folder_list

Wiki 目录 · list。性质：只读；恢复：read。所需工具授权：`nw_wiki_folder_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| data | object | 否 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含Wiki 目录 · list的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_folder_save

Wiki 目录 · save。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_wiki_folder_save`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| mode | string (create / update) | 是 | mode |
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`name` (string)、`parent_id` (string)、`move_parent` (boolean)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含Wiki 目录 · save的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_folder_delete

Wiki 目录 · delete。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_wiki_folder_delete`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含Wiki 目录 · delete的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## wiki（10 项）

业务来源：KnowledgeManagement。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_wiki_revision_list

Wiki 结构与质量 · revision_list。性质：只读；恢复：read。所需工具授权：`nw_wiki_revision_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 否 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含Wiki 结构与质量 · revision_list的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_index_get

Wiki 结构与质量 · index_get。性质：只读；恢复：read。所需工具授权：`nw_wiki_index_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| data | object | 否 | data |

业务字段：`query` (string)、`topK` (integer)、`documentId` (string)、`contentKind` (string)、`page` (integer)、`pageSize` (integer)、`chunkId` (string)、`mode` (string)、`nodeId` (string)、`limit` (integer)、`searchIn` (array<业务对象>)、`sortBy` (string)、`sortOrder` (string)、`isEnabled` (boolean)、`documentIds` (array<业务对象>)、`attrFilters` (object)、`attrRules` (array<业务对象>)、`keyword` (string)、`parse_status` (string)、`source` (string)、`search_field` (string)、`is_enabled` (boolean)、`tag_id` (string)、`sort_order` (string)、`folder_id` (string)、`page_type` (string)、`status` (string)、`parent_id` (string)、`version` (integer)、`cursor` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含Wiki 结构与质量 · index_get的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_stats_get

Wiki 结构与质量 · stats_get。性质：只读；恢复：read。所需工具授权：`nw_wiki_stats_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |

返回：`data` 包含Wiki 结构与质量 · stats_get的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_lint_get

Wiki 结构与质量 · lint_get。性质：只读；恢复：read。所需工具授权：`nw_wiki_lint_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |

返回：`data` 包含Wiki 结构与质量 · lint_get的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_issue_list

Wiki 结构与质量 · issue_list。性质：只读；恢复：read。所需工具授权：`nw_wiki_issue_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |

返回：`data` 包含Wiki 结构与质量 · issue_list的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_graph_get

Wiki 结构与质量 · graph_get。性质：只读；恢复：read。所需工具授权：`nw_wiki_graph_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |

返回：`data` 包含Wiki 结构与质量 · graph_get的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_revert

Wiki 维护 · revert。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_wiki_revert`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| data | object | 是 | data |

业务字段：`slug` (string)、`version` (integer)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含Wiki 维护 · revert的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_issue_set

Wiki 维护 · issue_set。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_wiki_issue_set`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`status` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含Wiki 维护 · issue_set的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_links_rebuild

Wiki 维护 · links_rebuild。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_wiki_links_rebuild`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |

返回：`data` 包含Wiki 维护 · links_rebuild的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_wiki_autofix

Wiki 维护 · autofix。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_wiki_autofix`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| connectionId | string | 是 | connectionId |
| collectionId | string | 是 | collectionId |

返回：`data` 包含Wiki 维护 · autofix的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## knowledge_creation（2 项）

业务来源：KnowledgeCreationService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_knowledge_creation_template_list

知识库创建模板 · template_list。性质：只读；恢复：read。所需工具授权：`nw_knowledge_creation_template_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含知识库创建模板 · template_list的业务结果，来自 KnowledgeCreationService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_creation_submit

模板化知识库创建 · submit。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_creation_submit`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| data | object | 是 | data |

业务字段：`templateId` (string)、`revision` (integer)、`name` (string)、`description` (string)、`preview` (boolean)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含模板化知识库创建 · submit的业务结果，来自 KnowledgeCreationService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## knowledge_creation_job（5 项）

业务来源：KnowledgeCreationService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_knowledge_creation_job_list

知识库创建作业 · list。性质：只读；恢复：read。所需工具授权：`nw_knowledge_creation_job_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含知识库创建作业 · list的业务结果，来自 KnowledgeCreationService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_creation_job_get

知识库创建作业 · get。性质：只读；恢复：read。所需工具授权：`nw_knowledge_creation_job_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含知识库创建作业 · get的业务结果，来自 KnowledgeCreationService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_creation_job_confirm

原知识库创建作业 · confirm。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_creation_job_confirm`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`business` (object)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含原知识库创建作业 · confirm的业务结果，来自 KnowledgeCreationService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_creation_job_retry

原知识库创建作业 · retry。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_creation_job_retry`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含原知识库创建作业 · retry的业务结果，来自 KnowledgeCreationService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_creation_job_recover

原知识库创建作业 · recover。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_creation_job_recover`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含原知识库创建作业 · recover的业务结果，来自 KnowledgeCreationService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## knowledge_operation（4 项）

业务来源：KnowledgeManagement。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_knowledge_operation_list

知识内容维护回执 · list。性质：只读；恢复：read。所需工具授权：`nw_knowledge_operation_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含知识内容维护回执 · list的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_operation_import_progress

知识内容维护回执 · import_progress。性质：只读；恢复：read。所需工具授权：`nw_knowledge_operation_import_progress`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含知识内容维护回执 · import_progress的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_operation_failure_report

知识内容维护回执 · failure_report。性质：只读；恢复：read。所需工具授权：`nw_knowledge_operation_failure_report`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含知识内容维护回执 · failure_report的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_knowledge_operation_recover

原知识内容操作恢复 · recover。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_knowledge_operation_recover`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含原知识内容操作恢复 · recover的业务结果，来自 KnowledgeManagement；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## evidence（3 项）

业务来源：KnowledgeEvidence / KnowledgeContent。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_evidence_get

稳定知识证据 · get。性质：只读；恢复：read。所需工具授权：`nw_evidence_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| taskId | string | 是 | taskId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含稳定知识证据 · get的业务结果，来自 KnowledgeEvidence / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_evidence_source_read

稳定知识证据 · source_read。性质：只读；恢复：read。所需工具授权：`nw_evidence_source_read`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| taskId | string | 是 | taskId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 否 | data |

业务字段：`page` (integer)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含稳定知识证据 · source_read的业务结果，来自 KnowledgeEvidence / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_evidence_media_read

稳定知识证据 · media_read。性质：只读；恢复：read。所需工具授权：`nw_evidence_media_read`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| taskId | string | 是 | taskId |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含稳定知识证据 · media_read的业务结果，来自 KnowledgeEvidence / KnowledgeContent；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## memory（11 项）

业务来源：MemoryService / MemoryRuntime。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_memory_target_list

授权记忆 · target_list。性质：只读；恢复：read。所需工具授权：`nw_memory_target_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含授权记忆 · target_list的业务结果，来自 MemoryService / MemoryRuntime；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_memory_entry_list

授权记忆 · entry_list。性质：只读；恢复：read。所需工具授权：`nw_memory_entry_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (user / task / project / workbench / expert) | 是 | kind |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| offset | integer | 否 | 分页偏移，默认0 |
| limit | integer | 否 | 每页数量，默认50，最多100 |

返回：`data` 包含授权记忆 · entry_list的业务结果，来自 MemoryService / MemoryRuntime；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_memory_get

授权记忆 · get。性质：只读；恢复：read。所需工具授权：`nw_memory_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |

返回：`data` 包含授权记忆 · get的业务结果，来自 MemoryService / MemoryRuntime；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_memory_search

授权记忆 · search。性质：只读；恢复：read。所需工具授权：`nw_memory_search`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (user / task / project / workbench / expert) | 是 | kind |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| query | string | 是 | query |

返回：`data` 包含授权记忆 · search的业务结果，来自 MemoryService / MemoryRuntime；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_memory_cleanup_list

授权记忆 · cleanup_list。性质：只读；恢复：read。所需工具授权：`nw_memory_cleanup_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含授权记忆 · cleanup_list的业务结果，来自 MemoryService / MemoryRuntime；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_memory_context_get

授权记忆 · context_get。性质：只读；恢复：read。所需工具授权：`nw_memory_context_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| taskId | string | 是 | taskId |

返回：`data` 包含授权记忆 · context_get的业务结果，来自 MemoryService / MemoryRuntime；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_memory_propose

有来源的记忆草稿（不可审核发布） · propose。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_memory_propose`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (user / task / project / workbench / expert) | 是 | kind |
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`title` (string)、`content` (string)、`sourceEntryId` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含有来源的记忆草稿（不可审核发布） · propose的业务结果，来自 MemoryService / MemoryRuntime；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_memory_draft_update

有来源的记忆草稿（不可审核发布） · draft_update。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_memory_draft_update`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| data | object | 是 | data |

业务字段：`revision` (integer)、`title` (string)、`content` (string)。更新使用当前读取的 revision / expected_revision / version；具体要求由原服务校验。

返回：`data` 包含有来源的记忆草稿（不可审核发布） · draft_update的业务结果，来自 MemoryService / MemoryRuntime；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_memory_disable

有来源的记忆草稿（不可审核发布） · disable。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_memory_disable`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |

返回：`data` 包含有来源的记忆草稿（不可审核发布） · disable的业务结果，来自 MemoryService / MemoryRuntime；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_memory_delete

有来源的记忆草稿（不可审核发布） · delete。性质：写入 / 执行；恢复：idempotent。所需工具授权：`nw_memory_delete`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |

返回：`data` 包含有来源的记忆草稿（不可审核发布） · delete的业务结果，来自 MemoryService / MemoryRuntime；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_memory_retry

记忆原同步操作 · retry。性质：写入 / 执行；恢复：reconcile。所需工具授权：`nw_memory_retry`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| id | string | 是 | 目标业务对象 ID，从对应列表或创建结果取得 |
| revision | integer | 是 | revision |

返回：`data` 包含记忆原同步操作 · retry的业务结果，来自 MemoryService / MemoryRuntime；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## model（2 项）

业务来源：ModelProviderService。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_model_catalog_list

本人已保存模型（无密钥与地址） · catalog_list。性质：只读；恢复：read。所需工具授权：`nw_model_catalog_list`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含本人已保存模型（无密钥与地址） · catalog_list的业务结果，来自 ModelProviderService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_model_settings_get

本人已保存模型（无密钥与地址） · settings_get。性质：只读；恢复：read。所需工具授权：`nw_model_settings_get`，另叠加目标对象的范围和业务权限。

无模型输入参数，身份由真实运行推导。

返回：`data` 包含本人已保存模型（无密钥与地址） · settings_get的业务结果，来自 ModelProviderService；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## admin（2 项）

业务来源：原模块管理服务（各自管理员检查）。适配入口：Java `platformmcp/PlatformMcpDispatch`。

### nw_admin_status_get

按原管理员权限提供脱敏查询 · status_get。性质：只读；恢复：read。所需工具授权：`nw_admin_status_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (knowledge / memory / workflow / engine / engine-status / models / credentials / knowledge-templates / knowledge-resources / knowledge-discovery / model-settings) | 是 | kind |

返回：`data` 包含按原管理员权限提供脱敏查询 · status_get的业务结果，来自 原模块管理服务（各自管理员检查）；文件与原图返回受控 `uri`，不包含上游地址或密钥。

### nw_admin_catalog_get

按原管理员权限提供脱敏查询 · catalog_get。性质：只读；恢复：read。所需工具授权：`nw_admin_catalog_get`，另叠加目标对象的范围和业务权限。

| 参数 | 类型 | 必需 | 说明 |
|---|---|---|---|
| kind | string (knowledge / memory / workflow / engine / engine-status / models / credentials / knowledge-templates / knowledge-resources / knowledge-discovery / model-settings) | 是 | kind |
| id | string | 否 | 目标业务对象 ID，从对应列表或创建结果取得 |
| limit | integer | 否 | 每页数量，默认50，最多100 |
| offset | integer | 否 | 分页偏移，默认0 |

返回：`data` 包含按原管理员权限提供脱敏查询 · catalog_get的业务结果，来自 原模块管理服务（各自管理员检查）；文件与原图返回受控 `uri`，不包含上游地址或密钥。

## 特定边界

- `save` 的 `mode` 为 create/update；更新传 id 和当前版本。共享专家、SOP、规则的变更会返回实际共享影响范围。
- 新建工作台/专家/独立工作流/知识库、市场添加、创建作业、跨项目专家/工作台总用量需要主执行的账号范围。指定资源不会授予其连接配置或其他账号数据。
- `nw_task_create` 必须指定现有目标项目，目标项目决定工作台；不创建隐蔽项目。派生任务和专家不能再次进行业务任务调度。任务元数据不授予会话正文，跨任务内容只能通过已有会话授权读取。
- `nw_runtime_save.data.files` 仅接受保留的已有文件 path；新文件用 `nw_runtime_file_add`。MCP 地址、凭据和策略是保留字段。
- `nw_faq_import` 支持 data.entries，或受控 file 加 format=json/csv；两者互斥。CSV 沿用现有中英文模板列和引号/多行语义。
- `nw_memory_propose.data.sourceEntryId` 可关联已有记忆形成修改或提升建议；始终产生有真实 Run 来源的新草稿。`nw_memory_draft_update` 保留待审核状态，审核发布继续由人完成。
- `nw_resource_read` 的 limit 最多 65536。二进制 offset 按字节，JSON 文本 offset 按字符串位置；跟随 nextOffset。MCP resources/read 对未读完的内容返回带 continuation 的 JSON 描述，避免把首段误认为完整文件。
- 管理查询仍执行各模块管理员检查；普通模板目录不包含技术配置。暂缺业务、人工审核/授权、连接和密钥维护不注册工具。
