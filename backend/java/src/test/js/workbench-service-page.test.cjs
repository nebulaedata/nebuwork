const { randomFillSync } = require('node:crypto');
// Model the limited Crypto API exposed on a plain HTTP LAN origin.
const crypto = { getRandomValues: bytes => randomFillSync(bytes) };
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '../../main/resources/workbench-service', name), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('SDK ignores forged initialization and retains the same write key after an uncertain response', async () => {
  const events = {}, requests = [], parent = {}, port = { postMessage: message => requests.push(message), start() {}, close() {} };
  const window = { parent, addEventListener: (name, fn) => { events[name] = fn; } };
  vm.runInNewContext(source('page-sdk.js'), { window, document: { hidden: false }, crypto, console, setTimeout, clearTimeout });
  let initialized = false; window.NebuService.ready().then(() => { initialized = true; });
  events.message({ source: {}, data: { type: 'nebu-service-init', context: {} }, ports: [port] });
  await flush(); assert.equal(initialized, false);
  events.message({ source: parent, data: { type: 'nebu-service-init', context: { id: 'instance', projectId: 'project' } }, ports: [port] });
  const first = window.NebuService.invoke('write', { a: 1, b: 2 }); await flush();
  const originalKey = requests[0].args.requestKey;
  assert.match(originalKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  port.onmessage({ data: { id: requests[0].id, error: { message: 'response lost' } } });
  await assert.rejects(first, e => e.requestKey === originalKey);
  const retry = window.NebuService.invoke('write', { b: 2, a: 1 }); await flush();
  assert.equal(requests[1].args.requestKey, originalKey);
  port.onmessage({ data: { id: requests[1].id, result: { status: 'succeeded' } } }); await retry;
  const fresh = window.NebuService.invoke('write', { a: 1, b: 2 }); await flush();
  assert.notEqual(requests[2].args.requestKey, originalKey);
  port.onmessage({ data: { id: requests[2].id, result: { status: 'succeeded' } } }); await fresh;
  const stop = window.NebuService.subscribe('operation', () => {}); await flush();
  const subscription = requests.at(-1);
  port.onmessage({ data: { id: subscription.id, result: { accepted: true } } });
  port.onmessage({ data: { event: 'operation:' + subscription.args.subscriptionId, data: { status: 'running', eventCursor: 42 } } });
  port.onmessage({ data: { event: 'subscription-ended:' + subscription.args.subscriptionId } }); await flush();
  const resumed = requests.at(-1); assert.equal(resumed.method, 'operation.events'); assert.equal(resumed.args.after, 42);
  stop();
  for (const request of requests.slice(4)) port.onmessage({ data: { id: request.id, result: [] } });
  await flush();
  events.pagehide();
});

test('host rejects forged authorization and discards an old-account response even when transport ignores abort', async () => {
  const events = {}, sent = [], calls = [], parent = { postMessage: message => sent.push(message) };
  const elements = Object.fromEntries(['page', 'status', 'updated', 'title', 'refresh'].map(id => [id, { textContent: '', style: {}, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; } }]));
  const window = { parent, addEventListener: (name, fn) => { events[name] = fn; } };
  let releaseOld;
  const response = data => ({ ok: true, json: async () => ({ code: 0, data }) });
  const fetch = async (url, options) => {
    if (url.endsWith('page-sdk.js')) return { ok: true, text: async () => '' };
    calls.push(options);
    if (calls.length === 1) return new Promise(resolve => { releaseOld = () => resolve(response({ id: 'instance', projectId: 'old', page: { key: 'board', name: 'Old', capabilities: [] }, html: 'OLD ACCOUNT' })); });
    return response({ id: 'instance', projectId: 'new', page: { key: 'board', name: 'New', capabilities: [] }, html: 'NEW ACCOUNT' });
  };
  vm.runInNewContext(source('host.js'), { window, parent, document: { getElementById: id => elements[id] }, location: { pathname: '/api/workbench-services/wb/pages/board', search: '?instanceId=instance' }, history: {}, crypto, Headers, URLSearchParams, AbortController, DOMException, fetch, setTimeout, clearTimeout, setInterval, clearInterval });
  await flush(); assert.equal(calls.length, 1);
  const data = { type: 'nebu-service-authorize', nonce: sent[0].nonce, token: 't'.repeat(43) };
  events.message({ source: {}, origin: 'https://approved.example', data }); await flush(); assert.equal(calls.length, 1);
  events.message({ source: parent, origin: 'https://approved.example', data }); await flush();
  assert.equal(elements.title.textContent, 'New'); assert.match(elements.page.srcdoc, /NEW ACCOUNT/);
  releaseOld(); await flush();
  assert.equal(elements.title.textContent, 'New'); assert.doesNotMatch(elements.page.srcdoc, /OLD ACCOUNT/);
  assert.equal(calls[1].headers.get('Authorization'), 'Bearer ' + data.token);
  events.pagehide();
});

