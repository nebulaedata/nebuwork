import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { openConnectionEditor, openReferencePicker } from './editors.js';
import { renderKnowledgeScope, renderKnowledgeSettings } from './views.js';
import { openKnowledgeBrowser } from './browser.js';
import { parseFaqImport } from './managementForms.js';
import { openAICreation, openCreationJob } from './creation.js';
import { defaultCreationConfig, editCreationTemplate } from './creationTemplates.js';
const auth = vi.hoisted(() => ({ version: 1, listeners: new Set() }));
const selects = vi.hoisted(() => new Map());
vi.mock('../../services/authSession.js', () => ({ authSession: {
  getSnapshot: () => ({ version: auth.version }),
  subscribe: fn => { auth.listeners.add(fn); return () => auth.listeners.delete(fn); },
} }));
vi.mock('../../shared/configSelect.jsx', () => ({ mountConfigSelect: (container, props) => {
  let value = props.value, options = props.options || [];
  const input = document.createElement('select'); input.setAttribute('aria-label', props.label); container.append(input);
  const paint = () => {
    input.replaceChildren(new Option('请选择', ''));
    options.forEach(option => { const item = new Option(option.label, option.value); item.disabled = !!option.disabled; input.add(item); });
    input.value = value || '';
  };
  const picker = { getValue: () => value, setValue: next => { value = next; paint(); }, setOptions: rows => { options = rows; paint(); },
    setDisabled: disabled => { input.disabled = disabled; }, destroy: vi.fn(() => input.remove()) };
  input.addEventListener('change', () => { value = input.value || undefined; props.onChange?.(value); });
  paint(); selects.set(props.label, { input, picker }); return picker;
} }));
let dom, api, host, cleanup;
const ok = data => ({ code: 0, data });
const connection = { id: 'c', name: '统一连接', driver: 'nebulae-v1-http', endpoint: 'http://kb.invalid/mcp', authType: 'none', authHeader: '', enabled: true, scopeKind: 'user', scopeId: '', revision: 1, testStatus: 'untested' };
const collectionRows = [{ id: 'opaque:/A?x=1', name: '制度', indexingStatus: 'ready' }, { id: 'B', name: '业务', indexingStatus: 'pending' }];
const scope = () => ({ kind: 'expert', id: 'e', revision: 4, knowledgeBases: [], connections: [connection] });
beforeEach(() => {
  auth.version = 1; auth.listeners.clear(); selects.clear(); cleanup = null;
  dom = new JSDOM('<main></main><div id="modal-mask"><div id="modal-box"></div></div>', { url: 'http://localhost/#/agents' });
  for (const key of ['window', 'document', 'location', 'MutationObserver', 'Option']) vi.stubGlobal(key, key === 'window' ? dom.window : dom.window[key]);
  vi.stubGlobal('ICON', () => '');
  vi.stubGlobal('UI', {
    toast: vi.fn(),
    modal: (_title, html, mount) => {
      cleanup?.(); cleanup = null;
      const box = document.querySelector('#modal-box'); box.innerHTML = '<div class="modal-body">' + html + '</div>';
      mount(box);
    },
    setModalCleanup: fn => { cleanup = fn; },
    closeModal: () => { cleanup?.(); cleanup = null; },
  });
  api = {
    fetchKnowledgeSettings: vi.fn(async () => ok({ canEdit: true, actorId: 'admin' })),
    fetchKnowledgeOperations: vi.fn(async () => ok([])),
    fetchKnowledgeCreationTemplates: vi.fn(async () => ok([])),
    fetchKnowledgeCreationJobs: vi.fn(async () => ok([])),
    fetchKnowledgeDrivers: vi.fn(async () => ok([{ id: 'nebulae-v1-http', name: 'Nebulae V1 HTTP' }])),
    testKnowledgeDraft: vi.fn(async () => ok({ collections: collectionRows })),
    fetchKnowledgeCollections: vi.fn(async () => ok({ collections: collectionRows })),
    fetchKnowledgeScope: vi.fn(async () => ok(scope())),
    fetchKnowledgeConnections: vi.fn(async () => ok([connection])),
    createLocalKnowledge: vi.fn(async () => ok(scope())),
    createKnowledgeConnection: vi.fn(async () => ok(connection)),
    bindKnowledge: vi.fn(async () => ok(scope())),
  };
  vi.stubGlobal('API', api); host = document.querySelector('main');
});
afterEach(() => {
  cleanup?.(); host.knowledgeCleanup?.(); host.querySelector('[data-knowledge-settings]')?.knowledgeCleanup?.();
  host.querySelectorAll('[data-admin],[data-mine],[data-operations],[data-creation-jobs]').forEach(e=>e.knowledgeCleanup?.());
  dom.window.close(); vi.unstubAllGlobals();
});
function change(label, value) {
  const select = selects.get(label).input; select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
function input(id, value) { const el = document.querySelector(id); el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }
const click = selector => document.querySelector(selector).click();


describe('centrally administered knowledge', () => {
  it('creates from a description without exposing infrastructure fields and follows the completed job', async () => {
    const rest = { ...connection, published: true, capabilities: ['create'] }, created = vi.fn();
    api.fetchKnowledgeCreationTemplates.mockResolvedValue(ok([{ id:'tpl', connectionId:'c', name:'企业模板', revision:3, isDefault:true, capabilities:{rag:true,wiki:true,graph:true,image:true} }, { id:'foreign',connectionId:'hidden',name:'不可用模板' }]));
    api.createKnowledgeJob=vi.fn(async()=>ok({id:'job'}));api.fetchKnowledgeCreationJob=vi.fn(async()=>ok({id:'job',connectionId:'c',collectionId:'created',status:'completed',business:{name:'AI 名称'}}));
    openAICreation([rest],()=>true,created,vi.fn());await vi.waitFor(()=>expect(selects.get('创建模板').input.options).toHaveLength(2));
    expect(document.querySelector('[data-features]').textContent).toContain('知识图谱');expect(document.querySelector('[data-embedding]')).toBeNull();expect(document.querySelector('#modal-box').textContent).not.toContain(connection.endpoint);
    input('[name=description]','用于标准规范检索与关系梳理');click('[data-save]');
    await vi.waitFor(()=>expect(created).toHaveBeenCalledWith(expect.objectContaining({collectionId:'created',connectionId:'c',name:'AI 名称'})));
    expect(api.createKnowledgeJob.mock.calls[0][0]).toMatchObject({templateId:'tpl',revision:3,name:'',description:'用于标准规范检索与关系梳理',preview:false});
  });
  it('keeps preview edits across refresh and confirms only business configuration', async () => {
    const business={name:'自动名称',description:'简介',wiki_config:{content_instructions:'页面规则',extraction_instructions:'领域概念'},vlm_config:{custom_instructions:'图片要求'},extract_config:{custom_instructions:'图谱规则',tags:['发布'],text:'虚构示例',nodes:[],relations:[]}};
    api.fetchKnowledgeCreationJob=vi.fn(async()=>ok({id:'job',status:'preview',business}));api.confirmKnowledgeCreationJob=vi.fn(async()=>ok({}));
    openCreationJob('job');await vi.waitFor(()=>expect(document.querySelector('[name=wikiContent]')).not.toBeNull());input('[name=wikiContent]','用户调整的 Wiki 要求');click('[data-refresh]');await vi.waitFor(()=>expect(api.fetchKnowledgeCreationJob).toHaveBeenCalledTimes(2));
    expect(document.querySelector('[name=wikiContent]').value).toBe('用户调整的 Wiki 要求');await vi.waitFor(()=>expect(document.querySelector('[data-confirm]').disabled).toBe(false));click('[data-confirm]');await vi.waitFor(()=>expect(api.confirmKnowledgeCreationJob).toHaveBeenCalledOnce());
    expect(api.confirmKnowledgeCreationJob.mock.calls[0][1].wiki_config.content_instructions).toBe('用户调整的 Wiki 要求');expect(api.confirmKnowledgeCreationJob.mock.calls[0][1]).not.toHaveProperty('model_id');
  });
  it('aborts a late creation response on account change without opening another account library', async () => {
    let finish;const created=vi.fn();api.fetchKnowledgeCreationJob=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
    openCreationJob('job',()=>true,created);const signal=api.fetchKnowledgeCreationJob.mock.calls[0][1];auth.version++;auth.listeners.forEach(fn=>fn());expect(signal.aborted).toBe(true);
    finish(ok({status:'completed',connectionId:'c',collectionId:'old'}));await Promise.resolve();await Promise.resolve();expect(created).not.toHaveBeenCalled();
  });
  it('defaults templates to all requested capabilities while keeping image vector and audio optional', () => {
    const config=defaultCreationConfig();expect(config.indexing_strategy).toEqual({vector_enabled:true,keyword_enabled:true,wiki_enabled:true,graph_enabled:true});expect(config.vlm_config.enabled).toBe(true);expect(config.image_processing_config.image_vector_enabled).toBe(false);expect(config.asr_config.enabled).toBe(false);expect(config.chunking_config.chunk_size).toBe(1000);
  });
  it('saves administrator template choices and parses file routing without credentials', async () => {
    api.fetchKnowledgeCreationResources=vi.fn(async()=>ok({models:[{id:'chat',name:'聊天',type:'KnowledgeQA'},{id:'embed',name:'向量',type:'Embedding'},{id:'vision',name:'视觉',type:'VLLM'}],parsers:[{id:'builtin',name:'内置',available:true,fileTypes:['pdf']}],storage:[],vectors:[]}));
    api.saveKnowledgeCreationTemplate=vi.fn(async()=>ok({}));api.validateKnowledgeCreationTemplate=vi.fn(async()=>ok({valid:true}));
    editCreationTemplate(connection,null,()=>true,vi.fn());await vi.waitFor(()=>expect(selects.get('配置生成模型')).toBeTruthy());
    change('配置生成模型','chat');change('Embedding 模型','embed');change('摘要 / 图谱模型','chat');change('Wiki 模型','chat');change('视觉模型','vision');click('[data-add-parser]');input('[data-parser-row] input','PDF');document.querySelector('[name=enabled]').checked=true;document.querySelector('[name=isDefault]').checked=true;click('[data-save]');
    await vi.waitFor(()=>expect(api.saveKnowledgeCreationTemplate).toHaveBeenCalledOnce());const sent=api.saveKnowledgeCreationTemplate.mock.calls[0][2];expect(sent.enabled).toBe(true);expect(sent.config.chunking_config.parser_engine_rules).toEqual([{engine:'builtin',file_types:['pdf']}]);expect(JSON.stringify(sent)).not.toContain('api_key');
  });
  it('hides administrator credentials and controls from ordinary users', async () => {
    api.fetchKnowledgeSettings.mockResolvedValue(ok({ canEdit: false, actorId: 'alice' }));
    await renderKnowledgeSettings(host);
    await vi.waitFor(() => expect(host.textContent).toContain('制度'));
    expect(host.querySelector('[data-admin] [data-add]')).toBeNull();
    expect(host.textContent).not.toContain(connection.endpoint);
    expect(host.querySelector('[data-create-library]')).not.toBeNull();
    expect(host.textContent).toContain('alice');
  });
  it('shows escaped business details and real counts in the compact catalog', async () => {
    api.fetchKnowledgeCollections.mockResolvedValue(ok({ collections: [
      { id: 'A', name: '法律', description: '<img src=x>', documentCount: 0, documentCountSource: 'reported' },
      { id: 'B', name: '可见', documentCount: 3, documentCountSource: 'visible' },
      { id: 'C', name: '未知', documentCount: null },
    ] }));
    await renderKnowledgeSettings(host);
    await vi.waitFor(() => expect(host.querySelectorAll('[data-browse]')).toHaveLength(3));
    expect(host.textContent).toContain('<img src=x>');expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('文件数0');expect(host.textContent).toContain('可见文件数3');expect(host.textContent).toContain('文件数暂不可用');
  });
  it('offers administrator connections and refreshes the catalog after save', async () => {
    await renderKnowledgeSettings(host); click('[data-admin] [data-add]');
    await vi.waitFor(() => expect(selects.get('知识库驱动').input.options.length).toBeGreaterThan(1));
    change('知识库驱动', 'nebulae-v1-http'); change('认证方式', 'none');
    input('#kc-name', '统一连接'); input('#kc-url', 'http://kb.invalid/mcp'); click('[data-save]');
    await vi.waitFor(() => expect(api.createKnowledgeConnection).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(api.fetchKnowledgeConnections.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect(api.createLocalKnowledge).not.toHaveBeenCalled();
  });
  it('keeps administrator controls usable after a catalog error', async () => {
    api.fetchKnowledgeCollections.mockRejectedValueOnce(new Error('远端暂不可用')).mockResolvedValueOnce(ok({ collections: [] }));
    await renderKnowledgeSettings(host);await vi.waitFor(() => expect(host.textContent).toContain('远端暂不可用'));
    expect(host.querySelector('[data-action="edit"]')).not.toBeNull();click('[data-load]');
    await vi.waitFor(() => expect(host.textContent).toContain('此连接暂无可见知识库'));
  });
  it('lets administrators create on an enabled published REST connection only', async () => {
    const rest = { ...connection, id: 'rest', driver: 'nebulae-v100-rest', name: '开放 REST 连接', published: true, capabilities: ['create', 'manage'] };
    api.fetchKnowledgeConnections.mockResolvedValue(ok([
      rest, { ...rest, id: 'disabled', enabled: false }, { ...rest, id: 'private', published: false },
      { ...connection, published: true, capabilities: ['search'] },
    ]));
    api.manageKnowledge = vi.fn(async (_id, body) => ok({ result: body.operation === 'kb.create' ? { id: 'new-library' } : body.operation === 'models' ? [{ id: 'embed', name: 'Embedding', type: 'embedding' }] : [] }));
    await renderKnowledgeSettings(host); click('[data-mine] [data-create-library]'); click('[data-manual]');
    const picker = selects.get('统一知识库连接').input;
    expect([...picker.options].map(option => option.value)).toEqual(['', 'rest']);
    expect(document.querySelector('[data-model-note]').textContent).not.toContain('暂无开放');
    await vi.waitFor(() => expect(selects.get('Embedding 模型').input.options).toHaveLength(2));
    input('[name=name]', '新知识库'); change('Embedding 模型', 'embed'); click('[data-save]');
    await vi.waitFor(() => expect(api.manageKnowledge).toHaveBeenCalledWith('rest', expect.objectContaining({ operation: 'kb.create', payload: expect.objectContaining({ name: '新知识库', embedding_model_id: 'embed' }) }), expect.any(AbortSignal)));
  });
  it('refreshes creation choices immediately after an administrator opens a connection', async () => {
    let current = { ...connection, driver: 'nebulae-v100-rest', published: false, capabilities: ['create', 'manage'], authType: 'header', authHeader: 'X-API-Key', hasSecret: true };
    api.fetchKnowledgeConnections.mockImplementation(async () => ok([current]));
    api.fetchKnowledgeDrivers.mockResolvedValue(ok([{ id: current.driver, name: 'Nebulae V100' }]));
    api.updateKnowledgeConnection = vi.fn(async (_id, body) => { current = { ...current, ...body, revision: 2 }; return ok(current); });
    api.manageKnowledge = vi.fn(async () => ok({ result: [] }));
    await renderKnowledgeSettings(host); click('[data-action="edit"]');
    await vi.waitFor(() => expect(selects.get('知识库驱动').input.options).toHaveLength(2));
    document.querySelector('#kc-published').checked = true; click('[data-save]');
    await vi.waitFor(() => expect(api.updateKnowledgeConnection).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(api.fetchKnowledgeConnections.mock.calls.length).toBeGreaterThanOrEqual(4));
    click('[data-mine] [data-create-library]'); click('[data-manual]');
    expect([...selects.get('统一知识库连接').input.options].map(option => option.value)).toEqual(['', 'c']);
  });
  it.each(['', 'eb1a7e0a-5393-4c63-b2b4-f10288aa1407'])('submits the default or concrete vector store without virtual IDs (%s)', async selected => {
    api.fetchKnowledgeConnections.mockResolvedValue(ok([{ ...connection, driver: 'nebulae-v100-rest', published: true, capabilities: ['create'] }]));
    api.manageKnowledge = vi.fn(async (_id, body) => ok({ result: body.operation === 'models' ? [{ id: 'embed', name: 'bge-m3', type: 'Embedding' }]
      : body.operation === 'vectors' ? [{ id: '__env_postgres__', name: 'PostgreSQL', source: 'env' }, { id: 'eb1a7e0a-5393-4c63-b2b4-f10288aa1407', name: '专用向量库', type: 'qdrant' }]
      : body.operation === 'kb.create' ? { id: 'new-library' } : [] }));
    await renderKnowledgeSettings(host); click('[data-mine] [data-create-library]'); click('[data-manual]');
    await vi.waitFor(() => expect(selects.get('向量存储').input.textContent).toContain('使用空间默认向量存储'));
    expect([...selects.get('向量存储').input.options].some(option => option.value === '__env_postgres__')).toBe(false);
    input('[name=name]', '法律法规'); change('Embedding 模型', 'embed'); if (selected) change('向量存储', selected); click('[data-save]');
    await vi.waitFor(() => expect(api.manageKnowledge.mock.calls.some(([, body]) => body.operation === 'kb.create')).toBe(true));
    const payload = api.manageKnowledge.mock.calls.find(([, body]) => body.operation === 'kb.create')[1].payload;
    if (selected) expect(payload.vector_store_id).toBe(selected); else expect(payload).not.toHaveProperty('vector_store_id');
  });
  it('aborts and ignores a late directory response after account changes', async () => {
    let finish;api.fetchKnowledgeCollections.mockImplementationOnce(() => new Promise(resolve => { finish=resolve; }));
    await renderKnowledgeSettings(host);await vi.waitFor(() => expect(api.fetchKnowledgeCollections).toHaveBeenCalledOnce());
    const signal=api.fetchKnowledgeCollections.mock.calls[0][1];auth.version++;auth.listeners.forEach(fn=>fn());
    expect(signal.aborted).toBe(true);host.textContent='新账号';finish(ok({ collections: [{ id:'OLD', name:'旧账号内容' }] }));
    await Promise.resolve();await Promise.resolve();expect(host.textContent).toBe('新账号');
  });
  it('requires one explicit library and preserves an opaque ID when binding', async () => {
    const changed=vi.fn();openReferencePicker(scope(),()=>true,changed);change('选择知识库连接','c');
    await vi.waitFor(()=>expect(selects.get('选择一个知识库').input.options).toHaveLength(3));
    click('[data-save]');await vi.waitFor(()=>expect(document.querySelector('[role=alert]').textContent).toContain('请选择'));
    expect(api.bindKnowledge).not.toHaveBeenCalled();change('选择一个知识库','opaque:/A?x=1');click('[data-save]');
    await vi.waitFor(()=>expect(changed).toHaveBeenCalledOnce());
    expect(api.bindKnowledge.mock.calls[0].slice(0,3)).toEqual(['expert','e',{ revision:4,connectionId:'c',collectionId:'opaque:/A?x=1' }]);
  });
  it('cancels obsolete selector discovery and destroys credentials on close', async () => {
    let finish;api.testKnowledgeDraft.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));openConnectionEditor({connection});
    input('#kc-name','连接');change('认证方式','bearer');input('#kc-secret','secret');click('[data-test]');
    const signal=api.testKnowledgeDraft.mock.calls[0][2];UI.closeModal();expect(signal.aborted).toBe(true);
    expect(document.querySelector('#kc-secret').value).toBe('');expect(selects.get('知识库驱动').picker.destroy).toHaveBeenCalled();
    finish(ok({collections:collectionRows}));await Promise.resolve();expect(document.querySelector('[data-test-result]').textContent).toBe('');
  });
  it('preserves inherited read-only references and removes local connection configuration', async () => {
    api.fetchKnowledgeScope.mockResolvedValue(ok({kind:'project',id:'p',revision:2,connections:[],knowledgeBases:[
      {id:'r1',name:'继承',collectionId:'A',connectionId:'c',inherited:true,sourceVersion:1,enabled:true},
      {id:'r2',name:'私有引用',collectionId:'B',connectionId:'c',inherited:false,enabled:false}
    ]}));await renderKnowledgeScope(host,{kind:'project',id:'p'});
    expect(host.textContent).toContain('继承 v1');expect(host.querySelectorAll('[data-remove]')).toHaveLength(1);
    expect(host.querySelector('[data-browse="1"]').disabled).toBe(true);expect(host.querySelector('[data-local]')).toBeNull();
  });
  it('opens a selected Wiki page through the detail route and retains its content kind', () => {
    openKnowledgeBrowser({name:'Wiki',connectionId:'c',collectionId:'k',contentKind:'wiki',initialDocumentId:'nested/page'},vi.fn());
    const query=new URLSearchParams(location.hash.split('?')[1]);
    expect(location.hash).toMatch(/^#\/knowledge\?/);expect(query.get('document')).toBe('nested/page');expect(query.get('content')).toBe('wiki');expect(query.get('tab')).toBe('wiki');expect(document.querySelector('[data-document-detail]')).toBeNull();
  });
  it('round-trips the upstream CSV format and rejects malformed imports', () => {
    const csv='分类(必填),问题(必填),相似问题(选填-多个用##分隔),反例问题(选填-多个用##分隔),机器人回答(必填-多个用##分隔),是否全部回复(选填-默认FALSE),是否停用(选填-默认FALSE),是否禁止被推荐(选填-默认False 可被推荐)\n合同,"什么,合同",问一##问二,,答案一##答案二,TRUE,FALSE,TRUE';
    expect(parseFaqImport(csv,'csv')[0]).toMatchObject({standard_question:'什么,合同',answers:['答案一','答案二'],is_enabled:true,is_recommended:false,answer_strategy:'all'});
    expect(()=>parseFaqImport('standard_question,answers\n"unclosed','csv')).toThrow('引号');
    expect(parseFaqImport('[{"id":999,"standard_question":"问","answers":["答"]}]','json')[0]).not.toHaveProperty('id');
  });
});
