import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { editWorkbench, editOntology } from './editors.js';
import { editProject } from '../projects/editor.js';
import { markdown, viewScope } from './ui.js';

vi.mock('../../services/authSession.js', () => ({ authSession: { getSnapshot: () => ({ version: 1 }) } }));
vi.mock('../../shared/configSelect.jsx', () => ({
  mountConfigSelect: (container, props) => {
    const input = container.ownerDocument.createElement('select'); container.appendChild(input);
    let current = props.value;
    const setOptions = options => {
      input.replaceChildren();
      for (const row of [{ value: '', label: '请选择' }, ...options]) {
        const option = input.ownerDocument.createElement('option'); option.value = row.value; option.textContent = row.label; option.disabled = !!row.disabled; input.appendChild(option);
      }
      input.value = current || '';
    };
    setOptions(props.options || []);
    input.addEventListener('change', () => { current = input.value; props.onChange?.(current); });
    return { getValue: () => current, setValue: value => { current = value; input.value = value || ''; }, setOptions,
      setDisabled: value => { input.disabled = value; }, destroy: () => input.remove() };
  },
}));

let dom, cleanup, api, ui, alive, saved;
beforeEach(() => {
  dom = new JSDOM('<div id="page"></div><div id="modal"></div>', { url: 'http://localhost/#/workbench?tab=pro' });
  vi.stubGlobal('document',dom.window.document); vi.stubGlobal('location',dom.window.location); vi.stubGlobal('ICON',() => '');
  cleanup = undefined; alive = true; saved = vi.fn();
  api = { fetchWorkbenchTemplates: vi.fn().mockResolvedValue({ data: [] }), createWorkbench: vi.fn(), saveWorkbenchConfig: vi.fn(), createProject: vi.fn(), updateProject: vi.fn() };
  ui = {
    modal: (_title,html,mount) => {
      cleanup?.(); document.getElementById('modal').innerHTML = '<div class="modal-body">'+html+'</div>'; mount(document.getElementById('modal'));
    },
    setModalCleanup: fn => { cleanup = fn; }, closeModal: vi.fn(() => cleanup?.()), toast: vi.fn(),
  };
  vi.stubGlobal('API',api); vi.stubGlobal('UI',ui);
});
afterEach(() => { cleanup?.(); dom.window.close(); vi.unstubAllGlobals(); });
const submit = () => document.querySelector('[data-save]').click();
const choose = (selector,value) => { const field = document.querySelector(selector+' select'); field.value = value; field.dispatchEvent(new dom.window.Event('change')); };

