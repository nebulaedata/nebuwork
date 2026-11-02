import { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Descriptions,
  Input,
  Radio,
  Table,
  Tag,
  Typography,
} from "antd";
import { Box, Download, RefreshCw } from "lucide-react";
import { api, date, uuid } from "./api";
import type {
  EnvironmentInfo,
  EnvironmentOperation,
  EnvironmentRecord,
  PythonPackage,
  WorkflowEnvironmentState,
} from "./types";
import { Button, Empty, ErrorNotice, Modal, useJob } from "./ui";

const labels: Record<string, string> = {
  not_created: "尚未创建",
  creating: "创建中",
  installing: "安装中",
  rebuilding: "重建中",
  ready: "已就绪",
  needs_repair: "待修复",
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  interrupted: "已中断",
  create: "创建环境",
  install: "安装依赖",
  rebuild: "重建环境",
};
const changing = (state: string) =>
  ["creating", "installing", "rebuilding"].includes(state);

export function EnvironmentSummary({
  value,
  empty = "环境未记录",
}: {
  value?: EnvironmentRecord | null;
  empty?: string;
}) {
  if (!value) return <span className="muted">{empty}</span>;
  return (
    <div className="environment-summary">
      <Tag>{value.mode === "isolated" ? "独立环境" : "共享环境"}</Tag>
      <span>Python {value.python_version}</span>
      <Typography.Text code copyable>
        {value.interpreter}
      </Typography.Text>
      <small className="muted">
        环境版本 {value.id.slice(0, 16)} · {value.package_count} 个包
      </small>
    </div>
  );
}

function Packages({
  info,
  busy,
  refresh,
}: {
  info: EnvironmentInfo | null;
  busy: boolean;
  refresh: () => void;
}) {
  const [query, setQuery] = useState("");
  return (
    <div className="environment-packages">
      {info && (
        <Descriptions
          size="small"
          column={1}
          items={[
            {
              key: "python",
              label: "Python 版本",
              children: info.python_version,
            },
            {
              key: "interpreter",
              label: "解释器",
              children: (
                <Typography.Text code copyable>
                  {info.interpreter}
                </Typography.Text>
              ),
            },
          ]}
        />
      )}
      <div className="list-toolbar">
        <Input
          aria-label="搜索 Python 包"
          placeholder="搜索包名…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          allowClear
          style={{ maxWidth: 320 }}
        />
        <div>
          <span className="muted">共 {info?.package_count ?? 0} 个包</span>
          <Button disabled={busy} onClick={refresh}>
            <RefreshCw size={14} />
            刷新包列表
          </Button>
        </div>
      </div>
      <Table<PythonPackage>
        size="small"
        rowKey="name"
        loading={busy}
        pagination={{
          pageSize: 15,
          showSizeChanger: false,
          hideOnSinglePage: true,
        }}
        dataSource={(info?.packages ?? []).filter((p) =>
          p.name.toLowerCase().includes(query.toLowerCase()),
        )}
        columns={[
          {
            title: "包名称",
            dataIndex: "name",
            sorter: (a, b) => a.name.localeCompare(b.name),
          },
          { title: "已安装版本", dataIndex: "version" },
        ]}
        locale={{ emptyText: "暂无匹配的已安装包" }}
      />
      {info && (
        <small className="muted">
          读取时间：{date(info.observed_at)} · 列表不包含 Python 标准库
        </small>
      )}
    </div>
  );
}

