import { useEffect, useState } from "react";
import { Alert, Collapse, Input, InputNumber, Select, Tag } from "antd";
import { Check, RefreshCw, Save } from "lucide-react";
import { api, uuid } from "./api";
import { Button, ErrorNotice, useJob } from "./ui";

export type AgentConfig = {
  base_url: string;
  model: string;
  api: string;
  node_path: string;
  context_window: number;
  max_tokens: number;
  version: number;
  has_api_key: boolean;
};
type Runtime = {
  ready: boolean;
  node_path: string;
  node_version: string;
  pi_version: string;
  error: string | null;
  active_session_id: string | null;
};

export function AgentSettings() {
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [key, setKey] = useState<string | undefined>();
  const [result, setResult] = useState("");
  const { busy, error, setError, run } = useJob();
  const load = async () => {
    const [c, r] = await Promise.all([
      api<AgentConfig>("/agent/settings"),
      api<Runtime>("/agent/runtime"),
    ]);
    setConfig(c);
    setRuntime(r);
    setKey(undefined);
  };
  useEffect(() => {
    run(load);
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>智能体设置</h1>
          <p className="muted">Pi Agent · 通过对话构建和调试工作流</p>
        </div>
        <Button disabled={busy} onClick={() => run(load)}>
          <RefreshCw size={15} />
          刷新
        </Button>
      </div>
      <ErrorNotice message={error} clear={() => setError("")} />
      <section className="panel agent-settings">
        <div className="agent-runtime-status">
          <strong>Pi 运行时</strong>
          <Tag color={runtime?.ready ? "green" : "default"}>
            {runtime?.ready ? "已就绪" : "未就绪"}
          </Tag>
          <span>
            Pi {runtime?.pi_version ?? "1.1.0"} · Node{" "}
            {runtime?.node_version ?? "未检测到"}
          </span>
        </div>
        {runtime?.error && (
          <Alert
            type="warning"
            showIcon
            title={runtime.error}
            description={<code>python -m nebulae agent-install</code>}
          />
        )}
        {runtime?.node_path && (
          <p className="muted agent-path">{runtime.node_path}</p>
        )}
        {config && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                const { has_api_key: _, version, ...values } = config;
                const saved = await api<AgentConfig>("/agent/settings", "PUT", {
                  ...values,
                  api_key: key ?? null,
                  expected_version: version,
                  command_id: uuid(),
                });
                setConfig(saved);
                setKey(undefined);
                setResult("模型配置已保存，下一轮对话生效。");
                setRuntime(await api<Runtime>("/agent/runtime"));
              });
            }}
          >
            <div className="agent-settings-grid">
              <label>
                Base URL
                <Input
                  required
                  aria-label="Base URL"
                  placeholder="https://your-provider.example/v1"
                  value={config.base_url}
                  onChange={(e) =>
                    setConfig({ ...config, base_url: e.target.value })
                  }
                />
              </label>
              <label>
                模型名称
                <Input
                  required
                  aria-label="模型名称"
                  placeholder="模型服务支持的模型 ID"
                  value={config.model}
                  onChange={(e) =>
                    setConfig({ ...config, model: e.target.value })
                  }
                />
              </label>
              <label>
                API Key
                <Input.Password
                  aria-label="API Key"
                  autoComplete="new-password"
                  value={key ?? ""}
                  placeholder={
                    config.has_api_key
                      ? "已保存，留空保持不变"
                      : "无需认证的本地接口可留空"
                  }
                  onChange={(e) => setKey(e.target.value)}
                />
              </label>
              <label>
                接口类型
                <Select
                  aria-label="接口类型"
                  value={config.api}
                  onChange={(api) => setConfig({ ...config, api })}
                  options={[
                    { value: "openai-completions", label: "Chat Completions" },
                    { value: "openai-responses", label: "Responses" },
                  ]}
                />
              </label>
            </div>
            <Button size="small" onClick={() => setKey("")}>
              清除已保存密钥
            </Button>
            <Collapse
              items={[
                {
                  key: "advanced",
                  label: "高级设置",
                  children: (
                    <div className="agent-settings-grid">
                      <label>
                        上下文长度
                        <InputNumber
                          aria-label="上下文长度"
                          min={8192}
                          max={2000000}
                          value={config.context_window}
                          onChange={(value) =>
                            setConfig({
                              ...config,
                              context_window: value ?? 128000,
                            })
                          }
                        />
                      </label>
                      <label>
                        最大输出长度
                        <InputNumber
                          aria-label="最大输出长度"
                          min={256}
                          max={200000}
                          value={config.max_tokens}
                          onChange={(value) =>
                            setConfig({ ...config, max_tokens: value ?? 8192 })
                          }
                        />
                      </label>
                      <label className="agent-full-width">
                        Node 绝对路径
                        <Input
                          aria-label="Node 绝对路径"
                          placeholder="留空使用系统 PATH 中的 Node.js"
                          value={config.node_path}
                          onChange={(e) =>
                            setConfig({ ...config, node_path: e.target.value })
                          }
                        />
                      </label>
                    </div>
                  ),
                },
              ]}
            />
            <p className="muted">
              每个工作流保留独立会话。模型密钥由本机服务保存，页面不会读取完整密钥。
            </p>
            {result && <Alert type="success" title={result} showIcon />}
            <footer>
              <Button
                disabled={busy || !runtime?.ready}
                onClick={() =>
                  run(async () => {
                    setResult("");
                    await api("/agent/check", "POST", {});
                    setResult("连接成功：流式响应和工具调用验证通过。");
                  })
                }
              >
                <Check size={15} />
                测试已保存配置
              </Button>
              <Button disabled={busy} type="submit" className="primary">
                <Save size={15} />
                保存模型配置
              </Button>
            </footer>
          </form>
        )}
      </section>
    </>
  );
}
