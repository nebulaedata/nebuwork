import { useEffect } from 'react';
import { Workflow, Play, Braces, Files } from 'lucide-react';
import { inputRows } from './inputPresets';
import { ArtifactList } from './artifacts.jsx';
import { Button, Notice, useWatch } from './ui.jsx';

function Card({ icon: Icon, title, children, action }) {
  return <section className="wf-overview-card"><div className="wf-overview-label"><Icon size={13} /><span>{title}</span>{action}</div><div className="wf-overview-body">{children}</div></section>;
}
export function WorkflowOverview({ id, definition, artifacts, onConfigure, onGraph, onArtifacts, readOnly = false, unavailable = '' }) {
  const steps = Object.entries(definition?.steps || {}), presets = definition?.input_presets || [], first = presets[0];
  const rows = first ? inputRows(first.input) : [];
  const action = (label, target) => typeof target === 'string' ? <a className="wf-overview-link" href={target}>{label}</a> : <button className="wf-overview-link" onClick={target}>{label}</button>;
  return <div className="wf-overview-grid">
    <Card icon={Workflow} title="执行流程" action={onGraph && action('查看编排', onGraph)}>
      {unavailable ? <p className="dim">定义暂不可用，请修复步骤代码或流程定义。</p> : <><strong>{steps.length} 个步骤 · {steps.reduce((count, [, step]) => count + (step.needs || []).length, 0)} 条依赖</strong>
      <ul className="wf-overview-lines">{steps.slice(0, 3).map(([name, step]) => <li key={name}><span>{name}</span><small>{step.needs?.length ? '依赖 ' + step.needs.join('、') : '起始步骤'}</small></li>)}</ul>
      {steps.length > 3 && <p className="dim">另有 {steps.length - 3} 个步骤</p>}</>}
    </Card>
    <Card icon={Play} title="运行场景" action={onConfigure && action(readOnly ? '查看配置' : '配置场景', onConfigure)}>
      {unavailable ? <p className="dim">定义暂不可用，无法读取运行场景。</p> : presets.length ? <><strong>{presets.length} 个可选场景</strong><ul className="wf-overview-lines">{presets.slice(0, 3).map((preset, index) => <li key={preset.id}><span>{preset.name}{index === 0 && <em>默认</em>}</span><small>{preset.description || '未填写用途说明'}</small></li>)}</ul>{presets.length > 3 && <p className="dim">另有 {presets.length - 3} 个场景</p>}</> : <p className="dim">未配置运行场景</p>}
    </Card>
    <Card icon={Braces} title="输入参数" action={first && onConfigure && action('查看全部参数', onConfigure)}>
      {unavailable ? <p className="dim">定义暂不可用，无法读取参数说明。</p> : first ? <><strong>{first.name}</strong><ul className="wf-overview-lines">{rows.slice(0, 3).map(row => <li key={row.path}><code>{row.path || '整个输入'} <small>{row.type}</small></code><small>{first.fields?.[row.path] || '未填写说明'}</small></li>)}</ul>{rows.length > 3 && <p className="dim">另有 {rows.length - 3} 项参数说明</p>}</> : <p className="dim">配置运行场景后展示参数及说明</p>}
    </Card>
    <Card icon={Files} title="产物文件" action={onArtifacts && action('查看全部', onArtifacts)}>
      <Notice error={artifacts.error} />
      {artifacts.data ? <><strong>{artifacts.data.length} 个产物文件</strong><ArtifactList workflowId={id} items={artifacts.data.slice(0, 3)} compact /></> : <p className="dim">{artifacts.error ? '产物加载失败' : '正在加载产物…'}</p>}
      {artifacts.error && <Button onClick={artifacts.reload}>重新加载产物</Button>}
    </Card>
  </div>;
}

export function RemoteWorkflowOverview({ id, workflow, route, refreshKey }) {
  const artifacts = useWatch(`/workflows/${id}/artifacts`);
  useEffect(() => { if (refreshKey > 1) artifacts.reload(); }, [refreshKey, artifacts.reload]);
  return <WorkflowOverview id={id} definition={workflow.error ? null : workflow.definition} unavailable={workflow.error} artifacts={artifacts} readOnly={workflow.archived}
    onConfigure={workflow.error ? undefined : route + '&configure=inputs'} onGraph={route + '&tab=graph'} onArtifacts={route + '&tab=artifacts'} />;
}
