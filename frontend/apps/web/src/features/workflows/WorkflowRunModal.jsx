import { useRef } from 'react';
import { Modal } from 'antd';
import { RunInputEditor, useRunInput } from './InputPresetControls';
import { Button, Notice, key, useApi, useJob } from './ui.jsx';

export function WorkflowRunModal({ id, presets, onClose }) {
  const { call, live } = useApi(), job = useJob(), model = useRunInput(presets), attempt = useRef(null);
  const submit = () => job.run(async () => {
    if (model.parsed.error) return;
    const body = { input: model.parsed.value }, fingerprint = JSON.stringify(body);
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) attempt.current = { key: key(), body, fingerprint };
    const task = await call(`/workflows/${id}/tasks`, 'POST', attempt.current.body, { key: attempt.current.key });
    if (live()) location.hash = '#/workflow-task/' + task.id;
  });
  return <Modal open width={980} title="运行工作流" className="wf-dialog" footer={null} closable={!job.busy} maskClosable={!job.busy} onCancel={() => { if (!job.busy) onClose(); }}>
    <p className="wf-input-description">创建并启动独立任务。流程结构在任务创建时固定，步骤启动时加载最新代码。</p>
    <RunInputEditor model={model} disabled={job.busy} />
    <Notice error={job.error} />
    <div className="wf-input-footer"><Button disabled={job.busy} onClick={onClose}>取消</Button><Button primary disabled={job.busy || !!model.parsed.error} onClick={submit}>{job.busy ? '正在提交…' : '开始运行'}</Button></div>
  </Modal>;
}
