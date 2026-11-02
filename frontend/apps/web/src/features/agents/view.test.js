import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createExpertApi } from '../../services/expertApi.js';
import { mountWorkflowCanvas } from './workflowCanvas.js';
import { materializeWorkflowEdges } from './workflowGraph.js';
import { workflowRoute } from '../workflows/sopWorkflow.js';
import { renderSopLayout, sopConfigValues } from './sopLayout.js';
import { mountProcessCanvas } from './processCanvas.js';
import { workflowKey } from '../../services/workflowKey.js';
import { expertSettingsForm } from './expertSettings.js';
import { usageText, tokenCount, usageTrend, taskDistribution } from '../tasks/usage.js';

const source = readFileSync(new URL('./view.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '');
let db, api, ui, views, el, response, handler, dom, removeModal, knowledgePanel, runtimeEditor;
beforeEach(() => {
  dom = new JSDOM('', { url: 'http://localhost:5173/#/agents' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('location', dom.window.location);
  document.body.innerHTML = '<div id="topbar-title"></div><div id="topbar-crumb"></div><div id="topbar-tabs"></div><main id="app-content"></main><div id="modal-box"></div>';
  db = {};
  response = { agent: { id: 'a', name: '专家', role: '方向', tagline: '简介', model: '模型', initials: '专', color: '#123456', level: 1, xp: 0, sop: [], kbIds: [], plugins: [], stats: { tasks: 0, successRate: null, tokens: '0', cost: '¥ 0.00' } },
    sopSets: [], ruleSets: [], rules: [], extensions: [], templates: [], knowledgeBases: [], tasks: [], growth: [], usage: { daily: [] } };
  handler = () => { throw new Error('unexpected write'); };
  api = createExpertApi(async (url, options) => !options ? { code: 0, data: structuredClone(url === '/api/agents' ? [response.agent] : response) } : handler(url, options), db);
  ui = { esc: s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), skeleton: () => '',
    toast: vi.fn(), closeModal: vi.fn(() => { document.querySelector('#modal-box').innerHTML = ''; }),
    setModalCleanup: vi.fn(),
    openModal: html => { document.querySelector('#modal-box').innerHTML = html; },
    modal: (_title, body, callback) => { const m = document.querySelector('#modal-box'); m.innerHTML = body; callback(m); }
  };
  views = {}; window.Views = views; el = document.querySelector('#app-content');
  removeModal = vi.fn();
  knowledgePanel = vi.fn(async host => { host.textContent = '知识库 MCP'; });
  runtimeEditor = vi.fn(() => vi.fn());
  new Function('window', 'Views', 'DB', 'API', 'UI', 'ICON', 'openRemoveExpertModal', 'renderKnowledgeScope', 'mountWorkflowCanvas', 'materializeWorkflowEdges', 'renderSopLayout', 'sopConfigValues', 'mountProcessCanvas', 'mountSopWorkflow', 'workflowRoute', 'lifetime', 'workflowKey', 'expertSettingsForm', 'mountExpertSettings', 'usageText', 'tokenCount', 'usageTrend', 'taskDistribution', 'mountRuntimeEditor', source)(window, views, db, api, ui, () => '', removeModal, knowledgePanel, mountWorkflowCanvas, materializeWorkflowEdges, renderSopLayout, sopConfigValues, mountProcessCanvas, vi.fn(), workflowRoute, element => ({ live: () => element.isConnected, dispose: vi.fn() }), workflowKey, expertSettingsForm, vi.fn(), usageText, tokenCount, usageTrend, taskDistribution, runtimeEditor);
});
afterEach(() => { dom.window.close(); vi.unstubAllGlobals(); });
describe('expert page persistence behavior', () => {
  it('creates a real workflow directly from new SOP and preserves its key on an uncertain retry', async () => {
    location.hash = '#/agent/a?tab=sop';
    await views.agent.render(el, 'a', { tab: 'sop' });
    el.querySelector('#btn-sop-new').click();
    const dialog = document.querySelector('#modal-box'); dialog.querySelector('#ns-name').value = '真实 SOP';
    expect(dialog.querySelector('#ns-kind').selectedOptions[0].textContent).toContain('Workflow');
    const requests = [];
    handler = async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) throw new Error('响应丢失');
      return { code: 0, data: { id: 'new-sop', name: '真实 SOP', kind: 'workflow', revision: 1, wf: { nodes: [] }, workflow: { id: 'real-wf', status: 'pending', error: null } } };
    };
    dialog.querySelector('#ns-submit').click(); await vi.waitFor(() => expect(ui.toast).toHaveBeenCalledWith('响应丢失', 'err'));
    dialog.querySelector('#ns-submit').click(); await vi.waitFor(() => expect(location.hash).toBe('#/workflow/real-wf?expert=a'));
    expect(requests[0].options.headers['Idempotency-Key']).toBe(requests[1].options.headers['Idempotency-Key']);
    expect(requests[1].url).toBe('/api/agents/a/sop-sets');
  });
  it('places the current-account Workflow canvas below four configuration cards', async () => {
    response.sopSets = [{ id: 's', name: '真实 SOP', kind: 'workflow', revision: 1, updatedAt: '2026-10-13T00:00:00Z', wf: { nodes: [] }, workflow: { id: 'real-wf', status: 'ready', error: null } }];
    location.hash = '#/agent/a?tab=sop'; await views.agent.render(el, 'a', { tab: 'sop' });
    expect(el.querySelector('#wf-canvas')).not.toBeNull();
    expect(el.querySelector('[data-workflow-overview]')).not.toBeNull();
    expect(el.querySelector('#btn-sop-cfg').textContent).toBe('运行场景');
    expect(el.querySelector('.sop-detail-layout').lastElementChild.id).toBe('wf-canvas');
    expect(el.querySelector('[data-workflow-run]').getAttribute('href')).toBe('#/workflow/real-wf?expert=a&run=1');
    expect(el.querySelector('[data-workflow-status]').textContent).toBe('已创建');
  });
  it('edits and deletes standard process nodes while preserving order and saved coordinates', async () => {
    response.sopSets = [{ id: 's', name: '标准 SOP', kind: 'process', revision: 1, materialRefs: [],
      proc: { specRefs: [], steps: ['a', 'b', 'c'].map((id, index) => ({ id, t: id, d: '指引', sys: 'ERP', rpa: true, x: 26 + index * 194, y: 24 })) } }];
    const writes = [];
    handler = (_url, options) => { const payload = JSON.parse(options.body); writes.push(payload); return { code: 0, data: { ...payload, revision: payload.revision + 1 } }; };
    await views.agent.render(el, 'a', { tab: 'sop' });
    expect(el.querySelectorAll('.sop-config-card')).toHaveLength(4);
    expect(el.querySelectorAll('.wf-node')).toHaveLength(3);
    expect(el.querySelectorAll('.wf-edge')).toHaveLength(2);
    expect(el.querySelector('.wf-port')).toBeNull();
    expect(el.querySelectorAll('.sop-resource')).toHaveLength(2);
    el.querySelector('[data-node-id="a"] .wf-node-t').click();
    document.querySelector('#st-t').value = '修改步骤'; document.querySelector('#st-submit').click();
    await vi.waitFor(() => expect(el.querySelector('[data-node-id="a"]').textContent).toContain('修改步骤'));
    expect(writes[0].proc.steps[0]).toMatchObject({ id: 'a', sys: 'ERP', rpa: true, x: 26, y: 24 });
    el.querySelector('[data-node-id="b"] .wf-node-x').click();
    await vi.waitFor(() => expect(el.querySelectorAll('.wf-node')).toHaveLength(2));
    expect(writes[1].revision).toBe(2);
    expect(writes[1].proc.steps.map(step => step.id)).toEqual(['a', 'c']);
    expect(writes[1].proc.edges).toBeUndefined();
    expect(el.querySelectorAll('.wf-edge')).toHaveLength(1);
  });
  it('saves the four process configuration fields without losing steps, materials or standards', async () => {
    response.sopSets = [{ id: 's', name: '标准 SOP', kind: 'process', revision: 4,
      materialRefs: [{ id: 'm', name: '模板.docx', status: 'missing' }], proc: { specRefs: ['制度 v1'], steps: [{ id: 'a', t: '步骤', d: '' }] } }];
    handler = (_url, options) => { const payload = JSON.parse(options.body); expect(payload.revision).toBe(4); return { code: 0, data: { ...payload, revision: 5 } }; };
    await views.agent.render(el, 'a', { tab: 'sop' });
    expect(el.querySelector('[data-sop-config="source"]').textContent).toContain('模板.docx');
    expect(el.querySelector('[data-sop-config="rules"]').textContent).toBe('制度 v1');
    el.querySelector('#btn-sop-cfg').click();
    for (const [key, value] of Object.entries({ source: 'ERP 数据', rules: '按制度核对', input: '业务日期', output: '核对报告' })) document.querySelector('#cf-' + key).value = value;
    document.querySelector('#cf-submit').click();
    await vi.waitFor(() => expect(el.querySelector('[data-sop-config="input"]').textContent).toBe('业务日期'));
    expect(db.sopSets.a[0].proc).toMatchObject({ source: 'ERP 数据', rules: '按制度核对', output: '核对报告', specRefs: ['制度 v1'], steps: [{ id: 'a', t: '步骤', d: '' }] });
    expect(db.sopSets.a[0].materialRefs).toHaveLength(1);
  });
  it('saves a branch, reloads it, and deletes a node with its incident edges using the latest revision', async () => {
    response.sopSets = [{ id: 's', name: '工作流', kind: 'workflow', revision: 1, updatedAt: '2026-10-09T00:00:00Z',
      wf: { source: '', rules: '', input: '', output: '', nodes: ['a', 'b', 'c'].map(id => ({ id, t: id, d: '' })) } }];
    const writes = [];
    handler = (_url, options) => {
      expect(options.method).toBe('POST');
      const payload = JSON.parse(options.body); writes.push(payload);
      response.sopSets[0] = { ...payload, revision: payload.revision + 1 };
      return { code: 0, data: structuredClone(response.sopSets[0]) };
    };
    await views.agent.render(el, 'a', { tab: 'sop' });
    expect(el.querySelectorAll('.wf-edge')).toHaveLength(2);
    el.querySelector('[data-node-id="a"] .wf-port-out').click();
    el.querySelector('[data-node-id="c"] .wf-port-in').click();
    await vi.waitFor(() => expect(el.querySelectorAll('.wf-edge')).toHaveLength(3));
    expect(writes[0].wf.edges).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'a', target: 'c' })]));
    await views.agent.render(el, 'a', { tab: 'sop' });
    expect(el.querySelectorAll('.wf-edge')).toHaveLength(3);
    el.querySelector('[data-node-id="b"] .wf-node-x').click();
    await vi.waitFor(() => expect(el.querySelectorAll('.wf-node')).toHaveLength(2));
    expect(writes[1].revision).toBe(2);
    expect(writes[1].wf.edges).toEqual([expect.objectContaining({ source: 'a', target: 'c' })]);
  });
  it('adds an unconnected node without regenerating legacy sequential edges', async () => {
    response.sopSets = [{ id: 's', name: '工作流', kind: 'workflow', revision: 1, updatedAt: '2026-10-09T00:00:00Z',
      wf: { source: '', rules: '', input: '', output: '', nodes: [{ id: 'a', t: 'a', d: '' }] } }];
    handler = (_url, options) => {
      const payload = JSON.parse(options.body);
      expect(payload.wf.edges).toEqual([]);
      payload.wf.nodes[1].id = 'b';
      return { code: 0, data: { ...payload, revision: 2 } };
    };
    await views.agent.render(el, 'a', { tab: 'sop' });
    el.querySelector('[data-sop-add-node]').click();
    document.querySelector('#nd-t').value = 'b'; document.querySelector('#nd-submit').click();
    await vi.waitFor(() => expect(el.querySelectorAll('.wf-node')).toHaveLength(2));
    expect(el.querySelectorAll('.wf-edge')).toHaveLength(0);
  });
  it('offers removal for market experts in the list without entering the card', async () => {
    Object.assign(response.agent, { sourceMarketId: 'market', revision: 4, membershipRevision: 2 });
    await views.agents.render(el);
    el.querySelector('[data-remove-expert]').click();
    expect(location.hash).toBe('#/agents'); expect(removeModal).toHaveBeenCalledOnce();
    expect(removeModal.mock.calls[0][0].expert).toMatchObject({ id: 'a', revision: 4, membershipRevision: 2 });
    api.fetchAgents = vi.fn(async () => ({ data: [] }));
    await removeModal.mock.calls[0][0].onRemoved();
    expect(el.querySelector('[data-agent]')).toBeNull(); expect(el.textContent).toContain('暂无专家');
  });
  it('offers removal in detail and returns to the list only after success', async () => {
    Object.assign(response.agent, { sourceMarketId: 'market', revision: 4, membershipRevision: 0 });
    location.hash = '#/agent/a'; await views.agent.render(el, 'a', {});
    el.querySelector('[data-remove-expert]').click(); expect(location.hash).toBe('#/agent/a');
    await removeModal.mock.calls[0][0].onRemoved(); expect(location.hash).toBe('#/agents');
  });
  it('does not offer market removal for custom experts', async () => {
    await views.agents.render(el); expect(el.querySelector('[data-remove-expert]')).toBeNull();
    await views.agent.render(el, 'a', {}); expect(el.querySelector('[data-remove-expert]')).toBeNull();
  });
  it('opens custom expert deletion from the settings tab and navigates only on success', async () => {
    Object.assign(response.agent, { revision: 4, membershipRevision: 0 });
    location.hash = '#/agent/a'; await views.agent.render(el, 'a', {});
    document.querySelector('[data-agtab="settings"]').click();
    expect(location.hash).toBe('#/agent/a?tab=settings');
    await views.agent.render(el, 'a', { tab: 'settings' });
    expect(document.querySelector('[data-agtab="settings"]').classList.contains('active')).toBe(true);
    expect(el.textContent).toContain('历史发布版本和项目快照保留');
    expect(el.querySelector('[data-remove-expert]')).toBeNull();
    el.querySelector('[data-delete-expert]').click();
    expect(removeModal).toHaveBeenCalledOnce();
    expect(removeModal.mock.calls[0][0]).toMatchObject({ mode: 'delete', expert: { id: 'a', revision: 4, membershipRevision: 0 } });
    expect(location.hash).toBe('#/agent/a?tab=settings');
    await removeModal.mock.calls[0][0].onRemoved(); expect(location.hash).toBe('#/agents');
  });
  it('keeps market removal available once in settings with re-addition guidance', async () => {
    Object.assign(response.agent, { sourceMarketId: 'market', revision: 4, membershipRevision: 2 });
    location.hash = '#/agent/a?tab=settings'; await views.agent.render(el, 'a', { tab: 'settings' });
    expect(el.querySelectorAll('[data-remove-expert]')).toHaveLength(1);
    expect(el.querySelector('[data-delete-expert]')).toBeNull();
    expect(el.textContent).toContain('之后可在专家市场重新添加');
    el.querySelector('[data-remove-expert]').click();
    expect(removeModal.mock.calls[0][0]).toMatchObject({ mode: 'remove' });
  });
  it('updates the SOP count immediately after a successful create', async () => {
    handler = (_url, options) => ({ code: 0, data: { ...JSON.parse(options.body), id: 's', revision: 1, updatedAt: '2026-09-19T00:00:00Z', proc: { materials: [], specRefs: [], steps: [] }, materialRefs: [] } });
    await views.agent.render(el, 'a', { tab: 'sop' });
    document.querySelector('#btn-sop-new').click();
    document.querySelector('#ns-name').value = '新流程';
    document.querySelector('#ns-kind').value = 'process';
    document.querySelector('#ns-submit').click();
    await vi.waitFor(() => expect(document.querySelector('#sop-count').textContent).toBe('1'));
    expect(el.textContent).toContain('新流程');
    expect(ui.closeModal).toHaveBeenCalledOnce();
  });
  it('keeps rule inputs and cached data when saving fails', async () => {
    response.rules = [{ id: 'r', ruleSetId: 'rs', revision: 1, name: '旧规则', scene: '场景', content: '原内容', enabled: true, hits: 0, updatedAt: '2026-09-19T00:00:00Z' }];
    response.ruleSets = [{ id: 'rs', name: '场景', desc: '', revision: 1 }];
    handler = () => Promise.reject(new Error('服务暂时不可用'));
    await views.agent.render(el, 'a', { tab: 'rules' });
    el.querySelector('[data-rule-edit]').click();
    document.querySelector('#rl-name').value = '未保存名称';
    document.querySelector('#rl-submit').click();
    await vi.waitFor(() => expect(ui.toast).toHaveBeenCalledWith('服务暂时不可用', 'err'));
    expect(document.querySelector('#rl-name').value).toBe('未保存名称');
    expect(document.querySelector('#rl-submit').disabled).toBe(false);
    expect(db.agentRules.a[0].name).toBe('旧规则');
    expect(ui.closeModal).not.toHaveBeenCalled();
  });
  it('shows the new-scene input for an empty rule registry and updates both counts on save', async () => {
    handler = (_url, options) => ({ code: 0, data: { ...JSON.parse(options.body), id: 'r', ruleSetId: 'rs', revision: 1, enabled: true, hits: 0, updatedAt: '2026-09-19T00:00:00Z' } });
    await views.agent.render(el, 'a', { tab: 'rules' });
    document.querySelector('#btn-rule-new').click();
    expect(document.querySelector('#rl-scene-new-wrap').style.display).toBe('');
    document.querySelector('#rl-name').value = '规则';
    document.querySelector('#rl-scene-new').value = '场景';
    document.querySelector('#rl-content').value = '必须核验';
    document.querySelector('#rl-submit').click();
    await vi.waitFor(() => expect(document.querySelector('#agent-rule-count').textContent).toBe('1'));
    expect(document.querySelector('[data-agtab="rules"] .cnt').textContent).toBe('1');
  });
  it('mounts the knowledge panel and keeps execution usage unavailable', async () => {
    await views.agent.render(el, 'a', { tab: 'kb' });
    expect(el.textContent).toContain('知识库 MCP');
    expect(knowledgePanel.mock.calls[0][1]).toMatchObject({ kind: 'expert', id: 'a' });
    await views.agent.render(el, 'a', { tab: 'usage' });
    expect(el.textContent).toContain('暂无执行用量');
    expect(el.textContent).toContain('暂无数据');
    expect(el.textContent).not.toContain('稳步上升');
  });
  it('uses total participation count, task links and Token consumption without monetary placeholders', async () => {
    ui.statusPill=status=>'<span>'+status+'</span>';
    response.agent.stats={tasks:51,successRate:100,totalTokens:100,usageKnown:true,inputTokens:60,outputTokens:40,callCount:2};
    response.tasks=[{id:'real-task',title:'真实任务',project:'项目',role:'collaborator',time:'2026-10-16T01:00:00Z',status:'completed',totalTokens:100,usageKnown:true}];
    response.taskTotal=51;response.offset=0;response.hasMore=true;
    await views.agent.render(el,'a',{tab:'tasks'});
    expect(document.querySelector('[data-agtab="tasks"] .cnt').textContent).toBe('51');
    expect(el.querySelector('a[href="#/task/real-task"]')).not.toBeNull();
    expect(el.textContent).toContain('100 Tokens');expect(el.textContent).toContain('下一页');
    expect(el.textContent).not.toMatch(/¥|未计价|累计成本/);
    await views.agent.render(el,'a',{tab:'usage'});
    expect(el.textContent).toContain('累计消耗');expect(el.textContent).toContain('60');expect(el.textContent).toContain('40');
  });
});
