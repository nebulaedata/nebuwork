import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, Select } from 'antd';
import { selectTheme } from './workbenchSelect.jsx';
import { modelVendorLabel } from './modelVendors.js';

/** Select a saved configuration by ID; identical model names can belong to different services. */
export function mountSavedModelSelect(container, { onChange, id = 'na-model', label = '基础模型', describedBy = 'na-model-status' }) {
  const root = createRoot(container), theme = selectTheme();
  let disposed = false;
  let state = { providers: [], value: undefined, loading: true, disabled: false };
  function update(patch) {
    if (disposed) return;
    state = { ...state, ...patch };
    root.render(createElement(ConfigProvider, { theme }, createElement(Select, {
      id,
      'aria-label': label,
      'aria-describedby': describedBy,
      className: 'saved-model-select',
      classNames: { popup: { root: 'mp-model-select-popup' } },
      options: state.providers.map(provider => ({
        value: provider.id,
        label: `${provider.model} · ${modelVendorLabel(provider.type)} / ${provider.baseUrl}`,
      })),
      value: state.value,
      loading: state.loading,
      disabled: state.loading || state.disabled || !state.providers.length,
      showSearch: { optionFilterProp: 'label' },
      allowClear: true,
      placeholder: state.loading ? '正在加载已保存的模型…' : '请选择已保存的模型配置',
      notFoundContent: '没有匹配的模型配置',
      size: 'large',
      listHeight: 256,
      popupMatchSelectWidth: true,
      getPopupContainer: () => container,
      onChange: value => { update({ value }); onChange?.(value); },
    })));
  }
  update({});
  return {
    getValue: () => state.value,
    setValue: value => update({ value }),
    setProviders(providers) {
      update({ providers, value: providers.some(provider => provider.id === state.value) ? state.value : undefined });
    },
    setLoading: loading => update({ loading }),
    setDisabled: disabled => update({ disabled }),
    destroy() { if (!disposed) { disposed = true; root.unmount(); } },
  };
}
