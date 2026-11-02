import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { App, Modal, Select, Tabs } from 'antd';
import { Graph } from './Graph';
import { ArtifactList } from './artifacts.jsx';
import { Button, Creation, Loading, Notice, creating, creationNames, date, key, pretty, useApi, useJob, useWatch } from './ui.jsx';
import { states, activeStates } from './types';
import { InputPresetEditor } from './InputPresetControls';
import { WorkflowRunModal } from './WorkflowRunModal.jsx';
import { WorkflowOverview } from './WorkflowOverview.jsx';
import { Save, Play, Settings2 } from 'lucide-react';
const CodeEditor = lazy(() => import('./CodeEditor.jsx'));

export function WorkflowList() {
  const { call } = useApi(), load = useWatch('/workflows', data => data.enabled && data.items.some(item => ['pending', 'syncing'].includes(item.status))), job = useJob();
  const [open, setOpen] = useState(false), [name, setName] = useState(''), [description, setDescription] = useState(''), attempt = useRef(null);
  if (!load.data) return <Loading {...load} />;
  const edit = (setter, value) => { setter(value); attempt.current = null; };
  return <><div className="wf-heading"><div><h1>Workflow</h1><p className="dim">新建真实工作流，编排步骤代码并手动运行。</p></div><div className="wf-actions"><Button onClick={load.reload}>刷新</Button><Button primary disabled={!load.data.enabled} onClick={() => setOpen(true)}>新建工作流</Button></div></div>
    {!load.data.enabled && <section className="card wf-empty">Workflow 接入未启用，请联系管理员在 <a href="#/settings?tab=workflow-settings">Workflow 设置</a> 中配置。</section>}
    <Notice error={load.error || job.error} />
    <div className="wf-list">{load.data.items.map(item => <article className="card wf-list-item" key={item.id}><div><a className="wf-name" href={'#/workflow/' + item.id}>{item.name}</a>{item.archived && <span className="pill pill-dim">已归档</span>}<p className="dim">{item.description || '未填写描述'}</p><small>{creationNames[item.status]} · {date(item.createdAt)}</small><Notice error={item.error} /></div><a className="btn btn-ghost" href={'#/workflow/' + item.id}>配置工作流</a></article>)}</div>
    {!load.data.items.length && <section className="card wf-empty">暂无工作流，点击“新建工作流”开始。</section>}
    <Modal title="新建工作流" open={open} onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
      <form className="wf-form" onSubmit={event => { event.preventDefault(); job.run(async () => {
        attempt.current ||= key(); const item = await call('/workflows', 'POST', { name: name.trim(), description: description.trim() }, { key: attempt.current });
        location.hash = '#/workflow/' + item.id;
      }); }}><label>工作流名称<input required maxLength={160} value={name} onChange={e => edit(setName, e.target.value)} /></label><label>描述<textarea maxLength={2000} value={description} onChange={e => edit(setDescription, e.target.value)} /></label><Notice error={job.error} /><div className="wf-actions wf-footer"><Button type="button" onClick={() => setOpen(false)}>取消</Button><Button primary type="submit" disabled={job.busy}>创建并配置</Button></div></form>
    </Modal></>;
}

