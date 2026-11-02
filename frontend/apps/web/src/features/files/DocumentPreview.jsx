import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from 'antd';
import { authSession } from '../../services/authSession.js';
import { LOCAL_OFFICE_BYTES, TEXT_PREVIEW_BYTES } from '../../services/fileApi.js';
import { renderTaskMarkdown } from '../tasks/markdown.js';
import { parseSourceLocators } from '../knowledge/source/sourceLocator';
import { documentType, EMPTY_LOCATE_REQUEST, hasCitation, needsServerPreview, sniffDocument } from './previewModel.js';
import './documentPreview.css';

const statusLabels = { queued: '等待后台处理', reading: '正在读取原文件', converting: '正在生成预览', ready: '预览已就绪', failed: '预览处理失败', cancelled: '预览已取消', expired: '预览已过期' };
const locateLabels = { none: '', precise: '已定位引用文本', structural: '已定位到原文区域', partial: '仅完成部分定位', missing: '未找到对应原文', ambiguous: '存在多处相同文本，无法唯一定位', unavailable: '原文版本或引用映射已变化，无法精确定位' };
const api = () => globalThis.API;
function Surface({ blob, url, type, name, request, onStatus, renderMarkdown }) {
  const ref = useRef(null), statusRef = useRef(onStatus);statusRef.current = onStatus;
  const requestKey = JSON.stringify(request);
  useEffect(() => {
    let stopped = false, cleanup = () => {};const abort=new AbortController(),surface = document.createElement('div');surface.className = 'document-preview-surface knowledge-original-surface task-markdown';ref.current.replaceChildren(surface);
    import('../knowledge/source/renderSource.js').then(async ({ renderSource }) => { if (stopped) return; const dispose = await renderSource(surface, blob, { fileName: name, fileType: type, request, remoteUrl: url, signal:abort.signal, renderMarkdown, cancelled: () => stopped, onStatus: value => statusRef.current?.(locateLabels[value] ?? value) });cleanup = dispose;if (stopped) dispose(); }).catch(e => { if (!stopped) statusRef.current?.('预览失败：' + e.message, true); });
    return () => { stopped = true;abort.abort();cleanup();surface.remove(); };
  }, [blob, url, type, name, requestKey,renderMarkdown]);
  return <div className="document-preview-renderer" ref={ref} />;
}
function ServerTable({ job, request, signal, onError }) {
  const sheets = job.manifest.sheets || [], loc = parseSourceLocators(request.locators || []).find(l => l.type === 'sheet' && l.mapping === 'exact' && !request.unavailable);
  const [sheet, setSheet] = useState(() => sheets.find(s => s.name === loc?.sheet)?.id || sheets[0]?.id || '0');
  const [row, setRow] = useState(() => Math.max(0, (loc?.row_start || 1) - 1)), [column, setColumn] = useState(0), [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(null), [cellText, setCellText] = useState(null);
  useEffect(()=>{if(!expanded)return;const abort=new AbortController(),stop=()=>abort.abort();signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();setCellText(null);api().filePreviewCell(job.id,sheet,expanded.row,expanded.column,expanded.start,abort.signal).then(r=>{if(!abort.signal.aborted)setCellText(r.data);}).catch(e=>{if(!abort.signal.aborted)onError(e.message);});return()=>{abort.abort();signal?.removeEventListener('abort',stop);};},[job.id,sheet,expanded,signal]);
  useEffect(() => { const abort = new AbortController(), stop = () => abort.abort();signal?.addEventListener('abort', stop, { once: true });if (signal?.aborted) stop();setData(null);api().filePreviewRows(job.id, sheet, { row, column }, abort.signal).then(r => { if (!abort.signal.aborted) setData(r.data); }).catch(e => { if (!abort.signal.aborted) onError(e.message); });return () => { abort.abort();signal?.removeEventListener('abort', stop); }; }, [job.id, sheet, row, column, signal]);
  const selected = sheets.find(s => s.id === sheet), rowCount = Math.max(0, Math.min(200, (selected?.rowCount || 0) - row)), columns = Math.max(0, Math.min(50, (selected?.columnCount || 0) - column));
  const cells = new Map((data?.cells || []).map(c => [`${c.row}:${c.column}`, c]));
  return <div className="document-preview-table"><nav className="document-preview-pages"><label>工作表<select value={sheet} onChange={e => { setSheet(e.target.value);setRow(0);setColumn(0); }}>{sheets.map(s => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label>起始行<input type="number" min="1" max={selected?.rowCount || 1} value={row + 1} onChange={e => setRow(Math.max(0, Math.min((selected?.rowCount || 1) - 1, Number(e.target.value || 1) - 1)))} /></label><span>共 {selected?.rowCount || 0} 行 · {selected?.columnCount || 0} 列</span><button onClick={() => setRow(Math.max(0, row - 200))} disabled={!row}>上一页</button><button onClick={() => setRow(row + 200)} disabled={row + 200 >= (selected?.rowCount || 0)}>下一页</button><button onClick={() => setColumn(Math.max(0, column - 50))} disabled={!column}>前 50 列</button><button onClick={() => setColumn(column + 50)} disabled={column + 50 >= (selected?.columnCount || 0)}>后 50 列</button></nav>{!data ? <p role="status">读取表格分页…</p> : !rowCount ? <p>空工作表</p> : <div className="document-preview-table-scroll"><table><thead><tr><th>行</th>{Array.from({ length: columns }, (_, c) => <th key={c}>{column + c + 1}</th>)}</tr></thead><tbody>{Array.from({ length: rowCount }, (_, r) => <tr key={row + r} className={loc?.sheet === selected?.name && row + r + 1 >= loc.row_start && row + r + 1 <= (loc.row_end || loc.row_start) ? 'source-locate-block' : ''}><th>{row + r + 1}</th>{Array.from({ length: columns }, (_, c) => { const cell = cells.get(`${row + r}:${column + c}`);return <td key={c}><div className="document-cell-text">{cell?.text}</div>{cell?.length > 240 && <button onClick={()=>setExpanded({row:cell.row,column:cell.column,start:0})}>展开单元格</button>}</td>; })}</tr>)}</tbody></table></div>}<Modal open={!!expanded} title={expanded?`第 ${expanded.row+1} 行，第 ${expanded.column+1} 列`:"单元格"} onCancel={()=>setExpanded(null)} footer={null}><pre>{cellText?.text??"正在读取…"}</pre>{expanded&&<nav className="document-preview-pages"><button disabled={!expanded.start} onClick={()=>setExpanded({...expanded,start:Math.max(0,expanded.start-16384)})}>上一段</button><button disabled={!cellText||expanded.start+16384>=cellText.length} onClick={()=>setExpanded({...expanded,start:expanded.start+16384})}>下一段</button></nav>}</Modal></div>;
}
export function DocumentPreview({ source, fileName = '', fileType = '', mediaType = '', size = -1, loadBlob, request = EMPTY_LOCATE_REQUEST, parentSignal, onStatus, onArtifact, onEvidence, onWiki, renderMarkdown = renderTaskMarkdown, htmlPolicy = 'interactive' }) {
  const sourceKey = JSON.stringify(source), requestKey = JSON.stringify(request);
  const input = useMemo(() => ({ source, request, declared: documentType(fileName, fileType, mediaType) }), [sourceKey, requestKey, fileName, fileType, mediaType]);
  const refs = useRef({ loadBlob, onStatus });refs.current = { loadBlob, onStatus };
  const [state, setState] = useState(null), [error, setError] = useState(''), [status, setStatus] = useState(''), [background, setBackground] = useState(false), [refresh, setRefresh] = useState(0), [showSource, setShowSource] = useState(false);
  const life = useRef(null),mediaRef=useRef(null); useEffect(()=>{const media=mediaRef.current;return()=>{if(media){media.pause();media.removeAttribute("src");media.load();}};},[state?.url]);
  const updateStatus = (text, failed = false) => { setStatus(text);refs.current.onStatus?.(text);if (failed) setError(text); };
  useEffect(() => { setBackground(false);setShowSource(false); }, [sourceKey]);
  useEffect(() => {
    const abort = new AbortController();life.current = abort;let objectUrl, timer, pollStarted = Date.now();
    const stop = () => abort.abort();parentSignal?.addEventListener('abort', stop, { once: true });if (parentSignal?.aborted) stop();
    const epoch = authSession.getSnapshot().version, unsubscribe = authSession.subscribe(() => { if (authSession.getSnapshot().version !== epoch) {stop();clearTimeout(timer);if(objectUrl)URL.revokeObjectURL(objectUrl);setState(null);setError('');setStatus('账号已变化，请重新打开文件');} });
    const current = () => !abort.signal.aborted && authSession.getSnapshot().version === epoch;
    setState(null);setError('');setStatus('正在读取文件…');
    const prepareJob = async job => {
      if (!current()) return;
      setState({ job });updateStatus(job.stage || statusLabels[job.status] || '处理中');
      if (job.status !== 'ready') return;
      const manifest = job.manifest || {};
      if (manifest.kind === 'table') { setState({ job, kind: 'table' });return; }
      const url = api().filePreviewUrl(job.id);
      const type = manifest.kind === 'native' ? input.declared : { ext: 'pdf', kind: 'pdf' };let locate = input.request;
      if (type.kind === 'pdf' && hasCitation(locate)) {
        const exact = parseSourceLocators(locate.locators || []).filter(l => l.mapping === 'exact' && !l.partial);
        const targets = exact.filter(l => l.type === 'pdf' && input.declared.kind==='pdf' || l.type === 'slide' && manifest.slideMappingExact).map(l => ({ page: l.page || l.slide, bbox: l.bbox, quote: l.quote || locate.scope || locate.quotes?.[0], granularity: l.bbox ? 'block' : 'page' })).filter(t=>t.page>0&&(!manifest.pageCount||t.page<=manifest.pageCount));
        let resolution = { targets, reason: locate.unavailable ? 'unavailable' : undefined };
        if (!targets.length && !locate.unavailable && (locate.scope || locate.quotes?.[0])) { const result = await api().filePreviewLocate(job.id, locate.scope || locate.quotes[0], abort.signal);resolution = { targets: (result.data.pages || []).map(page => ({ page, quote: locate.scope || locate.quotes[0], granularity: 'text' })), reason: result.data.reason }; }
        locate = { ...locate, pdfResolution: resolution };
      }
      if (current()) setState({ job, url, kind: type.kind, ext: type.ext, request: locate });
    };
    const poll = async id => { if (!current()) return;try { if (document.hidden) { timer = setTimeout(() => void poll(id), 3000);return; }const result = await api().filePreviewStatus(id, abort.signal);if (!current()) return;await prepareJob(result.data);if (['queued', 'reading', 'converting'].includes(result.data.status)) { if (Date.now() - pollStarted < 300000) timer = setTimeout(() => void poll(id), 3000);else setState(previous => ({ ...previous, paused: true })); } } catch (e) { if (current()) setError(e.message); } };
    const run = async () => {
      const kind = input.declared.kind;
      const useBackground = background || size > LOCAL_OFFICE_BYTES && !['text', 'markdown', 'html', 'mermaid'].includes(kind);
      if (useBackground) { if (!source || !api()?.createFilePreview) throw new Error('此来源暂不支持后台预览');const result = await api().createFilePreview(input.source, kind === 'pdf' && hasCitation(input.request), abort.signal);if (!current()) return;await prepareJob(result.data);if (['queued', 'reading', 'converting'].includes(result.data.status)) timer = setTimeout(() => void poll(result.data.id), 3000);return; }
      if (size > TEXT_PREVIEW_BYTES && ['text', 'markdown', 'html', 'mermaid'].includes(kind)) throw new Error('文本文件超过 5 MiB 预览上限，请下载查看。');
      const blob = await refs.current.loadBlob(abort.signal);if (!current()) return;
      if (blob.size > LOCAL_OFFICE_BYTES && ['docx', 'pptx', 'excel'].includes(kind)) { setBackground(true);return; }
      const type = await sniffDocument(blob, input.declared);if (!current()) return;
      if(await needsServerPreview(blob,type.kind)){if(current())setBackground(true);return;}if(!current())return;
      if (['text', 'markdown', 'html', 'mermaid'].includes(type.kind)) { if (blob.size > TEXT_PREVIEW_BYTES) throw new Error('文本文件超过 5 MiB 预览上限，请下载查看。');const text = await blob.text();if (current()) { setState({ ...type, text, blob });updateStatus(''); } }
      else if (['image', 'audio', 'video'].includes(type.kind) || type.kind === 'pdf' && input.declared.kind === 'pdf' && !hasCitation(input.request)) { objectUrl = URL.createObjectURL(blob.type && blob.type !== 'application/octet-stream' ? blob : new Blob([blob], { type: mediaType || ({ pdf: 'application/pdf' }[type.kind]) || blob.type }));if (current()) { setState({ ...type, url: objectUrl });updateStatus(input.request.unavailable?locateLabels.unavailable:hasCitation(input.request)?locateLabels.structural:''); } }
      else { setState({ ...type, blob, request: input.request });updateStatus(type.kind === 'unsupported' ? '此格式暂不支持在线预览，请下载原文件。' : '正在渲染预览…'); }
    };
    void run().catch(e => { if (current()) setError(e.message); });
    return () => { abort.abort();clearTimeout(timer);unsubscribe();parentSignal?.removeEventListener('abort', stop);if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [input, size, background, refresh, parentSignal]);
  const action = async kind => { try { const result = await api().filePreviewAction(state.job.id, kind, life.current.signal);if (!life.current.signal.aborted) { setState({ job: result.data });setRefresh(value => value + 1); } } catch (e) { if (!life.current.signal.aborted) setError(e.message); } };
  let body;
  if (state?.kind === 'html') body = <><button onClick={() => setShowSource(v => !v)}>{showSource ? '显示预览' : '查看源码'}</button>{showSource ? htmlPolicy==='source'?<Surface blob={state.blob} type="txt" name={fileName} request={input.request} onStatus={updateStatus}/>:<pre>{state.text}</pre> : <iframe title={fileName} srcDoc={(htmlPolicy==='source'?`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'">`:'')+state.text} sandbox={htmlPolicy==='source'?'':'allow-scripts'} referrerPolicy="no-referrer" />}</>;
  else if (['markdown','text','mermaid'].includes(state?.kind)&&hasCitation(input.request)) body=<Surface blob={state.blob} type={state.ext} name={fileName} request={input.request} onStatus={updateStatus}/>;
  else if (state?.kind === 'markdown') body = <div className="task-markdown" onClick={e => { const evidence = e.target.closest('[data-knowledge-evidence]'), artifact = e.target.closest('[data-artifact-id]');if (evidence) { e.preventDefault();onEvidence?.(evidence.dataset.knowledgeEvidence); }else if (artifact) { e.preventDefault();onArtifact?.(artifact.dataset.artifactId, artifact.dataset.artifactVersion ? Number(artifact.dataset.artifactVersion) : undefined); } }} dangerouslySetInnerHTML={{ __html: renderMarkdown(state.text) }} />;
  else if (state?.kind === 'text' || state?.kind === 'mermaid') body = <pre>{state.text}</pre>;
  else if (state?.kind === 'image' && state.url) body = <img src={state.url} alt={fileName} onError={() => updateStatus('浏览器无法解码此图片，请下载查看', true)} />;
  else if (['audio', 'video'].includes(state?.kind) && state.url) { const Media = state.kind;const time = parseSourceLocators(input.request.locators || []).find(l => l.type === 'time' && l.mapping === 'exact');body = <Media ref={mediaRef} controls src={state.url} onLoadedMetadata={e => { if (time && !input.request.unavailable) e.currentTarget.currentTime = (time.start_ms || 0) / 1000; }} onError={() => updateStatus('浏览器不支持此媒体编码，请下载查看', true)} />; }
  else if (state?.kind === 'pdf' && state.url && !hasCitation(input.request)) body = <iframe src={state.url} title={fileName || 'PDF 预览'} referrerPolicy="no-referrer" />;
  else if (state?.kind === 'table') body = <ServerTable job={state.job} request={input.request} signal={life.current?.signal} onError={setError} />;
  else if (state?.kind && state.kind !== 'unsupported') body = <Surface blob={state.blob} url={state.url} type={state.ext} name={fileName} request={state.request || input.request} onStatus={updateStatus} renderMarkdown={renderMarkdown} />;
  return <section className="document-preview" onClick={event=>{const wiki=event.target.closest("[data-wiki-page]");if(wiki){event.preventDefault();onWiki?.(wiki.dataset.wikiPage,wiki.textContent);}}}>{error ? <p role="alert" className="document-preview-error">{error}</p> : status && <p role="status">{status}</p>}{body}{state?.job && <nav className="document-preview-pages">{['queued', 'reading', 'converting'].includes(state.job.status) && <button onClick={() => void action('cancel')}>取消处理</button>}{['failed', 'cancelled', 'expired'].includes(state.job.status) && <><p role="alert">{state.job.error || statusLabels[state.job.status]}</p><button onClick={() => void action('retry')}>重新生成预览</button></>}{state.paused && <button onClick={() => setRefresh(v => v + 1)}>后台仍在处理，刷新进度</button>}</nav>}{!error&&state?.blob&&['docx','pptx','excel'].includes(input.declared.kind)&&!background&&<button onClick={()=>setBackground(true)}>使用后台预览</button>}{error && ['docx', 'pptx', 'excel'].includes(input.declared.kind) && !background && <button onClick={() => setBackground(true)}>尝试后台预览</button>}</section>;
}