export function SharedEnvironment({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const [info, setInfo] = useState<EnvironmentInfo | null>(null);
  const { error, setError, busy, run } = useJob();
  const load = () =>
    run(async () => setInfo(await api<EnvironmentInfo>("/environment/shared")));
  useEffect(() => {
    load();
  }, []);
  return (
    <>
      {!embedded && (
        <div className="page-heading">
          <div>
            <h1>Python 环境</h1>
            <p className="muted">查看共享解释器与已安装依赖。</p>
          </div>
        </div>
      )}
      <section className={embedded ? "" : "panel environment-panel"}>
        <Alert
          type="info"
          showIcon
          title="共享环境"
          description="所有选择共享环境的工作流共同使用。这里仅查看包列表；工作流专属依赖可在其「执行环境」中安装。"
        />
        <ErrorNotice message={error} clear={() => setError("")} />
        <Packages info={info} busy={busy} refresh={load} />
      </section>
    </>
  );
}

function OperationDetails({
  id,
  close,
  retry,
  changed,
}: {
  id: string;
  close: () => void;
  retry: (operation: EnvironmentOperation) => void;
  changed: () => void;
}) {
  const [operation, setOperation] = useState<EnvironmentOperation | null>(null);
  const [logs, setLogs] = useState("");
  const [error, setError] = useState("");
  const changedRef = useRef(changed);
  changedRef.current = changed;
  useEffect(() => {
    let alive = true,
      cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<EnvironmentOperation>(
          `/environment/operations/${id}?after=${cursor}`,
        );
        if (!alive) return;
        cursor = result.cursor;
        setOperation(result);
        setLogs((old) => old + result.log);
        if (["queued", "running"].includes(result.state) || result.has_more)
          timer = setTimeout(poll, 700);
        else changedRef.current();
      } catch (e) {
        if (alive) setError(String(e instanceof Error ? e.message : e));
      }
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id]);
  return (
    <Modal title="环境操作记录" wide close={close}>
      <ErrorNotice message={error} clear={() => setError("")} />
      {operation && (
        <>
          <p>
            {labels[operation.kind]} <Tag>{labels[operation.state]}</Tag>{" "}
            <span className="muted">{date(operation.created_at)}</span>
          </p>
          {operation.request.requirements ? (
            <details>
              <summary>安装使用的 requirements.txt 快照</summary>
              <pre>{operation.request.requirements_content}</pre>
            </details>
          ) : (
            operation.request.packages.length > 0 && (
              <p>安装请求：{operation.request.packages.join("，")}</p>
            )
          )}
          {operation.error && (
            <Alert
              type="error"
              showIcon
              title="操作未完成，请查看日志后重试或重建"
            />
          )}
        </>
      )}
      <pre className="environment-log" aria-label="安装日志">
        {logs || "等待操作日志…"}
      </pre>
      <footer>
        {operation && ["failed", "interrupted"].includes(operation.state) && (
          <Button onClick={() => retry(operation)}>重试此操作</Button>
        )}
        <Button onClick={close}>关闭</Button>
      </footer>
    </Modal>
  );
}

