import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AutoComplete, ConfigProvider } from 'antd';
import { selectTheme } from './workbenchSelect.jsx';

/** Editable, single-model picker for the existing non-React modal. */
export function mountModelSelect(container, { onChange }) {
  const root = createRoot(container);
  const theme = selectTheme();
  let disposed = false;
  let state = { value: '', models: [], disabled: false, open: false, search: '' };
  const arrow = createElement('svg', {
    width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 2, 'aria-hidden': true, style: { pointerEvents: 'none' },
  }, createElement('path', { d: 'm6 9 6 6 6-6' }));
  function update(patch) {
    if (disposed) return;
    state = { ...state, ...patch };
    const query = state.search.trim().toLocaleLowerCase();
    let options = state.models.filter(model => model.toLocaleLowerCase().includes(query))
      .map(model => ({ value: model, label: model }));
    if (query && !state.models.includes(state.value.trim())) {
      options = [...options, { value: state.value.trim(), label: `使用自定义模型：${state.value.trim()}` }];
    }
    if (!options.length) options = [{ value: '', label: '请先获取模型目录，也可直接输入模型名', disabled: true }];
    root.render(createElement(ConfigProvider, { theme }, createElement(AutoComplete, {
      id: 'mp-model',
      'aria-label': '模型名',
      'aria-describedby': 'mp-status',
      className: 'mp-model-select',
      classNames: { popup: { root: 'mp-model-select-popup' } },
      value: state.value,
      options,
      disabled: state.disabled,
      open: state.open && !state.disabled,
      allowClear: true,
      defaultActiveFirstOption: false,
      showSearch: { filterOption: false, searchIcon: arrow },
      suffixIcon: arrow,
      size: 'large',
      listHeight: 256,
      popupMatchSelectWidth: true,
      getPopupContainer: () => container,
      placeholder: '搜索并选择模型，或直接输入模型名',
      onChange: value => {
        update({ value, search: value, open: true });
        onChange?.(value);
      },
      onSelect: value => update({ value, search: '', open: false }),
      onFocus: () => update({ search: '', open: true }),
      onBlur: () => update({ open: false }),
      onOpenChange: open => update({ open, ...(open ? { search: '' } : {}) }),
    })));
  }
  update({});
  return {
    getValue: () => state.value,
    setModels(models) { update({ models: [...new Set(models)], search: '' }); },
    setDisabled(disabled) { update({ disabled, ...(disabled ? { open: false } : {}) }); },
    open() { update({ open: true, search: '' }); },
    destroy() { if (!disposed) { disposed = true; root.unmount(); } },
  };
}
