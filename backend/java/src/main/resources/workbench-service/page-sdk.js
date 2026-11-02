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
  const boot = window.__NEBU_SERVICE_BOOTSTRAP__ || {};
  const pending = new Map(), listeners = new Map(), uncertainRequests = new Map();
  let port, sequence = 0, context, instance, closed = false, readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const key = () => createUuid();
  function emit(name, value) { for (const fn of listeners.get(name) || []) { try { fn(value); } catch (e) { console.error(e); } } }
  function receive(message) {
    if (message.event) { emit(message.event, message.data); return; }
    const entry = pending.get(message.id); if (!entry) return;
    clearTimeout(entry.timer); pending.delete(message.id);
    message.error ? entry.reject(Object.assign(new Error(message.error.message || String(message.error)), { status: message.error.status })) : entry.resolve(message.result);
  }
  function request(method, args) {
    if (closed) return Promise.reject(new Error('页面会话已关闭'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('页面请求超时，请核对原操作后重试')); }, 35000);
      pending.set(id, { resolve, reject, timer });
      if (port) port.postMessage({ id, method, args });
      else window.parent.postMessage({ jsonrpc: '2.0', id, method, params: args }, '*');
    });
  }
  async function mcpTool(name, args) {
    const result = await request('tools/call', { name, arguments: args });
    if (result.isError) throw new Error(result.content?.[0]?.text || '工具调用失败');
    return result.structuredContent ?? JSON.parse(result.content?.[0]?.text || '{}');
  }
  window.addEventListener('message', async event => {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'nebu-service-init' && !port && event.ports?.[0] && boot.mode !== 'mcp') {
      port = event.ports[0]; port.onmessage = e => receive(e.data); port.start();
      context = data.context; instance = context.id; readyResolve(context); emit('ready', context);
    } else if (boot.mode === 'mcp' && data.jsonrpc === '2.0') {
      if (data.id != null && !data.method) receive(data);
      if (data.method === 'ui/notifications/tool-input') {
        const input = data.params?.arguments?.body;
        if (!input?.projectId) return;
        try {
          context = await mcpTool('__service_page_open', { pageKey: boot.pageKey, body: { projectId: input.projectId, releaseId: boot.releaseId }, requestKey: key() });
          instance = context.id; readyResolve(context); emit('ready', context);
        } catch (e) { emit('error', e); }
      }
      if (data.method === 'ui/notifications/tool-result') emit('tool-result', data.params);
      if (data.method === 'ui/notifications/host-context-changed') emit('host-context', data.params);
    }
  });
  async function call(method, args) {
    await ready;
    if (port) return request(method, args);
    switch (method) {
      case 'invoke': return mcpTool(args.capability, { requestKey: args.requestKey, body: { input: args.input, projectId: context.projectId, releaseId: context.releaseId } });
      case 'operation.get': return mcpTool('__service_operation_get', args);
      case 'operation.events': return mcpTool('__service_operation_events', args);
      case 'operation.command': return mcpTool('__service_operation_command', args);
      case 'state.get': return mcpTool('__service_page_get', { instanceId: instance });
      case 'state.save': return mcpTool('__service_page_state', { instanceId: instance, body: args });
      case 'emit': return request('ui/update-model-context', { structuredContent: { event: args.name, data: args.data } });
      default: throw new Error('未支持的页面方法');
    }
  }
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
    return value;
  }
  async function mutation(method, args, options) {
    const fingerprint = method + ':' + JSON.stringify(canonical(args));
    let requestKey = options.requestKey || uncertainRequests.get(fingerprint);
    if (!requestKey) {
      // Do not evict uncertain writes: a lost response must keep its original key.
      if (uncertainRequests.size >= 100) throw new Error('待核对请求过多，请先查询原操作');
      requestKey = key();
    }
    uncertainRequests.set(fingerprint, requestKey);
    try { const result = await call(method, { ...args, requestKey }); uncertainRequests.delete(fingerprint); return result; }
    catch (e) { if (e.status >= 400 && e.status < 500) uncertainRequests.delete(fingerprint); e.requestKey = requestKey; throw e; }
  }
  const api = {
    version: 1, ready: () => ready,
    invoke: (capability, input, options = {}) => mutation('invoke', { capability, input }, options),
    operation: id => call('operation.get', { operationId: id }),
    command: (id, command, options = {}) => mutation('operation.command', { operationId: id, command }, options),
    subscribe: (id, callback) => {
      let active = true, cursor = 0, timer; const deadline = Date.now() + 300000;
      const subscriptionId = key();
      const remove = api.on('operation:' + subscriptionId, operation => {
        if (!active) return;
        cursor = Math.max(cursor, operation.eventCursor || 0);
        callback(operation);
        if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(operation.status)) stop();
      });
      const ended = api.on('subscription-ended:' + subscriptionId, () => { if (active) void poll(); });
      function stop() { active = false; clearTimeout(timer); remove(); ended(); if (port) void call('operation.unsubscribe', { subscriptionId }).catch(() => {}); }
      async function poll() {
        try {
          const events = await call('operation.events', { operationId: id, after: cursor });
          if (!active) return;
          for (const event of events) { cursor = Math.max(cursor, event.id); callback(event.data); }
          const operation = await api.operation(id); if (!active) return;
          if (!events.length) callback(operation);
          if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(operation.status)) { stop(); return; }
        } catch (e) { if (active) emit('error', e); }
        if (active && Date.now() < deadline) timer = setTimeout(poll, document.hidden ? 5000 : 1000);
        else if (active) emit('tracking-paused', { operationId: id });
      }
      if (boot.mode === 'mcp') void poll();
      else void call('operation.subscribe', { operationId: id, subscriptionId, after: cursor }).catch(() => { if (active) void poll(); });
      return stop;
    },
    state: {
      get: () => call('state.get', {}),
      save: async (state, revision) => {
        if (revision === undefined) throw new Error('保存页面状态需要读取时的 revision');
        const result = await call('state.save', { state, revision }); context = { ...context, state: result.state, revision: result.revision }; return result;
      }
    },
    on: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return () => listeners.get(name)?.delete(fn); },
    emit: (name, data) => call('emit', { name, data })
  };
  Object.defineProperty(window, 'NebuService', { value: Object.freeze(api), configurable: false });
  // Opaque frames cannot use browser storage. This compatibility store is ephemeral;
  // persistent settings must use NebuService.state with a server revision.
  for (const name of ['localStorage', 'sessionStorage']) {
    try { void window[name].length; } catch {
      const values = new Map();
      Object.defineProperty(window, name, { configurable: true, value: { get length() { return values.size; }, key: i => [...values.keys()][i] ?? null, getItem: k => values.get(String(k)) ?? null, setItem: (k, v) => values.set(String(k), String(v)), removeItem: k => values.delete(String(k)), clear: () => values.clear() } });
    }
  }
  if (boot.mode === 'mcp') {
    request('ui/initialize', { appInfo: { name: 'nebuwork-service-page', version: '1' }, appCapabilities: {}, protocolVersion: '2026-01-26' })
      .then(() => window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*'))
      .catch(e => emit('error', e));
  }
  window.addEventListener('pagehide', () => { closed = true; for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('页面已关闭')); } pending.clear(); port?.close(); });
})();