describe('workbench/project editor behavior', () => {
  it('creates a blank workbench directly and preserves entered metadata',async()=>{
    api.createWorkbench.mockResolvedValue({data:{id:'blank'}});editWorkbench(null,()=>alive,saved);document.getElementById('wc-name').value='空白工作台';submit();
    await vi.waitFor(()=>expect(saved).toHaveBeenCalledWith({id:'blank'}));expect(api.createWorkbench.mock.calls[0][0]).toEqual({name:'空白工作台',desc:'',color:'#6c63f0',icon:'package'});expect(api.fetchWorkbenchTemplates).not.toHaveBeenCalled();
  });
  it('preserves input and reuses the creation key on retry, changing it only for changed input', async () => {
    api.createWorkbench.mockRejectedValue(new Error('网络中断'));
    editWorkbench(null,() => alive,saved);
    document.getElementById('wc-name').value = ' 我的工作台 '; submit();
    await vi.waitFor(() => expect(document.querySelector('.config-modal-error').textContent).toBe('网络中断'));
    expect(document.getElementById('wc-name').value).toBe(' 我的工作台 '); expect(ui.toast).not.toHaveBeenCalled();
    submit(); await vi.waitFor(() => expect(api.createWorkbench).toHaveBeenCalledTimes(2));
    expect(api.createWorkbench.mock.calls[1][1]).toBe(api.createWorkbench.mock.calls[0][1]);
    await vi.waitFor(() => expect(document.querySelector('[data-save]').disabled).toBe(false));
    document.getElementById('wc-name').value = '不同工作台'; submit();
    await vi.waitFor(() => expect(api.createWorkbench).toHaveBeenCalledTimes(3));
    expect(api.createWorkbench.mock.calls[2][1]).not.toBe(api.createWorkbench.mock.calls[0][1]);
  });
  it('ignores completed saves after the user leaves the page', async () => {
    let resolve; api.createWorkbench.mockImplementation(() => new Promise(done => { resolve = done; }));
    editWorkbench(null,() => alive,saved); document.getElementById('wc-name').value = '工作台'; submit();
    alive = false; resolve({ data: { id: 'late' } }); await Promise.resolve(); await Promise.resolve();
    expect(saved).not.toHaveBeenCalled(); expect(ui.toast).not.toHaveBeenCalled();
  });
  it('keeps stable entity IDs, validates local removal and retains conflicted input', async () => {
    api.saveWorkbenchConfig.mockRejectedValue(new Error('配置已被修改，请重新加载后再保存'));
    const config = { revision: 4, bizName: '审查', domain: '法务', bizDef: '定义', wikiMd: '', applicabilityMd: '', exclusionsMd: '', systemPrompt: '', defaultAgentId: 'a',
      entities: [{ id: 'e1', name: '合同', description: '' }], relations: [{ id: 'r1', name: '关联', description: '', sourceEntityId: 'e1', targetEntityId: 'e1' }] };
    editOntology({ workbench: { id: 'w', name: '工作台' }, config, agents: [{ id: 'a', name: '专家', role: '法务' }] },() => alive,saved);
    document.querySelector('#oc-entities button').click(); expect(document.querySelectorAll('#oc-entities tr')).toHaveLength(1);
    expect(document.querySelector('.config-modal-error').textContent).toContain('先移除');
    document.getElementById('oc-bizDef').value = '未保存的定义'; submit();
    await vi.waitFor(() => expect(document.querySelector('.config-modal-error').textContent).toContain('重新加载'));
    const payload = api.saveWorkbenchConfig.mock.calls[0][1];
    expect(payload.entities[0].id).toBe('e1'); expect(payload.relations[0].id).toBe('r1'); expect(payload.revision).toBe(4); expect(payload.defaultAgentId).toBe('a');
    expect(document.getElementById('oc-bizDef').value).toBe('未保存的定义'); expect(ui.toast).not.toHaveBeenCalled();
    expect(config.bizDef).toBe('定义');
  });
  it('offers published workbenches and sends only the business project configuration', async () => {
    api.createProject.mockResolvedValue({ data: { id: 'p' } });
    editProject(null,[{ id: 'draft', name: '草稿' }, { id: 'published', name: '已发布', activeVersionId: 'v1', activeVersion: 1 }],'published',() => alive,saved);
    expect(document.querySelector('#pe-workbench').textContent).not.toContain('草稿');
    expect(document.querySelector('#pe-workbench').textContent).not.toContain('仅配置历史版本');
    document.getElementById('pe-name').value = ' 项目 '; submit();
    await vi.waitFor(() => expect(saved).toHaveBeenCalledWith({ id: 'p' }));
    expect(api.createProject.mock.calls[0][0]).toEqual({ name: '项目', desc: '', workbenchId: 'published' });
    expect(api.createProject.mock.calls[0][1]).toBeTruthy();
  });
  it('disables creation when no workbench is published and saves project state by revision', async () => {
    editProject(null,[],null,() => alive,saved); expect(document.querySelector('[data-save]').disabled).toBe(true);
    api.updateProject.mockResolvedValue({ data: { id: 'p', revision: 3 } });
    editProject({ id: 'p', name: '项目', workbenchName: '工作台', status: 'active', revision: 2, ontologyVersion: 1 },[],null,() => alive,saved);
    choose('#pe-status','paused'); submit();
    await vi.waitFor(() => expect(saved).toHaveBeenCalled());
    expect(api.updateProject).toHaveBeenCalledWith('p',{ name: '项目', desc: '', revision: 2, status: 'paused' });
  });
  it('previews Markdown without executing HTML or links', () => {
    document.getElementById('page').innerHTML = markdown('# 术语\n<script>alert(1)</script>\n![x](javascript:alert(1))\n**规则**\n```html\n<img src=x onerror=alert(1)>\n```');
    expect(document.querySelector('#page h1').textContent).toBe('术语'); expect(document.querySelector('#page strong').textContent).toBe('规则');
    expect(document.querySelectorAll('#page script, #page img, #page a')).toHaveLength(0);
  });
  it('invalidates page callbacks on reload or navigation', () => {
    const page = document.getElementById('page'), first = viewScope(page); expect(first()).toBe(true);
    const second = viewScope(page); expect(first()).toBe(false); expect(second()).toBe(true);
    location.hash = '#/projects'; expect(second()).toBe(false);
  });
});
