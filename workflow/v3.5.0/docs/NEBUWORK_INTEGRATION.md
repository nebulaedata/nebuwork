# NebuWork 服务接入

默认本机模式不变。跨机器接入显式启用 `--remote-access`，通过进程环境设置至少 32 个非空白 ASCII 字符的 `NEBULAE_SERVICE_API_KEY`，启动示例：

```text
python -m nebulae serve --host 0.0.0.0 --remote-access --trusted-host workflow.internal
```

`--trusted-host` 可以重复传入，填写 Java 请求 URL 实际使用的域名或 IP，不能使用通配符。不要把密钥放到命令行、URL、浏览器或代码中。远程模式的所有 `/api/` 请求都需要 `Authorization: Bearer <服务密钥>`；保持原浏览器 Origin 限制。反向代理头不会改变服务看到的客户端身份。

NebuWork 管理员在设置页填写服务根地址和密钥。Java 使用现有 `/api/v1` 管理接口，健康检查返回 `service: nebulae-workflow`、`integration_version: 1` 及真实调度器状态。原独立前端没有服务密钥登录入口，远程模式的管理通过 NebuWork 完成。默认本机模式仍可使用原独立前端。

Python `Client` 支持显式 `api_key` 或进程中的同名环境变量；无需向请求透传业务用户 Cookie。账号授权和 NebuWork 创建记录由 Java 管理，本服务密钥只授予受信任的服务端。

首次任务创建与控制继续沿用 `command_id` 和版本校验。重启后的未完成任务仍等待人工处理，不自动执行。源码、依赖和产物协议没有变更。

新增 `tests/test_remote_integration.py`，由使用方运行测试及服务验收；本次未运行测试、构建或服务。
