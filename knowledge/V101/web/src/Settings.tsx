import { useEffect, useState, useRef } from "react";
import {
  Button,
  Dialog,
  Input,
  InputNumber,
  Select,
  Table,
  Tabs,
  MessagePlugin,
  Upload,
  Checkbox,
  Switch,
  Tag,
} from "tdesign-react";
import {
  DefaultParserSettings,
  ParserServiceSettings,
} from "./ProcessingSettings";
import { ModelConnections, emptyConnection } from "./ModelConnections";
import { AppearanceSettings } from "./AppearanceSettings";
import { QASettings } from "./QA";
import { AddIcon } from "tdesign-icons-react";
const TabPanel = Tabs.TabPanel;
import { api, send, Row, purposeOptions, supportsPurpose } from "./api";
import { action, confirmDelete, ErrorNotice, useData } from "./ui";
const emptyModel = {
  name: "",
  connection_id: "",
  purpose: "text",
  protocol: "openai",
  base_url: "",
  model_name: "",
  api_key: "",
  dimension: null,
  config: { allow_image_input: false },
};
export function Settings() {
  const models = useData<Row[]>("/models");
  const connections = useData<Row[]>("/model-connections");
  const [connectionManager, setConnectionManager] = useState(false);
  const [connectionEdit, setConnectionEdit] = useState<Row | null>(null);
  const bindings = useData<Row>("/settings/model-bindings");
  const [edit, setEdit] = useState<Row | null>(null);
  const [sample, setSample] = useState<Row | null>(null);
  const [testResult, setTestResult] = useState<Row | null>(null);
  const [testingText, setTestingText] = useState(false);
  const [bound, setBound] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [modelNames, setModelNames] = useState<string[]>([]);
  const [discoveryError, setDiscoveryError] = useState("");
  const discoverySequence = useRef(0);
  useEffect(() => {
    discoverySequence.current++;
    setDiscovering(false);
    setModelNames([]);
    setDiscoveryError("");
  }, [edit?.id, !!edit]);
  async function discover() {
    if (!edit) return;
    setDiscovering(true);
    setDiscoveryError("");
    const snapshot = edit;
    const sequence = ++discoverySequence.current;
    try {
      const result = await send("/models/discover", {
        id: edit.id,
        connection_id: edit.connection_id || "",
        base_url: edit.base_url,
        api_key: edit.api_key,
        clear_api_key: !!edit.clear_api_key,
      });
      if (sequence !== discoverySequence.current) return;
      setEdit((current) => {
        if (
          !current ||
          current.id !== snapshot.id ||
          current.connection_id !== snapshot.connection_id ||
          current.base_url !== snapshot.base_url ||
          current.api_key !== snapshot.api_key
        )
          return current;
        return { ...current, base_url: result.base_url };
      });
      setModelNames(result.models);
      if (result.models.length === 0)
        setDiscoveryError("服务返回的模型列表为空，可手动输入模型名称。");
      else MessagePlugin.success(`已获取 ${result.models.length} 个模型`);
    } catch (e) {
      if (sequence === discoverySequence.current)
        setDiscoveryError((e as Error).message);
    } finally {
      if (sequence === discoverySequence.current) setDiscovering(false);
    }
  }
  useEffect(() => {
    if (bindings.data) setBound(bindings.data);
  }, [bindings.data]);
  async function saveModel() {
    if (!edit) return;
    setBusy(true);
    try {
      const body = {
        name: edit.name,
        connection_id: edit.connection_id || "",
        purpose: edit.purpose,
        protocol: edit.protocol,
        base_url: edit.base_url,
        model_name: edit.model_name,
        api_key: edit.api_key,
        clear_api_key: !!edit.clear_api_key,
        dimension: edit.dimension || null,
        config: edit.config || {},
      };
      const saved = await send(
        "/models" + (edit.id ? "/" + edit.id : ""),
        body,
        edit.id ? "PUT" : "POST",
      );
      setEdit(null);
      models.reload();
      bindings.reload();
      connections.reload();
      MessagePlugin.success(
        saved.purpose_changed
          ? "模型用途已修改，绑定已按兼容关系更新"
          : "模型已保存",
      );
    } catch (e) {
      MessagePlugin.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-layout">
      <div className="page-heading">
        <div>
          <h1>设置</h1>
          <p className="subtitle">管理模型、默认处理方式和后台外观。</p>
        </div>
      </div>
      <ErrorNotice
        message={models.error || connections.error || bindings.error}
      />
      <div className="section">
        <Tabs defaultValue="models">
          <TabPanel value="qa" label="知识库问答"><QASettings /></TabPanel>
          <TabPanel value="models" label="模型">
            <div className="tab-content">
              <div className="toolbar">
                <div>
                  <h2>模型服务</h2>
                  <p className="help">
                    先保存服务连接，再选择地址快速添加模型，自动复用连接的 API
                    Key。
                  </p>
                </div>
                <div className="responsive-stack">
                  <Button
                    variant="outline"
                    onClick={() => setConnectionManager(true)}
                  >
                    服务连接管理
                  </Button>
                  <Button
                    icon={<AddIcon />}
                    onClick={() => setEdit({ ...emptyModel })}
                  >
                    添加模型
                  </Button>
                </div>
              </div>
              <Table
                tableContentWidth="max(100%, 850px)"
                rowKey="id"
                data={models.data || []}
                empty="尚未配置模型"
                columns={[
                  { colKey: "name", title: "名称", ellipsis: true },
                  {
                    colKey: "purpose",
                    title: "用途",
                    width: 190,
                    cell: ({ row }) => (
                      <div className="model-purpose-cell">
                        <span>
                          {purposeOptions.find((p) => p.value === row.purpose)
                            ?.label || row.purpose}
                        </span>
                        {row.purpose === "text" && (
                          <Tag
                            size="small"
                            theme={
                              row.config?.allow_image_input === true
                                ? "success"
                                : "default"
                            }
                            variant="light"
                          >
                            {row.config?.allow_image_input === true
                              ? "允许图片"
                              : "仅文本"}
                          </Tag>
                        )}
                      </div>
                    ),
                  },
                  {
                    colKey: "model_name",
                    title: "服务模型标识",
                    ellipsis: true,
                  },
                  {
                    colKey: "connection_name",
                    title: "服务连接",
                    ellipsis: true,
                    cell: ({ row }) => row.connection_name || "手动配置",
                  },
                  {
                    colKey: "has_api_key",
                    title: "凭证",
                    width: 90,
                    cell: ({ row }) => (row.has_api_key ? "已保存" : "未设置"),
                  },
                  {
                    colKey: "actions",
                    title: "操作",
                    width: 210,
                    cell: ({ row }) => (
                      <>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => {
                            setTestResult(null);
                            if (
                              [
                                "asr",
                                "vision",
                                "multimodal_embedding",
                              ].includes(row.purpose) ||
                              (row.purpose === "text" &&
                                row.config?.allow_image_input === true)
                            )
                              setSample(row);
                            else
                              action(async () =>
                                setTestResult(
                                  await send("/models/" + row.id + "/test", {}),
                                ),
                              );
                          }}
                        >
                          测试
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() =>
                            setEdit({
                              ...row,
                              connection_id: row.connection_id || "",
                              original_purpose: row.purpose,
                              api_key: "",
                            })
                          }
                        >
                          编辑
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          theme="danger"
                          onClick={() =>
                            confirmDelete(
                              row.name,
                              () =>
                                api("/models/" + row.id, { method: "DELETE" }),
                              models.reload,
                            )
                          }
                        >
                          删除
                        </Button>
                      </>
                    ),
                  },
                ]}
              />
              <div className="settings-group" style={{ marginTop: 16 }}>
                <h2>默认用途绑定</h2>
                <p className="help">
                  文本生成与目录核验可互相选用模型，也可绑定同一个模型。目录核验留空时继承文本生成绑定。
                </p>
                <div className="form-grid" style={{ marginTop: 12 }}>
                  {purposeOptions.map((p) => (
                    <label className="field" key={p.value}>
                      <span className="field-label">{p.label}</span>
                      <Select
                        clearable
                        value={bound[p.value] || ""}
                        options={(models.data || [])
                          .filter((m) => supportsPurpose(m.purpose, p.value))
                          .map((m) => ({
                            value: m.id,
                            label: ["text", "outline"].includes(p.value)
                              ? `${m.name} · ${purposeOptions.find((option) => option.value === m.purpose)?.label}`
                              : m.name,
                          }))}
                        placeholder="选择模型"
                        onChange={(value) =>
                          setBound({ ...bound, [p.value]: value || null })
                        }
                      />
                    </label>
                  ))}
                </div>
                <div className="form-actions">
                  <Button
                    onClick={() =>
                      action(
                        () => send("/settings/model-bindings", bound, "PUT"),
                        bindings.reload,
                      )
                    }
                  >
                    保存模型绑定
                  </Button>
                </div>
              </div>
            </div>
          </TabPanel>
          <TabPanel
            value="formats"
            label="文件格式与引擎"
            destroyOnHide={false}
            lazy
          >
            <DefaultParserSettings section="formats" />
          </TabPanel>
          <TabPanel
            value="parser-engines"
            label="解析引擎配置"
            destroyOnHide={false}
            lazy
          >
            <ParserServiceSettings />
          </TabPanel>
          <TabPanel
            value="strategy"
            label="解析策略"
            destroyOnHide={false}
            lazy
          >
            <DefaultParserSettings section="strategy" />
          </TabPanel>
          <TabPanel value="retrieval" label="检索默认设置">
            <RetrievalSettings />
          </TabPanel>
          <TabPanel value="appearance" label="外观" lazy>
            <AppearanceSettings />
          </TabPanel>
        </Tabs>
      </div>
      <ModelConnections
        connections={connections.data || []}
        error={connections.error}
        visible={connectionManager}
        onClose={() => setConnectionManager(false)}
        edit={connectionEdit}
        onEdit={setConnectionEdit}
        onReload={connections.reload}
        onSaved={(connection, selectForModel) => {
          models.reload();
          setEdit((current) =>
            current &&
            (selectForModel || current.connection_id === connection.id)
              ? {
                  ...current,
                  connection_id: connection.id,
                  base_url: connection.base_url,
                  api_key: "",
                  clear_api_key: false,
                  has_api_key: connection.has_api_key,
                }
              : current,
          );
          setModelNames([]);
          setDiscoveryError("");
        }}
      />
      <Dialog
        header={
          sample?.purpose === "text" ? "文本与图片输入测试" : "模型样本测试"
        }
        closeOnOverlayClick={false}
        visible={!!sample}
        onClose={() => {
          setSample(null);
          setTestResult(null);
        }}
        footer={false}
      >
        {sample?.purpose === "text" && (
          <Button
            variant="outline"
            loading={testingText}
            onClick={async () => {
              setTestingText(true);
              await action(async () =>
                setTestResult(await send("/models/" + sample.id + "/test", {})),
              );
              setTestingText(false);
            }}
          >
            文字测试
          </Button>
        )}
        <p className="help">
          {sample?.purpose === "asr"
            ? "选择不超过 25 MiB 的音频样本"
            : "选择不超过 20 MiB 的 PNG、JPEG 或 WebP 图片样本"}
          ，发送到已配置的模型服务验证实际输入与返回格式。
        </p>
        <Upload
          theme="file"
          requestMethod={async (files) => {
            const file = Array.isArray(files) ? files[0] : files;
            const form = new FormData();
            form.append("file", file.raw!);
            try {
              const result = await api("/models/" + sample!.id + "/test-file", {
                method: "POST",
                body: form,
              });
              setTestResult(result);
              return { status: "success" as const, response: {} };
            } catch (e) {
              return {
                status: "fail" as const,
                error: (e as Error).message,
                response: {},
              };
            }
          }}
        />
        {testResult && (
          <pre className="json">{JSON.stringify(testResult, null, 2)}</pre>
        )}
      </Dialog>
      <Dialog
        header="模型测试结果"
        visible={!!testResult && !sample}
        onClose={() => setTestResult(null)}
        footer={false}
      >
        <pre className="json">{JSON.stringify(testResult, null, 2)}</pre>
      </Dialog>
      <Dialog
        header={edit?.id ? "编辑模型" : "添加模型"}
        closeOnOverlayClick={false}
        top="6vh"
        className="processing-dialog"
        visible={!!edit}
        width={640}
        onClose={() => setEdit(null)}
        confirmBtn={{ content: "保存", loading: busy }}
        onConfirm={saveModel}
      >
        {edit && (
          <div className="field-stack">
            <div className="form-grid">
              <label className="field">
                <span className="field-label">显示名称</span>
                <Input
                  value={edit.name}
                  onChange={(v) => setEdit({ ...edit, name: v })}
                  placeholder="例如：中文向量模型"
                />
              </label>
              <label className="field">
                <span className="field-label">用途</span>
                <Select
                  value={edit.purpose}
                  options={purposeOptions}
                  onChange={(v) =>
                    setEdit({
                      ...edit,
                      purpose: v,
                      config: {
                        ...edit.config,
                        allow_image_input:
                          v === "text" &&
                          edit.config?.allow_image_input === true,
                      },
                      protocol:
                        v === "multimodal_embedding" ? "jina" : "openai",
                      dimension: ["embedding", "multimodal_embedding"].includes(
                        String(v),
                      )
                        ? edit.dimension
                        : null,
                    })
                  }
                />
              </label>
            </div>
            {edit.purpose === "text" && (
              <div className="field">
                <label className="model-image-toggle">
                  <Switch
                    aria-label="允许图片输入"
                    value={edit.config?.allow_image_input === true}
                    onChange={(allowed) =>
                      setEdit({
                        ...edit,
                        config: {
                          ...edit.config,
                          allow_image_input: !!allowed,
                        },
                      })
                    }
                  />
                  <span>允许图片输入</span>
                </label>
                <p className="help">
                  开启后可向该文本模型发送图片。请确认服务支持图片输入，保存后可通过“测试”上传图片验证。
                </p>
              </div>
            )}
            {edit.id && edit.original_purpose !== edit.purpose && (
              <p className="help">
                保存后会保留兼容绑定，清理不再匹配的默认用途和知识库绑定。文本生成与目录核验互相兼容，已有文件与索引保留。
              </p>
            )}
            <label className="field">
              <span className="field-label">协议</span>
              <Select
                value={edit.protocol}
                options={[
                  { value: "openai", label: "OpenAI 兼容协议" },
                  { value: "jina", label: "Jina 多模态向量" },
                ]}
                onChange={(v) => setEdit({ ...edit, protocol: v })}
              />
            </label>
            <label className="field">
              <span className="field-label">基础地址 / 服务连接</span>
              <div className="model-discovery">
                <Select
                  aria-label="基础地址 / 服务连接"
                  filterable
                  value={edit.connection_id || ""}
                  disabled={discovering}
                  options={[
                    { value: "", label: "手动填写地址与 Key" },
                    ...(connections.data || []).map((c) => ({
                      value: c.id,
                      label: c.name + " · " + c.base_url,
                    })),
                  ]}
                  onChange={(value) => {
                    const selected = connections.data?.find(
                      (c) => c.id === value,
                    );
                    setModelNames([]);
                    setDiscoveryError("");
                    setEdit({
                      ...edit,
                      connection_id: value || "",
                      base_url: selected?.base_url || edit.base_url,
                      api_key: "",
                      clear_api_key: false,
                      has_api_key: selected
                        ? selected.has_api_key
                        : !!edit.id && edit.has_api_key,
                    });
                  }}
                />
                <Button
                  variant="outline"
                  disabled={discovering}
                  onClick={() =>
                    setConnectionEdit({
                      ...emptyConnection,
                      selectForModel: true,
                    })
                  }
                >
                  新建连接
                </Button>
              </div>
              {!edit.connection_id && (
                <Input
                  aria-label="手动基础地址"
                  value={edit.base_url}
                  disabled={discovering}
                  onChange={(base_url) => {
                    setModelNames([]);
                    setDiscoveryError("");
                    setEdit({ ...edit, base_url });
                  }}
                  placeholder="https://模型服务地址/v1"
                />
              )}
            </label>
            <label className="field">
              <span className="field-label">供应商 API Key</span>
              <Input
                aria-label="模型 API Key"
                type="password"
                value={edit.api_key}
                disabled={
                  discovering || !!edit.connection_id || !!edit.clear_api_key
                }
                onChange={(api_key) => {
                  setModelNames([]);
                  setDiscoveryError("");
                  setEdit({ ...edit, api_key });
                }}
                placeholder={
                  edit.connection_id
                    ? edit.has_api_key
                      ? "已自动使用所选连接的 Key（不回显）"
                      : "所选连接无需 Key"
                    : edit.has_api_key
                      ? "留空保留已有密钥"
                      : "本地无凭证服务可留空"
                }
              />
              {edit.connection_id && (
                <span className="help">
                  地址和 Key
                  来自服务连接，查询模型与实际调用会自动使用。可在“服务连接管理”统一修改。
                </span>
              )}
            </label>
            {!edit.connection_id && edit.has_api_key && (
              <Checkbox
                checked={!!edit.clear_api_key}
                onChange={(clear_api_key) =>
                  setEdit({ ...edit, clear_api_key, api_key: "" })
                }
              >
                清除已保存密钥
              </Checkbox>
            )}
            <label className="field">
              <span className="field-label">服务模型标识</span>
              <div className="model-discovery">
                <Select
                  aria-label="服务模型标识"
                  filterable
                  creatable
                  clearable
                  value={edit.model_name}
                  options={Array.from(
                    new Set([
                      ...modelNames,
                      ...(edit.model_name ? [edit.model_name] : []),
                    ]),
                  ).map((name) => ({ value: name, label: name }))}
                  onCreate={(name) => {
                    setModelNames((names) => [...names, String(name)]);
                    setEdit({ ...edit, model_name: String(name) });
                  }}
                  onChange={(v) =>
                    setEdit({ ...edit, model_name: String(v || "") })
                  }
                  placeholder="查询后快速选择，也可输入名称后按回车"
                />
                <Button
                  variant="outline"
                  loading={discovering}
                  disabled={!edit.base_url?.trim()}
                  onClick={discover}
                >
                  查询模型
                </Button>
              </div>
              <span className="help">
                请求服务的 /models；只填写域名时自动使用
                /v1/models。列表不会自动判断用途。
              </span>
              <ErrorNotice message={discoveryError} />
            </label>
            <div className="form-grid">
              <label className="field">
                <span className="field-label">请求超时（秒）</span>
                <InputNumber
                  min={5}
                  max={600}
                  value={edit.config?.timeout_seconds || 300}
                  onChange={(v) =>
                    setEdit({
                      ...edit,
                      config: { ...edit.config, timeout_seconds: Number(v) },
                    })
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">模型并发上限</span>
                <InputNumber
                  min={1}
                  max={128}
                  value={edit.config?.max_concurrency || 2}
                  onChange={(v) =>
                    setEdit({
                      ...edit,
                      config: { ...edit.config, max_concurrency: Number(v) },
                    })
                  }
                />
              </label>
            </div>
            {["embedding", "multimodal_embedding"].includes(edit.purpose) && (
              <label className="field">
                <span className="field-label">向量维度</span>
                <InputNumber
                  value={edit.dimension || undefined}
                  min={1}
                  max={16000}
                  onChange={(v) =>
                    setEdit({ ...edit, dimension: v ? Number(v) : null })
                  }
                  placeholder="可留空，通过模型响应验证"
                />
              </label>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
function RetrievalSettings() {
  const setting = useData<Row>("/settings/retrieval-defaults");
  const [value, setValue] = useState<Row>({});
  useEffect(() => {
    if (setting.data) setValue(setting.data);
  }, [setting.data]);
  return (
    <div className="field-stack tab-content">
      <ErrorNotice message={setting.error} />
      <h2>默认召回方式</h2>
      <Select
        value={value.mode || "hybrid"}
        onChange={(mode) => setValue({ ...value, mode })}
        options={[
          { value: "hybrid", label: "混合检索" },
          { value: "keyword", label: "关键词检索" },
          { value: "vector", label: "向量检索" },
          { value: "multi", label: "多路综合检索" },
        ]}
        style={{ maxWidth: 320 }}
      />
      <div className="form-grid">
        <label className="field">
          <span>返回条数</span>
          <InputNumber
            value={value.top_k || 10}
            min={1}
            max={100}
            onChange={(n) => setValue({ ...value, top_k: Number(n) })}
          />
        </label>
        <label className="field">
          <span>候选条数</span>
          <InputNumber
            value={value.candidate_k || 50}
            min={value.top_k || 10}
            max={500}
            onChange={(n) => setValue({ ...value, candidate_k: Number(n) })}
          />
        </label>
      </div>
      <p className="help">
        混合检索使用 RRF
        融合。未配置必要模型时会明确提示，搜索不会静默切换检索方式。
      </p>
      <div className="form-actions">
        <Button
          onClick={() =>
            action(
              () => send("/settings/retrieval-defaults", value, "PUT"),
              setting.reload,
            )
          }
        >
          保存检索设置
        </Button>
      </div>
    </div>
  );
}
