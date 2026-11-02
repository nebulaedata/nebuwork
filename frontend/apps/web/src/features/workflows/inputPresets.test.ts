import { describe, expect, it } from 'vitest';
import { initialRunInput, inputRows, parseInput, reduceRunInput, runInputText } from './inputPresets';
import type { InputPreset } from './inputPresets';

const presets: InputPreset[] = [
  { id: 'initial', name: '初始化', description: '首次处理', input: { mode: 'initial', options: { 'a/b~c': [1, false] } }, fields: { '/mode': '处理模式' } },
  { id: 'delta', name: '增量更新', description: '继续处理', input: { mode: 'delta' }, fields: { '/mode': '处理模式' } },
];
describe('run input contract', () => {
  it('enumerates containers, array values and escaped JSON Pointer tokens', () => {
    expect(inputRows(presets[0].input)).toEqual([
      { path: '/mode', type: 'string' }, { path: '/options', type: 'object' },
      { path: '/options/a~1b~0c', type: 'array' }, { path: '/options/a~1b~0c/0', type: 'number' }, { path: '/options/a~1b~0c/1', type: 'boolean' },
    ]);
  });
  it('prefills the first scenario, keeps edits per selection and restores only the selected preset', () => {
    let state = initialRunInput(presets);
    expect(JSON.parse(runInputText(state, presets))).toEqual(presets[0].input);
    state = reduceRunInput(state, { type: 'edit', text: '{"mode":"initial","edited":true}' }, presets);
    state = reduceRunInput(state, { type: 'select', id: 'delta' }, presets);
    expect(JSON.parse(runInputText(state, presets))).toEqual({ mode: 'delta' });
    state = reduceRunInput(state, { type: 'edit', text: '{invalid' }, presets);
    state = reduceRunInput(state, { type: 'select', id: 'initial' }, presets);
    expect(JSON.parse(runInputText(state, presets)).edited).toBe(true);
    state = reduceRunInput(state, { type: 'reset' }, presets);
    expect(JSON.parse(runInputText(state, presets))).toEqual(presets[0].input);
    state = reduceRunInput(state, { type: 'select', id: 'delta' }, presets);
    expect(parseInput(runInputText(state, presets)).error).toContain('JSON');
    expect(presets[0].input).not.toHaveProperty('edited');
  });
  it('supports legacy flows and scalar presets without replacing false, zero or null', () => {
    expect(runInputText(initialRunInput([]), [])).toBe('{}');
    for (const input of [false, 0, null, '']) {
      const choices = [{ ...presets[0], id: 'constructor', input }];
      expect(JSON.parse(runInputText(initialRunInput(choices), choices))).toEqual(input);
    }
  });
  it('rejects invalid and overflowing JSON without converting it to an empty input', () => {
    expect(parseInput('{\n  "x":\n}').error).toContain('JSON 格式错误');
    expect(parseInput('{"x":1e400}').error).toContain('有限数值');
    expect(parseInput('{"nested": [false,0,null]}').error).toBe('');
  });
});
