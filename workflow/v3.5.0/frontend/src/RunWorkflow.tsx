import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import { api, uuid } from './api';
import { RunInputEditor, useRunInput } from './InputPresetControls';
import type { InputPreset, JsonValue } from './inputPresets';
import type { Task } from './types';

type Submission = {
  fingerprint: string;
  create: { workflow_id: string; input: JsonValue; command_id: string };
  task?: Task;
  start?: { expected_version: number; command_id: string };
};
export function RunWorkflow({ id, presets, close }: { id: string; presets: InputPreset[]; close: () => void }) {
  const model = useRunInput(presets), attempt = useRef<Submission | null>(null), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const controller = useRef(new AbortController());
  useEffect(() => { if (controller.current.signal.aborted) controller.current = new AbortController(); return () => controller.current.abort(); }, []);
  const submit = async (start: boolean) => {
    if (pending.current || model.parsed.error) return;
    pending.current = true; setBusy(true); setError('');
    const signal = controller.current.signal;
    try {
      const fingerprint = JSON.stringify([start, model.parsed.value]);
      if (!attempt.current || attempt.current.fingerprint !== fingerprint) attempt.current = {
        fingerprint, create: { workflow_id: id, input: model.parsed.value, command_id: uuid() },
      };
      const command = attempt.current;
      command.task ??= await api<Task>('/tasks', 'POST', command.create, signal);
      if (start) {
        command.start ??= { expected_version: command.task.version, command_id: uuid() };
        await api(`/tasks/${command.task.id}/actions/start`, 'POST', command.start, signal);
      }
      if (!signal.aborted) location.hash = 'task/' + command.task.id;
    } catch (failure) {
      if (!signal.aborted) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      pending.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  return <Modal open width={980} title="创建任务" className="workbench-modal" footer={null} closable={!busy} maskClosable={!busy} onCancel={() => { if (!busy) close(); }}>
    <p className="wf-input-description">任务将固定当前流程结构。步骤启动时加载最新代码。</p>
    <RunInputEditor model={model} disabled={busy} />
    {error && <Alert type="error" showIcon title={error} description="可使用相同输入重试；系统会复用原创建和启动请求。" />}
    <div className="wf-input-footer"><Button disabled={busy} onClick={close}>取消</Button><Button disabled={busy || !!model.parsed.error} onClick={() => void submit(false)}>仅创建</Button>
      <Button type="primary" disabled={busy || !!model.parsed.error} loading={busy} onClick={() => void submit(true)}>创建并运行</Button></div>
  </Modal>;
}
