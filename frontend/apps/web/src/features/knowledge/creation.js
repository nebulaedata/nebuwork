import { esc, knowledgeModal, lifetime } from './lifecycle.js';
import { field, operationKey, libraryHref } from './managementForms.js';

export const creationStage = job => ({ queued: '等待处理', preview: '配置已生成，等待确认', completed: '知识库已创建', failed: '处理失败', unknown: '创建结果待核对' }[job.status] || { preflight: '检查模板与依赖', generating: 'AI 正在生成业务配置', validate: '校验业务配置', creating: '创建远端知识库', verifying: '核验实际配置', registering: '登记知识库归属', recover: '恢复原创建结果' }[job.step] || '正在处理');
export const featureSummary = c => [['rag', 'RAG 检索'], ['wiki', 'Wiki'], ['graph', '知识图谱'], ['image', '图像理解']].filter(([k]) => c?.[k]).map(([, label]) => label).join(' · ');

export function openAICreation(connections, valid, onCreated, manual) {
  knowledgeModal('AI 一键创建知识库', '<p class="dim">描述用途、资料类型和关注重点，AI 将根据管理员模板生成适合你的业务配置。</p><div class="knowledge-creation-form"><label class="field">创建模板<div data-template></div></label><p class="knowledge-note" data-features></p>' + field('description', '你希望建立什么知识库？', '', 'textarea') + field('name', '名称（可选，留空由 AI 生成）') + '<p class="dim">创建完成后上传资料，系统再生成索引、Wiki 页面和知识图谱。</p><div class="knowledge-actions"><button class="btn btn-ghost" data-reload>刷新模板</button><button class="btn btn-ghost" data-manual>手动创建 FAQ / Wiki</button></div></div><div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-ghost" data-preview>先预览配置</button><button class="btn btn-primary" data-save>AI 一键创建</button></div>', valid, ctx => {
    let templates = [], submitted = null;
    const key = operationKey(), available = new Set(connections.filter(c => c.enabled && c.published && c.capabilities?.includes('create')).map(c => c.id));
    const summary = () => { const template = templates.find(t => t.id === picker.getValue()); ctx.box.querySelector('[data-features]').textContent = template ? featureSummary(template.capabilities) + ' · 模板 v' + template.revision : '暂无可用创建模板，请联系管理员配置并启用。'; };
    const picker = ctx.select('[data-template]', { label: '创建模板', onChange: summary });
    ctx.box.querySelector('[name=description]').maxLength = 4000; ctx.box.querySelector('[name=description]').rows = 5; ctx.box.querySelector('[name=name]').maxLength = 200;
    const load = async () => { const response = await API.fetchKnowledgeCreationTemplates(undefined, ctx.signal); if (!ctx.live()) return; templates = response.data.filter(t => available.has(t.connectionId)); picker.setOptions(templates.map(t => ({ value: t.id, label: t.name + (t.isDefault ? '（默认）' : '') }))); picker.setValue(templates.find(t => t.isDefault)?.id || templates[0]?.id); summary(); };
    const submit = async preview => {
      const template = templates.find(t => t.id === picker.getValue()), description = ctx.box.querySelector('[name=description]').value.trim();
      if (!template || !description) throw new Error('请选择可用模板并填写知识库需求');
      const payload = { templateId: template.id, revision: template.revision, name: ctx.box.querySelector('[name=name]').value.trim(), description, preview, requestKey: key };
      if (submitted && JSON.stringify(payload) !== JSON.stringify(submitted)) throw new Error('上一请求结果尚不明确，请先到“我的创建任务”核对；重试时请保留原需求。');
      submitted = payload;
      const { data } = await API.createKnowledgeJob(payload, ctx.signal); if (!ctx.live()) return;
      UI.closeModal(); openCreationJob(data.id, valid, onCreated);
    };
    ctx.action('[data-save]', () => submit(false));ctx.action('[data-preview]', () => submit(true));ctx.action('[data-reload]', load);ctx.action('[data-manual]', manual);
    void load().catch(ctx.error);
  });
}

