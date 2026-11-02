# Nacos 配置记录

2026-10-26 配置独立后端连接 `http://192.168.204.128:8848/nacos`，namespace ID / 名称均为 `nebuwork-dev`，Group 为 `DEFAULT_GROUP`，默认环境为 `dev`。

已将原 `cccs-jyz-1` 命名空间内该服务使用的三份配置完整复制到目标命名空间：

- `cccs-database-base-dev.yml`
- `cccs-config-base-dev.yml`
- `nebuwork-backend-api-dev.yml`

复制后重新读取源配置和目标配置，逐份核对内容完全相同。数据库、Redis、加密密钥及各组件设置均保留原值；用户模块和原命名空间未修改。配置摘要见 [nacos-configuration.json](nacos-configuration.json)，记录不包含配置明文或登录凭据。

后端继续使用独立的官方 Spring Boot parent，只恢复所需的 Spring Cloud bootstrap 和 Nacos config 依赖，不恢复原 Java 合集的父工程或源码模块。版本沿用原配置接入的 Spring Cloud 2021.0.5、Alibaba 2021.0.5.0、Nacos client 2.2.0。

Nacos 认证信息位于 `backend/java/config/nacos.properties`，已被 Git 和 Docker 构建上下文忽略。Java 启动时通过 bootstrap 导入该文件；正常 Docker 启动以只读方式挂载它，凭据不会进入镜像。公开模板为 `config/nacos.example.properties`，模板不含真实密码。

默认 `scripts/Start-Local.ps1` 使用 `compose.nacos.yml`，只启动 API 并读取现有配置，不新建数据库或 Redis。原来的全隔离开发环境通过 `-Isolated` 显式启用；两种模式使用不同的配置文件。

真实 Nacos 加载验收已通过：Spring bootstrap 从目标命名空间读取三份配置，46 项数据库、Redis及业务组件属性与源配置完全一致。验收只启动最小配置上下文，没有连接业务数据库、执行迁移、注册业务服务或启动后台 worker。普通 Maven 测试默认关闭 Nacos，真实加载验收需要显式开启。

独立 Java 工程重新打包成功，40 项相关回归测试通过；在线 Nacos 验收在普通回归中按开关跳过，另行显式执行已通过。新的 Docker 镜像构建成功，并确认镜像不含私有 Nacos 凭据文件；正常 Compose 仅有 API 服务，隔离 Compose 明确关闭 Nacos。
