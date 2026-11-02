import { esc, lifetime, knowledgeModal, modalFooter } from './lifecycle.js';
import { field, choice, editForm, confirmAction, operationKey, unwrap, libraryHref, saveBlob, parseFaqImport } from './managementForms.js';
import { openKnowledgeBrowser } from './browser.js';
import { openKnowledgeUpload, refreshAfterUploads } from './uploads.js';
import './management.css';

const jsonView = value => '<pre class="knowledge-json">' + esc(JSON.stringify(value, null, 2)) + '</pre>';
const rowsOf = value => { const d = unwrap(value); return Array.isArray(d) ? d : d?.data || d?.items || d?.entries || d?.pages || d?.folders || d?.tags || d?.issues || []; };
const names = { document: '文档', faq: 'FAQ', wiki: 'Wiki' };
function appliedConfiguration(kb) {
  const idx=kb.indexing_strategy||{},graph=kb.extract_config||{},image=kb.vlm_config||{},wiki=kb.wiki_config||{};
  const enabled=[['RAG 检索',idx.vector_enabled||idx.keyword_enabled],['Wiki',idx.wiki_enabled],['知识图谱',idx.graph_enabled&&graph.enabled],['图像理解',image.enabled]].map(([label,on])=>label+'：'+(on?'已开启':'未开启')).join(' · ');
  const rows=[['Wiki 内容生成要求',wiki.content_instructions],['Wiki 提取重点',wiki.extraction_instructions],['图片解析要求',image.custom_instructions],['图谱提取要求',graph.custom_instructions],['图谱关系类型',(graph.tags||[]).join('、')],['解析规则',(kb.chunking_config?.parser_engine_rules||[]).map(r=>(r.file_types||[]).join('、')+' → '+r.engine).join('；')]];
  return '<section class="card card-pad"><p>'+esc(enabled)+'</p><details><summary>查看已生效的业务配置</summary><dl class="knowledge-applied-config">'+rows.map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(value||'采用默认配置')+'</dd>').join('')+'</dl>'+(graph.text?'<p class="dim">图谱配置示例只用于抽取规则，不作为真实知识入库。</p>':'')+'</details></section>';
}
const status = value => ({ pending: '待处理', processing: '处理中', finalizing: '生成增强内容', completed: '已完成', failed: '失败', cancelled: '已取消', deleting: '删除中', draft: '草稿', ready: '已就绪', sent: '等待核对', received: '待恢复本地记录' }[value] || value || '未知');

export async function renderOperations(host) {
  const life = lifetime(host); let pending = false, timer; const deadline = Date.now() + 300000;
  life.cleanup(() => clearTimeout(timer));
  const load = async () => {
    if (!life.live() || pending) return; pending = true;
    try {
      const { data: rows } = await API.fetchKnowledgeOperations(life.signal); if (!life.live()) return;
      host.innerHTML = '<div class="tc-head"><h3>处理记录</h3><button class="btn btn-ghost btn-sm" data-refresh>刷新</button></div><p class="dim">超时操作请先核对远端结果。已收到远端响应的操作可恢复本地记录，无需重复创建。</p><div role="alert" class="knowledge-error"></div>' + rows.map((r, i) => '<div class="knowledge-operation"><div><strong>' + esc(r.operation) + '</strong><div class="dim">' + esc(r.id) + ' · ' + esc(status(r.status)) + '</div></div><div class="knowledge-actions">' + (r.operation === 'faq.import' && r.result ? '<button class="btn btn-ghost btn-sm" data-progress="' + i + '">导入进度</button>' : '') + (r.status === 'received' ? '<button class="btn btn-primary btn-sm" data-recover="' + i + '">恢复记录</button>' : '') + '</div></div>').join('') + (!rows.length ? '<div class="empty">暂无操作</div>' : '');
      host.querySelector('[data-refresh]').onclick = load;
      host.querySelectorAll('[data-progress]').forEach(b => b.onclick = () => showProgress(rows[Number(b.dataset.progress)].id, life.live));
      host.querySelectorAll('[data-recover]').forEach(b => b.onclick = async () => { if (pending) return; pending = true; b.disabled = true; try { await API.recoverKnowledgeOperation(rows[Number(b.dataset.recover)].id, life.signal); pending = false; if (life.live()) await load(); } catch (error) { if (life.live()) host.querySelector('[role=alert]').textContent = error.message; } finally { pending = false; if (life.live()) b.disabled = false; } });
      if (rows.some(r => ['sent', 'received'].includes(r.status)) && Date.now() < deadline) { clearTimeout(timer); timer = setTimeout(load, 3000); }
    } catch (error) { if (life.live() && error.name !== 'AbortError') host.innerHTML = '<p role="alert">' + esc(error.message) + '</p><button class="btn btn-ghost" data-refresh>刷新处理记录</button>'; host.querySelector('[data-refresh]')?.addEventListener('click', load); }
    finally { pending = false; }
  }; await load();
}

