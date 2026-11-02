import { createUuid } from './uuid.js';
// Use a distinct filename from inputPresets.ts for Windows module resolution.
import { useRef, useState } from 'react';
import { Alert, Button, Input, Select } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { documentedRows, initialRunInput, inputRows, inputText, parseInput, reduceRunInput, runInputText } from './inputPresets';
import type { InputPreset, JsonValue, ParsedInput, RunInputAction } from './inputPresets';
import './inputPresets.css';

export function useRunInput(presets: InputPreset[]) {
  const [choices] = useState(() => structuredClone(presets));
  const [state, setState] = useState(() => initialRunInput(choices));
  const text = runInputText(state, choices), parsed = parseInput(text);
  return { state, text, parsed, presets: choices, preset: choices.find(item => item.id === state.selected),
    dispatch: (action: RunInputAction) => setState(old => reduceRunInput(old, action, choices)) };
}

function JsonInput({ value, onChange, parsed, disabled = false }: {
  value: string; onChange: (value: string) => void; parsed: ParsedInput; disabled?: boolean;
}) {
  const editor = useRef<TextAreaRef>(null);
  return <div className="wf-input-json"><label><span>输入（JSON）</span><Input.TextArea ref={editor} aria-label="输入（JSON）" spellCheck={false}
    value={value} disabled={disabled} onChange={event => onChange(event.target.value)} /></label>
    {parsed.error && <Alert type="error" showIcon title={parsed.error} action={parsed.position === undefined ? undefined : <Button size="small" onClick={() => {
      const element = editor.current?.resizableTextArea?.textArea;
      element?.focus(); element?.setSelectionRange(parsed.position!, parsed.position! + 1);
    }}>定位错误</Button>} />}
  </div>;
}

export function InputFieldNotes({ value, fields = {}, onChange, disabled = false }: {
  value: JsonValue; fields?: Record<string, string>; onChange?: (path: string, text: string) => void; disabled?: boolean;
}) {
  return <div className="wf-input-notes"><h4>参数说明</h4><div className="wf-input-fields">
    {documentedRows(value, fields).map(row => <div className="wf-input-field" key={row.path}>
      <div><code>{row.path || '整个输入'}</code><span className="wf-input-type">{row.type}</span></div>
      {onChange ? <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} aria-label={`参数说明 ${row.path || '整个输入'}`} disabled={disabled}
        placeholder="填写此参数的含义、取值要求和使用示例" value={fields[row.path] || ''} onChange={event => onChange(row.path, event.target.value)} />
        : <p>{fields[row.path] || '未填写说明'}</p>}
    </div>)}
  </div></div>;
}

export function RunInputEditor({ model, disabled = false }: {
  model: ReturnType<typeof useRunInput>; disabled?: boolean;
}) {
  const presets = model.presets;
  return <div className="wf-input-panel">
    <div className="wf-input-tools"><label><span>运行场景</span><Select aria-label="运行场景" value={model.state.selected} disabled={disabled}
      options={presets.length ? presets.map((item, index) => ({ value: item.id, label: item.name + (index === 0 ? '（默认）' : '') })) : [{ value: '', label: '自定义输入' }]}
      onChange={id => model.dispatch({ type: 'select', id })} /></label>
      <Button disabled={disabled} onClick={() => model.dispatch({ type: 'reset' })}>{model.preset ? '恢复预设' : '重置输入'}</Button></div>
    <p className="wf-input-description">{model.preset?.description || (presets.length ? '未填写场景用途说明。' : '未配置运行场景，可使用自定义 JSON 输入。')}</p>
    <div className="wf-input-columns"><JsonInput value={model.text} parsed={model.parsed} disabled={disabled} onChange={text => model.dispatch({ type: 'edit', text })} />
      {model.parsed.error ? <p className="wf-input-description">修正 JSON 后显示对应参数说明。</p> : <InputFieldNotes value={model.parsed.value} fields={model.preset?.fields} />}</div>
    <p className="wf-input-hint">修改仅用于本次运行；切换场景会保留本窗口内的编辑。{model.parsed.value === null && !model.parsed.error ? '输入 null 将按现有执行规则转换为空对象。' : ''}</p>
  </div>;
}

