import { createRoot } from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { lifetime } from '../knowledge/lifecycle.js';
import { WorkflowContext } from './ui.jsx';
import { WorkflowList, WorkflowEditor } from './WorkflowEditor.jsx';
import { WorkflowTask } from './WorkflowTask.jsx';
import { WorkflowSettings } from './WorkflowSettings.jsx';
import { selectTheme } from '../../shared/workbenchSelect.jsx';
import './workflow.css';

function mount(el, content) {
  el.innerHTML = '<div class="page wf-page"><div data-workflow-root></div></div>';
  const host = el.querySelector('[data-workflow-root]'), life = lifetime(host), root = createRoot(host);
  const context = { live: life.live, artifactUrl: API.workflowArtifactUrl, call: (path, method, body, options) => API.workflowRequest(path, method, body, { ...options, signal: options?.signal ? AbortSignal.any([life.signal, options.signal]) : life.signal }) };
  life.cleanup(() => { host.querySelectorAll('input[type=password]').forEach(input => { input.value = ''; }); root.unmount(); });
  const theme = selectTheme(); theme.token.controlHeight = 40;
  root.render(<ConfigProvider locale={zhCN} theme={theme}><AntApp><WorkflowContext.Provider value={context}>{content}</WorkflowContext.Provider></AntApp></ConfigProvider>);
}
export const renderWorkflowSettings = el => mount(el, <WorkflowSettings />);
window.Views ||= {};
window.Views.workflows = { render: el => mount(el, <WorkflowList />) };
window.Views.workflow = { render: (el, id, query) => mount(el, <WorkflowEditor id={id} expert={query.expert} initialTab={query.tab} runOnOpen={query.run === '1'} configureOnOpen={query.configure === 'inputs'} />) };
window.Views['workflow-task'] = { render: (el, id) => mount(el, <WorkflowTask id={id} />) };
