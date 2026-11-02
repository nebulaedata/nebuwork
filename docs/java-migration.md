# Java 后端独立迁入

后续配置调整：按用户要求恢复独立工程的 Nacos 配置中心，默认连接 `nebuwork-dev`，完整沿用原数据库和组件。本页保留初次拆分验证记录；当前配置与启动方式以 [Nacos 配置记录](nacos-configuration.md) 和后端 README 为准。

2026-10-26 将 `D:/Work/Code/cccs/content-cloud-cluster-service/nebuwork-backend-api` 的工作区代码迁入 `backend/java/`。原目录和原 Git 状态保留，包含尚未提交的业务功能源码与测试。

## 工程边界

`backend/java/pom.xml` 就是单个服务的工程入口，直接使用官方 Spring Boot 2.7.6 parent，保留 Java 8；没有原父 POM、聚合 modules、相邻目录引用或私有共享模块依赖。

移除 `content-static-packet`、`content-starter`，以及无业务引用的 Spring Cloud / Nacos / OpenFeign、Lombok、Fastjson、commons-lang 等继承依赖。所需的 Web、Redis、MyBatis、Flyway、JDBC、SQL 解析、Office/CSV、JSON Schema 和 HTTP 库在本 POM 中声明。保留已有 PageHelper 分页及其 JSqlParser 4.9 适配契约，不更改业务分页行为。

没有迁入用户模块、网关、短信、分词或其他 Java 业务项目。原模块的 `preview-worker` 是可选文件预览辅助进程，保留其自身独立 Java 17 工程，不进入 API 的 Maven 模块或默认启动链路。

## 配置与启动

移除原环境的全部 `bootstrap*.yml`，不复制 `.env.local`、密码、数据库内容、日志、编译产物或运行文件。旧故障诊断/修复脚本及旧 Nacos 基础配置模板不进入新启动链路。

新配置读取环境变量及可选的 Git 忽略文件 `config/application-local.yml`。高级知识库和文件预览示例移至 `config/examples/`，历史交付文档标明当前启动入口。

本地 Docker 启动脚本 `backend/java/scripts/Start-Local.ps1` 首次生成随机本地密码和加密密钥，使用隔离的 MySQL / Redis，等待 API 健康检查。也可在本目录运行 `mvn clean verify` 后直接启动 `target/nebuwork-backend-api.jar`。配置和完整命令见 [后端 README](../backend/java/README.md)。

统一认证逻辑保持原样：只读取现有用户服务的 Redis 会话，保留 token / sessionKey / Cookie 校验；没有新账号、独立登录或认证回退。使用现有账号时配置同一 Redis 实例、database 和认证信息。本地新 Redis 不包含原会话。

## 数据库与核对

V1–V28 SQL 的 SHA-256 均与原文件相同，保留 `nebuwork_1` 数据库检查、禁止跨库迁移和禁止 Flyway clean。当前迁入不读取或修改原业务数据库。源码来源摘要、文件变化及验证结果见 [java-import.json](java-import.json)。

已通过以下验证：

- Java 8 容器执行 `mvn verify dependency:tree`，独立工程构建成功；478 项测试通过，17 项外部环境验收按原有显式开关跳过，失败和错误均为 0。
- `node --test src/test/js/workbench-service-page.test.cjs`，3 项通过。
- Dockerfile 从本工程构建成功，启动脚本两次使用同一份隔离配置成功；API 以非 root 用户运行。
- 在隔离 MySQL 8.0.32 上执行全部 28 份原始迁移；没有写入演示专家或用户。
- API 健康接口成功；Actuator 报告数据库和 Redis 为 `UP`；匿名请求和 Redis 中不存在的 token 均返回 401。
- 可执行 JAR 包含 28 份迁移，不包含原共享模块、Spring Cloud、Nacos、Lombok、H2 或测试种子。
- 原目录的 247 个文件摘要、Git 状态及 28 份迁移文件摘要保持不变；本地密码、配置、日志、缓存和编译产物均被 Git 忽略。

实际启动检查使用 `nebuwork-java-import-check` 项目及端口 `42120`，与既有服务分离；验证结束后清理该项目的临时容器、网络和数据卷。没有启动或重启原环境的用户模块、网关、数据库或 Redis。

验证中修正了本地 MySQL 8 首次认证所需的连接参数，并将旧的扩展绑定测试更新为现有接口的 409 拒绝契约，保留模板绑定和市场添加的幂等检查；业务扩展安装流程没有改变。