type DraftPreset = { preset: InputPreset; text: string };
export function InputPresetEditor({ presets, onApply, onClose, readOnly = false }: {
  presets: InputPreset[]; onApply: (items: InputPreset[]) => void; onClose: () => void; readOnly?: boolean;
}) {
  const [items, setItems] = useState<DraftPreset[]>(() => presets.map(preset => ({ preset: structuredClone(preset), text: inputText(preset.input) })));
  const [selected, setSelected] = useState(presets[0]?.id || ''), [error, setError] = useState('');
  const index = items.findIndex(item => item.preset.id === selected), current = items[index], parsed = parseInput(current?.text ?? '{}');
  const update = (changes: Partial<InputPreset>) => { setItems(old => old.map(item => item.preset.id === selected ? { ...item, preset: { ...item.preset, ...changes } } : item)); setError(''); };
  const add = (copy = false) => {
    const id = 'scene_' + createUuid(), item = copy && current
      ? { preset: { ...structuredClone(current.preset), id, name: current.preset.name + ' 副本' }, text: current.text }
      : { preset: { id, name: '', description: '', input: {}, fields: {} }, text: '{}' };
    setItems([...items, item]); setSelected(id); setError('');
  };
  const move = (offset: number) => { const next = [...items]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; setItems(next); };
  const apply = () => {
    try {
      const ids = new Set<string>();
      const result = items.map(({ preset, text }, position) => {
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(preset.id) || ids.has(preset.id)) throw new Error(`第 ${position + 1} 个场景的标识无效或重复`);
        ids.add(preset.id);
        if (!preset.name.trim()) { setSelected(preset.id); throw new Error(`请填写第 ${position + 1} 个场景的名称`); }
        const value = parseInput(text);
        if (value.error) { setSelected(preset.id); throw new Error(`${preset.name}：${value.error}`); }
        const paths = new Set(['', ...inputRows(value.value).map(row => row.path)]);
        return { ...preset, name: preset.name.trim(), input: value.value, fields: Object.fromEntries(Object.entries(preset.fields).filter(([path]) => paths.has(path))) };
      });
      onApply(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return <div className="wf-input-panel">
    <p className="wf-input-description">{readOnly ? '查看运行场景及输入说明，当前配置只读。' : '按工作流实际用途配置可选输入，第一项为默认场景。应用后需保存流程。'}</p>
    <div className="wf-input-tools"><label><span>运行场景</span><Select aria-label="配置的运行场景" value={selected || undefined} placeholder="尚未配置场景"
      options={items.map((item, position) => ({ value: item.preset.id, label: (item.preset.name || '未命名场景') + (position === 0 ? '（默认）' : '') }))} onChange={setSelected} /></label>
      {!readOnly && <><Button onClick={() => add()}>新增场景</Button><Button disabled={!current} onClick={() => add(true)}>复制场景</Button></>}</div>
    {current ? <>
      {!readOnly && <div className="wf-input-order"><Button disabled={index === 0} onClick={() => move(-1)}>上移</Button><Button disabled={index === items.length - 1} onClick={() => move(1)}>下移</Button>
        <Button danger onClick={() => { const next = items.filter(item => item.preset.id !== selected); setItems(next); setSelected(next[Math.min(index, next.length - 1)]?.preset.id || ''); }}>删除场景</Button></div>}
      <div className="wf-input-metadata"><label><span>场景名称</span><Input aria-label="场景名称" value={current.preset.name} disabled={readOnly} onChange={event => update({ name: event.target.value })} /></label>
        <label><span>适用说明</span><Input.TextArea aria-label="适用说明" autoSize={{ minRows: 2, maxRows: 5 }} value={current.preset.description} disabled={readOnly} onChange={event => update({ description: event.target.value })} /></label></div>
      <div className="wf-input-columns"><JsonInput value={current.text} parsed={parsed} disabled={readOnly} onChange={text => { setItems(old => old.map(item => item.preset.id === selected ? { ...item, text } : item)); setError(''); }} />
        {parsed.error ? <p className="wf-input-description">修正 JSON 后可填写字段说明。</p> : <InputFieldNotes value={parsed.value} fields={current.preset.fields} disabled={readOnly}
          onChange={readOnly ? undefined : (path, text) => update({ fields: { ...current.preset.fields, [path]: text } })} />}</div>
    </> : <div className="wf-input-empty">未配置运行场景。场景可由智能体根据实际工作流生成，也可在此添加。</div>}
    {error && <Alert type="error" showIcon title={error} />}
    <div className="wf-input-footer"><Button onClick={onClose}>{readOnly ? '关闭' : '取消'}</Button>{!readOnly && <Button type="primary" onClick={apply}>应用到流程草稿</Button>}</div>
  </div>;
}