function previewMarkup(b, suppliedName) {
  return '<p class="dim">模型与解析配置来自管理员模板。可调整下面的业务要求，保存后创建。</p><div class="knowledge-preview">' + field('generatedName', '名称', b.name) + field('generatedDescription', '简介', b.description, 'textarea') + field('wikiContent', 'Wiki 内容生成要求', b.wiki_config.content_instructions, 'textarea') + field('wikiExtraction', 'Wiki 提取重点', b.wiki_config.extraction_instructions, 'textarea') + field('imageInstructions', '图片解析要求', b.vlm_config.custom_instructions, 'textarea') + field('graphInstructions', '图谱提取要求', b.extract_config.custom_instructions, 'textarea') + '<details><summary>图谱配置示例（不作为真实知识入库）</summary><p>关系类型：' + esc(b.extract_config.tags.join('、')) + '</p><p class="knowledge-example">' + esc(b.extract_config.text) + '</p></details>' + (suppliedName ? '<p class="dim">创建时保留你最初填写的名称。</p>' : '') + '</div>';
}
export function openCreationJob(id, valid = () => true, onCreated = created => { location.hash = libraryHref(created.connectionId, created.collectionId); }) {
  knowledgeModal('知识库创建任务', '<div data-progress role="status"></div><p class="dim">关闭窗口后后台继续处理，可在“我的创建任务”中查看。</p><div data-business></div><div class="modal-foot"><button class="btn btn-ghost" data-close>关闭</button><button class="btn btn-ghost" data-refresh>刷新状态</button><button class="btn btn-ghost" data-retry hidden>重试生成</button><button class="btn btn-ghost" data-recover hidden>恢复原创建结果</button><button class="btn btn-primary" data-confirm hidden>确认创建</button><button class="btn btn-primary" data-open hidden>打开知识库</button></div>', valid, ctx => {
    let timer, job, shownPreview = false, loading = false;const started = Date.now();ctx.cleanup(() => clearTimeout(timer));
    const load = async () => {
      if (loading || !ctx.live()) return;loading = true;clearTimeout(timer);
      try {
        const { data } = await API.fetchKnowledgeCreationJob(id, ctx.signal);if (!ctx.live()) return;job = data;
        ctx.box.querySelector('[data-progress]').textContent = creationStage(job) + (job.error ? '：' + job.error : '');
        for (const [action, show] of [['retry', job.status === 'failed'], ['recover', job.status === 'unknown'], ['confirm', job.status === 'preview' && !!job.business], ['open', job.status === 'completed' && !!job.collectionId]]) ctx.box.querySelector('[data-' + action + ']').hidden = !show;
        if (job.status === 'preview' && job.business && !shownPreview) { shownPreview = true;ctx.box.querySelector('[data-business]').innerHTML = previewMarkup(job.business, job.name);ctx.box.querySelector('[name=generatedName]').maxLength = 200;ctx.box.querySelectorAll('textarea').forEach(e => e.maxLength = 4000);if(job.name)ctx.box.querySelector('[name=generatedName]').readOnly = true; }
        if (job.status !== 'preview' && shownPreview) { shownPreview = false;ctx.box.querySelector('[data-business]').replaceChildren(); }
        if (job.status === 'completed' && job.collectionId) { UI.closeModal();await onCreated({ ...job.business, id: job.collectionId, collectionId: job.collectionId, connectionId: job.connectionId });return; }
        if (['queued', 'running'].includes(job.status)) {
          if (Date.now() - started < 300000) timer = setTimeout(() => void load().catch(ctx.error), 3000);
          else ctx.box.querySelector('[data-progress]').textContent += '。自动刷新已停止，请手动刷新。';
        }
      } finally { loading = false; }
    };
    ctx.action('[data-refresh]', load);
    ctx.action('[data-retry]', async () => { await API.retryKnowledgeCreationJob(id, false, ctx.signal);await load(); });
    ctx.action('[data-recover]', async () => { await API.retryKnowledgeCreationJob(id, true, ctx.signal);await load(); });
    ctx.action('[data-confirm]', async () => {
      const b = structuredClone(job.business), value = name => ctx.box.querySelector('[name=' + name + ']').value.trim();
      b.name = value('generatedName');b.description = value('generatedDescription');b.wiki_config.content_instructions = value('wikiContent');b.wiki_config.extraction_instructions = value('wikiExtraction');b.vlm_config.custom_instructions = value('imageInstructions');b.extract_config.custom_instructions = value('graphInstructions');
      await API.confirmKnowledgeCreationJob(id, b, ctx.signal);await load();
    });
    ctx.action('[data-open]', async () => { UI.closeModal();await onCreated({ ...job.business, collectionId: job.collectionId, connectionId: job.connectionId }); });
    void load().catch(ctx.error);
  });
}

export async function renderCreationJobs(el) {
  const life = lifetime(el);let timer, loading = false;const started = Date.now();life.cleanup(() => clearTimeout(timer));
  el.innerHTML = '<div class="tc-head"><h3>我的创建任务</h3><button class="btn btn-ghost btn-sm" data-refresh>刷新</button></div><div data-jobs></div><p role="alert" class="knowledge-error"></p>';
  const load = async () => {
    if (!life.live() || loading) return;loading = true;clearTimeout(timer);
    try {
      const { data: jobs } = await API.fetchKnowledgeCreationJobs(life.signal);if (!life.live()) return;
      el.querySelector('[role=alert]').textContent = '';
      el.querySelector('[data-jobs]').innerHTML = jobs.map((j, i) => '<article class="knowledge-connection"><div class="knowledge-copy"><strong>' + esc(j.business?.name || j.name || 'AI 创建知识库') + '</strong><p>' + esc(creationStage(j)) + '</p></div><button class="btn btn-ghost btn-sm" data-job="' + i + '">查看任务</button></article>').join('') || '<p class="dim">暂无创建任务</p>';
      el.querySelectorAll('[data-job]').forEach(b => b.onclick = () => openCreationJob(jobs[Number(b.dataset.job)].id, life.live));
      if (jobs.some(j => ['queued', 'running'].includes(j.status))) { if (Date.now() - started < 300000) timer = setTimeout(load, 3000);else el.querySelector('[role=alert]').textContent = '自动刷新已停止，请手动刷新。'; }
    } catch (error) { if (life.live() && error.name !== 'AbortError') el.querySelector('[role=alert]').textContent = error.message; } finally { loading = false; }
  };
  el.querySelector('[data-refresh]').onclick = load;await load();
}
