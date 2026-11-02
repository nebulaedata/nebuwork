import { createRoot } from 'react-dom/client';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { selectTheme } from '../../shared/workbenchSelect.jsx';
import { WorkflowContext } from './ui.jsx';
import { RemoteWorkflowOverview } from './WorkflowOverview.jsx';
import './workflow.css';

export function mountSopOverview(host, { id, expert, api, life }) {
  const element = host.querySelector('[data-workflow-overview]');
  if (!element) return { update() {}, message() {} };
  const root = createRoot(element);
  const context = { live: life.live, artifactUrl: api.workflowArtifactUrl,
    call: (path, method, body, options) => api.workflowRequest(path, method, body, { ...options, signal: options?.signal ? AbortSignal.any([life.signal, options.signal]) : life.signal }) };
  const theme = selectTheme(); theme.token.controlHeight = 40;
  let revision = 0;
  life.cleanup(() => root.unmount());
  const render = content => root.render(<ConfigProvider locale={zhCN} theme={theme}><App><WorkflowContext.Provider value={context}>{content}</WorkflowContext.Provider></App></ConfigProvider>);
  return {
    update(workflow) { if (life.live()) render(<RemoteWorkflowOverview id={id} workflow={workflow} refreshKey={++revision} route={`#/workflow/${encodeURIComponent(id)}?expert=${encodeURIComponent(expert)}`} />); },
    message(text) { if (life.live()) render(<div className="wf-overview-grid">{['执行流程', '运行场景', '输入参数', '产物文件'].map(title => <section className="wf-overview-card" key={title}><div className="wf-overview-label">{title}</div><p className="dim">{text}</p></section>)}</div>); },
  };
}
