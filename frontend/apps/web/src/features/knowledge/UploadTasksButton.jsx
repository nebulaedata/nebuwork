import { useEffect, useState } from 'react';
import { knowledgeUploads, openUploadTasks } from './uploads.js';

export function UploadTasksButton() {
  const [batches, setBatches] = useState(() => knowledgeUploads.getSnapshot());
  useEffect(() => {
    const unsubscribe = knowledgeUploads.subscribe(setBatches);
    setBatches(knowledgeUploads.getSnapshot());
    return unsubscribe;
  }, []);
  const pending = batches.flatMap(b => b.items).filter(i => ['queued', 'uploading'].includes(i.status)).length;
  return <button className="btn btn-ghost knowledge-upload-topbar" id="btn-upload-tasks" onClick={openUploadTasks} aria-label={'上传任务' + (pending ? '，剩余 ' + pending + ' 个文件' : '')}>上传任务{pending > 0 && <span className="pill pill-dim">{pending}</span>}</button>;
}