function showProgress(id, valid) {
  knowledgeModal('FAQ 导入进度', '<div data-progress-result>正在读取…</div><button class="btn btn-ghost" data-refresh>刷新</button><div class="modal-foot"><button class="btn btn-ghost" data-close>关闭</button></div>', valid, ctx => {
    let timer, pending = false; const deadline = Date.now() + 300000; ctx.cleanup(() => clearTimeout(timer));
    const load = async () => { if (pending || !ctx.live()) return; pending = true; try { const response = await API.fetchKnowledgeProgress(id, ctx.signal); if (!ctx.live()) return; const d = unwrap(response.data); ctx.box.querySelector('[data-progress-result]').innerHTML = '<p>状态：' + esc(status(d.status)) + '</p>' + jsonView(d) + (d.hasFailureReport ? '<button class="btn btn-ghost" data-errors>下载完整错误明细</button>' : ''); ctx.box.querySelector('[data-errors]')?.addEventListener('click', async event => { const button = event.currentTarget; button.disabled = true; try { const file = await API.downloadKnowledgeErrors(id, ctx.signal); if (ctx.live()) saveBlob(file.data, 'faq-errors.csv'); } catch (error) { ctx.error(error); } finally { if (ctx.live()) button.disabled = false; } }); if (['pending', 'processing', 'running'].includes(d.status) && Date.now() < deadline) { clearTimeout(timer); timer = setTimeout(() => void load().catch(ctx.error), 3000); } } finally { pending = false; } };
    ctx.action('[data-refresh]', load); void load().catch(ctx.error);
  });
}

