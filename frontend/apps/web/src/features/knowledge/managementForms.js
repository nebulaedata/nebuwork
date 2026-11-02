import { createUuid } from '../../lib/uuid.js';
import { esc, knowledgeModal, modalFooter } from './lifecycle.js';
import { openAICreation } from './creation.js';

export const operationKey = () => 'knowledge-' + createUuid();
export const unwrap = value => value?.data ?? value;
export const libraryHref = (connection, collection) => '#/knowledge?connection=' + encodeURIComponent(connection) + '&collection=' + encodeURIComponent(collection) + '&tab=document';
export const choice = (name, label, options, value) => '<div class="field"><label>' + esc(label) + '</label><div data-select-name="' + esc(name) + '" data-label="' + esc(label) + '" data-value="' + esc(value) + '" data-options="' + esc(JSON.stringify(options.map(([value, label]) => ({ value, label })))) + '"></div></div>';
export function saveBlob(blob, name) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function field(name, label, value = '', type = 'text') {
  if (type === 'textarea') return '<label class="field">' + esc(label) + '<textarea name="' + name + '" rows="9">' + esc(value) + '</textarea></label>';
  if (type === 'checkbox') return '<label class="knowledge-check"><input name="' + name + '" type="checkbox" ' + (value ? 'checked' : '') + '>' + esc(label) + '</label>';
  return '<label class="field">' + esc(label) + '<input name="' + name + '" type="' + type + '" value="' + esc(value) + '"></label>';
}
export function editForm(title, markup, valid, submit, changed = () => {}) {
  knowledgeModal(title, '<div class="knowledge-management-form">' + markup + '</div>' + modalFooter('保存'), valid, ctx => {
    const pickers = [...ctx.box.querySelectorAll('[data-select-name]')].map((node, i) => { node.id = 'knowledge-form-picker-' + i; return [node.dataset.selectName, ctx.select('#' + node.id, { label: node.dataset.label, value: node.dataset.value, options: JSON.parse(node.dataset.options) })]; });
    const key = operationKey();
    ctx.action('[data-save]', async () => { const values = {}; ctx.box.querySelectorAll('[name]').forEach(e => values[e.name] = e.type === 'checkbox' ? e.checked : e.value); pickers.forEach(([name, picker]) => values[name] = picker.getValue()); await submit(values, ctx, key); if (!ctx.live()) return; UI.closeModal(); await changed(); });
  });
}
export function confirmAction(title, message, valid, submit, changed) {
  knowledgeModal(title, '<p>' + esc(message) + '</p>' + modalFooter(title), valid, ctx => { const key = operationKey(); ctx.action('[data-save]', async () => { await submit(ctx.signal, key); if (!ctx.live()) return; UI.closeModal(); await changed?.(); }); });
}
export function openLibraryCreate(connections, valid, onCreated = () => {}) {
  const old = connections.filter(c => c.driver !== "nebulae-v101-rest");
  if(connections.some(c => c.driver === "nebulae-v101-rest" && c.enabled && c.published))return import("./v101Workspace.js").then(({openV101Create}) => openV101Create(connections,valid,onCreated,old.length ? () => openAICreation(old,valid,onCreated,() => openManualLibraryCreate(old,valid,onCreated)) : undefined));
  return openAICreation(old, valid, onCreated, () => openManualLibraryCreate(old, valid, onCreated));
}
export function openManualLibraryCreate(connections, valid, onCreated = () => {}) {
  const available = connections.filter(c => c.capabilities?.includes('create') && c.enabled && c.published);
  knowledgeModal('新增知识库', '<p class="dim">在管理员开放的连接中创建，内容仅归当前账号所有。</p><div class="knowledge-form"><div class="field"><label>连接</label><div data-connection></div></div><div class="field"><label>知识库类型</label><div data-type></div></div>' + field('name', '名称') + field('description', '说明') + '<div class="field"><label>Embedding 模型</label><div data-embedding></div></div><div class="field"><label>摘要模型（可选）</label><div data-summary></div></div><div class="field"><label>Wiki 生成模型</label><div data-wiki-model></div></div><div class="field"><label>存储（可选）</label><div data-storage></div></div><div class="field"><label>向量存储（可选）</label><div data-vector></div></div></div><div class="knowledge-note" data-model-note></div><button class="btn btn-ghost" data-models>刷新可用资源</button>' + modalFooter('创建知识库'), valid, ctx => {
    let generation = 0, loading = false;
    const embedding = ctx.select('[data-embedding]', { label: 'Embedding 模型' }), summary = ctx.select('[data-summary]', { label: '摘要模型', allowClear: true }), wikiModel = ctx.select('[data-wiki-model]', { label: 'Wiki 生成模型', allowClear: true });
    const storage = ctx.select('[data-storage]', { label: '存储', allowClear: true }), vector = ctx.select('[data-vector]', { label: '向量存储', placeholder: '使用空间默认向量存储', allowClear: true });
    const type = ctx.select('[data-type]', { label: '知识库类型', value: 'document', options: [{ value: 'document', label: '文档' }, { value: 'faq', label: 'FAQ' }, { value: 'wiki', label: 'Wiki' }] });
    const load = async () => {
      const token = ++generation; if (!connection.getValue()) return; loading = true;
      [embedding, summary, wikiModel, storage, vector].forEach(p => { p.setValue(undefined); p.setOptions([]); });
      const result = await Promise.allSettled(['models', 'storage', 'vectors'].map(operation => API.manageKnowledge(connection.getValue(), { operation }, ctx.signal)));
      if (!ctx.live() || token !== generation) return; loading = false;
      const list = i => result[i].status === 'fulfilled' ? unwrap(result[i].value.data.result) : [];
      const options = rows => rows.map(r => ({ value: r.id, label: r.name || r.id }));
      embedding.setOptions(options(list(0).filter(m => /embedding/i.test(m.type))));
      const chat = options(list(0).filter(m => /chat|knowledgeqa|llm/i.test(m.type))); summary.setOptions(chat); wikiModel.setOptions(chat);
      storage.setOptions(options(list(1))); vector.setOptions([{ value: '', label: '使用空间默认向量存储' }, ...options(list(2).filter(r => r.source !== 'env' && !r.id.startsWith('__env_')))]);
      ctx.box.querySelector('[data-model-note]').textContent = result.map((r, i) => r.status === 'rejected' ? ['模型', '存储', '向量存储'][i] + '：' + r.reason.message : '').filter(Boolean).join('；');
    };
    const connection = ctx.select('[data-connection]', { label: '统一知识库连接', value: available[0]?.id, options: available.map(c => ({ value: c.id, label: c.name })), onChange: () => { void load().catch(ctx.error); } });
    const key = operationKey(); ctx.action('[data-models]', load);
    if (!available.length) ctx.box.querySelector('[data-model-note]').textContent = '暂无开放的 Nebulae V100 连接，请联系管理员。'; else void load().catch(ctx.error);
    ctx.action('[data-save]', async () => {
      const name = ctx.box.querySelector('[name=name]').value.trim(); if (!connection.getValue() || !name || loading) throw new Error('请选择连接、填写名称，并等待模型读取完成');
      if (type.getValue() !== 'wiki' && !embedding.getValue()) throw new Error('请选择 Embedding 模型；模型由远端管理员预先配置');
      if (type.getValue() === 'wiki' && !wikiModel.getValue()) throw new Error('请选择 Wiki 生成模型');
      const payload = { name, description: ctx.box.querySelector('[name=description]').value, type: type.getValue(), indexing_strategy: { vector_enabled: !!embedding.getValue(), keyword_enabled: true, wiki_enabled: type.getValue() === 'wiki', graph_enabled: false }, chunking_config: { chunk_size: 1000, chunk_overlap: 200 } };
      if (embedding.getValue()) payload.embedding_model_id = embedding.getValue(); if (summary.getValue()) payload.summary_model_id = summary.getValue();
      if (type.getValue() === 'wiki') payload.wiki_config = { synthesis_model_id: wikiModel.getValue(), extraction_granularity: 'standard' };
      if (storage.getValue()) payload.storage_backend_id = storage.getValue(); if (vector.getValue() && !vector.getValue().startsWith('__env_')) payload.vector_store_id = vector.getValue();
      const response = await API.manageKnowledge(connection.getValue(), { operation: 'kb.create', payload, requestKey: key }, ctx.signal); if (!ctx.live()) return;
      const library = unwrap(response.data.result), connectionId = connection.getValue(); UI.closeModal(); await onCreated({ ...library, connectionId, collectionId: library.id });
    });
  });
}