export function WorkflowEditor({ id, expert, initialTab, runOnOpen, configureOnOpen }) {
  const { call, live } = useApi(), { modal } = App.useApp(), load = useWatch('/workflows/' + id, creating), job = useJob();
  const [draft, setDraft] = useState(null), [selected, setSelected] = useState(''), [tab, setTab] = useState(['graph', 'code', 'tasks', 'artifacts'].includes(initialTab) ? initialTab : 'graph');
  const [newStep, setNewStep] = useState(null), [jsonDraft, setJsonDraft] = useState(null), [runOpen, setRunOpen] = useState(false), [configureOpen, setConfigureOpen] = useState(false);
  const [codeDirty, setCodeDirty] = useState(false);
  const [extraFiles, setExtraFiles] = useState([]);
  const [sourceEpoch, setSourceEpoch] = useState(0);
  const opened = useRef(false), configured = useRef(false), previousFlow = useRef(null), discard = useRef(false);
  const flow = load.data?.workflow;
  const editing = useRef(null); editing.current = { flow, draft, codeDirty, configureOpen, jsonDraft };
  const artifacts = useWatch(flow && load.data?.enabled ? `/workflows/${id}/artifacts` : null);
  const codeFlow = useMemo(() => flow ? { ...flow, files: [...new Set([...flow.files, ...extraFiles])] } : null, [flow, extraFiles]);
  useEffect(() => {
    if (!flow) return;
    const previous = previousFlow.current, reset = discard.current;
    setDraft(current => !current || !previous || reset || pretty(current) === pretty(previous.definition) ? structuredClone(flow.definition) : current);
    previousFlow.current = flow; discard.current = false;
  }, [flow]);
  useEffect(() => {
    if (runOnOpen && flow && !flow.archived && !flow.error && !opened.current) { opened.current = true; setRunOpen(true); }
  }, [flow, runOnOpen]);
  useEffect(() => { if (configureOnOpen && flow && !flow.error && !configured.current) { configured.current = true; setConfigureOpen(true); } }, [flow, configureOnOpen]);
  const back = expert ? `#/agent/${encodeURIComponent(expert)}?tab=sop` : '#/workflows';
  if (!load.data) return <Loading {...load} />;
  if (flow && !draft) return <Loading {...load} />;
  if (!flow || !draft) return <><a className="btn btn-ghost" href={back}>返回</a><Notice error={load.error || job.error} /><Creation data={load.data} retry={() => job.run(async () => { await call(`/workflows/${id}/retry`, 'POST'); load.reload(); })} />{load.data.status === 'ready' && !load.data.enabled && <p>Workflow 接入已关闭，配置和运行暂不可用。</p>}<Button onClick={load.reload}>刷新状态</Button></>;
  const dirty = pretty(draft) !== pretty(flow.definition), spec = draft.steps[selected];
  const patch = value => setDraft({ ...draft, steps: { ...draft.steps, [selected]: { ...spec, ...value } } });
  const confirmLeave = operation => dirty || codeDirty ? modal.confirm({ title: '有未保存修改', content: '此操作将放弃当前流程或源码草稿。', okText: '放弃并继续', cancelText: '继续编辑', onOk: operation }) : operation();
  const reload = () => { discard.current = true; setSourceEpoch(value => value + 1); load.reload(); artifacts.reload(); };
  const save = () => job.run(async () => { const saved = await call(`/workflows/${id}/definition`, 'POST', { definition: draft, expected_revision: flow.revision }); setDraft(current => pretty(current) === pretty(draft) ? structuredClone(saved.definition) : current); load.accept({ ...load.data, workflow: saved }); job.setNote('工作流已保存。'); });
  const openRun = () => job.run(async () => {
    const latest = await call(`/workflows/${id}`);
    if (!live()) return;
    const current = editing.current;
    if (!current.flow || !current.draft || current.codeDirty || current.configureOpen || current.jsonDraft !== null || pretty(current.draft) !== pretty(current.flow.definition)) throw new Error('请先保存或关闭当前编辑，再运行工作流。');
    load.accept(latest);
    if (!latest.enabled || latest.status !== 'ready' || !latest.workflow) throw new Error('工作流当前不可运行，请刷新状态。');
    if (latest.workflow.archived || latest.workflow.error) throw new Error(latest.workflow.error || '工作流已归档，无法运行。');
    setRunOpen(true);
  });
  const selectTab = next => { if (tab === 'code' && codeDirty && next !== tab) modal.confirm({ title: '源码有未保存修改', content: '切换标签页将放弃当前源码草稿。', okText: '放弃并切换', cancelText: '继续编辑', onOk: () => setTab(next) }); else setTab(next); };
  const submitStep = () => job.run(async () => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(newStep) || draft.steps[newStep]) throw new Error('步骤 ID 必须由字母、数字、下划线或短横线组成，且不能重复。');
    const path = `steps/${newStep}.py`, content = 'def run(ctx):\n    ctx.task.save_json("result", ctx.input)\n';
    try { await call(`/workflows/${id}/source?path=${encodeURIComponent(path)}`, 'POST', { content, expected_revision: null }); }
    catch (error) {
      // A source create may have succeeded before its response was lost. Never overwrite a different file.
      const existing = await call(`/workflows/${id}/source?path=${encodeURIComponent(path)}`);
      if (existing.content !== content) throw error;
    }
    setExtraFiles(files => [...new Set([...files, path])]);
    setDraft({ ...draft, steps: { ...draft.steps, [newStep]: { code: path + ':run', needs: [] } } }); setSelected(newStep); setNewStep(null);
  });
  return <><a className="btn btn-ghost btn-sm" href={back}>返回{expert ? ' SOP' : '工作流列表'}</a>
    <div className="wf-heading"><div><h1>{flow.name}</h1><p className="dim">{Object.keys(draft.steps).length} 个步骤 · {dirty ? '有未保存的流程修改' : '流程已保存'}{flow.archived ? ' · 已归档' : ''}</p></div><div className="wf-actions">
      <Button disabled={job.busy} onClick={() => confirmLeave(reload)}>重新加载</Button><Button disabled={job.busy} onClick={() => confirmLeave(() => job.run(async () => { await call(`/workflows/${id}/archive`, 'POST', { archived: !flow.archived }); reload(); }))}>{flow.archived ? '恢复归档' : '归档'}</Button>
      <Button disabled={job.busy || flow.archived || !dirty} onClick={save}><Save size={14} />保存流程</Button>
      <Button primary disabled={dirty || codeDirty || flow.archived || job.busy || !!flow.error} onClick={openRun}><Play size={14} />运行</Button>
    </div></div><Notice error={load.error || job.error || flow.error} /><p role="status">{job.note}</p>
    <WorkflowOverview id={id} definition={flow.error ? null : draft} unavailable={flow.error} artifacts={artifacts} readOnly={flow.archived} onConfigure={flow.error ? undefined : () => setConfigureOpen(true)} onGraph={() => selectTab('graph')} onArtifacts={() => { selectTab('artifacts'); artifacts.reload(); }} />
    <section className="card wf-workspace"><Tabs activeKey={tab} onChange={selectTab} items={[{ key: 'graph', label: '流程编排' }, { key: 'code', label: '步骤代码' }, { key: 'tasks', label: '运行记录' }, { key: 'artifacts', label: '工作流产物' }]} />
      {tab === 'graph' && <><div className="wf-toolbar"><span className="dim">拖动节点 · 连接端点添加依赖 · 选中连线后删除</span><div className="wf-actions"><Button disabled={job.busy || !!flow.error} onClick={() => setConfigureOpen(true)}><Settings2 size={13} />运行场景</Button><Button disabled={flow.archived} onClick={() => setJsonDraft(pretty(draft))}>JSON</Button><Button disabled={flow.archived || job.busy} onClick={() => setNewStep('step_' + (Object.keys(draft.steps).length + 1))}>添加步骤</Button><Button disabled={job.busy} onClick={() => job.run(async () => { await call(`/workflows/${id}/validate`, 'POST', { definition: draft }); job.setNote('流程、输入场景与代码入口校验通过，尚未保存。'); })}>校验</Button></div></div>
        <div className="wf-graph-layout"><Graph definition={draft} onChange={flow.archived || job.busy ? undefined : setDraft} onSelect={setSelected} /><aside className="wf-inspector"><fieldset disabled={flow.archived || job.busy}><label>工作流名称<input value={draft.name} maxLength={160} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><h3>步骤设置</h3>{spec ? <><strong>{selected}</strong><label>代码入口<input value={spec.code} onChange={e => patch({ code: e.target.value })} /></label><label>上游依赖<Select disabled={flow.archived || job.busy} mode="multiple" value={spec.needs || []} options={Object.keys(draft.steps).filter(name => name !== selected).map(name => ({ value: name, label: name }))} onChange={needs => patch({ needs })} /></label>
          <label>自动重试次数<input type="number" min="0" step="1" value={spec.retries ?? 0} onChange={e => patch({ retries: Number(e.target.value) })} /></label><label>重试间隔（秒）<input type="number" min="0" value={spec.retry_delay ?? 1} onChange={e => patch({ retry_delay: Number(e.target.value) })} /></label><label>步骤超时（秒，可留空）<input type="number" min="0.001" step="any" value={spec.timeout ?? ''} onChange={e => patch({ timeout: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <Button onClick={() => { const next = structuredClone(draft); delete next.steps[selected]; if (next.layout) delete next.layout[selected]; for (const value of Object.values(next.steps)) value.needs = (value.needs || []).filter(name => name !== selected); setDraft(next); setSelected(''); }}>删除步骤</Button></> : <p className="dim">点击节点配置代码入口与执行参数。</p>}</fieldset></aside></div></>}
      {tab === 'code' && <Suspense fallback={<p>正在加载代码编辑器…</p>}><CodeEditor key={sourceEpoch} id={id} flow={codeFlow} onDirty={setCodeDirty} onSaved={() => { if (!dirty) load.reload(); }} /></Suspense>}
      {tab === 'tasks' && <WorkflowTasks id={id} />}
      {tab === 'artifacts' && <WorkflowArtifacts id={id} load={artifacts} />}
    </section>
    <Modal open={newStep !== null} title="添加步骤" onCancel={() => setNewStep(null)} footer={null}><form className="wf-form" onSubmit={e => { e.preventDefault(); submitStep(); }}><label>步骤 ID<input required maxLength={100} value={newStep || ''} onChange={e => setNewStep(e.target.value)} /></label><p className="dim">创建对应 Python 文件，保存流程后可执行。新步骤不自动连接。</p><Notice error={job.error} /><Button primary type="submit" disabled={job.busy}>添加步骤</Button></form></Modal>
    <Modal width={800} open={jsonDraft !== null} title="流程 JSON" onCancel={() => setJsonDraft(null)} footer={null}><div className="wf-form"><textarea className="wf-json" value={jsonDraft || ''} onChange={e => setJsonDraft(e.target.value)} /><Notice error={job.error} /><Button primary disabled={job.busy} onClick={() => job.run(async () => { const definition = await call(`/workflows/${id}/validate`, 'POST', { definition: JSON.parse(jsonDraft) }); setDraft(definition); setJsonDraft(null); })}>校验并应用到画布</Button></div></Modal>
    {configureOpen && <Modal className="wf-dialog" width={980} open title="运行场景配置" footer={null} onCancel={() => setConfigureOpen(false)}><InputPresetEditor presets={draft.input_presets || []} readOnly={flow.archived || job.busy || !!flow.error} onClose={() => setConfigureOpen(false)} onApply={input_presets => { setDraft(current => ({ ...current, input_presets })); setConfigureOpen(false); job.setNote('运行场景已应用，请保存流程。'); }} /></Modal>}
    {runOpen && !dirty && !codeDirty && !flow.archived && !flow.error && <WorkflowRunModal id={id} presets={flow.definition.input_presets || []} onClose={() => setRunOpen(false)} />}
  </>;
}
function WorkflowTasks({ id }) {
  const load = useWatch(`/workflows/${id}/tasks`, items => items.some(item => ['pending', 'syncing'].includes(item.status) || activeStates.includes(item.task?.state)));
  if (!load.data) return <Loading {...load} />;
  return <div className="wf-section"><div className="wf-actions"><Button onClick={load.reload}>刷新运行记录</Button></div><Notice error={load.error} />{load.data.map(item => <article className="wf-row" key={item.id}><a href={'#/workflow-task/' + item.id}>{date(item.task?.created_at || item.createdAt)}</a><span>{item.task ? states[item.task.state] || item.task.state : creationNames[item.status]}</span><Notice error={item.error} /></article>)}{!load.data.length && <p className="dim">暂无运行记录。</p>}</div>;
}
function WorkflowArtifacts({ id, load }) {
  return <div className="wf-section"><div className="wf-toolbar"><span className="dim">任务产物与工作流共享文件</span><Button onClick={load.reload}>刷新产物</Button></div><Notice error={load.error} />{load.data ? <ArtifactList workflowId={id} items={load.data} /> : <Loading {...load} />}</div>;
}