export async function renderLibraryDetail(el, connectionId, collectionId, options = {}) {
  el.innerHTML = '<div class="page knowledge-manager"><a class="btn btn-ghost" href="#/settings?tab=knowledge">返回知识库</a><div data-library>正在读取知识库…</div></div>';
  const host = el.querySelector('[data-library]'), life = lifetime(host);
  const request = async (operation, args = {}, signal = life.signal, key) => (await API.manageKnowledge(connectionId, { operation, collectionId, ...args, ...(key ? { requestKey: key } : {}) }, signal)).data;
  let library, canManage = false;
  try {
    const [detail, catalog] = await Promise.all([request('kb.get'), API.fetchKnowledgeCollections(connectionId, life.signal)]); if (!life.live()) return;
    library = unwrap(detail.result); canManage = !!catalog.data.collections.find(c => c.id === collectionId)?.canManage;
  } catch (error) { if (life.live()) host.innerHTML = '<p role="alert">' + esc(error.message) + '</p>'; return; }
  let page = 1, mode = library.type === 'faq' ? 'faq' : library.type === 'wiki' ? 'wiki' : 'document', keyword = '', generation = 0, timer, loading = false; const deadline = Date.now() + 300000;
  life.cleanup(() => { generation++; clearTimeout(timer); });
  host.innerHTML = '<div class="tc-head"><div><h2>' + esc(library.name) + '</h2><p class="dim">' + esc(library.description || '暂无说明') + '</p><p class="dim">' + esc(names[library.type] || library.type) + ' · ' + esc(collectionId) + (canManage ? '' : ' · 只读') + '</p></div><div class="knowledge-actions"><button class="btn btn-primary" data-search>检索</button>' + (canManage ? '<button class="btn btn-ghost" data-config>配置</button><button class="btn btn-ghost" data-resources>模型与存储</button><button class="btn btn-ghost knowledge-danger" data-delete>删除知识库</button>' : '') + '</div></div><div class="knowledge-mode-tabs">' + ['document', ...(library.type === 'faq' ? ['faq'] : []), ...(library.type === 'wiki' || library.indexing_strategy?.wiki_enabled ? ['wiki'] : [])].map(k => '<button class="btn btn-ghost" data-mode="' + k + '">' + names[k] + '</button>').join('') + '</div><section class="card card-pad"><div data-toolbar></div><div role="alert" class="knowledge-error"></div><div data-list></div><div class="knowledge-actions"><button class="btn btn-ghost btn-sm" data-prev>上一页</button><span data-page></span><button class="btn btn-ghost btn-sm" data-next>下一页</button></div></section><section class="card card-pad" data-extra></section>';
  host.querySelector('.tc-head').insertAdjacentHTML('afterend',appliedConfiguration(library));
  if (!options.embedded) {
  const maintenance = document.createElement('details');maintenance.className='knowledge-maintenance';maintenance.innerHTML='<summary>内容管理 · 文档、FAQ 与 Wiki 编辑维护</summary>';
  [...host.children].filter(node=>node!==host.querySelector('.tc-head')&&!node.querySelector('.knowledge-applied-config')).forEach(node=>maintenance.append(node));
  const explorer=document.createElement('section');explorer.className='card card-pad';host.append(explorer,maintenance);
  void import('./KnowledgeExplorer.jsx').then(({mountKnowledgeExplorer})=>{if(life.live())mountKnowledgeExplorer(explorer,{name:library.name,connectionId,collectionId,driver:'nebulae-v100-rest',contentKind:library.type},(payload,signal)=>API.readKnowledgeCatalog(connectionId,collectionId,payload,signal),life);}).catch(error=>{if(life.live())explorer.textContent=error.message;});
  } else {
    host.querySelector('.tc-head h2').textContent = '内容管理';
    host.querySelectorAll('.tc-head p').forEach(node => node.remove());
  }

  const fail = e => { if (life.live() && e.name !== 'AbortError') host.querySelector('[role=alert]').textContent = e.message; };
  const mut = (op, args, ctx, key) => request(op, args, ctx.signal, key);
  const refresh = () => load();
  const inspect = (title, result) => knowledgeModal(title, jsonView(result) + '<div class="modal-foot"><button class="btn btn-ghost" data-close>关闭</button></div>', life.live, () => {});
  const busyRead = async (button, action) => { if (button.disabled || !life.live()) return; button.disabled = true; try { await action(); } catch (e) { fail(e); } finally { if (life.live()) button.disabled = false; } };
  host.querySelector('[data-search]').onclick = () => openKnowledgeBrowser({ name: library.name, connectionId, collectionId, contentKind: mode, enhanced: true }, (payload, signal) => API.readKnowledgeCatalog(connectionId, collectionId, payload, signal), life.live);
  host.querySelector('[data-config]')?.addEventListener('click', event => busyRead(event.currentTarget, async () => { const models = unwrap((await request('models')).result); if (life.live()) configureLibrary(library, life.live, request, async () => { if (life.live()) await renderLibraryDetail(el, connectionId, collectionId, options); }, models); }));
  host.querySelector('[data-resources]')?.addEventListener('click', event => busyRead(event.currentTarget, async () => { const [m, s] = await Promise.all([request('models'), request('storage')]); if (!life.live()) return; const models = unwrap(m.result), storage = unwrap(s.result); const options = rows => rows.map(r => [r.id, r.name || r.id]); editForm('模型与存储', '<p class="dim">Embedding 仅在空库时可切换；向量存储在创建后固定。其他业务配置保留。</p>' + choice('embedding_model_id', 'Embedding', options(models.filter(r => /embedding/i.test(r.type))), library.embedding_model_id) + choice('summary_model_id', '摘要模型', options(models.filter(r => /chat|knowledgeqa|llm/i.test(r.type))), library.summary_model_id) + choice('storage_backend_id', '存储', [['', '当前空间默认'], ...options(storage)], library.storage_backend_id || ''), life.live, (v, ctx, key) => request('kb.resources', { payload: v }, ctx.signal, key), async () => { if (life.live()) await renderLibraryDetail(el, connectionId, collectionId, options); }); }));
  host.querySelector('[data-delete]')?.addEventListener('click', event => busyRead(event.currentTarget, async () => { const usage = unwrap((await request('kb.references')).result); if (!life.live()) return; if (usage.blocked) return inspect('知识库仍有引用，不能删除', { 当前账号引用: usage.references, 其他账号引用: usage.otherReferences ? '还有其他账号引用，请联系管理员处理' : '无' }); confirmAction('删除知识库', '删除「' + library.name + '」及其远端内容？历史发布引用也会阻止删除。', life.live, (signal, key) => request('kb.delete', {}, signal, key), () => { location.hash = '#/settings?tab=knowledge'; }); }));
  const docForm = (row = null) => editForm(row ? '编辑手工文档' : '新增 Markdown', field('title', '标题', row?.title || '') + field('content', 'Markdown 正文', row?.metadata?.content || row?.content || '', 'textarea') + choice('status', '发布状态', [['draft', '草稿'], ['publish', '发布并索引']], (row?.metadata?.status || row?.parse_status) === 'draft' ? 'draft' : 'publish'), life.live, (v, ctx, key) => mut(row ? 'document.update' : 'document.manual', { resourceId: row?.id, payload: v }, ctx, key), refresh);
  const faqForm = (row = null) => editForm(row ? '编辑 FAQ' : '新增 FAQ', field('standard_question', '标准问', row?.standard_question || '') + field('answers', '答案（每行一个）', (row?.answers || []).join('\n'), 'textarea') + field('similar_questions', '相似问（每行一个）', (row?.similar_questions || []).join('\n'), 'textarea') + field('negative_questions', '负样例（每行一个）', (row?.negative_questions || []).join('\n'), 'textarea') + choice('answer_strategy', '答案策略', [['all', '返回全部答案'], ['random', '随机一个答案']], row?.answer_strategy || 'all') + field('tag_name', '标签名称', row?.tag_name || '') + field('is_enabled', '启用', row?.is_enabled !== false, 'checkbox') + field('is_recommended', '推荐', row?.is_recommended || false, 'checkbox'), life.live, (v, ctx, key) => { if (!v.standard_question.trim()) throw new Error('请填写标准问'); for (const k of ['answers', 'similar_questions', 'negative_questions']) v[k] = v[k].split(/\r?\n/).map(x => x.trim()).filter(Boolean); return mut(row ? 'faq.update' : 'faq.create', { resourceId: row?.id?.toString(), payload: v }, ctx, key); }, refresh);
  const wikiForm = (row = null) => editForm(row ? '编辑 Wiki 页面' : '新增 Wiki 页面', field('title', '标题', row?.title || '') + (!row ? field('slug', '页面路径（可留空自动生成）') : '') + field('content', 'Markdown 正文', row?.content || '', 'textarea'), life.live, (v, ctx, key) => mut(row ? 'wiki.update' : 'wiki.create', { resourceId: row?.slug, payload: { ...Object.fromEntries(Object.entries(v).filter(([k, value]) => k !== 'slug' || value)), ...(row ? { version: row.version } : {}) } }, ctx, key), refresh);
  function toolbar() {
    host.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('btn-primary', b.dataset.mode === mode));
    host.querySelector('[data-toolbar]').innerHTML = '<div class="knowledge-actions knowledge-list-tools"><label class="field knowledge-copy">按标题或内容筛选<input data-keyword value="' + esc(keyword) + '"></label><button class="btn btn-ghost" data-refresh>刷新</button>' + (canManage ? (mode === 'document' ? '<button class="btn btn-primary" data-new>Markdown</button><button class="btn btn-ghost" data-url>导入 URL</button><button class="btn btn-ghost" data-upload>上传文件</button>' : mode === 'faq' ? '<button class="btn btn-primary" data-new>新增 FAQ</button><button class="btn btn-ghost" data-import>导入 FAQ</button><button class="btn btn-ghost" data-batch>批量维护</button>' : '<button class="btn btn-primary" data-new>新增页面</button>') : '') + (mode === 'faq' ? '<button class="btn btn-ghost" data-export="json">导出 JSON</button><button class="btn btn-ghost" data-export="csv">导出 CSV</button>' : '') + '</div>';
    host.querySelector('[data-refresh]').onclick = () => { keyword = host.querySelector('[data-keyword]').value; page = 1; void load(); };
    host.querySelector('[data-new]')?.addEventListener('click', () => mode === 'document' ? docForm() : mode === 'faq' ? faqForm() : wikiForm());
    host.querySelector('[data-url]')?.addEventListener('click', () => editForm('导入 URL', field('url', '网页或文件 URL', '', 'url') + field('title', '标题'), life.live, (v, ctx, key) => mut('document.url', { payload: v }, ctx, key), refresh));
    if (canManage && library.type !== 'faq') {
      const actions = host.querySelector('[data-toolbar] .knowledge-actions');
      // Wiki libraries also accept source documents, independently of the page editor.
      if (!actions.querySelector('[data-upload]')) actions.insertAdjacentHTML('beforeend', '<button class="btn btn-ghost" data-upload>上传文件</button>');
      actions.insertAdjacentHTML('beforeend', '<button class="btn btn-ghost" data-upload-folder>上传文件夹</button>');
      const target = { connectionId, collectionId, name: library.name };
      actions.querySelector('[data-upload]').onclick = () => openKnowledgeUpload({ target, valid: life.live });
      actions.querySelector('[data-upload-folder]').onclick = () => openKnowledgeUpload({ target, folder: true, valid: life.live });
    }
    host.querySelector('[data-import]')?.addEventListener('click', () => faqImport(connectionId, collectionId, life.live, refresh));
    host.querySelector('[data-batch]')?.addEventListener('click', () => batchFaq(life.live, request, host, refresh));
    host.querySelectorAll('[data-export]').forEach(b => b.onclick = () => busyRead(b, async () => { const response = await API.downloadKnowledgeFile(connectionId, { collectionId, format: b.dataset.export }, life.signal); if (life.live()) saveBlob(response.data, library.name + '.' + b.dataset.export); }));
  }
  async function load() {
    const stamp = ++generation; clearTimeout(timer); loading = true; host.querySelector('[role=alert]').textContent = '';
    const op = mode === 'document' ? 'documents.list' : mode === 'faq' ? 'faq.list' : 'wiki.pages';
    try {
      const response = await request(op, { page, pageSize: 20, ...(mode === 'wiki' ? { query: keyword } : { keyword }) }); if (!life.live() || stamp !== generation) return;
      const raw = response.result, d = unwrap(raw), rows = rowsOf(raw), total = raw.total ?? d.total ?? rows.length;
      host.querySelector('[data-list]').innerHTML = rows.map((r, i) => '<article class="knowledge-managed-row">' + (mode === 'faq' && canManage ? '<input type="checkbox" data-entry="' + esc(r.id) + '" aria-label="选择 ' + esc(r.standard_question) + '">' : '') + '<div class="knowledge-copy"><strong>' + esc(r.title || r.standard_question || r.file_name || r.slug || r.id) + '</strong>' + (r.folder_path ? '<div class="dim knowledge-id">来源路径：' + esc(r.folder_path + '/' + (r.file_name || r.title || r.id)) + '</div>' : '') + '<div class="dim">' + esc(r.slug || r.id) + '</div><div class="dim">' + esc(mode === 'document' ? status(r.parse_status) : mode === 'faq' ? (r.is_enabled ? '启用' : '停用') + (r.is_recommended ? ' · 推荐' : '') : '版本 ' + (r.version || 1)) + '</div>' + (r.error_message ? '<p class="knowledge-error">' + esc(r.error_message) + '</p>' : '') + '</div><div class="knowledge-actions"><button class="btn btn-ghost btn-sm" data-row="' + i + '" data-action="read">阅读</button>' + (canManage ? '<button class="btn btn-ghost btn-sm" data-row="' + i + '" data-action="edit">编辑</button><button class="btn btn-ghost btn-sm knowledge-danger" data-row="' + i + '" data-action="delete">删除</button>' : '') + (mode === 'document' ? '<button class="btn btn-ghost btn-sm" data-row="' + i + '" data-action="stages">处理阶段</button><button class="btn btn-ghost btn-sm" data-row="' + i + '" data-action="download">下载原文件</button>' + (canManage ? '<button class="btn btn-ghost btn-sm" data-row="' + i + '" data-action="reparse">重新解析</button><button class="btn btn-ghost btn-sm" data-row="' + i + '" data-action="cancel">取消解析</button>' : '') : mode === 'wiki' ? '<button class="btn btn-ghost btn-sm" data-row="' + i + '" data-action="history">历史版本</button>' + (canManage ? '<button class="btn btn-ghost btn-sm" data-row="' + i + '" data-action="move">移动</button>' : '') : '') + '</div></article>').join('') || '<div class="empty">暂无内容</div>';
      host.querySelector('[data-page]').textContent = '第 ' + page + ' 页 · 共 ' + total + ' 条'; host.querySelector('[data-prev]').disabled = page <= 1; host.querySelector('[data-next]').disabled = page * 20 >= total;
      host.querySelectorAll('[data-row]').forEach(b => b.onclick = () => busyRead(b, async () => {
        const row = rows[Number(b.dataset.row)], action = b.dataset.action, resourceId = String(mode === 'wiki' ? row.slug : row.id), currentMode = mode;
        if (action === 'read') return openKnowledgeBrowser({ name: row.title || row.standard_question || library.name, connectionId, collectionId, contentKind: mode, initialDocumentId: resourceId, enhanced: true }, (payload, signal) => API.readKnowledgeCatalog(connectionId, collectionId, payload, signal), life.live);
        if (action === 'delete') return confirmAction('删除内容', '确认删除所选' + names[mode] + '？此操作修改远端内容。', life.live, (signal, key) => request(currentMode + '.delete', currentMode === 'faq' ? { payload: { ids: [Number(row.id)] } } : { resourceId }, signal, key), refresh);
        if (action === 'edit') { const result = unwrap((await request(mode + '.get', { resourceId })).result); if (!life.live()) return; if (currentMode === 'document') { if (result.type !== 'manual' && result.source !== 'manual') throw new Error('仅手工 Markdown 可替换正文；上传文件可删除后重新上传'); docForm(result); } else if (currentMode === 'faq') faqForm(result); else wikiForm(result); }
        if (action === 'stages') { const result = await request('document.stages', { resourceId }); if (life.live()) inspect('文档处理阶段', unwrap(result.result)); }
        if (action === 'download') { const response = await API.downloadKnowledgeFile(connectionId, { collectionId, documentId: resourceId }, life.signal); if (life.live()) saveBlob(response.data, row.file_name || row.title || 'document'); }
        if (action === 'reparse' || action === 'cancel') confirmAction(action === 'reparse' ? '重新解析' : '取消解析', action === 'reparse' ? '重新解析可能重新生成索引、摘要和 Wiki 内容。' : '取消此文档尚未完成的解析？', life.live, (signal, key) => request('document.' + action, { resourceId }, signal, key), refresh);
        if (action === 'history') wikiHistory(resourceId, life.live, canManage, request, refresh);
        if (action === 'move') editForm('移动 Wiki 页面', field('folder_id', '目标目录 ID（空为根目录）'), life.live, (v, ctx, key) => mut('wiki.move', { payload: { slug: resourceId, folder_id: v.folder_id } }, ctx, key), refresh);
      }));
      let processing = rows.some(r => ['pending', 'processing', 'finalizing'].includes(r.parse_status));
      if (mode === 'faq') processing = unwrap((await request('kb.get')).result).is_processing;
      if (mode === 'wiki') { const stats = unwrap((await request('wiki.stats')).result); processing = stats.is_active || stats.pending_tasks > 0; }
      if (life.live() && stamp === generation && processing && Date.now() < deadline) timer = setTimeout(load, 3000);
    } catch (error) { if (stamp === generation) fail(error); }
    finally { if (stamp === generation) loading = false; }
  }
  host.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; page = 1; keyword = ''; toolbar(); extras(); void load(); });
  host.querySelector('[data-prev]').onclick = () => { if (!loading && page > 1) { page--; void load(); } };
  host.querySelector('[data-next]').onclick = () => { if (!loading) { page++; void load(); } };
  let extraGeneration = 0;
  function extras() {
    const extraStamp = ++extraGeneration;
    const panel = host.querySelector('[data-extra]'); panel.innerHTML = mode === 'wiki' ? '<h3>Wiki 索引与维护</h3><div class="knowledge-actions">' + [['folders', '目录'], ['index', '索引'], ['stats', '统计'], ['graph', '关系'], ['lint', '一致性检查'], ['issues', '问题列表'], ...(canManage ? [['links', '重建链接'], ['fix', '自动修复']] : [])].map(([op, label]) => '<button class="btn btn-ghost" data-extra-op="' + op + '">' + label + '</button>').join('') + '</div>' + (canManage ? '<button class="btn btn-primary" data-folder-create>新建目录</button>' : '') + '<div data-extra-result></div>' : '';
    panel.hidden = false;
    panel.insertAdjacentHTML('afterbegin', '<button class="btn btn-ghost" data-tags>标签管理</button>');
    panel.querySelector('[data-tags]').onclick = () => openTags(life.live, request, canManage);
    panel.querySelector('[data-folder-create]')?.addEventListener('click', () => editForm('新建目录', field('name', '目录名称') + field('parent_id', '父目录 ID（空为根目录）'), life.live, (v, ctx, key) => mut('wiki.folder.create', { payload: v }, ctx, key), () => {}));
    panel.querySelectorAll('[data-extra-op]').forEach(b => b.onclick = () => busyRead(b, async () => {
      const op = b.dataset.extraOp;
      if (op === 'links' || op === 'fix') return confirmAction(b.textContent, '此操作将修改远端 Wiki。确认继续？', life.live, (signal, key) => request('wiki.' + op, {}, signal, key), refresh);
      const result = unwrap((await request('wiki.' + op)).result); if (!life.live() || extraStamp !== extraGeneration) return;
      const output = panel.querySelector('[data-extra-result]');
      if (op === 'folders') {
        renderFolderTree(output, result, () => life.live() && extraStamp === extraGeneration, request, canManage);
      } else if (op === 'index') renderWikiIndex(output, result, () => life.live() && extraStamp === extraGeneration, request);
      else if (op === 'graph') output.innerHTML = graphView(result);
      else if (op === 'issues') {
        const issues = rowsOf(result); output.innerHTML = issues.map((issue, i) => '<div class="file-row"><div class="knowledge-copy">' + esc(issue.description || issue.message || issue.issue_type) + '<div class="dim">' + esc(issue.slug || issue.page_slug) + ' · ' + esc(issue.status) + '</div></div>' + (canManage ? '<button class="btn btn-ghost btn-sm" data-issue="' + i + '">更改状态</button>' : '') + '</div>').join('') || '<p>暂无问题</p>';
        output.querySelectorAll('[data-issue]').forEach(button => button.onclick = () => { const issue = issues[Number(button.dataset.issue)]; editForm('更改问题状态', choice('status', '状态', [['pending', '待处理'], ['ignored', '忽略'], ['resolved', '已解决']], issue.status), life.live, (v, ctx, key) => mut('wiki.issue', { resourceId: issue.id, payload: v }, ctx, key), () => b.click()); });
      } else output.innerHTML = jsonView(result);
    }));
  }
  toolbar(); extras(); await load();
  refreshAfterUploads(life, refresh, target => target.connectionId === connectionId && target.collectionId === collectionId);
}

