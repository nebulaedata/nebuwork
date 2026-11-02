import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider, Select } from "antd";

function readToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function selectTheme() {
  return {
    token: {
      colorPrimary: readToken("--accent"),
      colorPrimaryHover: readToken("--accent-hover"),
      colorBgContainer: readToken("--surface-2"),
      colorBgElevated: readToken("--surface"),
      colorBorder: readToken("--border"),
      colorBorderSecondary: readToken("--border"),
      colorText: readToken("--text"),
      colorTextSecondary: readToken("--text-sub"),
      colorTextPlaceholder: readToken("--text-dim"),
      borderRadius: 6,
      controlHeightLG: 40,
      fontFamily: readToken("--font-body"),
      fontSize: 13
    },
    components: {
      Select: {
        activeBorderColor: readToken("--accent"),
        activeOutlineColor: readToken("--accent-dim"),
        hoverBorderColor: readToken("--border-strong"),
        optionActiveBg: readToken("--hover"),
        optionSelectedBg: readToken("--accent-dim"),
        optionSelectedColor: readToken("--text"),
        optionSelectedFontWeight: 500,
        selectorBg: readToken("--surface-2"),
        zIndexPopup: 120
      }
    }
  };
}

export function mountWorkbenchSelect(container, { workbenches, value, onChange }) {
  const options = workbenches.map(workbench => ({
    value: workbench.id,
    label: `${workbench.name} · ${workbench.activeVersion ? '业务版本 v'+workbench.activeVersion : '未发布'}`,
    name: workbench.name,
    sourceLabel: workbench.activeVersion ? `业务版本 v${workbench.activeVersion}` : '未发布'
  }));
  const root = createRoot(container);

  root.render(createElement(
    ConfigProvider,
    { theme: selectTheme() },
    createElement(Select, {
      id: "np-wb",
      "aria-label": "所属工作台",
      className: "np-workbench-select",
      classNames: { popup: { root: "np-workbench-select-popup" } },
      defaultValue: value,
      disabled: options.length === 0,
      listHeight: 260,
      notFoundContent: "暂无可用工作台",
      onChange,
      optionFilterProp: "label",
      optionRender: option => createElement(
        "div",
        { className: "np-workbench-option" },
        createElement("span", { className: "np-workbench-option-name" }, option.data.name),
        createElement("span", { className: "np-workbench-option-template" }, option.data.sourceLabel)
      ),
      options,
      placeholder: "请选择工作台",
      popupMatchSelectWidth: true,
      showSearch: true,
      size: "large"
    })
  ));

  return () => root.unmount();
}
