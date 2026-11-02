import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Download, Eye, FileText, FolderOpen, LoaderCircle, Upload } from 'lucide-react';
import { FilePreview } from '../tasks/AgentTask.jsx';
import { UploadTasks } from './UploadTasks.jsx';
import { authSession } from '../../services/authSession.js';
import './projectFiles.css';
export function ProjectFiles({ projectId, initialFiles = [], writable = true }) {
  const [files, setFiles] = useState(initialFiles), [selected, setSelected] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const life = useRef(null), uploadInput = useRef(null);
  useEffect(() => { const abort = new AbortController();life.current = abort;const epoch = authSession.getSnapshot().version;const unsubscribe = authSession.subscribe(() => { if (authSession.getSnapshot().version !== epoch) { abort.abort();setFiles([]);setSelected(null); } });return () => { abort.abort();unsubscribe(); }; }, [projectId]);
  const upload = async picked => { setBusy(true);setError('');try { for (const file of picked) await API.uploadArtifact(projectId, file,undefined,undefined,{onRetryComplete:async()=>{const result=await API.fetchProjectArtifacts(projectId,life.current.signal);if(!life.current.signal.aborted)setFiles(result.data.items||[]);}});const result = await API.fetchProjectArtifacts(projectId, life.current.signal);if (!life.current.signal.aborted) setFiles(result.data.items || []); } catch (e) { if (!life.current.signal.aborted) setError(e.message); } finally { if (!life.current.signal.aborted) setBusy(false); } };
  return <section className="project-files" aria-label="项目成果文件">
    {selected ? <FilePreview projectId={projectId} file={selected} close={() => setSelected(null)} onArtifact={(id, version) => { const file = files.find(f => f.id === id && (!version || f.version === version));if (file) setSelected(file);else API.fetchArtifact(projectId, id, version, life.current.signal).then(r => { if (!life.current.signal.aborted) setSelected(r.data); }).catch(e => { if (!life.current.signal.aborted) setError(e.message); }); }} /> : <>
      <div className="project-file-tools">
        <span className="project-file-upload-icon" aria-hidden="true"><Upload size={20} /></span>
        <div className="project-file-upload-copy">
          <h2>上传成果文件</h2>
          <p id="project-file-upload-hint">单个文件最大 2048 MiB，支持多选与大文件断点续传。</p>
        </div>
        <input ref={uploadInput} type="file" multiple hidden disabled={!writable || busy} aria-label="选择成果文件" onChange={e => { const picked = [...e.target.files];e.target.value = '';if (picked.length) void upload(picked); }} />
        <button type="button" className="btn btn-primary project-file-upload-button" disabled={!writable || busy} aria-describedby="project-file-upload-hint" onClick={() => uploadInput.current?.click()}>
          {busy ? <LoaderCircle size={16} className="agent-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}{busy ? '上传中…' : '上传文件'}
        </button>
      </div>
      <div className="project-file-list">
        <div className="project-file-list-heading"><h2>成果文件</h2><span>{files.length} 个文件</span></div>
        {files.length ? <ul>{files.map(file => <li className="project-file-row" key={file.id}>
          <span className="project-file-icon" aria-hidden="true"><FileText size={20} /></span>
          <div className="project-file-copy">
            <button type="button" className="project-file-name" onClick={() => setSelected(file)}>{file.name}</button>
            <p>版本 {file.version}<span aria-hidden="true">·</span>{file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MiB` : `${(file.size / 1024).toFixed(1)} KB`}</p>
          </div>
          <div className="project-file-actions">
            <button type="button" className="btn btn-ghost" aria-label={`预览 ${file.name}`} onClick={() => setSelected(file)}><Eye size={15} aria-hidden="true" />预览</button>
            <a className="btn btn-ghost" href={API.artifactUrl(projectId, file)} download={file.name} aria-label={`下载 ${file.name}`}><Download size={15} aria-hidden="true" />下载</a>
          </div>
        </li>)}</ul> : <div className="project-file-empty"><FolderOpen size={28} aria-hidden="true" /><strong>暂无成果文件</strong><p>{writable ? '上传文件后，可在这里预览和下载。' : '当前项目暂无可查看的成果文件。'}</p></div>}
      </div>
    </>}
    {error && <p className="project-file-error" role="alert">{error}</p>}
    <UploadTasks projectId={projectId} />
  </section>;
}
export function mountProjectFiles(el, props) { const root = createRoot(el);flushSync(()=>root.render(<ProjectFiles {...props} />));return () => root.unmount(); }