function renderFolderTree(output, data, valid, request, canManage) {
  const folders = rowsOf(data);
  const load = async id => { const d = unwrap((await request('wiki.folders', { parent_id: id })).result); if (valid() && output.isConnected) renderFolderTree(output, d, valid, request, canManage); };
  const error = e => { if (valid()) UI.toast(e.message, 'err'); };
  output.innerHTML = '<button class="btn btn-ghost btn-sm" data-root>返回根目录</button>' + folders.map((f, i) => '<div class="file-row"><div class="knowledge-copy">' + esc(f.name) + '<div class="dim">' + esc(f.id) + ' · ' + esc(f.page_count) + ' 页</div></div><button class="btn btn-ghost btn-sm" data-open="' + i + '">打开</button>' + (canManage ? '<button class="btn btn-ghost btn-sm" data-edit="' + i + '">重命名 / 移动</button><button class="btn btn-ghost btn-sm" data-remove="' + i + '">删除</button>' : '') + '</div>').join('') + (!folders.length ? '<p>此目录没有子目录</p>' : '');
  output.querySelector('[data-root]').onclick = () => void load('').catch(error);
  output.querySelectorAll('[data-open]').forEach(b => b.onclick = () => void load(folders[Number(b.dataset.open)].id).catch(error));
  output.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { const f = folders[Number(b.dataset.edit)]; editForm('维护目录', field('name', '名称', f.name) + field('parent_id', '父目录 ID（空为根目录）', f.parent_id || ''), valid, (v, ctx, key) => request('wiki.folder.update', { resourceId: f.id, payload: { ...v, move_parent: true } }, ctx.signal, key), () => load(data.parent_id || '')); });
  output.querySelectorAll('[data-remove]').forEach(b => b.onclick = () => confirmAction('删除目录', '确认删除目录？页面将按远端规则重新归属。', valid, (signal, key) => request('wiki.folder.delete', { resourceId: folders[Number(b.dataset.remove)].id }, signal, key), () => load(data.parent_id || '')));
}