export function WorkflowEnvironment({
  id,
  revision,
  dirty,
  changed,
}: {
  id: string;
  revision: string;
  dirty: boolean;
  changed: () => Promise<void>;
}) {
  const { modal } = App.useApp();
  const [state, setState] = useState<WorkflowEnvironmentState | null>(null);
  const [info, setInfo] = useState<EnvironmentInfo | null>(null);
  const [packages, setPackages] = useState("");
  const [method, setMethod] = useState("packages");
  const [operationId, setOperationId] = useState<string | null>(null);
  const [selection, setSelection] = useState<"shared" | "isolated" | null>(
    null,
  );
  const { busy, error, setError, run } = useJob();
  const load = async () =>
    setState(
      await api<WorkflowEnvironmentState>(`/workflows/${id}/environment`),
    );
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api<WorkflowEnvironmentState>(
          `/workflows/${id}/environment`,
        );
        if (alive) setState(value);
      } catch (e) {
        if (alive) setError(String(e instanceof Error ? e.message : e));
      }
      if (alive) timer = setTimeout(poll, 1500);
    };
    poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [id, setError]);
  const refreshPackages = async () =>
    setInfo(
      await api<EnvironmentInfo>(`/workflows/${id}/environment/packages`),
    );
  useEffect(() => {
    if (state?.current && !changing(state.state)) run(refreshPackages);
  }, [state?.version]);
  if (!state)
    return (
      <>
        <ErrorNotice message={error} clear={() => setError("")} />
        <Empty>正在读取执行环境…</Empty>
      </>
    );
  const locked = changing(state.state) || state.occupants.length > 0;
  const submit = (
    kind: "create" | "install" | "rebuild",
    list: string[] = [],
    requirements = false,
  ) =>
    run(async () => {
      const result = await api<EnvironmentOperation>(
        `/workflows/${id}/environment/operations`,
        "POST",
        {
          kind,
          expected_version: state.version,
          command_id: uuid(),
          packages: list,
          requirements,
        },
      );
      setOperationId(result.id);
      await load();
    });
  const rebuild = () =>
    modal.confirm({
      title: "重建独立环境",
      content:
        "将创建一个干净环境，需要重新安装依赖。旧环境目录和执行历史保留；本工作流当前不能有占用环境的任务。",
      okText: "创建干净环境",
      cancelText: "取消",
      onOk: () => submit("rebuild"),
    });
  return (
    <div className="environment-panel">
      <div className="environment-section">
        <h2>
          <Box size={17} /> 任务执行环境
        </h2>
        <Radio.Group
          aria-label="执行环境选择"
          value={selection ?? state.mode}
          disabled={busy || dirty}
          options={[
            { label: "共享环境", value: "shared" },
            { label: "工作流独立环境", value: "isolated" },
          ]}
          onChange={(e) => setSelection(e.target.value)}
        />
        <Button
          className="environment-save"
          disabled={
            busy || dirty || selection === null || selection === state.mode
          }
          onClick={() =>
            run(async () => {
              await api(`/workflows/${id}/environment`, "PUT", {
                mode: selection,
                expected_revision: revision,
              });
              await changed();
              await load();
              setSelection(null);
            })
          }
        >
          保存环境选择
        </Button>
        <p className="muted">
          人工开始、恢复或重跑时固定环境。运行中的任务与自动重试继续使用本轮环境。
        </p>
        {dirty && (
          <Alert type="warning" title="请先保存流程修改，再切换环境。" />
        )}
        <ErrorNotice message={error} clear={() => setError("")} />
      </div>
      {state.mode === "shared" && <SharedEnvironment embedded />}
      <div className="environment-section">
        <div className="environment-title">
          <h2>
            工作流专属环境{" "}
            <Tag
              color={
                state.state === "ready"
                  ? "success"
                  : state.state === "needs_repair"
                    ? "warning"
                    : "default"
              }
            >
              {labels[state.state]}
            </Tag>
          </h2>
          <div className="heading-actions">
            <Button onClick={() => run(load)} disabled={busy}>
              <RefreshCw size={14} />
              刷新状态
            </Button>
            {!state.current ? (
              <Button
                className="primary"
                disabled={busy || locked}
                onClick={() => submit("create")}
              >
                创建独立环境
              </Button>
            ) : (
              <Button disabled={busy || locked} onClick={rebuild}>
                重建环境
              </Button>
            )}
          </div>
        </div>
        {state.error && (
          <Alert
            type="warning"
            showIcon
            title="环境需要人工处理"
            description="安装或创建未正常完成，请查看操作记录，修复后重试或重建。"
          />
        )}
        {state.occupants.length > 0 && (
          <Alert
            type="info"
            title="环境正在被任务占用，暂停并等待步骤收尾后才能安装"
            description={
              <div>
                {state.occupants.map((t) => (
                  <a
                    key={t.id}
                    href={`#task/${t.id}`}
                    className="environment-task-link"
                  >
                    {t.id.slice(0, 12)}
                  </a>
                ))}
              </div>
            }
          />
        )}
        {state.current ? (
          <>
            <div className="environment-install">
              <h3>安装依赖</h3>
              <Radio.Group
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                options={[
                  { label: "按包名安装", value: "packages" },
                  { label: "requirements.txt", value: "requirements" },
                ]}
              />
              {method === "packages" ? (
                <Input.TextArea
                  aria-label="安装包列表"
                  value={packages}
                  onChange={(e) => setPackages(e.target.value)}
                  placeholder={
                    "每行一个包或版本约束，例如：\nrequests==2.32.5\npandas"
                  }
                  rows={3}
                />
              ) : (
                <p className="muted">
                  安装工作流源码目录内已保存的
                  requirements.txt。可在「步骤代码」中创建和编辑该文件。
                </p>
              )}
              <Button
                className="primary"
                disabled={
                  busy || locked || (method === "packages" && !packages.trim())
                }
                onClick={() =>
                  submit(
                    "install",
                    method === "packages"
                      ? packages
                          .split(/\r?\n/)
                          .map((p) => p.trim())
                          .filter(Boolean)
                      : [],
                    method === "requirements",
                  )
                }
              >
                <Download size={14} />
                安装依赖
              </Button>
              <small className="muted">
                按包名安装不会改写 requirements.txt。包列表与安装记录会保留。
              </small>
            </div>
            <Packages
              info={info}
              busy={busy || changing(state.state)}
              refresh={() => run(refreshPackages)}
            />
          </>
        ) : (
          <p className="muted">
            使用服务当前 Python 版本创建；不会继承共享环境的第三方包。
          </p>
        )}
      </div>
      <div className="environment-section">
        <h2>环境操作记录</h2>
        <Table<EnvironmentOperation>
          rowKey="id"
          size="small"
          dataSource={state.operations}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
          columns={[
            {
              title: "操作",
              dataIndex: "kind",
              render: (value) => labels[value],
            },
            {
              title: "状态",
              dataIndex: "state",
              render: (value) => <Tag>{labels[value]}</Tag>,
            },
            { title: "创建时间", dataIndex: "created_at", render: date },
            {
              title: "日志",
              key: "log",
              render: (_, record) => (
                <Button onClick={() => setOperationId(record.id)}>
                  查看日志
                </Button>
              ),
            },
          ]}
        />
      </div>
      {operationId && (
        <OperationDetails
          key={operationId}
          id={operationId}
          close={() => setOperationId(null)}
          changed={() => run(load)}
          retry={(op) => {
            setOperationId(null);
            if (op.kind === "rebuild") rebuild();
            else submit(op.kind, op.request.packages, op.request.requirements);
          }}
        />
      )}
    </div>
  );
}
