> 历史功能交付记录：其中的 Nacos、原父工程和部署说明仅描述旧环境。当前独立工程的启动、配置及构建方式以 [README.md](README.md) 为准。

# 模型配置接口交付

本批实现设置页的模型目录管理、默认/备用选择和三个配置开关。业务代码全部在 `nebuwork-backend-api`；身份复用统一登录的 Redis 会话。未修改网关、统一用户服务或 NebuAgentCore。

本轮没有运行测试、构建、服务或浏览器验收，也没有连接数据库执行迁移。以下步骤由使用方执行。

## Nacos 必填配置

在现有模块的 Nacos Data ID `nebuwork-backend-api-dev.yml` 中合并以下内容，不覆盖已有 `spring.redis`、`spring.datasource` 和其他模块配置。完整参考文件为 [配置样例](config/application-local.example.yml)。

```yaml
nebu:
  models:
    encryption-key: "替换为32字节随机值的Base64编码"
    block-special-addresses: false
    internal-allowlist-enabled: false
    allowed-internal-origins: ""
    request-timeout-ms: 12000
logging:
  level:
    org.apache.http.wire: "OFF"
    org.apache.http.headers: "OFF"
    org.springframework.web.servlet.mvc.method.annotation.RequestResponseBodyMethodProcessor: WARN
```

在自己的终端生成一次主密钥，再粘贴到 Nacos（不要提交到 Git 或放在前端）：

```powershell
$modelKeyBytes = New-Object byte[] 32
$modelKeyRng = [Security.Cryptography.RandomNumberGenerator]::Create()
try {
  $modelKeyRng.GetBytes($modelKeyBytes)
  [Convert]::ToBase64String($modelKeyBytes)
} finally {
  [Array]::Clear($modelKeyBytes, 0, $modelKeyBytes.Length)
  $modelKeyRng.Dispose()
}
```

密钥需长期保持一致并备份。随意更换或丢失会导致已保存 Key 无法解密；本批没有在线密钥轮换工具。多实例必须使用同一密钥。缺失或无效时保存/解密返回 503，没有明文回退。使用支持 AES-256/GCM 的 Java 8 运行环境。

2026-10-26 起，模型网络地址限制默认关闭，获取模型、测试连接和模型调用均允许 Fake-IP（包括 198.18.0.0/15）、内网、本机及其他已解析目标地址，不需要维护来源白名单。

可按部署需要显式重新启用：

```yaml
nebu:
  models:
    block-special-addresses: false
    internal-allowlist-enabled: false
    allowed-internal-origins: ""
```

两个开关默认都是 false。设 internal-allowlist-enabled 为 true 才校验 allowed-internal-origins；设 block-special-addresses 为 true 才拦截特殊地址。DNS、HTTP(S) 地址格式、账号归属和 API Key 加密仍按原接口执行，无需数据库迁移。

模型访问固定使用校验后的 DNS 地址，保留原域名进行 TLS 校验，不跟随重定向、不使用系统 HTTP 代理。总时间预算包括 DNS、连接和所有分页，默认 12 秒，可配 100～60000 ms；累计响应最多 2 MiB、最多 20 页。不关闭 TLS 证书检查。不要开启 HTTP wire/header 或包含请求体的 TRACE 日志；API Key 不应被外围请求日志记录。

## 数据库迁移

数据源仍指向 `nebuwork_1`。重建并启动模块时，Flyway 自动执行 [V2 SQL](src/main/resources/db/migration/V2__user_model_configuration.sql)。未改 V1，未插入演示模型。

专家模型关联另增 [V3 SQL](src/main/resources/db/migration/V3__expert_model_provider.sql)，在本库 `nw_expert` 添加可空的 `model_provider_id`、索引及外键，模型名扩为 255 字符。不修改已应用的 V1/V2，也不按名称回填私人配置。旧专家及市场导入的模型名继续作为展示快照。