function renderWikiIndex(output, data, valid, request) {
  const groups = data.groups || [];
  output.innerHTML = '<p>' + esc(data.intro || '') + '</p>' + groups.map((g, i) => '<section class="knowledge-index-group"><h4>' + esc(g.type) + ' · ' + esc(g.total) + '</h4>' + (g.items || []).map(p => '<p><strong>' + esc(p.title) + '</strong><br><span class="dim">' + esc(p.slug) + '</span></p>').join('') + (g.next_cursor ? '<button class="btn btn-ghost btn-sm" data-cursor="' + i + '">下一页 ' + esc(g.type) + '</button>' : '') + '</section>').join('');
  output.querySelectorAll('[data-cursor]').forEach(b => b.onclick = async () => { b.disabled = true; try { const next = unwrap((await request('wiki.index', { cursor: groups[Number(b.dataset.cursor)].next_cursor })).result); if (valid() && output.isConnected) renderWikiIndex(output, next, valid, request); } catch (e) { if (valid()) UI.toast(e.message, 'err'); } finally { if (valid()) b.disabled = false; } });
}

function openTags(valid, request, canManage, currentPage = 1) {
  knowledgeModal('知识库标签', '<div data-tags-list>正在读取…</div><div data-pagination></div>' + (canManage ? '<button class="btn btn-primary" data-new-tag>新建标签</button>' : '') + '<div class="modal-foot"><button class="btn btn-ghost" data-close>关闭</button></div>', valid, ctx => {
    const reopen = () => openTags(valid, request, canManage, currentPage);
    const form = tag => editForm(tag ? '编辑标签' : '新建标签', field('name', '标签名称', tag?.name || '') + field('color', '颜色', tag?.color || '#6366f1', 'color'), valid, (values, child, key) => request(tag ? 'tags.update' : 'tags.create', { resourceId: tag?.id?.toString(), payload: values }, child.signal, key), reopen);
    ctx.box.querySelector('[data-new-tag]')?.addEventListener('click', () => form(null));
    const load = async () => {
      const raw = (await request('tags.list', { page: currentPage, pageSize: 20 }, ctx.signal)).result; if (!ctx.live()) return;
      const d = unwrap(raw), rows = rowsOf(raw), total = raw.total ?? d.total ?? rows.length;
      ctx.box.querySelector('[data-tags-list]').innerHTML = rows.map((r, i) => '<div class="file-row"><div class="knowledge-copy">' + esc(r.name) + '<div class="dim">序号 ' + esc(r.seq_id || r.id) + '</div></div>' + (canManage ? '<button class="btn btn-ghost btn-sm" data-edit="' + i + '">编辑</button><button class="btn btn-ghost btn-sm" data-delete="' + i + '">删除</button>' : '') + '</div>').join('') || '<p>暂无标签</p>';
      ctx.box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => form(rows[Number(b.dataset.edit)]));
      ctx.box.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => confirmAction('删除标签', '删除标签会改变相关内容的分类，确认继续？', valid, (signal, key) => request('tags.delete', { resourceId: String(rows[Number(b.dataset.delete)].id) }, signal, key), reopen));
      ctx.box.querySelector('[data-pagination]').innerHTML = (currentPage > 1 ? '<button class="btn btn-ghost btn-sm" data-prev>上一页</button>' : '') + (currentPage * 20 < total ? '<button class="btn btn-ghost btn-sm" data-next>下一页</button>' : '');
      ctx.box.querySelector('[data-prev]')?.addEventListener('click', () => { currentPage--; void load().catch(ctx.error); });
      ctx.box.querySelector('[data-next]')?.addEventListener('click', () => { currentPage++; void load().catch(ctx.error); });
    }; void load().catch(ctx.error);
  });
}