test('host selects projects in the floating controls and forwards manual refresh without recreating the instance', async () => {
  const events = {}, sent = [], requests = [], created = [];
  const node = () => ({ textContent: '', style: {}, children: [], setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; }, append(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; } });
  const elements = Object.fromEntries(['page', 'status', 'updated', 'title', 'refresh', 'project-controls'].map(id => [id, node()]));
  elements.page.contentWindow = { postMessage() {} };
  const document = { hidden: false, getElementById: id => elements[id] || created.find(n => n.id === id), createElement() { const n = node(); created.push(n); return n; } };
  const window = { addEventListener: (name, fn) => { events[name] = fn; } };
  let fade;
  const fetch = async (url, options) => {
    if (url.endsWith('page-sdk.js')) return { ok: true, text: async () => '' };
    requests.push({ url, options });
    const data = url.endsWith('/manifest') ? { pages: [{ key: 'board' }], projects: [{ id: 'one', name: '项目一' }, { id: 'two', name: '项目二' }] } : { id: 'instance', projectId: 'two', releaseId: 'release', page: { key: 'board', name: '项目页面', capabilities: [] }, html: '<p>Published</p>' };
    return { ok: true, json: async () => ({ code: 0, data }) };
  };
  function MessageChannel() { this.port1 = { start() {}, close() {}, postMessage: message => sent.push(message) }; this.port2 = {}; }
  vm.runInNewContext(source('host.js'), { window, parent: window, document, MessageChannel, Option: function(text, value) { this.text = text; this.value = value; }, location: { pathname: '/api/workbench-services/wb/pages/board', search: '' }, history: { replaceState() {} }, crypto, Headers, URLSearchParams, AbortController, DOMException, fetch, setTimeout: (fn, delay) => delay === 2500 ? (fade = fn) : setTimeout(fn, delay), clearTimeout: id => { if (id !== fade) clearTimeout(id); }, setInterval, clearInterval });
  await flush();
  const select = elements['project-controls'].children[0]; assert.equal(select['aria-label'], '选择项目'); assert.equal(select.children.length, 3);
  select.value = 'two'; select.onchange(); await flush();
  assert.equal(elements['project-controls'].children.length, 0); assert.equal(document.title, '项目页面');
  const creations = requests.filter(r => r.url.endsWith('/instances'));
  assert.equal(creations.length, 1); assert.equal(JSON.parse(creations[0].options.body).projectId, 'two'); assert.equal(elements.refresh.disabled, false);
  elements.page.onload(); elements.refresh.onclick();
  assert.equal(sent[0].event, 'refresh'); assert.equal(sent[0].data.reason, 'manual'); assert.equal(requests.length, 3);
  assert.equal(elements.status.textContent, '已发送刷新请求'); fade(); assert.equal(elements.status.textContent, '');
  events.pagehide();
});
