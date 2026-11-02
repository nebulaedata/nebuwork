import { useSyncExternalStore } from 'react';
import { fileUploadStore } from '../../services/fileApi.js';
const labels = { verifying: '核对已上传分块', uploading: '上传中', sealing: '校验完整文件', complete: '已完成', failed: '上传失败', cancelled: '已取消', paused: '已暂停' };
export function UploadTasks({ projectId, taskId }) {
  const rows = useSyncExternalStore(fileUploadStore.subscribe, fileUploadStore.getSnapshot).filter(row => row.projectId === projectId && (!taskId || row.taskId === taskId));
  return <div className="document-upload-tasks" aria-live="polite">{rows.map(row => <div key={row.id}><strong>{row.name}</strong><span>{labels[row.state]} · {(row.confirmed / 1048576).toFixed(1)} / {(row.size / 1048576).toFixed(1)} MiB</span><progress max={row.size || 1} value={row.confirmed} aria-label={`${row.name} 上传进度`} />{row.error && <p role="alert">{row.error}</p>}{row.cancel && <button type="button" onClick={() => row.cancel().catch(() => {})}>取消上传</button>}{['failed', 'paused'].includes(row.state) && row.retry && <button type="button" onClick={() => row.retry().catch(() => {})}>重试原上传</button>}</div>)}</div>;
}
