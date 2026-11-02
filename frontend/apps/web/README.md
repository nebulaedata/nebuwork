# NebuWork Web

React / Vite 纯前端，保留原有页面布局。运行期通过现有网关访问 Java 与统一用户服务，无 Node BFF、无接口失败时的 Mock 回退。

- src/app：页面路由与登录守卫。
- src/services/authApi.js：RSA 账号登录、退出和当前用户接口。
- src/services/authSession.js：服务端会话恢复、用户缓存与过期请求隔离。
- src/services/httpApi.js、expertApi.js：Java 业务接口及专家配置缓存。
- src/data：页面契约和尚未迁移页面的原型资料；登录身份不使用演示数据。
- src/features：现有各页面；个人信息只读。

在工程根目录运行 npm run dev，访问 http://localhost:5173/#/agents。公开配置见本目录 .env.example，完整启动及 Java 配置说明见根目录 README.md。

保留 .openai/hosting.json、worker/index.js、Sites 构建脚本及相关测试，它们只适配静态资源托管，不实现业务后端。
