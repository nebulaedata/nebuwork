import { useEffect, useState } from "react";
import {
  Button,
  ColorPicker,
  MessagePlugin,
  Radio,
  Switch,
  Tag,
} from "tdesign-react";
import { FolderIcon } from "tdesign-icons-react";
import { ErrorNotice } from "./ui";
import {
  DEFAULT_THEME_COLOR,
  THEME_PRESETS,
  readableBrand,
  themeVariables,
  useTheme,
  validThemeColor,
} from "./theme";

export function AppearanceSettings() {
  const theme = useTheme();
  const [draft, setDraft] = useState(theme.color);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(theme.color), [theme.color]);
  const changed = draft.toLowerCase() !== theme.color.toLowerCase();
  const disabled = theme.loading || !!theme.error || saving;
  const effective = readableBrand(draft);
  async function save() {
    setSaving(true);
    try {
      await theme.save(draft);
      MessagePlugin.success("主题色已保存");
    } catch (e) {
      MessagePlugin.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="tab-content appearance-settings">
      <div className="toolbar">
        <div>
          <h2>主题色</h2>
          <p className="help">
            默认紫蓝色。保存后应用到整个后台，所有访问者共用此设置。
          </p>
        </div>
        <Button
          theme="primary"
          onClick={save}
          loading={saving}
          disabled={disabled || !changed}
        >
          保存主题色
        </Button>
      </div>
      <ErrorNotice message={theme.error} />
      {theme.error && (
        <Button variant="outline" onClick={theme.reload}>
          重新加载
        </Button>
      )}
      <div className="appearance-layout">
        <div className="appearance-controls">
          <div className="field-label">预设颜色</div>
          <Radio.Group
            value={draft}
            onChange={(value) => setDraft(String(value))}
            disabled={disabled}
            className="theme-presets"
            aria-label="预设主题色"
          >
            {THEME_PRESETS.map((preset) => (
              <Radio
                value={preset.color}
                key={preset.color}
                className="theme-preset"
              >
                <span
                  className="theme-swatch"
                  style={{ background: preset.color }}
                />
                <span>
                  {preset.name}
                  {preset.color === DEFAULT_THEME_COLOR && <small>默认</small>}
                </span>
              </Radio>
            ))}
          </Radio.Group>
          <div className="field theme-custom-color">
            <div className="field" role="group" aria-label="自定义颜色">
              <span className="field-label">自定义颜色</span>
              <ColorPicker
                value={draft}
                onChange={(_value, context) => {
                  if (validThemeColor(context.color.hex))
                    setDraft(context.color.hex.toLowerCase());
                }}
                format="HEX"
                colorModes={["monochrome"]}
                enableAlpha={false}
                clearable={false}
                disabled={disabled}
                inputProps={{ name: "theme-color", allowInput: false }}
                swatchColors={THEME_PRESETS.map((preset) => preset.color)}
              />
            </div>
            <p className="help">
              可输入十六进制色值，较浅的颜色会自动加深以保证文字清晰。
            </p>
            {effective !== draft.toLowerCase() && (
              <span className="help">实际应用：{effective.toUpperCase()}</span>
            )}
          </div>
          <div className="appearance-actions">
            <Button
              variant="outline"
              disabled={disabled || draft === DEFAULT_THEME_COLOR}
              onClick={() => setDraft(DEFAULT_THEME_COLOR)}
            >
              恢复默认
            </Button>
            {changed && (
              <Button
                variant="text"
                disabled={disabled}
                onClick={() => setDraft(theme.color)}
              >
                撤销修改
              </Button>
            )}
            <span className="help" role="status">
              {theme.loading
                ? "正在加载…"
                : theme.error
                  ? "加载失败"
                  : changed
                    ? "有未保存的修改"
                    : "已保存"}
            </span>
          </div>
        </div>
        <div className="appearance-preview" style={themeVariables(draft)}>
          <div className="appearance-preview-heading">
            效果预览 <span>选择颜色即可预览</span>
          </div>
          <div className="appearance-preview-body">
            <div className="appearance-preview-nav">
              <FolderIcon /> 知识库
            </div>
            <div className="appearance-preview-content">
              <div className="toolbar">
                <h3>项目资料</h3>
                <Tag theme="primary" variant="light">
                  已选中
                </Tag>
              </div>
              <p className="help">整理内容、检索知识并追溯原文。</p>
              <div className="appearance-preview-controls">
                <Button theme="primary">主要操作</Button>
                <Button theme="primary" variant="outline">
                  次要操作
                </Button>
                <Switch value aria-label="主题开关预览" />
              </div>
              <div className="appearance-preview-source">
                <span>来源引用</span>
                <p>菜单、按钮与内容高亮会使用同一主题色。</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
