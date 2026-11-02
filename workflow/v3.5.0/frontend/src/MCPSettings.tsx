import { useEffect, useState } from "react";
import {
  Alert,
  App,
  Collapse,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Segmented,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { Check, Copy, Play, Plug, RefreshCw, Save, Square } from "lucide-react";
import { api, pretty, uuid } from "./api";
import { Button, ErrorNotice, useJob } from "./ui";

type Tool = {
  name: string;
  description: string;
  input_schema: unknown;
  read_only: boolean;
};
type MCPInfo = {
  installed: boolean;
  sdk_version: string | null;
  dependency_error: string | null;
  python: string;
  working_directory: string;
  platform: string;
  api_url: string;
  default_port: number;
  tools: Tool[];
  guide: string;
  service: Service;
};
type Service = {
  port: number;
  version: number;
  state: "stopped" | "starting" | "running" | "failed";
  pid: number | null;
  error: string | null;
  config_error: string | null;
  log: string;
  log_truncated: boolean;
};
const serviceStates = {
  stopped: { label: "已停止", color: "default" },
  starting: { label: "启动中", color: "processing" },
  running: { label: "运行中", color: "success" },
  failed: { label: "启动失败或异常退出", color: "error" },
};
type Connection = {
  connected: boolean;
  url: string;
  server: { name: string; version: string } | null;
  error: string | null;
};

function CopyBlock({ label, value }: { label: string; value: string }) {
  const { message } = App.useApp();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setCopied(false);
  }, [value]);
  return (
    <div className="mcp-copy-block">
      <div className="mcp-block-heading">
        <strong>{label}</strong>
        <Button
          size="small"
          aria-label={`复制${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              message.error("复制失败，请选中文本手动复制。");
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "已复制" : "复制"}
        </Button>
      </div>
      <pre aria-label={label} tabIndex={0}>
        {value}
      </pre>
    </div>
  );
}

export function MCPSettings() {
  const [info, setInfo] = useState<MCPInfo | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [statusError, setStatusError] = useState("");
  const [transport, setTransport] = useState("http");
  const [port, setPort] = useState<number | null>(8766);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [checking, setChecking] = useState(false);
  const [query, setQuery] = useState("");
  const { error, setError, busy, run } = useJob();
  const updateService = (next: Service) =>
    setService((previous) =>
      previous && previous.version > next.version ? previous : next,
    );
  const load = () =>
    run(async () => {
      try {
        const next = await api<MCPInfo>("/mcp/info");
        if (!next.service) throw new Error("Not Found");
        setInfo(next);
        setService(next.service);
        setPort(next.service.port);
        setStatusError("");
        setConnection(null);
      } catch (e) {
        if (e instanceof Error && e.message === "Not Found") {
          throw new Error(
            "当前服务尚未加载 MCP 页面接口。请在 PyCharm 中重启 Workflow 服务，再刷新页面。",
          );
        }
        throw e;
      }
    });
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!info) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<Service>("/mcp/service");
        if (active) {
          updateService(next);
          setStatusError("");
        }
      } catch {
        if (active) setStatusError("暂时无法获取 MCP 状态，正在重连…");
      } finally {
        if (active) timer = setTimeout(poll, 1200);
      }
    };
    timer = setTimeout(poll, 1200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [info]);
  const control = (action: "config" | "start" | "stop") =>
    run(async () => {
      if (!service) return;
      setConnection(null);
      try {
        const next = await api<Service>(
          `/mcp/service/${action}`,
          action === "config" ? "PUT" : "POST",
          {
            expected_version: service.version,
            command_id: uuid(),
            ...(action === "config" ? { port } : {}),
          },
        );
        updateService(next);
        if (action === "config") setPort(next.port);
      } catch (e) {
        // Refresh the revision after a competing command without losing draft input.
        try {
          updateService(await api<Service>("/mcp/service"));
        } catch {
          /* keep the original error */
        }
        throw e;
      }
    });
  const active = service?.state === "starting" || service?.state === "running";
  const dirty = service && (port !== service.port || !!service.config_error);
  const controlsDisabled = busy || checking || !!statusError || !service;
  const validPort =
    port !== null && Number.isInteger(port) && port > 0 && port <= 65535;
  const mcpUrl = `http://127.0.0.1:${port ?? "端口"}/mcp`;
  const windows = info?.platform === "windows";
  const quote = (s: string) =>
    windows
      ? `'${s.replaceAll("'", "''")}'`
      : `'${s.replaceAll("'", "'\\''")}'`;
  const prefix = windows ? "& " : "";
  const moduleCommand = info
    ? `${prefix}${quote(info.python)} -m nebulae --url ${quote(info.api_url)} mcp`
    : "";
  const httpCommand = validPort
    ? `${moduleCommand} --transport streamable-http --port ${port}`
    : "请填写有效端口";
  const config = info
    ? transport === "http"
      ? { mcpServers: { "nebulae-workflow": { url: mcpUrl } } }
      : {
          mcpServers: {
            "nebulae-workflow": {
              command: info.python,
              args: ["-m", "nebulae", "--url", info.api_url, "mcp"],
              cwd: info.working_directory,
            },
          },
        }
    : {};
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>MCP 接入</h1>
          <p className="muted">
            连接你的智能体，让它协助编排流程、编辑代码和管理任务。
          </p>
        </div>
        <Button disabled={busy} onClick={load}>
          <RefreshCw size={15} />
          刷新接入信息
        </Button>
      </div>
      <ErrorNotice message={error} clear={() => setError("")} />
      {!info && !error && (
        <div className="panel mcp-panel">正在读取接入信息…</div>
      )}
      {info && (
        <div className="mcp-layout">
          <section className="panel mcp-panel">
            <div className="mcp-section-heading">
              <h2>
                <Plug size={17} />
                连接设置
              </h2>
              <Tag color={info.installed ? "success" : "warning"}>
                {info.installed
                  ? `MCP 依赖已安装 · ${info.sdk_version}`
                  : "MCP 依赖未就绪"}
              </Tag>
            </div>
            {!info.installed && (
              <Alert
                type="warning"
                showIcon
                title="需要安装 MCP 依赖"
                description={info.dependency_error}
              />
            )}
            {!info.installed && (
              <CopyBlock
                label="安装命令"
                value="uv sync --extra server --extra dev --extra mcp"
              />
            )}
            <Descriptions
              size="small"
              column={1}
              items={[
                {
                  key: "api",
                  label: "Workflow 服务",
                  children: (
                    <Typography.Text code copyable>
                      {info.api_url}
                    </Typography.Text>
                  ),
                },
                {
                  key: "python",
                  label: "Python 解释器",
                  children: (
                    <Typography.Text code copyable>
                      {info.python}
                    </Typography.Text>
                  ),
                },
                {
                  key: "cwd",
                  label: "启动工作目录",
                  children: (
                    <Typography.Text code copyable>
                      {info.working_directory}
                    </Typography.Text>
                  ),
                },
              ]}
            />
            <Segmented
              aria-label="MCP 连接方式"
              value={transport}
              onChange={(v) => setTransport(String(v))}
              options={[
                { label: "Streamable HTTP", value: "http" },
                { label: "stdio", value: "stdio" },
              ]}
            />
            {transport === "http" ? (
              <>
                <p className="muted">
                  保存端口后点击启动，再将下方地址填入智能体。配置会保留；Workflow
                  服务重启后，MCP 保持停止，需手动启动。
                </p>
                {service && (
                  <Space wrap className="mcp-result">
                    <strong>页面管理的 HTTP 服务</strong>
                    <Tag color={serviceStates[service.state].color}>
                      {serviceStates[service.state].label}
                    </Tag>
                    {service.pid && (
                      <Typography.Text type="secondary">
                        PID {service.pid}
                      </Typography.Text>
                    )}
                  </Space>
                )}
                {(statusError || service?.error || service?.config_error) && (
                  <Alert
                    className="mcp-result"
                    showIcon
                    type={statusError ? "warning" : "error"}
                    title={
                      statusError || service?.config_error || service?.error
                    }
                  />
                )}
                <Form layout="vertical" className="mcp-connection-form">
                  <Form.Item
                    label="MCP 端口"
                    validateStatus={validPort ? "" : "error"}
                    help={!validPort ? "请输入 1–65535 之间的整数" : undefined}
                  >
                    <InputNumber
                      aria-label="MCP 端口"
                      disabled={controlsDisabled || active}
                      value={port}
                      min={1}
                      max={65535}
                      precision={0}
                      onChange={(value) => {
                        setPort(value);
                        setConnection(null);
                      }}
                    />
                  </Form.Item>
                  <Form.Item label="MCP 地址">
                    <Input aria-label="MCP 地址" readOnly value={mcpUrl} />
                  </Form.Item>
                </Form>
                <Space wrap>
                  <Button
                    disabled={
                      controlsDisabled || active || !validPort || !dirty
                    }
                    onClick={() => control("config")}
                  >
                    <Save size={15} />
                    保存配置
                  </Button>
                  <Button
                    className="primary"
                    disabled={
                      controlsDisabled ||
                      active ||
                      !!dirty ||
                      !validPort ||
                      !info.installed
                    }
                    onClick={() => control("start")}
                  >
                    <Play size={15} />
                    启动 MCP
                  </Button>
                  <Button
                    disabled={controlsDisabled || !active}
                    onClick={() => control("stop")}
                  >
                    <Square size={15} />
                    停止 MCP
                  </Button>
                  {dirty && (
                    <Typography.Text type="secondary">
                      端口尚未保存
                    </Typography.Text>
                  )}
                </Space>
                <p className="muted">
                  修改端口前请先停止。停止 MCP
                  只断开智能体接入，已提交的任务继续执行。终端或智能体自行启动的实例由原启动方关闭。
                </p>
                <Space wrap>
                  <Button
                    disabled={!validPort || checking}
                    onClick={async () => {
                      setChecking(true);
                      setConnection(null);
                      try {
                        setConnection(
                          await api<Connection>("/mcp/check", "POST", { port }),
                        );
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setChecking(false);
                      }
                    }}
                  >
                    {checking ? "检测中…" : "检测连接"}
                  </Button>
                  <Tag
                    color={
                      connection
                        ? connection.connected
                          ? "success"
                          : "warning"
                        : "default"
                    }
                  >
                    {connection
                      ? connection.connected
                        ? "MCP 服务可连接"
                        : "MCP 服务未连接"
                      : "连接尚未检测"}
                  </Tag>
                  {validPort && (
                    <Typography.Text copyable={{ text: mcpUrl }}>
                      复制地址
                    </Typography.Text>
                  )}
                </Space>
                {connection && (
                  <Alert
                    className="mcp-result"
                    showIcon
                    type={connection.connected ? "success" : "warning"}
                    title={
                      connection.connected
                        ? `${connection.server?.name} · ${connection.server?.version}`
                        : "连接未成功"
                    }
                    description={
                      connection.connected
                        ? "MCP 协议连接正常，可以在智能体中添加此地址。"
                        : connection.error
                    }
                  />
                )}
                {service?.log && (
                  <Collapse
                    className="mcp-result"
                    items={[
                      {
                        key: "log",
                        label: service.log_truncated
                          ? "启动日志（最近 16 KiB）"
                          : "启动日志",
                        children: (
                          <pre className="mcp-schema">{service.log}</pre>
                        ),
                      },
                    ]}
                  />
                )}
                <CopyBlock label="启动命令" value={httpCommand} />
                <p className="muted">
                  也可在上方工作目录中手动执行（
                  {windows ? "PowerShell" : "终端"}），或用 PyCharm 运行
                  start_mcp.py（默认端口
                  8766）。使用页面启动时无需再运行该命令。
                </p>
              </>
            ) : (
              <>
                <Alert
                  className="mcp-result"
                  type="info"
                  showIcon
                  title="由智能体启动 MCP 子进程"
                  description="把下方配置加入智能体的 MCP 设置。Workflow 服务保持运行；stdio 不使用 HTTP MCP 端口，无需另开 start_mcp.py。"
                />
              </>
            )}
            {(transport === "stdio" || validPort) && (
              <CopyBlock label="智能体配置" value={pretty(config)} />
            )}
            <p className="muted">
              配置为通用 mcpServers
              格式，复制后填入所用客户端。页面不会自动改写智能体配置；连接和检测均不会执行工作流。
            </p>
          </section>
          <section className="panel mcp-panel">
            <div className="mcp-section-heading">
              <h2>智能体可以做什么</h2>
              <Tag>{info.tools.length} 个工具</Tag>
            </div>
            <p className="muted">
              流程与源码管理、任务执行和重跑、日志与产物查询、Python 环境管理。
            </p>
            <Input
              aria-label="搜索 MCP 工具"
              placeholder="搜索工具名称或用途…"
              allowClear
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Table<Tool>
              rowKey="name"
              size="small"
              className="mcp-tools"
              scroll={{ x: 460 }}
              dataSource={info.tools.filter((tool) =>
                `${tool.name} ${tool.description}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )}
              pagination={{
                pageSize: 8,
                showSizeChanger: false,
                hideOnSinglePage: true,
              }}
              expandable={{
                expandedRowRender: (tool) => (
                  <>
                    <p className="mcp-tool-description">{tool.description}</p>
                    <pre className="mcp-schema">
                      {pretty(tool.input_schema)}
                    </pre>
                  </>
                ),
              }}
              columns={[
                {
                  title: "工具",
                  dataIndex: "name",
                  render: (name: string) => <code>{name}</code>,
                },
                {
                  title: "类型",
                  width: 90,
                  render: (_, tool) => (
                    <Tag>{tool.read_only ? "只读" : "操作"}</Tag>
                  ),
                },
              ]}
              locale={{
                emptyText: info.installed
                  ? "没有匹配的工具"
                  : "安装 MCP 依赖后可查看工具清单",
              }}
            />
            <Collapse
              items={[
                {
                  key: "guide",
                  label: "步骤开发与智能体操作指南",
                  children: <pre className="mcp-guide">{info.guide}</pre>,
                },
              ]}
            />
          </section>
        </div>
      )}
    </>
  );
}