function graphView(data) {
  const nodes = data.nodes || [], links = data.edges || data.links || []; if (!nodes.length) return '<p>暂无关系</p>';
  const positions = new Map(nodes.map((n, i) => [n.id || n.slug, { x: 350 + Math.cos(i * Math.PI * 2 / nodes.length) * 280, y: 230 + Math.sin(i * Math.PI * 2 / nodes.length) * 190 }]));
  return '<svg class="knowledge-graph" viewBox="0 0 700 460" role="img" aria-label="Wiki 页面关系">' + links.map(l => { const a = positions.get(l.source), b = positions.get(l.target); return a && b ? '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" />' : ''; }).join('') + nodes.map(n => { const p = positions.get(n.id || n.slug); return '<g><circle cx="' + p.x + '" cy="' + p.y + '" r="5"/><text x="' + p.x + '" y="' + (p.y - 10) + '" text-anchor="middle">' + esc((n.title || n.slug || n.id).slice(0, 20)) + '</text></g>'; }).join('') + '</svg>';
}

function batchFaq(valid, request, host, changed) {
  const ids = [...host.querySelectorAll('[data-entry]:checked')].map(e => Number(e.dataset.entry)); if (!ids.length) return UI.toast('请先勾选本页 FAQ', 'err');
  editForm('批量维护 ' + ids.length + ' 条 FAQ', choice('action', '操作', [['enable', '启用'], ['disable', '停用'], ['recommend', '设为推荐'], ['unrecommend', '取消推荐'], ['tag', '设置标签'], ['delete', '删除所选条目']], 'enable') + field('tag_id', '标签序号（设置标签时填写）', '', 'number') + '<p class="knowledge-warning">保存会修改全部已勾选条目；选择删除将永久删除这些 FAQ。</p>', valid, (v, ctx, key) => {
    if (v.action === 'delete') return request('faq.delete', { payload: { ids } }, ctx.signal, key);
    if (v.action === 'tag') { const tag = Number(v.tag_id); if (!Number.isInteger(tag) || tag < 1) throw new Error('请输入有效标签序号'); return request('faq.tags', { payload: { updates: Object.fromEntries(ids.map(id => [id, tag])) } }, ctx.signal, key); }
    const change = ['enable', 'disable'].includes(v.action) ? { is_enabled: v.action === 'enable' } : { is_recommended: v.action === 'recommend' };
    return request('faq.fields', { payload: { by_id: Object.fromEntries(ids.map(id => [id, change])) } }, ctx.signal, key);
  }, changed);
}

