import { useState } from 'react';
import { Modal } from 'antd';
import { FileText, Download, Eye } from 'lucide-react';
import { Button, Notice, date, pretty, useApi, useJob } from './ui.jsx';
export const fileSize = size => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
export function ArtifactList({ workflowId, items, compact = false }) {
  const { call, live, artifactUrl } = useApi(), job = useJob(), [preview, setPreview] = useState(null);
  return <><Notice error={job.error} /><div className={'wf-artifacts' + (compact ? ' wf-artifacts-compact' : '')}>{items.map(item => <article className="wf-artifact-row" key={item.id}>
    <span className="wf-artifact-icon"><FileText size={17} /></span><div className="wf-artifact-info"><strong title={item.filename || item.name}>{item.filename || item.name}</strong>
      {!compact && item.filename && item.filename !== item.name && <span className="wf-artifact-name">{item.name}</span>}
      <p className="dim">{fileSize(item.size)} · {item.scope === 'workflow' ? '工作流共享' : '任务产物'} · {item.step} · 第 {item.attempt} 次</p>
      <div className="wf-artifact-meta"><time>{date(item.created_at)}</time><span className={'wf-artifact-status' + (item.effective ? ' is-effective' : '')}>{!item.published ? '未发布' : item.effective ? '当前有效' : '历史版本'}</span></div>
    </div><div className="wf-actions"><Button disabled={job.busy} aria-label={'预览 ' + (item.filename || item.name)} onClick={() => job.run(async () => { const content = await call(`/workflows/${workflowId}/artifacts/${encodeURIComponent(item.id)}/content`); if (live()) setPreview({ name: item.filename || item.name, content }); })}><Eye size={13} />预览</Button><a className="btn btn-ghost" href={artifactUrl(workflowId, item.id)} download><Download size={13} />下载</a></div>
  </article>)}</div>{!items.length && <p className="wf-artifact-empty">暂无产物文件，运行并保存产物后将在这里展示。</p>}
    <Modal className="wf-dialog" width={850} open={!!preview} title={preview?.name} onCancel={() => setPreview(null)} footer={null}>{preview?.content.download_only ? <p>该文件暂不支持在线预览，请下载查看。</p> : <pre className="wf-preview">{typeof preview?.content.data === 'string' ? preview.content.data : pretty(preview?.content.data)}</pre>}</Modal>
  </>;
}
