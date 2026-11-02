import { useEffect, useRef, useState } from 'react';
import { App, Modal, Select } from 'antd';
import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { Button, Notice, date, useApi, useJob } from './ui.jsx';
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
const initialContent = file => file.endsWith('.py') ? 'def run(ctx):\n    ctx.task.save_json("result", ctx.input)\n' : file.endsWith('.json') ? '{}\n' : '';
function SourceDiff({ original, modified, language }) {
  const container = useRef(null);
  useEffect(() => {
    const before = monaco.editor.createModel(original, language), after = monaco.editor.createModel(modified, language);
    const editor = monaco.editor.createDiffEditor(container.current, { readOnly: true, theme: 'vs', minimap: { enabled: false }, automaticLayout: true });
    editor.setModel({ original: before, modified: after });
    return () => { editor.setModel(null); editor.dispose(); before.dispose(); after.dispose(); };
  }, [original, modified, language]);
  return <div ref={container} style={{ height: '50vh' }} />;
}
export default function CodeEditor({ id, flow, onSaved, onDirty }) {
  const { call, live } = useApi(), { modal } = App.useApp(), job = useJob();
  const [files, setFiles] = useState(flow.files), [path, setPath] = useState(flow.files.find(name => name.endsWith('.py')) || 'workflow.json');
  const [source, setSource] = useState(null), [content, setContent] = useState(''), [newFile, setNewFile] = useState(null);
  const [history, setHistory] = useState(null), [revision, setRevision] = useState(null), [error, setError] = useState('');
  useEffect(() => { setFiles(flow.files); }, [flow.files]);
  useEffect(() => {
    let alive = true; const controller = new AbortController(); setSource(null); setError('');
    call(`/workflows/${id}/source?path=${encodeURIComponent(path)}`, 'GET', undefined, { signal: controller.signal }).then(value => { if (alive && live()) { setSource(value); setContent(value.content); } }).catch(e => { if (alive && live() && e.name !== 'AbortError') setError(e.message); });
    return () => { alive = false; controller.abort(); };
  }, [id, path, call, live]);
  const dirty = !!source && source.content !== content, language = path.endsWith('.py') ? 'python' : path.endsWith('.json') ? 'json' : 'plaintext';
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const choose = next => {
    if (path === next) return;
    if (dirty) modal.confirm({ title: '当前文件有未保存修改', content: '切换文件会放弃当前草稿。', okText: '放弃并切换', cancelText: '继续编辑', onOk: () => setPath(next) });
    else setPath(next);
  };
  return <><div className="wf-code-layout"><aside className="wf-file-tree"><Button disabled={flow.archived || job.busy} onClick={() => setNewFile('steps/new_step.py')}>新增文件</Button>{files.map(file => <button key={file} className={file === path ? 'on' : ''} onClick={() => choose(file)}>{file}</button>)}</aside><section className="wf-code-pane"><div className="wf-toolbar"><span>{path}{dirty ? ' · 未保存' : ''}</span><div className="wf-actions"><Button disabled={job.busy} onClick={() => job.run(async () => { const values = await call(`/workflows/${id}/revisions?path=${encodeURIComponent(path)}`); setHistory(values); setRevision(values[0] || null); })}>版本历史</Button><Button primary disabled={flow.archived || job.busy || !dirty} onClick={() => job.run(async () => { const value = await call(`/workflows/${id}/source?path=${encodeURIComponent(path)}`, 'POST', { content, expected_revision: source.revision }); setSource(value); setContent(value.content); onSaved(); })}>保存代码</Button></div></div><Notice error={error || job.error} />{source ? <Editor height="520px" path={id + '/' + path} language={language} value={content} theme="vs" onChange={value => setContent((value ?? '').replace(/\r\n?/g, '\n'))} options={{ readOnly: flow.archived, minimap: { enabled: false }, fontSize: 14, tabSize: 4, automaticLayout: true, scrollBeyondLastLine: false, ariaLabel: '步骤代码编辑器' }} /> : <p>正在加载源码…</p>}</section></div>
    <Modal open={newFile !== null} title="新增源码文件" onCancel={() => setNewFile(null)} footer={null}><form className="wf-form" onSubmit={e => { e.preventDefault(); job.run(async () => { if (files.includes(newFile)) throw new Error('文件已存在，请选择其他路径。'); await call(`/workflows/${id}/source?path=${encodeURIComponent(newFile)}`, 'POST', { content: initialContent(newFile), expected_revision: null }); setFiles([...files, newFile]); choose(newFile); setNewFile(null); }); }}><label>相对路径<input required value={newFile || ''} onChange={e => setNewFile(e.target.value)} /></label><Notice error={job.error} /><Button primary type="submit" disabled={job.busy}>创建文件</Button></form></Modal>
    <Modal width={900} open={history !== null} title={'代码版本 · ' + path} onCancel={() => setHistory(null)} footer={null}><div className="wf-actions"><Select style={{ minWidth: 300 }} value={revision?.id} options={(history || []).map(value => ({ value: value.id, label: `#${value.id} · ${date(value.created_at)}` }))} onChange={value => setRevision(history.find(item => item.id === value))} /><Button disabled={flow.archived || !revision || !source || job.busy} onClick={() => modal.confirm({ title: '恢复所选历史版本', content: '当前编辑草稿将被替换，服务端会检查文件版本。', okText: '恢复版本', cancelText: '取消', onOk: () => job.run(async () => { const value = await call(`/workflows/${id}/restore?path=${encodeURIComponent(path)}`, 'POST', { revision_id: revision.id, expected_revision: source.revision }); setSource(value); setContent(value.content); setHistory(null); onSaved(); }) })}>恢复此版本</Button></div><Notice error={job.error} /><p className="dim">左侧为历史版本，右侧为当前编辑内容。</p>{revision ? <SourceDiff original={revision.content} modified={content} language={language} /> : <p>暂无历史版本。</p>}</Modal>
  </>;
}
