import { Alert, Input, Checkbox, Tabs, Tag, Spin, App as AntApp } from "antd";
import { useEffect, useRef, useState, lazy, Suspense } from "react";
import {
  ArrowLeft,
  Plus,
  Save,
  Play,
  Braces,
  Workflow as FlowIcon,
  Code2,
  Copy,
  Archive,
  Package,
  Trash2,
  Settings2,
} from "lucide-react";
import { api, pretty } from "./api";
import { InputPresetEditor } from "./InputPresetControls";
import { RunWorkflow } from "./RunWorkflow";
import type { Artifact, Definition, Workflow } from "./types";
import { Button, ErrorNotice, Modal, useJob } from "./ui";
import { Graph } from "./Graph";
import { WorkflowTasks } from "./WorkflowTasks";
import { WorkflowEnvironment } from "./Environments";
const CodeEditor = lazy(() =>
  import("./CodeEditor").then((module) => ({ default: module.CodeEditor })),
);
import { ArtifactList } from "./Artifacts";

export function WorkflowView({ id }: { id: string }) {
  const { modal } = AntApp.useApp();
  const [flow, setFlow] = useState<Workflow | null>(null),
    [draft, setDraft] = useState<Definition | null>(null);
  const [tab, setTab] = useState("graph"),
    [selected, setSelected] = useState("");
  const [newStep, setNewStep] = useState<string | null>(null),
    [runOpen, setRunOpen] = useState(false);
  const [configureOpen, setConfigureOpen] = useState(false), [codeDirty, setCodeDirty] = useState(false);
  const [jsonDraft, setJsonDraft] = useState<string | null>(null),
    [copyId, setCopyId] = useState<string | null>(null);
  const [shared, setShared] = useState<Artifact[]>([]);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const { busy, error, setError, run } = useJob();
  const openingRun = useRef<AbortController | null>(null);
  useEffect(() => () => openingRun.current?.abort(), [id]);
  const editing = useRef({ flow, draft, configureOpen, jsonDraft, codeDirty });
  editing.current = { flow, draft, configureOpen, jsonDraft, codeDirty };
  const acceptRemote = (value: Workflow) => {
    const current = editing.current;
    if (current.flow && current.draft && (pretty(current.draft) !== pretty(current.flow.definition) || current.configureOpen || current.jsonDraft !== null)) {
      if (value.revision !== current.flow.revision) setRemoteChanged(true);
      setFlow(old => old ? { ...old, files: value.files, archived: value.archived } : value);
    } else { setFlow(value); setDraft(value.definition); setRemoteChanged(false); }
  };
  const refresh = async () => acceptRemote(await api<Workflow>("/workflows/" + id));
  useEffect(() => {
    run(refresh);
  }, [id]);
  const loadShared = async () =>
    setShared(
      (await api<Artifact[]>(`/workflows/${id}/artifacts`)).filter(
        (a) => a.scope === "workflow",
      ),
    );
  useEffect(() => {
    if (tab === "shared") run(loadShared);
  }, [id, tab]);
  useEffect(() => {
    const controller = new AbortController();
    const changed = (event: Event) => {
      if ((event as CustomEvent).detail !== id) return;
      api<Workflow>("/workflows/" + id, 'GET', undefined, controller.signal)
        .then((value) => {
          if (controller.signal.aborted) return;
          acceptRemote(value);
          if (tab === "shared") loadShared().catch((e) => setError(e.message));
        })
        .catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    };
    window.addEventListener("nebulae:workflow-change", changed);
    return () => { controller.abort(); window.removeEventListener("nebulae:workflow-change", changed); };
  }, [id, tab]);
  if (!flow || !draft)
    return error ? (
      <ErrorNotice message={error} clear={() => setError("")} />
    ) : (
      <div className="empty">
        <Spin size="small" />
        <p className="muted">正在读取工作流…</p>
      </div>
    );
  const dirty = pretty(draft) !== pretty(flow.definition),
    spec = draft.steps[selected];
  const patch = (changes: Partial<typeof spec>) =>
    setDraft({
      ...draft,
      steps: { ...draft.steps, [selected]: { ...spec, ...changes } },
    });
  const save = () =>
    run(async () => {
      const value = await api<Workflow>(`/workflows/${id}/definition`, "PUT", {
        definition: draft,
        expected_revision: flow.revision,
      });
      setFlow(value);
      setDraft(current => pretty(current) === pretty(draft) ? value.definition : current);
      setRemoteChanged(false);
    });
  const openRun = () => run(async () => {
    openingRun.current?.abort();
    const controller = new AbortController();
    openingRun.current = controller;
    try {
      const latest = await api<Workflow>(`/workflows/${id}`, 'GET', undefined, controller.signal);
      if (controller.signal.aborted) return;
      const current = editing.current;
      if (!current.flow || !current.draft || current.codeDirty || current.configureOpen || current.jsonDraft !== null || pretty(current.draft) !== pretty(current.flow.definition)) {
        throw new Error('请先保存或关闭当前编辑，再创建任务。');
      }
      acceptRemote(latest);
      if (latest.archived || latest.error) throw new Error(latest.error || '工作流已归档，无法创建任务。');
      setRunOpen(true);
    } catch (failure) {
      if (!controller.signal.aborted) throw failure;
    }
  });
  return (
    <>
      {remoteChanged && (
        <Alert
          type="warning"
          title="流程定义已被助手修改，当前未保存草稿已保留。请比较流程 JSON 后合并，避免覆盖变更。"
        />
      )}
      <a href="#workflows" className="back">
        <ArrowLeft size={15} />
        工作流列表
      </a>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKFLOW / {id}</div>
          <h1>
            {flow.name}
            {flow.archived && <Tag>已归档</Tag>}
          </h1>
          <p className="muted">
            {Object.keys(draft.steps).length} 个步骤
            <span className="sep">·</span>代码驱动的依赖编排
            {dirty && <span className="dirty-text"> · 有未保存的流程修改</span>}
          </p>
        </div>
        <div className="heading-actions">
          <Button onClick={() => setConfigureOpen(true)} disabled={busy || !!flow.error}><Settings2 size={15} />运行场景</Button>
          <Button disabled={busy || !dirty || flow.archived} onClick={save}><Save size={15} />保存流程</Button>
          <Button onClick={() => setCopyId(id + "-copy")}>
            <Copy size={15} />
            复制
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(`/workflows/${id}/archive`, "POST", {
                  archived: !flow.archived,
                });
                await refresh();
              })
            }
          >
            <Archive size={15} />
            {flow.archived ? "恢复归档" : "归档"}
          </Button>
          <Button
            className="primary"
            disabled={flow.archived || dirty || codeDirty || busy || !!flow.error}
            onClick={openRun}
          >
            <Play size={15} />
            创建任务
          </Button>
        </div>
      </div>
      <ErrorNotice
        message={error || flow.error || ""}
        clear={() => setError("")}
      />
      <section className="panel workflow-panel">
        <Tabs
          className="workspace-tabs"
          activeKey={tab}
          onChange={(key) => {
            if (tab === 'code' && codeDirty && key !== tab) modal.confirm({
              title: '源码有未保存修改', content: '切换标签页将放弃当前源码草稿。', okText: '放弃并切换', cancelText: '继续编辑', onOk: () => setTab(key),
            });
            else if (!dirty || tab !== "graph") setTab(key);
            else
              modal.confirm({
                title: "流程有未保存修改",
                content: "仍要切换标签页吗？当前流程修改尚未保存到文件。",
                okText: "切换标签页",
                cancelText: "继续编辑",
                onOk: () => setTab(key),
              });
          }}
          items={[
            {
              key: "graph",
              label: (
                <>
                  <FlowIcon size={15} />
                  流程编排
                </>
              ),
            },
            {
              key: "code",
              label: (
                <>
                  <Code2 size={15} />
                  步骤代码
                </>
              ),
            },
            {
              key: "environment",
              label: (
                <>
                  <Package size={15} />
                  执行环境
                </>
              ),
            },
            {
              key: "shared",
              label: (
                <>
                  <Package size={15} />
                  共享产物
                </>
              ),
            },
            {
              key: "tasks",
              label: (
                <>
                  <Play size={15} />
                  相关任务
                </>
              ),
            },
          ]}
        />
        {tab === "graph" && (
          <>
            <div className="graph-toolbar">
              <span>拖动节点调整布局 · 连接端点添加依赖</span>
              <div>
                <Button disabled={flow.archived} onClick={() => setJsonDraft(pretty(draft))}>
                  <Braces size={15} />
                  JSON
                </Button>
                <Button
                  disabled={flow.archived || busy}
                  onClick={() =>
                    setNewStep("step_" + (Object.keys(draft.steps).length + 1))
                  }
                >
                  <Plus size={15} />
                  添加步骤
                </Button>
              </div>
            </div>
            <div className="flow-workspace">
              <Graph
                definition={draft}
                onChange={flow.archived || busy ? undefined : setDraft}
                onSelect={setSelected}
              />
              <aside className="step-inspector">
                <div className="inspector-title">步骤设置</div>
                {spec ? (
                  <>
                    <h2>{selected}</h2>
                    <div className="form-section">
                      <label>
                        代码入口
                        <Input
                          aria-label="代码入口"
                          disabled={flow.archived || busy}
                          value={spec.code}
                          onChange={(e) => patch({ code: e.target.value })}
                        />
                      </label>
                      <small>格式：相对路径.py:run</small>
                      <div className="field-label">
                        依赖步骤
                        <div className="dependency-list">
                          {Object.keys(draft.steps)
                            .filter((n) => n !== selected)
                            .map((name) => (
                              <Checkbox
                                key={name}
                                aria-label={name}
                                disabled={flow.archived || busy}
                                checked={(spec.needs ?? []).includes(name)}
                                onChange={(e) =>
                                  patch({
                                    needs: e.target.checked
                                      ? [...(spec.needs ?? []), name]
                                      : (spec.needs ?? []).filter(
                                          (n) => n !== name,
                                        ),
                                  })
                                }
                              >
                                {name}
                              </Checkbox>
                            ))}
                          {Object.keys(draft.steps).length === 1 && (
                            <span className="muted">没有其他步骤</span>
                          )}
                        </div>
                      </div>
                      <div className="input-pair">
                        <label>
                          自动重试
                          <Input
                            type="number"
                            disabled={flow.archived || busy}
                            min="0"
                            value={spec.retries ?? 0}
                            onChange={(e) =>
                              patch({ retries: Number(e.target.value) })
                            }
                          />
                        </label>
                        <label>
                          间隔（秒）
                          <Input
                            type="number"
                            disabled={flow.archived || busy}
                            min="0"
                            value={spec.retry_delay ?? 1}
                            onChange={(e) =>
                              patch({ retry_delay: Number(e.target.value) })
                            }
                          />
                        </label>
                      </div>
                      <label>
                        超时（秒）
                        <Input
                          type="number"
                          disabled={flow.archived || busy}
                          min="0.1"
                          step="0.1"
                          placeholder="不设限"
                          value={spec.timeout ?? ""}
                          onChange={(e) =>
                            patch({
                              timeout: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                        />
                      </label>
                    </div>
                    <Button
                      className="danger-text"
                      disabled={flow.archived || busy}
                      onClick={() => {
                        const value = structuredClone(draft);
                        delete value.steps[selected];
                        for (const node of Object.values(value.steps))
                          node.needs = (node.needs ?? []).filter(
                            (n) => n !== selected,
                          );
                        setDraft(value);
                        setSelected("");
                      }}
                    >
                      <Trash2 size={15} />
                      移除步骤
                    </Button>
                  </>
                ) : (
                  <div className="inspector-empty">
                    <FlowIcon size={30} />
                    <p>选择一个节点</p>
                    <span>在这里配置代码入口、依赖与执行设置。</span>
                  </div>
                )}
              </aside>
            </div>
            <div className="panel-footnote">
              流程结构在任务创建时固定，修改连线只影响新任务。
            </div>
          </>
        )}
        {tab === "code" && (
          <Suspense fallback={<div className="empty">正在加载代码编辑器…</div>}>
            <CodeEditor workflow={flow} refresh={refresh} onDirty={setCodeDirty} />
          </Suspense>
        )}
        {tab === "tasks" && <WorkflowTasks id={id} />}
        {tab === "environment" && (
          <WorkflowEnvironment
            id={id}
            revision={flow.revision}
            dirty={dirty}
            changed={refresh}
          />
        )}
        {tab === "shared" && <ArtifactList key={id} artifacts={shared} />}
      </section>
      {newStep !== null && (
        <Modal title="添加步骤" close={() => setNewStep(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(newStep))
                  throw new Error("步骤 ID 仅支持字母、数字、下划线和短横线");
                if (draft.steps[newStep]) throw new Error("步骤 ID 已存在");
                const filename = "steps/" + newStep + ".py";
                if (!flow.files.includes(filename))
                  await api(
                    `/workflows/${id}/source?path=${encodeURIComponent(filename)}`,
                    "PUT",
                    {
                      content:
                        'def run(ctx):\n    ctx.task.save_json("result", {})\n',
                      expected_revision: null,
                    },
                  );
                setDraft({
                  ...draft,
                  steps: {
                    ...draft.steps,
                    [newStep]: { code: filename + ":run", needs: [] },
                  },
                });
                setFlow({
                  ...flow,
                  files: [...new Set([...flow.files, filename])],
                });
                setSelected(newStep);
                setNewStep(null);
              });
            }}
          >
            <label>
              步骤 ID
              <Input
                autoFocus
                value={newStep}
                onChange={(e) => setNewStep(e.target.value)}
              />
            </label>
            <p className="muted">
              会创建对应的 Python 文件，可在步骤代码中编辑。
            </p>
            <ErrorNotice message={error} clear={() => setError("")} />
            <footer>
              <Button type="button" onClick={() => setNewStep(null)}>
                取消
              </Button>
              <Button type="submit" className="primary" disabled={busy}>
                添加步骤
              </Button>
            </footer>
          </form>
        </Modal>
      )}
      {jsonDraft !== null && (
        <Modal title="流程 JSON" wide close={() => setJsonDraft(null)}>
          <Input.TextArea
            className="json-input tall"
            aria-label="流程 JSON"
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
          />
          <ErrorNotice message={error} clear={() => setError("")} />
          <footer>
            <Button onClick={() => setJsonDraft(null)}>取消</Button>
            <Button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const value = await api<Definition>(
                    `/workflows/${id}/validate`,
                    "POST",
                    { definition: JSON.parse(jsonDraft) },
                  );
                  setDraft(value);
                  setJsonDraft(null);
                })
              }
            >
              应用到画布
            </Button>
          </footer>
        </Modal>
      )}
      {configureOpen && <Modal title="运行场景配置" wide close={() => setConfigureOpen(false)}><InputPresetEditor presets={draft.input_presets || []} readOnly={flow.archived || busy || !!flow.error}
        onClose={() => setConfigureOpen(false)} onApply={input_presets => { setDraft(current => current ? { ...current, input_presets } : current); setConfigureOpen(false); }} /></Modal>}
      {runOpen && !dirty && !codeDirty && !flow.archived && !flow.error && <RunWorkflow id={id} presets={flow.definition.input_presets || []} close={() => setRunOpen(false)} />}
      {copyId !== null && (
        <Modal title="复制工作流" close={() => setCopyId(null)}>
          <label>
            新工作流 ID
            <Input value={copyId} onChange={(e) => setCopyId(e.target.value)} />
          </label>
          <ErrorNotice message={error} clear={() => setError("")} />
          <footer>
            <Button onClick={() => setCopyId(null)}>取消</Button>
            <Button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api("/workflows", "POST", {
                    id: copyId,
                    name: flow.name + " · 副本",
                    copy_from: id,
                  });
                  location.hash = "workflow/" + copyId;
                  setCopyId(null);
                })
              }
            >
              创建副本
            </Button>
          </footer>
        </Modal>
      )}
    </>
  );
}
