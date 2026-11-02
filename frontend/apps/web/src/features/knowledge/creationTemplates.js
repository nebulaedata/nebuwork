import { esc, knowledgeModal } from './lifecycle.js';
import { field, choice } from './managementForms.js';
import { featureSummary } from './creation.js';

export const defaultCreationConfig = () => ({
  generation_model_id: '', embedding_model_id: '', summary_model_id: '',
  indexing_strategy: { vector_enabled: true, keyword_enabled: true, wiki_enabled: true, graph_enabled: true },
  chunking_config: { chunk_size: 1000, chunk_overlap: 200, strategy: 'legacy', parser_engine_rules: [] },
  wiki_config: { synthesis_model_id: '', extraction_granularity: 'standard', max_pages_per_ingest: 0 },
  vlm_config: { enabled: true, model_id: '', description_language: '' },
  image_processing_config: { image_attrs_enabled: false, image_vector_enabled: false },
  asr_config: { enabled: false, model_id: '', language: '' }, storage_backend_id: '', vector_store_id: '',
});

export function openCreationTemplates(connection, valid, changed = () => {}) {
  knowledgeModal('创建模板 · ' + connection.name, '<p class="dim">管理员固定模型、解析和存储配置，用户描述业务需求后由 AI 补齐业务规则。模板修改只影响之后提交的任务。</p><div data-templates></div><div class="modal-foot"><button class="btn btn-ghost" data-close>关闭</button><button class="btn btn-primary" data-add-template>新增模板</button></div>', valid, ctx => {
    const reload = async () => { const { data } = await API.fetchKnowledgeCreationTemplates(connection.id, ctx.signal);if (!ctx.live()) return;
      ctx.box.querySelector('[data-templates]').innerHTML = data.map((t, i) => '<article class="knowledge-connection"><div class="knowledge-copy"><strong>' + esc(t.name) + '</strong><p>' + (t.enabled ? '已启用' : '未启用') + (t.isDefault ? ' · 默认模板' : '') + ' · v' + t.revision + '</p><p class="dim">' + esc(featureSummary(t.capabilities)) + '</p></div><button class="btn btn-ghost" data-edit-template="' + i + '">配置</button></article>').join('') || '<p class="dim">尚未配置创建模板。</p>';
      ctx.box.querySelectorAll('[data-edit-template]').forEach(b => b.onclick = () => editCreationTemplate(connection, data[Number(b.dataset.editTemplate)], valid, changed));
      ctx.box.querySelectorAll('[data-edit-template]').forEach(edit => {
        const template = data[Number(edit.dataset.editTemplate)];
        const action = (label, enabled, isDefault) => {
          const button=document.createElement('button');button.className='btn btn-ghost';button.textContent=label;edit.parentElement.append(button);
          button.onclick=async()=>{button.disabled=true;try{await API.saveKnowledgeCreationTemplate(connection.id,template.id,{name:template.name,revision:template.revision,config:template.config,enabled,isDefault},ctx.signal);if(ctx.live()){await reload();await changed();}}catch(error){ctx.error(error);}finally{if(ctx.live())button.disabled=false;}};
        };
        action(template.enabled?'停用':'启用',!template.enabled,false);
        if(template.enabled&&!template.isDefault)action('设为默认',true,true);
      });
    };
    ctx.action('[data-add-template]', () => editCreationTemplate(connection, null, valid, changed));void reload().catch(ctx.error);
  });
}

