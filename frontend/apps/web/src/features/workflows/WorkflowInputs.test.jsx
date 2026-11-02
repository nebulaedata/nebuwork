// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkflowContext } from './ui.jsx';
import { WorkflowRunModal } from './WorkflowRunModal.jsx';
import { WorkflowEditor } from './WorkflowEditor.jsx';
import { InputPresetEditor } from './InputPresetControls';

vi.mock('antd', async () => {
  const React = await import('react');
  const TextArea = React.forwardRef(({ autoSize, onChange, ...props }, ref) => <textarea {...props} onChange={onChange} ref={node => {
    if (ref && typeof ref !== 'function') ref.current = node ? { resizableTextArea: { textArea: node } } : null;
  }} />);
  const Input = props => <input {...props} />;
  Input.TextArea = TextArea;
  return {
    App: { useApp: () => ({ modal: { confirm: vi.fn() } }) },
    Input,
    Select: ({ options = [], value, onChange, disabled, ...props }) => <select aria-label={props['aria-label']} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{options.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>,
    Button: ({ children, onClick, disabled }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
    Alert: ({ title, description, action }) => <div role="alert">{title}{description}{action}</div>,
    Modal: ({ open, title, children }) => open ? <div role="dialog" aria-label={title}>{children}</div> : null,
    Tabs: ({ items, onChange }) => <div>{items.map(item => <button role="tab" key={item.key} onClick={() => onChange(item.key)}>{item.label}</button>)}</div>,
  };
});
vi.mock('./Graph', () => ({ Graph: () => <div data-graph /> }));
vi.mock('./CodeEditor.jsx', () => ({ default: () => <div>源码编辑器</div> }));

const presets = [
  { id: 'initial', name: '初始化', description: '首次处理数据', input: { mode: 'initial', ids: [1] }, fields: { '/mode': '执行模式', '/ids': '目标列表', '/ids/0': '目标编号' } },
  { id: 'delta', name: '增量更新', description: '继续已有状态', input: { mode: 'delta' }, fields: { '/mode': '增量模式' } },
];
let root, host, call, live;
beforeEach(() => {
  document.body.innerHTML = '<main></main>'; host = document.querySelector('main'); root = createRoot(host);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); location.hash = '#/workflow/owned'; live = true; call = vi.fn();
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
const mount = component => act(async () => root.render(<WorkflowContext.Provider value={{ call, live: () => live, artifactUrl: (id, file) => `/owned/${id}/${file}` }}>{component}</WorkflowContext.Provider>));
const button = text => [...host.querySelectorAll('button')].find(node => node.textContent === text);
const click = text => act(async () => button(text).click());
const change = (node, value) => act(async () => {
  const prototype = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : node.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, value);
  node.dispatchEvent(new Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
});

describe('workflow run scenarios', () => {
  it('prefills inputs, displays key meanings, retains each draft and blocks invalid JSON', async () => {
    call.mockResolvedValue({ id: 'created' });
    await mount(<WorkflowRunModal id="owned" presets={presets} onClose={() => {}} />);
    const input = host.querySelector('[aria-label="输入（JSON）"]'), select = host.querySelector('[aria-label="运行场景"]');
    expect(JSON.parse(input.value)).toEqual(presets[0].input); expect(host.textContent).toContain('目标编号');
    await change(input, '{"mode":"initial","ids":[2]}'); await change(select, 'delta');
    expect(JSON.parse(input.value)).toEqual({ mode: 'delta' }); expect(host.textContent).toContain('增量模式');
    await change(select, 'initial'); expect(JSON.parse(input.value).ids).toEqual([2]);
    await change(input, '{bad'); expect(button('开始运行').disabled).toBe(true); expect(host.textContent).toContain('JSON 格式错误');
    await click('恢复预设'); expect(JSON.parse(input.value)).toEqual(presets[0].input);
    await change(input, '{"mode":"initial","ids":[9]}'); await click('开始运行');
    expect(call.mock.calls[0].slice(0, 3)).toEqual(['/workflows/owned/tasks', 'POST', { input: { mode: 'initial', ids: [9] } }]);
    expect(location.hash).toBe('#/workflow-task/created'); expect(presets[0].input.ids).toEqual([1]);
  });
  it('fences duplicate clicks and reuses the exact request after a lost response', async () => {
    let reject;
    call.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await mount(<WorkflowRunModal id="owned" presets={presets} onClose={() => {}} />);
    const start = button('开始运行');
    await act(async () => { start.click(); start.click(); });
    expect(call).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('响应丢失')));
    const first = call.mock.calls[0]; call.mockResolvedValue({ id: 'recovered' }); await click('开始运行');
    expect(call.mock.calls[1][2]).toEqual(first[2]); expect(call.mock.calls[1][3].key).toBe(first[3].key);
  });
  it('keeps legacy workflows unconfigured and ignores completion after leaving', async () => {
    let resolve; call.mockImplementation(() => new Promise(done => { resolve = done; }));
    await mount(<WorkflowRunModal id="owned" presets={[]} onClose={() => {}} />);
    expect(host.textContent).toContain('未配置运行场景'); expect(host.querySelector('textarea').value).toBe('{}');
    await click('开始运行'); live = false; await act(async () => root.render(null));
    await act(async () => resolve({ id: 'late' })); expect(location.hash).toBe('#/workflow/owned');
  });
  it('reorders scenarios and applies edited nested documentation without changing saved presets', async () => {
    const applied = vi.fn();
    await mount(<InputPresetEditor presets={presets} onApply={applied} onClose={() => {}} />);
    await change(host.querySelector('[aria-label="参数说明 /ids/0"]'), '输入要处理的目标编号');
    await click('下移'); await click('应用到流程草稿');
    expect(applied.mock.calls[0][0].map(item => item.id)).toEqual(['delta', 'initial']);
    expect(applied.mock.calls[0][0][1].fields['/ids/0']).toBe('输入要处理的目标编号');
    expect(presets[0].fields['/ids/0']).toBe('目标编号');
  });
});

describe('workflow overview and draft persistence', () => {
  function flow() { return { id: 'owned', revision: 'r1', name: '测试流程', archived: false, files: ['main.py'], definition: { name: '测试流程', steps: { main: { code: 'main.py:run', needs: [] } }, input_presets: structuredClone(presets) } }; }
  const artifact = { id: 'file', name: '报告', filename: 'report.docx', scope: 'task', step: 'main', attempt: 1, kind: 'file', size: 1234, created_at: 1, published: true, effective: true };
  it('shows the four actual overview cards and task-level files with authorized downloads', async () => {
    call.mockImplementation(async path => path.endsWith('/artifacts') ? [artifact] : { id: 'owned', enabled: true, status: 'ready', workflow: flow() });
    await mount(<WorkflowEditor id="owned" initialTab="artifacts" />);
    expect([...host.querySelectorAll('.wf-overview-label>span')].map(node => node.textContent)).toEqual(['执行流程', '运行场景', '输入参数', '产物文件']);
    expect(host.querySelector('.wf-section').textContent).toContain('report.docx');
    expect(host.querySelector('.wf-section a[download]').getAttribute('href')).toBe('/owned/owned/file');
  });
  it('keeps artifacts accessible when the workflow definition is unavailable', async () => {
    call.mockImplementation(async path => path.endsWith('/artifacts') ? [artifact] : { id: 'owned', enabled: true, status: 'ready', workflow: { ...flow(), error: '流程定义需要修复' } });
    await mount(<WorkflowEditor id="owned" initialTab="artifacts" runOnOpen />);
    expect(host.querySelector('.wf-section').textContent).toContain('report.docx');
    expect(host.textContent).toContain('定义暂不可用');
    expect(button('运行').disabled).toBe(true);
    expect(host.querySelector('[aria-label="运行工作流"]')).toBeNull();
  });
  it('reads newly saved scenarios before opening the run dialog', async () => {
    let current = flow(); delete current.definition.input_presets;
    call.mockImplementation(async path => path.endsWith('/artifacts') ? [] : { id: 'owned', enabled: true, status: 'ready', workflow: current });
    await mount(<WorkflowEditor id="owned" />);
    expect(host.textContent).toContain('未配置运行场景');
    current = { ...flow(), revision: 'r2' };
    await click('运行');
    const dialog = host.querySelector('[aria-label="运行工作流"]');
    expect(JSON.parse(dialog.querySelector('[aria-label="输入（JSON）"]').value)).toEqual(presets[0].input);
    expect(dialog.textContent).toContain('目标编号');
  });
  it('keeps scene edits and the original revision after a save conflict and prevents running drafts', async () => {
    call.mockImplementation(async (path, method) => { if (method === 'POST') throw new Error('版本冲突'); return path.endsWith('/artifacts') ? [] : { id: 'owned', enabled: true, status: 'ready', workflow: flow() }; });
    await mount(<WorkflowEditor id="owned" configureOnOpen />);
    await change(host.querySelector('[aria-label="场景名称"]'), '修改后的场景'); await click('应用到流程草稿');
    expect(button('运行').disabled).toBe(true); await click('保存流程');
    expect(host.textContent).toContain('版本冲突'); expect(host.textContent).toContain('修改后的场景');
    const write = call.mock.calls.find(args => args[1] === 'POST');
    expect(write[2].expected_revision).toBe('r1'); expect(write[2].definition.input_presets[0].name).toBe('修改后的场景');
    await click('保存流程'); expect(call.mock.calls.filter(args => args[1] === 'POST')[1][2].expected_revision).toBe('r1');
  });
});