手动创建专家 `POST /api/agents` 改为提交 `{name,role,tagline,modelProviderId}`，配置 ID 通过已验证会话校验所属用户，模型名由 Java 从配置读取；只传名称返回 422，提交他人或已删除配置返回 404。列表和详情增加可空的 `modelProviderId`。创建与删除沿用同一用户设置行锁，避免绑定已删除配置；删除在同一事务中解除相关专家引用、增加专家 revision 并保留模型名，脱敏审计记录解除数量。此关联不代表模型执行已接通。

| 表 | 用途 |
| --- | --- |
| `nw_model_provider` | 用户自有模型配置、AES-GCM 密文、最近目录测试结果 |
| `nw_user_model_settings` | 本用户默认及备用配置 ID、三个偏好、revision |

变更日志复用 `nw_config_audit`，记录验证过的实际 `punterId`。不新增用户表、不向用户模块写数据、不建立跨库外键。模型唯一性按当前用户 + 厂商 + 规范化目录地址 + 模型名计算 SHA-256 指纹；服务根地址、版本地址与完整目录地址对应同一目录时视作同一配置。

生产迁移前检查实际连接库和 Flyway schema 为 `nebuwork_1`，不符会停止迁移。仅测试资源使用 `expert-local` + 隔离 H2，不能把这个测试 profile 用于实际部署。运行期使用本模块数据源，勿为它配置独立且指向其他库的 Flyway 数据源。数据库字符集沿用已有 `utf8mb4`。

新用户 GET 设置返回空引用、三个 `true`、`revision: 0`；新增模型会建立版本 0 的用户设置行作为并发锁，不改变初始偏好。首次实际保存升为 1。后续启动由 Flyway 历史表跳过已应用迁移，不覆盖配置。删除模型和清除该用户默认/备用引用在一个事务内完成；引用变化时版本加一。

## 接口

下表是模块内部路径；浏览器统一加 `/nebulaedev/nwaa`，直接 Java 地址加 `/nwaa`。全部要求已验证的统一登录会话。成功 `{code:0,data:...,msg:"成功"}`；错误使用对应 HTTP 状态及同样的响应外壳。

| 方法 | 路径 | 请求/结果 |
| --- | --- | --- |
| GET | `/api/model-providers` | 本用户配置数组，无 Key 或密文 |
| POST | `/api/model-providers` | `{type,baseUrl,apiKey,model}`；返回新配置，不强制联网 |
| POST | `/api/model-providers/models` | `{type,baseUrl,apiKey}`；返回 `{models,endpoint,latencyMs}`，不落库 |
| POST | `/api/model-providers/test` | `{type,baseUrl,apiKey,model}`；返回 `{connected,modelFound,latencyMs}`，不落库 |
| POST | `/api/model-providers/{id}/test` | 无请求体；读取密文后测试，返回诊断和刷新后的配置字段 |
| DELETE | `/api/model-providers/{id}` | 删除本人配置、清空引用；成功 `data:null`，随后重新查询列表和设置 |
| GET | `/api/model-settings` | 查询当前用户设置 |
| POST（兼容 PATCH） | `/api/model-settings` | 必须有 `revision`；可部分更新下列字段，返回全部设置 |

页面保存使用 POST，适配现有网关仅允许 GET/POST/DELETE/PUT/OPTIONS 的 CORS 方法配置，避免 PATCH 在网关返回 403。Java 保留 PATCH 兼容入口；两种方法进入相同的会话、用户归属、参数与 revision 校验。GET 查询不变。此修复需重新构建并重启 Java，然后刷新前端；不需要变更数据库或网关。

```json
{
  "revision": 0,
  "defaultProviderId": null,
  "auditFallbackProviderId": null,
  "retainAuditTrail": true,
  "autoArchiveArtifacts": true,
  "autoMemoryBackflow": true
}
```

