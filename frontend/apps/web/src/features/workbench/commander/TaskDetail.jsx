import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { FilePreview } from '../../tasks/AgentTask.jsx';
import { statuses } from '../../tasks/agentState.js';
import { usageText } from '../../tasks/usage.js';
import { Empty, Notice, Overlay, formatTime } from '../HubUI.jsx';
import { taskArtifacts } from '../hubModel.js';

export function TaskDetail({ task, close, onFollow }) {
  const [data, setData] = useState(null), [files, setFiles] = useState([]), [error, setError] = useState(''), [preview, setPreview] = useState(null), [loading, setLoading] = useState(true);
  useEffect(() => { const abort = new AbortController();
    Promise.allSettled([API.fetchTask(task.id, abort.signal), API.fetchProjectArtifacts(task.projectId, abort.signal)]).then(results => {
      if (abort.signal.aborted) return;
      if (results[0].status === 'fulfilled') setData(results[0].value.data);
      if (results[0].status === 'fulfilled' && results[1].status === 'fulfilled') setFiles(taskArtifacts(results[1].value.data.items, results[0].value.data));
      setError(results.filter(r => r.status === 'rejected').map(r => r.reason.message).join('；')); setLoading(false);
    }); return () => abort.abort();
  }, [task.id, task.projectId]);
  return <Overlay title={task.title} close={close}><div className="hub-detail"><a className="btn btn-ghost" href={`#/task/${task.id}`}><ExternalLink size={14}/>打开完整任务</a>{onFollow&&<button className="btn btn-primary" onClick={() => { onFollow(task); close(); }}>继续跟踪／回传成果</button>}<Notice>{error}</Notice>{(data?.runs || []).map(run => <p key={run.id}>{statuses[run.status] || run.status} · {formatTime(run.createdAt)} · {usageText(run.usage)}</p>)}<h3>任务成果</h3>{files.map(f => <button className="hub-source-row" key={f.id} onClick={() => setPreview(f)}>{f.name} · v{f.version}</button>)}{!files.length&&<Empty>{loading ? '正在读取任务成果…' : error ? '成果暂不可用，请重试。' : '暂无已提交成果'}</Empty>}{preview&&<FilePreview projectId={task.projectId} file={preview} close={() => setPreview(null)}/>}</div></Overlay>;
}