export function editCreationTemplate(connection, template, valid, changed) {
  knowledgeModal(template ? '配置创建模板' : '新增创建模板', '<div data-template-editor><p class="dim">读取可用模型和解析引擎…</p></div><div class="modal-foot"><button class="btn btn-ghost" data-close>取消</button><button class="btn btn-ghost" data-resources>刷新资源</button><button class="btn btn-ghost" data-validate>校验配置</button><button class="btn btn-primary" data-save>保存模板</button></div>', valid, ctx => {
    let config = structuredClone(template?.config || defaultCreationConfig()), mounted = false, pickers = new Map(), resources;
    const get = key => pickers.get(key)?.getValue() || '', value = key => ctx.box.querySelector('[name="' + key + '"]'), num = key => Number(value(key).value), checked = key => value(key).checked;
    const options = (kind, type) => (resources[kind] || []).filter(r => !type || type(r)).map(r => [r.id, r.name + (r.available === false ? '（不可用）' : '')]);
    const read = () => ({
      generation_model_id: get('generation'), embedding_model_id: get('embedding'), summary_model_id: get('summary'),
      indexing_strategy: { vector_enabled: checked('vector'), keyword_enabled: checked('keyword'), wiki_enabled: checked('wiki'), graph_enabled: checked('graph') },
      chunking_config: { ...config.chunking_config, chunk_size: num('size'), chunk_overlap: num('overlap'), strategy: get('strategy'), parser_engine_rules: [...ctx.box.querySelectorAll('[data-parser-row]')].map(row => ({ ...JSON.parse(row.dataset.originalRule), engine: row.querySelector('select').value, file_types: row.querySelector('input').value.split(/[,，\s]+/).map(s => s.trim().replace(/^\./, '').toLowerCase()).filter(Boolean) })) },
      wiki_config: { synthesis_model_id: get('wikiModel'), extraction_granularity: get('granularity'), max_pages_per_ingest: num('pages') },
      vlm_config: { enabled: checked('image'), model_id: get('vision'), description_language: get('imageLanguage') },
      image_processing_config: { image_attrs_enabled: checked('imageAttrs'), image_vector_enabled: checked('imageVector') },
      asr_config: { enabled: checked('asr'), model_id: get('asrModel'), language: value('asrLanguage').value.trim() },
      storage_backend_id: get('storage'), vector_store_id: get('vectorStore'),
    });
    const parserRow = rule => {
      const row = document.createElement('div');row.className = 'knowledge-parser-rule';row.dataset.parserRow = '';row.dataset.originalRule = JSON.stringify(rule);
      row.innerHTML = '<label>解析引擎<select aria-label="解析引擎">' + options('parsers').map(([id, label]) => '<option value="' + esc(id) + '">' + esc(label) + '</option>').join('') + '</select></label><label>文件类型（逗号分隔）<input aria-label="文件类型" placeholder="pdf,docx" value="' + esc((rule.file_types || []).join(',')) + '"></label><button class="btn btn-ghost" type="button" data-remove>移除</button>';
      row.querySelector('select').value = rule.engine || resources.parsers[0]?.id || '';row.querySelector('[data-remove]').onclick = () => row.remove();ctx.box.querySelector('[data-parser-rules]').append(row);
    };
    const mount = () => {
      const chat = options('models', m => /knowledgeqa|^llm$|^chat$/i.test(m.type)), embedding = options('models', m => /embedding/i.test(m.type)), visual = options('models', m => /^vllm$/i.test(m.type)), asr = options('models', m => /^asr$/i.test(m.type));
      ctx.box.querySelector('[data-template-editor]').innerHTML = '<div class="knowledge-template-form"><div class="knowledge-form">' + field('templateName', '模板名称', template?.name || '企业知识库') + field('enabled', '启用（保存时重新校验依赖）', template?.enabled ?? false, 'checkbox') + field('isDefault', '设为此连接默认模板', template?.isDefault ?? false, 'checkbox') + '</div><h3>模型</h3><div class="knowledge-form">' + choice('generation', '配置生成模型', chat, config.generation_model_id) + choice('embedding', 'Embedding 模型', embedding, config.embedding_model_id) + choice('summary', '摘要 / 图谱模型', chat, config.summary_model_id) + choice('wikiModel', 'Wiki 模型', chat, config.wiki_config.synthesis_model_id) + choice('vision', '视觉模型', visual, config.vlm_config.model_id) + choice('asrModel', '语音模型（可选）', [['', '不使用'], ...asr], config.asr_config.model_id) + '</div><h3>索引与内容处理</h3><div class="knowledge-form">' + [['vector','向量检索',config.indexing_strategy.vector_enabled],['keyword','关键词检索',config.indexing_strategy.keyword_enabled],['wiki','Wiki',config.indexing_strategy.wiki_enabled],['graph','知识图谱',config.indexing_strategy.graph_enabled],['image','图像理解',config.vlm_config.enabled],['imageVector','图片向量检索（需模型支持）',config.image_processing_config.image_vector_enabled],['imageAttrs','图片属性识别',config.image_processing_config.image_attrs_enabled],['asr','音频转录',config.asr_config.enabled]].map(([k,l,v])=>field(k,l,v,'checkbox')).join('') + choice('granularity','Wiki 提取粒度',[['focused','聚焦'],['standard','标准'],['exhaustive','详尽']],config.wiki_config.extraction_granularity) + field('pages','每次导入 Wiki 页数上限（0 不限制）',config.wiki_config.max_pages_per_ingest,'number') + choice('imageLanguage','图片描述语言',[['','跟随文档'],['zh-CN','简体中文'],['en-US','English']],config.vlm_config.description_language) + field('asrLanguage','语音语言（可选）',config.asr_config.language) + '</div><h3>解析与分块</h3><p class="dim">为支持的文件类型指定解析引擎；同一文件类型只配置一次。</p><div data-parser-rules></div><button class="btn btn-ghost" data-add-parser>添加解析规则</button><div class="knowledge-form">' + field('size','分块大小',config.chunking_config.chunk_size,'number') + field('overlap','分块重叠',config.chunking_config.chunk_overlap,'number') + choice('strategy','分块策略',[['legacy','默认'],['auto','自动'],['heading','按标题'],['heuristic','启发式'],['recursive','递归']],config.chunking_config.strategy || 'legacy') + '</div><h3>存储</h3><div class="knowledge-form">' + choice('storage','文件存储',[['','空间默认存储'],...options('storage')],config.storage_backend_id) + choice('vectorStore','向量存储',[['','空间默认向量存储'],...options('vectors')],config.vector_store_id) + '</div><p class="knowledge-note" data-validation></p></div>';
      ctx.box.querySelectorAll('[data-select-name]').forEach((node,i) => { node.id = 'knowledge-template-select-' + i;pickers.set(node.dataset.selectName,ctx.select('#'+node.id,{label:node.dataset.label,value:node.dataset.value,options:JSON.parse(node.dataset.options)})); });
      config.chunking_config.parser_engine_rules.forEach(parserRow);ctx.box.querySelector('[data-add-parser]').onclick = () => parserRow({});
      ctx.box.querySelector('[data-validate]').disabled = false;ctx.box.querySelector('[data-save]').disabled = false;mounted = true;
    };
    const load = async () => {
      const { data } = await API.fetchKnowledgeCreationResources(connection.id,ctx.signal);if(!ctx.live())return;resources=data;
      if(!mounted)mount();else{
        // Refresh choices without replacing an administrator's unsaved edits.
        const chat=m=>/knowledgeqa|^llm$|^chat$/i.test(m.type);
        const updates={generation:options('models',chat),summary:options('models',chat),wikiModel:options('models',chat),embedding:options('models',m=>/embedding/i.test(m.type)),vision:options('models',m=>/^vllm$/i.test(m.type)),asrModel:[['','不使用'],...options('models',m=>/^asr$/i.test(m.type))],storage:[['','空间默认存储'],...options('storage')],vectorStore:[['','空间默认向量存储'],...options('vectors')]};
        for(const [key,rows] of Object.entries(updates)){const selected=get(key);if(selected&&!rows.some(([id])=>id===selected))rows.push([selected,'原资源已不可用']);pickers.get(key).setOptions(rows.map(([value,label])=>({value,label})));}
        ctx.box.querySelectorAll('[data-parser-row] select').forEach(select=>{const selected=select.value;select.innerHTML=options('parsers').map(([id,label])=>'<option value="'+esc(id)+'">'+esc(label)+'</option>').join('');if(selected&&![...select.options].some(o=>o.value===selected))select.add(new Option('原引擎已不可用',selected));select.value=selected;});
        ctx.box.querySelector('[data-validation]').textContent='已刷新远端资源状态；保存时将按最新资源重新校验。';
      }
    };
    ctx.action('[data-resources]',load);
    ctx.action('[data-validate]',async()=>{if(!mounted)throw new Error('请先成功读取远端资源');await API.validateKnowledgeCreationTemplate(connection.id,read(),ctx.signal);if(ctx.live())ctx.box.querySelector('[data-validation]').textContent='配置校验通过。启用并保存后，用户即可使用。';});
    ctx.action('[data-save]',async()=>{if(!mounted)return;await API.saveKnowledgeCreationTemplate(connection.id,template?.id,{name:value('templateName').value.trim(),...(template?{revision:template.revision}:{}),enabled:checked('enabled'),isDefault:checked('isDefault'),config:read()},ctx.signal);if(!ctx.live())return;UI.closeModal();await changed?.();openCreationTemplates(connection,valid,changed);});
    void load().catch(ctx.error);
  });
}