字段不传表示保留；默认引用传 `null` 表示清空，只接受本人配置 ID。忽略模型创建请求中的伪造归属字段，设置接口拒绝不支持的字段。实际归属始终来自 `RequestIdentity.actor()`。其他用户的配置在测试、删除、引用时均返回 404。重复模型或过期 revision 返回 409。

列表字段：`id,type,baseUrl,model,hasApiKey,status,lastTestedAt,lastLatencyMs,lastModelFound,createdAt,updatedAt`。初始 `status=untested`，时间/诊断为空；测试后为 `connected` 或 `error`。`connected` 只表示目录访问成功；`lastModelFound=false` 不表示推理不可用，手动模型仍可保存。接口不返回用户 ID、Key 或密文。

上游 401/403/429、无效 JSON、空目录、分页异常等映射为脱敏 502；超时 504；错误参数或禁止的地址 422；加密/服务配置异常 503。只有本站会话失效返回 401。错误体和审计不记录上游响应正文或 Key，失败的已保存测试也持久化错误状态及耗时。

新增配置、目录查询和草稿测试的 `type` 仅接受 `mrtoken`、`custom`，页面名称分别为“mrtoken”“自定义”。两者均通过 Bearer + `/v1/models` 查询目录，并支持现有 `/v1/chat/completions` 任务执行；保留代理路径和显式版本。URL 由用户填写，服务地址不可包含账号、查询参数或 URL 片段。其他厂商值返回 422。

旧 `openai`、`anthropic`、`gemini` 仅作为已保存配置的读取和测试兼容，旧 OpenAI 兼容配置仍可执行；不会出现在新增厂商选项中。本次无需数据库迁移，重新构建并重启 Java 后生效。

## 使用方验收

先合并 Nacos 配置，再重新构建并启动 `NebuworkBackendApiApplication`（42020，`/nwaa`），网关继续由你管理。前端根目录 `npm run dev`，进入 `http://localhost:5173/#/settings?tab=model`。模型 Key 通过页面传入 Java，不配置到前端环境变量。

- 确认 V2 只在 `nebuwork_1` 应用一次，初始模型列表为空、默认及备用未选。
- 用 A/B 两个用户分别新增相同模型；各自只能看到、测试、删除、引用自己的配置；伪造 `userId` 不生效。
- 同用户对等价地址重复添加返回 409，失败弹窗保留输入；未测试或目录未匹配的手动模型可以保存。
- 保存默认/备用和三个开关后刷新、重启 Java，配置仍在；数据库/API/日志/审计均无明文 Key。
- 删除同时被设为默认和备用的配置，两处清空；删除其他配置不改变引用；旧 revision 保存返回 409。
- mrtoken、自定义分别验证新增保存、目录查询、连接测试、任务选择和执行，验证根地址、版本地址、完整目录地址、自定义代理路径及认证。旧协议不能作为新厂商提交，但历史配置仍可读取和测试。空目录/非法 JSON/循环分页/20 页上限/2 MiB 上限不能成功。
- 验证 Key 错误、上游限流返回 502，超时返回 504，本站仍保持登录；无会话才返回 401。
- 验证默认可连接内网、本机和代理 Fake-IP；显式重新启用限制时验证来源白名单及特殊地址拦截；重定向不跟随。
- 保存失败保留选中项，开关失败恢复，重新加载后可再保存；退出或切换用户后不显示旧用户数据。
- 页面注明本批仅保存配置，未实现推理、自动归档、记忆回流或专家模型选择器迁移。

已新增但 **未执行**：`ModelApiTest`（H2/MockMvc、隔离/加密/引用/冲突/重复迁移）、`ModelCatalogClientTest`（本机 HTTP 夹具、协议/分页/错误/限额）、`ModelSecurityTest`（地址/加密）、`ModelDatabaseConfigurationTest`（迁移库校验）；前端 `modelApi.test.js`、`modelSettings.test.js`（串行写入、账号变更、失败页面）。这些测试不使用真实模型账户。实际重启持久化和浏览器验收由你执行。
