import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, Select } from 'antd';
import { selectTheme } from './workbenchSelect.jsx';

export function mountConfigSelect(container, { id, label, options = [], value, placeholder = '请选择', onChange, allowClear = false, mode }) {
  const root = createRoot(container), theme = selectTheme();
  let disposed = false, state = { options, value, disabled: false };
  function update(patch) {
    if (disposed) return;
    state = { ...state, ...patch };
    root.render(createElement(ConfigProvider, { theme }, createElement(Select, {
      id, 'aria-label': label, className: 'config-select', classNames: { popup: { root: 'mp-model-select-popup' } },
      mode, options: state.options, value: state.value, disabled: state.disabled, placeholder, allowClear,
      showSearch: { optionFilterProp: 'label' }, size: 'large', listHeight: 256, notFoundContent: '暂无可选项',
      // Keep menus outside horizontally scrolling entity tables and the scrolling form body.
      getPopupContainer: () => container.closest('.workbench-config-modal') || container,
      onChange: next => { update({ value: next }); onChange?.(next); },
    })));
  }
  update({});
  return { getValue: () => state.value, setValue: value => update({ value }), setOptions: options => update({ options }),
    setDisabled: disabled => update({ disabled }), destroy: () => { if (!disposed) { disposed = true; root.unmount(); } } };
}