function faqImport(connectionId, collectionId, valid, changed) {
  knowledgeModal('导入 FAQ', '<label class="field">CSV 或 JSON 文件<input type="file" accept=".csv,.json" data-file></label><div class="field"><label>导入方式</label><div data-mode></div></div><p class="knowledge-warning">替换模式会覆盖远端现有 FAQ。先校验，确认校验完成后再导入。</p><div data-result></div><button class="btn btn-ghost" data-check>校验文件</button>' + modalFooter('确认导入'), valid, ctx => {
    let entries, fingerprint, checked = false, validationId, timer; const start = Date.now();
    const mode = ctx.select('[data-mode]', { label: '导入方式', value: 'append', options: [{ value: 'append', label: '追加' }, { value: 'replace', label: '替换全部' }], onChange: () => { checked = false; } });
    const input = ctx.box.querySelector('[data-file]'); input.onchange = () => { checked = false; validationId = null; clearTimeout(timer); }; ctx.cleanup(() => clearTimeout(timer));
    const key = operationKey();
    const poll = async () => {
      const id = validationId; const response = await API.fetchKnowledgeProgress(id, ctx.signal); if (!ctx.live() || id !== validationId) return;
      const d = unwrap(response.data); ctx.box.querySelector('[data-result]').innerHTML = '<p>校验状态：' + esc(status(d.status)) + '</p>' + jsonView(d);
      checked = ['completed', 'success'].includes(d.status) && !(d.failed_entries?.length) && !(d.failed || d.failed_count);
      if (!checked && ['pending', 'processing', 'running'].includes(d.status) && Date.now() - start < 300000) timer = setTimeout(() => void poll().catch(ctx.error), 3000);
    };
    ctx.action('[data-check]', async () => {
      const file = input.files[0]; if (!file || file.size > 8 * 1024 * 1024) throw new Error('请选择不超过 8 MiB 的 CSV 或 JSON 文件'); checked = false;
      entries = parseFaqImport(await file.text(), file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv'); fingerprint = file.name + ':' + file.size + ':' + file.lastModified + ':' + mode.getValue();
      const response = await API.manageKnowledge(connectionId, { operation: 'faq.import', collectionId, payload: { entries, mode: mode.getValue(), dry_run: true }, requestKey: operationKey() }, ctx.signal); if (!ctx.live()) return; validationId = response.data.operationId; await poll();
    });
    ctx.action('[data-save]', async () => { const file = input.files[0]; if (!checked || !file || fingerprint !== file.name + ':' + file.size + ':' + file.lastModified + ':' + mode.getValue()) throw new Error('请先完成当前文件和导入方式的校验'); await API.manageKnowledge(connectionId, { operation: 'faq.import', collectionId, payload: { entries, mode: mode.getValue(), dry_run: false }, requestKey: key }, ctx.signal); if (!ctx.live()) return; UI.closeModal(); await changed(); UI.toast('导入已提交，可在处理记录中查看进度'); });
  });
}

function wikiHistory(slug, valid, canManage, request, changed) {
  knowledgeModal('Wiki 历史版本', '<div data-history>正在读取…</div><div data-version></div><div class="knowledge-actions"><button class="btn btn-ghost" data-more>下一页</button></div><div class="modal-foot"><button class="btn btn-ghost" data-close>关闭</button></div>', valid, ctx => {
    let page = 1;
    const load = async () => {
      const d = unwrap((await request('wiki.revisions', { resourceId: slug, page }, ctx.signal)).result); if (!ctx.live()) return;
      const rows = Array.isArray(d) ? d : d.revisions || d.items || []; ctx.box.querySelector('[data-more]').disabled = rows.length < 50;
      ctx.box.querySelector('[data-history]').innerHTML = rows.map(r => '<div class="file-row"><span>版本 ' + esc(r.version) + ' · ' + esc(r.edit_source) + '</span><button class="btn btn-ghost btn-sm" data-version="' + esc(r.version) + '">查看</button>' + (canManage ? '<button class="btn btn-ghost btn-sm" data-revert="' + esc(r.version) + '">恢复此版本</button>' : '') + '</div>').join('') || '<p>暂无可用历史快照</p>';
      ctx.box.querySelectorAll('button[data-version]').forEach(button => button.onclick = async () => { button.disabled = true; try { const row = unwrap((await request('wiki.revisions', { resourceId: slug, version: Number(button.dataset.version) }, ctx.signal)).result); if (ctx.live()) ctx.box.querySelector('div[data-version]').innerHTML = '<pre class="knowledge-document">' + esc(row.content || JSON.stringify(row, null, 2)) + '</pre>'; } catch (error) { ctx.error(error); } finally { if (ctx.live()) button.disabled = false; } });
      ctx.box.querySelectorAll('[data-revert]').forEach(button => button.onclick = () => { const version = Number(button.dataset.revert); UI.closeModal(); confirmAction('恢复 Wiki 版本', '将版本 ' + version + ' 的内容写为新版本，版本号继续递增。', valid, (signal, key) => request('wiki.revert', { payload: { slug, version } }, signal, key), changed); });
    };
    ctx.action('[data-more]', async () => { page++; await load(); }); void load().catch(ctx.error);
  });
}

function configureLibrary(library, valid, request, changed, models = []) {
  const chunk = library.chunking_config || {}, index = library.indexing_strategy || {}, faq = library.faq_config || {}, wiki = library.wiki_config || {};
  editForm('知识库配置', field('name', '名称', library.name) + field('description', '说明', library.description || '') + field('chunk_size', '分块大小', chunk.chunk_size || 1000, 'number') + field('chunk_overlap', '分块重叠', chunk.chunk_overlap || 200, 'number') + field('vector_enabled', '向量索引', index.vector_enabled, 'checkbox') + field('keyword_enabled', '关键词索引', index.keyword_enabled, 'checkbox') + field('wiki_enabled', 'Wiki 生成', index.wiki_enabled, 'checkbox') + (library.type === 'faq' ? choice('index_mode', 'FAQ 索引内容', [['question_only', '仅问题'], ['question_answer', '问题与答案']], faq.index_mode || 'question_only') + choice('question_index_mode', '问题索引方式', [['combined', '合并问题'], ['separate', '分别索引']], faq.question_index_mode || 'combined') : '') + choice('synthesis_model_id', 'Wiki 生成模型', [['', '未选择'], ...models.filter(m => /chat|knowledgeqa|llm/i.test(m.type)).map(m => [m.id, m.name || m.id])], wiki.synthesis_model_id || '') + choice('extraction_granularity', 'Wiki 抽取粒度', [['focused', '聚焦'], ['standard', '标准'], ['exhaustive', '详细']], wiki.extraction_granularity || 'standard') + field('content_instructions', 'Wiki 内容要求', wiki.content_instructions || '', 'textarea'), valid, (v, ctx, key) => {
    const size = Number(v.chunk_size), overlap = Number(v.chunk_overlap); if (!v.name.trim() || !Number.isInteger(size) || size < 1 || !Number.isInteger(overlap) || overlap < 0 || overlap >= size) throw new Error('请填写名称，分块大小须大于重叠值');
    const config = { chunking_config: { ...chunk, chunk_size: size, chunk_overlap: overlap }, indexing_strategy: { ...index, vector_enabled: v.vector_enabled, keyword_enabled: v.keyword_enabled, wiki_enabled: v.wiki_enabled } };
    if (library.type === 'faq') config.faq_config = { ...faq, index_mode: v.index_mode, question_index_mode: v.question_index_mode };
    if (v.wiki_enabled) config.wiki_config = { ...wiki, synthesis_model_id: v.synthesis_model_id, extraction_granularity: v.extraction_granularity, content_instructions: v.content_instructions };
    return request('kb.update', { payload: { name: v.name, description: v.description, config } }, ctx.signal, key);
  }, changed);
}
