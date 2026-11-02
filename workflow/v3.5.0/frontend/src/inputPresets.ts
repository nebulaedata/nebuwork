// Keep this contract aligned with nebulae-ai-platform-v3.5/frontend/src/inputPresets.ts.
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type InputPreset = {
  id: string;
  name: string;
  description: string;
  input: JsonValue;
  fields: Record<string, string>;
};
export type InputRow = { path: string; type: string };
export type ParsedInput = { value: JsonValue; error: string; position?: number };
export const inputText = (value: JsonValue) => JSON.stringify(value, null, 2);
const inputType = (value: JsonValue) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const pointerToken = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');

export function inputRows(value: JsonValue): InputRow[] {
  const rows: InputRow[] = [];
  function walk(item: JsonValue, path: string) {
    const entries = item !== null && typeof item === 'object' ? Object.entries(item) : [];
    if (path || !entries.length) rows.push({ path, type: inputType(item) });
    for (const [key, child] of entries) walk(child, path + '/' + pointerToken(key));
  }
  walk(value, '');
  return rows;
}

export function documentedRows(value: JsonValue, fields: Record<string, string> = {}): InputRow[] {
  const rows = inputRows(value);
  if (Object.hasOwn(fields, '') && !rows.some(row => row.path === '')) rows.unshift({ path: '', type: inputType(value) });
  return rows;
}

export function parseInput(text: string): ParsedInput {
  try {
    const value: JsonValue = JSON.parse(text);
    const finite = (item: JsonValue): boolean => typeof item === 'number' ? Number.isFinite(item)
      : item !== null && typeof item === 'object' ? Object.values(item).every(finite) : true;
    if (!finite(value)) return { value: null, error: 'JSON 数字超出可表示范围，请使用有限数值。' };
    return { value, error: '' };
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    const match = /position (\d+)/i.exec(message), location = /line (\d+) column (\d+)/i.exec(message);
    let position = match ? Number(match[1]) : /end of JSON/i.test(message) ? text.length : undefined;
    if (position === undefined && location) {
      position = text.split('\n').slice(0, Number(location[1]) - 1).reduce((sum, line) => sum + line.length + 1, 0) + Number(location[2]) - 1;
    }
    const before = position === undefined ? null : text.slice(0, position).split('\n');
    const at = before ? `（第 ${before.length} 行，第 ${before.at(-1)!.length + 1} 列）` : '';
    return { value: null, error: `JSON 格式错误${at}：${message}`, position };
  }
}

export type RunInputState = { selected: string; drafts: Record<string, string> };
export type RunInputAction = { type: 'select'; id: string } | { type: 'edit'; text: string } | { type: 'reset' };
export function initialRunInput(presets: InputPreset[]): RunInputState {
  return { selected: presets[0]?.id || '', drafts: { '': '{}' } };
}
export function runInputText(state: RunInputState, presets: InputPreset[]) {
  const preset = presets.find(item => item.id === state.selected);
  return Object.hasOwn(state.drafts, state.selected) ? state.drafts[state.selected] : inputText(preset ? preset.input : {});
}
export function reduceRunInput(state: RunInputState, action: RunInputAction, presets: InputPreset[]): RunInputState {
  if (action.type === 'select') return { ...state, selected: presets.some(preset => preset.id === action.id) ? action.id : '' };
  const preset = presets.find(item => item.id === state.selected);
  const text = action.type === 'edit' ? action.text : inputText(preset ? preset.input : {});
  return { ...state, drafts: { ...state.drafts, [state.selected]: text } };
}
