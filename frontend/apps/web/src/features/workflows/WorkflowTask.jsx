import { useEffect, useRef, useState } from 'react';
import { Modal, Select, Tabs } from 'antd';
import { Graph } from './Graph';
import { activeStates, states } from './types';
import { ArtifactList } from './artifacts.jsx';
import { Button, Creation, Loading, Notice, date, key, pretty, useApi, useJob, useWatch } from './ui.jsx';

export function WorkflowTask({ id }) {
  const { call, live } = useApi(), load = useWatch('/workflow-tasks/' + id, data => data.enabled && (['pending', 'syncing'].includes(data.status) || activeStates.includes(data.task?.state))), job = useJob();
  const [selected, setSelected] = useState(''), [attempt, setAttempt] = useState(null), [logs, setLogs] = useState(''), [events, setEvents] = useState([]), [preview, setPreview] = useState(null);
  const [tab, setTab] = useState('artifacts'), [eventError, setEventError] = useState(''), [logError, setLogError] = useState('');
  const command = useRef(null), cursor = useRef(0), task = load.data?.task;
  useEffect(() => { if (task && !selected) setSelected(task.steps[0]?.name || ''); }, [task, selected]);
  useEffect(() => {
    if (!task) return;
    let alive = true; const controller = new AbortController();
    const read = async () => {
      let more = true;
      while (alive && live() && more) {
        const items = await call(`/workflow-tasks/${id}/events?after=${cursor.current}`, 'GET', undefined, { signal: controller.signal });
        if (!alive || !live()) return;
        setEventError('');
        setEvents(old => [...old, ...items.filter(item => !old.some(value => value.id === item.id))].slice(-500));
        if (items.length) cursor.current = items.at(-1).id;
        more = items.length === 500;
      }
    };
    read().catch(error => { if (alive && live() && error.name !== 'AbortError') setEventError(error.message); });
    return () => { alive = false; controller.abort(); };
  }, [id, task, call, live]);
  const step = task?.steps.find(value => value.name === selected), record = step?.history.find(value => value.number === attempt) || step?.history.at(-1);
  useEffect(() => {
    let alive = true; const controller = new AbortController();
    if (!record) { setLogs(''); return; }
    call(`/workflow-tasks/${id}/logs?step=${encodeURIComponent(selected)}&attempt=${record.number}`, 'GET', undefined, { signal: controller.signal }).then(value => { if (alive && live()) { setLogs(value.text + (value.truncated ? '\n（日志已截断）' : '')); setLogError(''); } }).catch(error => { if (alive && live() && error.name !== 'AbortError') setLogError(error.message); });
    return () => { alive = false; controller.abort(); };
  }, [id, selected, record?.number, task, call, live]);
  const control = (action, payload) => job.run(async () => {
    // Preserve the exact version/body and key across an uncertain response, even while status polling advances.
    if (command.current && command.current.action !== action) throw new Error('上次操作结果尚未确认，请先重试原操作或刷新后放弃该请求。');
    command.current ||= { action, body: payload || { expected_version: task.version }, key: key() };
    await call(`/workflow-tasks/${id}/actions/${action}`, 'POST', command.current.body, { key: command.current.key });
    command.current = null; setPreview(null); load.reload();
  });
  if (!load.data) return <Loading {...load} />;
  if (!task) return <><a className="btn btn-ghost" href={'#/workflow/' + load.data.workflowId}>返回工作流</a><Notice error={load.error || job.error} /><Creation data={load.data} retry={() => job.run(async () => { await call(`/workflow-tasks/${id}/retry`, 'POST'); load.reload(); })} /><Button onClick={load.reload}>刷新状态</Button></>;
  const active = activeStates.includes(task.state);
  return <><a className="btn btn-ghost btn-sm" href={'#/workflow/' + load.data.workflowId}>返回工作流</a><div className="wf-heading"><div><h1>{task.definition.name}</h1><p className="dim">{date(task.created_at)} · {states[task.state] || task.state}</p></div><div className="wf-actions">
    <Button onClick={() => { command.current = null; load.reload(); }}>刷新</Button>
    {task.state === 'ready' && <Button primary disabled={job.busy} onClick={() => control('start')}>开始</Button>}
    {['queued', 'running'].includes(task.state) && <Button disabled={job.busy} onClick={() => control('pause')}>暂停</Button>}
    {['paused', 'failed', 'cancelled', 'waiting_manual'].includes(task.state) && <Button primary disabled={job.busy} onClick={() => control('resume')}>继续</Button>}
    {!['succeeded', 'failed', 'cancelled', 'cancelling'].includes(task.state) && <Button disabled={job.busy} onClick={() => control('cancel')}>取消</Button>}
    <Button disabled={job.busy || active} onClick={() => job.run(async () => { const value = await call(`/workflow-tasks/${id}/preview`, 'POST', { from_steps: null }); setPreview({ ...value, from: null }); })}>重跑全部</Button>
    {command.current && <Button disabled={job.busy} onClick={() => control(command.current.action)}>重试原操作</Button>}
  </div></div><Notice error={load.error || job.error || load.data.error} />
    <section className="card wf-workspace"><div className="wf-graph-layout"><Graph definition={task.definition} steps={task.steps} onSelect={name => { setSelected(name); setAttempt(null); }} /><aside className="wf-inspector"><h3>节点执行记录</h3>{step ? <><strong>{step.name}</strong><p>{states[step.state] || step.state}</p><label>执行次数<Select value={record?.number} options={step.history.map(value => ({ value: value.number, label: `第 ${value.number} 次 · ${states[value.state] || value.state}` }))} onChange={setAttempt} /></label>{record && <><p>开始：{date(record.started_at)}</p><p>结束：{date(record.finished_at)}</p><Notice error={record.error} /><small className="wf-hash">代码快照：{record.code_hash || '未启动'}</small></>}<Button disabled={job.busy || active} onClick={() => job.run(async () => { const value = await call(`/workflow-tasks/${id}/preview`, 'POST', { from_steps: [selected] }); setPreview({ ...value, from: [selected] }); })}>从此节点重跑</Button></> : <p>选择节点查看执行记录。</p>}</aside></div>
      <Tabs activeKey={tab} onChange={setTab} items={[{ key: 'artifacts', label: '任务产物' }, { key: 'logs', label: '节点日志' }, { key: 'events', label: '运行事件' }, { key: 'input', label: '输入' }]} />
      <div className="wf-section">{tab === 'artifacts' && <ArtifactList workflowId={load.data.workflowId} items={task.artifacts} />}{tab === 'logs' && <><Notice error={logError} /><pre className="wf-preview">{logs || '暂无日志。'}</pre></>}{tab === 'events' && <><Notice error={eventError} />{events.map(event => <details className="wf-event" key={event.id}><summary>{date(event.created_at)} · {event.step || '任务'} · {event.kind}</summary><pre className="wf-preview">{pretty(event.payload)}</pre></details>)}{!events.length && <p>暂无事件。</p>}</>}{tab === 'input' && <pre className="wf-preview">{pretty(task.input)}</pre>}</div>
    </section>
    <Modal open={!!preview} title="确认重跑范围" onCancel={() => setPreview(null)} footer={null}><p>将重新执行：{preview?.affected.join('、')}</p><p>复用上游执行记录：{Object.entries(preview?.reused || {}).map(([name, number]) => `${name} 第 ${number} 次`).join('、') || '无'}</p><p className="dim">本次按预览版本提交，运行状态变化后需要重新预览。</p><Notice error={job.error} /><Button primary disabled={job.busy} onClick={() => control('rerun', { expected_version: preview.version, from_steps: preview.from, expected_environment: preview.environment_token })}>确认重跑</Button></Modal>
  </>;
}
