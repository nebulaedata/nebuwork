> 2026-10-15：本文保留为历史阶段记录。当前执行链路、部署与验收以 [新智能体引擎交付说明](agent-engine-delivery.md) 为准；文中的旧核心、模板和未接通状态不适用于当前实现。

# 纯前端与统一用户服务迁移

日期：2026-09-20。状态：代码已调整，待使用方验证。本轮没有运行测试、构建、浏览器验证或启动/重启服务，没有修改数据库、Redis 数据、Nacos 内容和网关规则。

## 变更

- 移除 Node BFF、仅供 BFF 使用的内核客户端、旧部署配置及生成的 BFF 文档。前端仍使用 Node/npm 进行 Vite 开发和构建；Sites worker 仅提供静态资源。
- 统一用户接口与专家接口分别解析 status 和 code 响应。登录 RSA 公钥及 odkixsk=0 与参考项目 MrToken3.0/main-fe 的开发配置一致，密码不去除首尾空格、不以明文发送。
- 应用启动查询真实当前用户，默认进入专家管理，保留有效站内返回地址。服务异常提供重试，过期会话重新登录；不以 sessionStorage 登录标记认证。
- 侧栏及个人信息显示真实用户资料，缺失头像使用中性占位。资料修改暂未接入，移除演示身份、管理员默认权限及虚假的保存成功提示。
- 退出成功清理用户和页面数据缓存；失败保留当前状态并显示错误。请求按会话版本隔离，旧响应和旧 SOP 排队请求不能覆盖新账号的数据。
- Java 验证现有 Redis token 记录，以实际 punterId 记录审计；不再签发模块自己的会话。专家数据可见范围、业务接口及表结构不变。

## 启动

在前端根目录执行 `npm install`、`npm run dev`，访问 `http://localhost:5173/#/agents`。本轮已安装 RSA 依赖并更新锁文件，未执行 npm 脚本中的测试或构建。

Java 新增 Redis 依赖且删除旧登录控制器，请重新构建并重启模块。在 Java 合集根目录执行 `mvn -pl nebuwork-backend-api clean package -DskipTests` 后运行模块启动脚本，或使用 IDE 重新构建并启动 `NebuworkBackendApiApplication`。使用 clean 防止删除的控制器 class 残留。

Nacos `spring.redis` 必须指向统一用户服务与网关共用的 Redis 实例和 database，沿用已有连接凭据。旧 `nebu.auth.username/password` 不再生效；数据库仍使用 `spring.datasource`。网关与 Java 端口分别为 42000、42020。

| 功能 | 浏览器请求 |
| --- | --- |
| 登录 | POST /nebulaedev/web/punterapi/login |
| 退出 | POST /nebulaedev/web/punterapi/loginOut |
| 当前用户 | POST /nebulaedev/web/punterapi/power/getPunterPowerInfoInHeader |
| 专家业务 | /nebulaedev/nwaa/api/... |

公开前端覆盖配置放在 `apps/web/.env.local`，参考该目录 `.env.example`。不要放入用户密码、私钥、数据库密码或内核系统密钥。部署静态文件时需配置同源环境前缀的网关转发。

## 使用方验收清单

- [ ] 前端独立启动，启动命令不再运行 Node 业务后端；检查请求前缀与上表一致。
- [ ] 正确账号登录成功，错误密码显示实际服务错误；刷新后恢复真实账号，默认进入专家管理。
- [ ] 未登录访问专家详情，登录后返回原专家及标签页；无效返回地址回到专家管理。
- [ ] 名称、账号、邮箱、手机号和头像来自真实接口；没有默认管理员权限，资料修改只提示暂未接入。
- [ ] 专家查询、配置保存及素材操作接受统一登录；审计 actor 为 Redis 会话中的实际 punterId。
- [ ] 注销后不能继续访问专家接口；过期 token、仅伪造 userId、旧模块 Cookie 均不能通过鉴权。
- [ ] 用户服务离线时提示重试，Redis 离线时专家接口返回 503；退出失败不显示退出成功。
- [ ] 退出或切换账号时，旧用户信息响应、业务响应和排队 SOP 写入不会恢复旧状态。
- [ ] Java 重启后已有专家配置保持；本批不创建账号表或调整现有数据范围。

供使用方自行执行的工程检查：前端 `npm run check`；Java `mvn -pl nebuwork-backend-api clean package`。已补充认证协议、会话竞态和 Java 统一会话相关用例，但本轮未运行，不能据此宣称检查通过。

## 仍待后续接入

短信/微信登录、注册、资料修改和权限管理不在本批。工作台、项目、任务执行等页面保留，原 Node 接口移除后未实现的 Java 路径会报错；本批不补业务实现或增加 Mock 回退。智能体内核仍在 NebuAgentCore。
