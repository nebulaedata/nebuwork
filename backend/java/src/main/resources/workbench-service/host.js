(function () {
  'use strict';
  /** UUID v4 from secure random bytes; works on HTTP LAN origins and Node 22. */
  function createUuid() {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16)
      + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }
  const match = /^(.*\/api\/workbench-services\/([A-Za-z0-9_-]+))\/pages\/([A-Za-z][A-Za-z0-9_-]*)$/.exec(location.pathname);
  if (!match) return;
  const base = match[1], wb = match[2], pageKey = match[3], params = new URLSearchParams(location.search);
  const frame = document.getElementById('page'), status = document.getElementById('status'), updated = document.getElementById('updated'), refreshButton = document.getElementById('refresh');
  const nonce = createUuid(), controllers = new Set(), subscriptions = new Map();
  let token = '', hostOrigin = '', instance, page, port, timer, messageTimer, generation = 0, loadEpoch = 0, disposed = false, sdk = '', loading = false;
  const newKey = () => createUuid();
  function message(text, failure, transient = false) { clearTimeout(messageTimer); status.textContent = text; status.style.color = failure ? 'var(--danger)' : 'var(--muted)'; status.setAttribute('role', failure ? 'alert' : 'status'); if (transient) messageTimer = setTimeout(() => { status.textContent = ''; }, 2500); }
  function detach() { clearInterval(timer); clearTimeout(messageTimer); port?.close(); port = null; frame.removeAttribute('srcdoc'); for (const c of controllers) c.abort(); controllers.clear(); subscriptions.clear(); }
  async function authorizedOperation(id) {
    const result = await request('/operations/' + encodeURIComponent(id));
    if (!page || !page.page.capabilities.includes(result.capability) || result.projectId !== page.projectId || result.releaseId !== page.releaseId) throw new Error('执行记录不属于此页面的授权上下文');
    return result;
  }
  async function subscribe(args) {
    await authorizedOperation(args.operationId);
    if (typeof args.subscriptionId !== 'string' || args.subscriptionId.length > 128 || subscriptions.has(args.subscriptionId)) throw new Error('订阅编号无效');
    const controller = new AbortController(), current = generation;
    subscriptions.set(args.subscriptionId, controller); controllers.add(controller);
    const headers = new Headers({ Accept: 'text/event-stream' });
    if (token) headers.set('Authorization', 'Bearer ' + token);
    if (hostOrigin) headers.set('X-Host-Origin', hostOrigin);
    async function stream() {
      try {
        const response = await fetch(base + '/operations/' + encodeURIComponent(args.operationId) + '/stream?after=' + Math.max(0, Number(args.after) || 0), { headers, credentials: token ? 'omit' : 'include', signal: controller.signal });
        if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('事件订阅不可用');
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          buffer += decoder.decode(part.value, { stream: true }).replace(/\r\n/g, '\n');
          if (buffer.length > 4 * 1024 * 1024) throw new Error('事件响应过大');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const packet = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            const line = packet.split('\n').find(l => l.startsWith('data: '));
            if (!line || current !== generation) continue;
            if (packet.includes('event: access-ended')) throw new Error('订阅授权已结束');
            if (packet.includes('event: operation')) {
              const id = packet.split('\n').find(l => l.startsWith('id: '));
              port?.postMessage({ event: 'operation:' + args.subscriptionId, data: { ...JSON.parse(line.slice(6)), eventCursor: Number(id?.slice(4)) || 0 } });
            }
          }
        }
        if (current === generation && !controller.signal.aborted) port?.postMessage({ event: 'subscription-ended:' + args.subscriptionId });
      } catch (e) { if (current === generation && !controller.signal.aborted) port?.postMessage({ event: 'subscription-ended:' + args.subscriptionId, data: { error: e.message } }); }
      finally { controllers.delete(controller); subscriptions.delete(args.subscriptionId); }
    }
    void stream(); return { accepted: true };
  }
  async function request(path, options = {}) {
    const epoch = loadEpoch;
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const headers = new Headers(options.headers);
      if (token) headers.set('Authorization', 'Bearer ' + token);
      if (hostOrigin) headers.set('X-Host-Origin', hostOrigin);
      if (options.body) headers.set('Content-Type', 'application/json');
      const response = await fetch(base + path, { ...options, headers, credentials: token ? 'omit' : 'include', signal: controller.signal });
      const result = await response.json();
      if (epoch !== loadEpoch || disposed) throw new DOMException('页面身份已变化', 'AbortError');
      if (!response.ok || result.code !== 0) throw Object.assign(new Error(result.msg || '页面请求失败'), { status: response.status });
      return result.data;
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  }
  async function handle(method, args) {
    if (!page) throw new Error('页面尚未加载');
    switch (method) {
      case 'invoke': {
        if (!page.page.capabilities.includes(args.capability)) throw new Error('页面未声明此能力');
        const result = await request('/capabilities/' + encodeURIComponent(args.capability) + '/invoke', { method: 'POST', headers: { 'Idempotency-Key': args.requestKey }, body: JSON.stringify({ input: args.input, instanceId: instance, projectId: page.projectId, releaseId: page.releaseId }) });
        updated.textContent = '最后成功请求：' + new Date().toLocaleString(); message(''); return result;
      }
      case 'operation.get': return authorizedOperation(args.operationId);
      case 'operation.events': await authorizedOperation(args.operationId); return request('/operations/' + encodeURIComponent(args.operationId) + '/events?after=' + Math.max(0, Number(args.after) || 0));
      case 'operation.command': await authorizedOperation(args.operationId); return request('/operations/' + encodeURIComponent(args.operationId) + '/commands', { method: 'POST', headers: { 'Idempotency-Key': args.requestKey }, body: JSON.stringify(args.command) });
      case 'operation.subscribe': return subscribe(args);
      case 'operation.unsubscribe': subscriptions.get(args.subscriptionId)?.abort(); subscriptions.delete(args.subscriptionId); return { accepted: true };
      case 'state.get': { const p = await request('/page-instances/' + encodeURIComponent(instance)); return { state: p.state, revision: p.revision }; }
      case 'state.save': { const p = await request('/page-instances/' + encodeURIComponent(instance) + '/state', { method: 'POST', body: JSON.stringify(args) }); return { state: p.state, revision: p.revision }; }
      case 'emit': {
        if (typeof args.name !== 'string' || JSON.stringify(args.data ?? null).length > 64000) throw new Error('无效的页面事件');
        window.dispatchEvent(new CustomEvent('nebu-service-event', { detail: args }));
        if (hostOrigin) parent.postMessage({ type: 'nebu-service-event', instanceId: instance, ...args }, hostOrigin);
        return { accepted: true };
      }
      default: throw new Error('未允许的页面请求');
    }
  }
  function render() {
    const current = ++generation; detach();
    const bootstrap = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; frame-src \'none\'; form-action \'none\'; base-uri \'none\'; object-src \'none\'"><script>window.__NEBU_SERVICE_BOOTSTRAP__={mode:"host"};\n' + sdk.replace(/<\/script/gi, '<\\/script') + '</script>';
    const html = page.html;
    const prefix = /^(?:\s|<!--[\s\S]*?-->)*(?:<!doctype\b[^>]*>(?:\s|<!--[\s\S]*?-->)*)?(?:<html\b[^>]*>(?:\s|<!--[\s\S]*?-->)*)?(?:<head\b[^>]*>)?/i.exec(html)?.[0] || '';
    frame.onload = () => {
      if (current !== generation || disposed) return;
      const channel = new MessageChannel(); port = channel.port1;
      port.onmessage = async event => {
        const data = event.data;
        if (!data || !Number.isSafeInteger(data.id) || typeof data.method !== 'string' || JSON.stringify(data).length > 1024 * 1024) return;
        try { const result = await handle(data.method, data.args || {}); if (current === generation) port?.postMessage({ id: data.id, result }); }
        catch (e) {
          if (current !== generation) return;
          port?.postMessage({ id: data.id, error: { message: e.message, status: e.status } });
          message('请求失败，当前数据可能已过期：' + e.message, true);
          if ([401, 403, 404].includes(e.status)) { ++generation; detach(); page = null; if (hostOrigin) parent.postMessage({ type: 'nebu-service-auth-required', nonce }, hostOrigin); }
        }
      };
      port.start();
      const context = { id: page.id, workbenchId: wb, projectId: page.projectId, releaseId: page.releaseId, context: page.context, state: page.state, revision: page.revision, capabilities: page.page.capabilities };
      frame.contentWindow.postMessage({ type: 'nebu-service-init', context }, '*', [channel.port2]);
      const refresh = page.page.refreshSeconds;
      let elapsed = 0;
      timer = setInterval(async () => {
        if (document.hidden) return;
        elapsed += 5;
        if (refresh && elapsed % refresh < 5) port?.postMessage({ event: 'refresh', data: { reason: 'timer' } });
        if (elapsed % 15 === 0) try { await request('/page-instances/' + encodeURIComponent(instance)); } catch (e) { message('访问验证失败：' + e.message, true); if ([401, 403, 404].includes(e.status)) { ++generation; detach(); page = null; } }
      }, 5000);
    };
    frame.srcdoc = prefix + bootstrap + html.slice(prefix.length);
  }
  async function load() {
    if (loading || disposed) return; loading = true; refreshButton.disabled = true; message('正在读取页面…');
    const epoch = ++loadEpoch;
    const current = () => epoch === loadEpoch && !disposed;
    try {
      if (!sdk) { const response = await fetch(base + '/page-sdk.js', { credentials: 'omit' }); if (!response.ok) throw new Error('页面 SDK 加载失败'); const source = await response.text(); if (!current()) return; sdk = source; }
      instance = params.get('instanceId');
      if (instance) page = await request('/page-instances/' + encodeURIComponent(instance));
      else {
        const manifest = await request('/manifest' + (params.get('releaseId') ? '?releaseId=' + encodeURIComponent(params.get('releaseId')) : ''));
        const definition = manifest.pages.find(p => p.key === pageKey);
        if (!definition) throw new Error('页面不存在或未获授权');
        const allowed = (manifest.projects || []).filter(p => !definition.projectIds || definition.projectIds.includes(p.id)); let projectId = params.get('projectId');
        if (projectId && definition.projectIds && !allowed.some(p => p.id === projectId)) throw new Error('页面未授权此项目');
        if (!projectId && allowed.length === 1) projectId = allowed[0].id;
        if (!projectId) {
          let select = document.getElementById('project');
          if (!select) { select = document.createElement('select'); select.id = 'project'; select.setAttribute('aria-label', '选择项目'); document.getElementById('project-controls').append(select); }
          select.replaceChildren(new Option('请选择项目', ''));
          for (const p of allowed) select.append(new Option(p.name || p.id, p.id));
          select.onchange = () => { if (select.value) { params.set('projectId', select.value); void load(); } };
          message(allowed.length ? '选择项目后打开页面。' : '当前授权没有可用项目。'); return;
        }
        document.getElementById('project-controls').replaceChildren();
        page = await request('/pages/' + encodeURIComponent(pageKey) + '/instances', { method: 'POST', headers: { 'Idempotency-Key': newKey() }, body: JSON.stringify({ projectId, ...(params.get('releaseId') ? { releaseId: params.get('releaseId') } : {}) }) });
        instance = page.id; params.set('instanceId', instance); history.replaceState(null, '', location.pathname + '?' + params);
      }
      if (page.page.key !== pageKey) throw new Error('页面实例与地址不匹配');
      document.getElementById('title').textContent = page.page.name;
      document.title = page.page.name; frame.title = page.page.name;
      message(''); render();
    } catch (e) { if (current()) { message('页面不可用：' + e.message, true); if ([401, 403, 404].includes(e.status)) { detach(); page = null; } } }
    finally { if (current()) { loading = false; refreshButton.disabled = false; } }
  }
  refreshButton.onclick = () => { if (port) { message('已发送刷新请求', false, true); port.postMessage({ event: 'refresh', data: { reason: 'manual' } }); } else void load(); };
  window.addEventListener('message', event => {
    if (event.source !== parent || event.origin === 'null' || event.data?.type !== 'nebu-service-authorize' || event.data.nonce !== nonce || !/^[A-Za-z0-9_-]{43}$/.test(event.data.token || '')) return;
    token = event.data.token; hostOrigin = event.origin; ++generation; ++loadEpoch; detach(); page = null; loading = false; void load();
  });
  window.addEventListener('pagehide', () => { disposed = true; ++generation; ++loadEpoch; detach(); token = ''; });
  if (parent !== window) parent.postMessage({ type: 'nebu-service-ready', nonce, workbenchId: wb, pageKey }, '*');
  void load();
})();
