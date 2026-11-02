import { createRoot } from 'react-dom/client';
import { lifetime } from '../knowledge/lifecycle.js';
import { EngineSettings } from './EngineSettings.jsx';
import './engineSettings.css';

export function renderEngineSettings(el) {
  el.innerHTML = '<div class="page settings-page"><div data-engine-settings-root></div></div>';
  const host = el.querySelector('[data-engine-settings-root]'), life = lifetime(host), root = createRoot(host);
  const call = (path, method, body, options) => API.engineSettingsRequest(path, method, body, { ...options,
    signal: options?.signal ? AbortSignal.any([life.signal, options.signal]) : life.signal });
  life.cleanup(() => { host.querySelectorAll('input[type=password]').forEach(input => { input.value = ''; }); root.unmount(); });
  root.render(<EngineSettings call={call} isCurrent={life.live} />);
}
