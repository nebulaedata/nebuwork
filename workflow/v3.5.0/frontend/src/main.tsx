import { createRoot } from "react-dom/client";
import { ConfigProvider, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import App from "./App";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: "#242424",
        colorInfo: "#242424",
        colorText: "#242424",
        colorTextSecondary: "#737373",
        colorBorder: "#e2e2e2",
        colorBgLayout: "#f7f7f7",
        borderRadius: 7,
        controlHeight: 32,
        fontSize: 13,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
        colorSuccess: "#368559",
        colorError: "#c34545",
        colorWarning: "#a27527",
        boxShadow: "0 2px 8px rgba(0,0,0,.06)",
      },
      components: {
        Button: {
          primaryShadow: "none",
          defaultShadow: "0 1px 2px rgba(0,0,0,.03)",
          fontWeight: 400,
        },
        Table: {
          headerBg: "#fafafa",
          headerColor: "#737373",
          rowHoverBg: "#f8f8f8",
          cellPaddingBlock: 14,
          cellPaddingInline: 18,
        },
        Tabs: {
          itemSelectedColor: "#171717",
          itemHoverColor: "#171717",
          inkBarColor: "#242424",
          horizontalItemGutter: 8,
        },
        Input: { activeShadow: "0 0 0 2px rgba(0,0,0,.04)" },
        Select: { optionSelectedBg: "#eeeeee" },
        Modal: { borderRadiusLG: 12 },
      },
    }}
  >
    <AntApp>
      <App />
    </AntApp>
  </ConfigProvider>,
);