/** RFC 4180 CSV, including embedded commas, escaped quotes and multiline answers. */
export function parseFaqImport(text, format) {
  const allowed = ['standard_question', 'similar_questions', 'negative_questions', 'answers', 'answer_strategy', 'tag_name', 'is_enabled', 'is_recommended'];
  let entries;
  if (format === 'json') { const parsed = JSON.parse(text); entries = Array.isArray(parsed) ? parsed : parsed.entries; }
  else {
    const rows = []; let row = [], value = '', quoted = false;
    for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted; } else if (!quoted && (c === ',' || c === '\n')) { row.push(value.replace(/\r$/, '')); value = ''; if (c === '\n') { rows.push(row); row = []; } } else value += c; }
    if (quoted) throw new Error('CSV 引号未闭合'); if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
    const rawHeader = rows.shift()?.map((s, i) => (i === 0 ? s.replace(/^\uFEFF/, '') : s).trim());
    const aliases = ['tag_name', 'standard_question', 'similar_questions', 'negative_questions', 'answers', 'all_answers', 'disabled', 'not_recommended'];
    const chinese = rawHeader?.includes('问题(必填)');
    const header = chinese ? aliases : rawHeader;
    if (!header?.includes('standard_question') || !header.includes('answers')) throw new Error('CSV 需要 standard_question 和 answers 列');
    entries = rows.filter(r => r.some(Boolean)).map(r => { const entry = Object.fromEntries(header.map((h, i) => [h, r[i] || ''])); if (chinese) { for (const k of ['answers', 'similar_questions', 'negative_questions']) entry[k] = entry[k].split('##').filter(Boolean); entry.answer_strategy = /^true$/i.test(entry.all_answers) ? 'all' : 'random'; entry.is_enabled = !/^true$/i.test(entry.disabled); entry.is_recommended = !/^true$/i.test(entry.not_recommended); } return entry; });
  }
  if (!Array.isArray(entries) || !entries.length || entries.length > 10000) throw new Error('请导入 1～10000 条 FAQ');
  return entries.map((entry, i) => {
    const out = Object.fromEntries(allowed.filter(k => entry[k] !== undefined && entry[k] !== '').map(k => [k, entry[k]]));
    if (!out.standard_question?.trim()) throw new Error('第 ' + (i + 1) + ' 条缺少标准问');
    for (const k of ['answers', 'similar_questions', 'negative_questions']) { if (typeof out[k] === 'string') { const s = out[k].trim(); out[k] = s.startsWith('[') ? JSON.parse(s) : s.split(/\r?\n/).filter(Boolean); } if (out[k] && (!Array.isArray(out[k]) || out[k].some(v => typeof v !== 'string'))) throw new Error('第 ' + (i + 1) + ' 条 ' + k + ' 必须为文本数组'); }
    for (const k of ['is_enabled', 'is_recommended']) if (typeof out[k] === 'string') { if (!/^(true|false|0|1)$/i.test(out[k])) throw new Error(k + ' 应为 true 或 false'); out[k] = /^(true|1)$/i.test(out[k]); }
    return out;
  });
}
