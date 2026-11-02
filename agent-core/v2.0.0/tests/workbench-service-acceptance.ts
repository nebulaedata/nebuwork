import { createUuid } from '../src/uuid.js';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import mysql from 'mysql2/promise';
import { fixture, testConfig } from './fixture.js';
import { Store } from '../src/store.js';
import { Objects } from '../src/objects.js';
import { Business } from '../src/business.js';
import { Worker } from '../src/worker.js';
import { createApi } from '../src/api.js';
import { createPlatformMcpServer } from '../src/platform-mcp-server.js';

const root = 'http://127.0.0.1:42025/nwaa/api';
const bootstrap = await mysql.createConnection(testConfig.DATABASE_URL); await bootstrap.query('CREATE DATABASE IF NOT EXISTS workbench_service_acceptance'); await bootstrap.end();
const env = { ...testConfig, DATABASE_URL: testConfig.DATABASE_URL.replace('/agent_test', '/workbench_service_acceptance'), S3_BUCKET: 'workbench-service-acceptance', S3_PREFIX: '', BUSINESS_API_URL: 'http://127.0.0.1:42025/nwaa', LEASE_MS: 15000 };
const store = new Store(env.DATABASE_URL), objects = new Objects(env); await store.migrate(); await objects.initialize();
const provider = await fixture(), api = await createApi(env, store, objects); await api.listen({ host: '127.0.0.1', port: 42320 });
const mcp = createPlatformMcpServer({ businessUrl: env.BUSINESS_API_URL, serviceKey: 'isolated-service-protocol-key-32-characters' }); await new Promise<void>(r => mcp.listen(42321, '127.0.0.1', r));
const worker = new Worker(env, store, objects, new Business(env)); let ticking = false;
const timer = setInterval(async () => { if (ticking) return; ticking = true; try { await worker.tick(); } finally { ticking = false; } }, 200);
async function call(path: string, body?: unknown, key = createUuid()) {
  const response = await fetch(root + path, { method: body === undefined ? 'GET' : 'POST', headers: { token: 'service-acceptance-token', 'content-type': 'application/json', 'Idempotency-Key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json() as any; assert.ok(response.ok && result.code === 0, response.status + ': ' + JSON.stringify(result)); return result.data;
}
async function settle(wb: string, id: string) { const deadline = Date.now() + 90000; while (Date.now() < deadline) { const result = await call('/workbench-services/' + wb + '/operations/' + id); if (['succeeded', 'failed', 'cancelled', 'interrupted'].includes(result.status)) return result; await new Promise(r => setTimeout(r, 500)); } throw new Error('Service operation did not finish'); }
try {
  const model = await call('/model-providers', { type: 'custom', baseUrl: 'http://127.0.0.1:' + provider.port + '/v1', apiKey: 'fixture-secret-never-persist', model: 'scripted-model' });
  const wb = await call('/workbenches', { name: '服务真实链路验收' });
  await call('/runtime-resources/workbench/' + wb.id, { revision: 0, document: { modelProviderId: model.id, instructions: [], files: [], skills: [], mcp: [], requiredCapabilities: [] } });
  await call('/workbenches/' + wb.id + '/config', { revision: 1, bizName: '服务验收', domain: '测试', bizDef: '运行服务接口并验证结构化结果' });
  await call('/workbenches/' + wb.id + '/publish', { revision: 2 });
  const project = await call('/projects', { name: '隔离执行项目', workbenchId: wb.id });
  await call('/workflow/settings', { revision: 0, enabled: true, baseUrl: 'http://127.0.0.1:8767', apiKey: '', requestTimeoutMs: 15000 });
  const flow = await call('/workflows', { name: '服务热加载验收' });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const current = await call('/workflows/' + flow.id); if (current.status === 'ready') break; assert.notEqual(current.status, 'failed', current.error); await new Promise(r => setTimeout(r, 500)); }
  let source = await call('/workflows/' + flow.id + '/source?path=main.py');
  async function changeWorkflow(value: number | string) { source = await call('/workflows/' + flow.id + '/source?path=main.py', { content: 'def run(ctx):\n    ctx.task.save_json("result", {"value": ' + JSON.stringify(value) + '})\n', expected_revision: source.revision }); }
  await changeWorkflow(1);
  const channels = { api: true, mcp: true, page: true }, projectIds = [project.id];
  const definition = { name: '服务真实验收', description: '真实 Java、Workflow 与 New2 执行，模型为脚本测试替身', capabilities: [
    { key: 'analyze', name: 'SDK 结构化分析', inputSchema: { type: 'object' }, outputSchema: { type: 'object', required: ['answer'], properties: { answer: { type: 'string' } }, additionalProperties: false }, projectIds, channels, binding: { type: 'agent', projectId: project.id, instructions: '通过 service_result_submit 返回结构化结果。' } },
    { key: 'workflow', name: '工作流当前实现', inputSchema: { type: 'object' }, outputSchema: { type: 'object', required: ['value'], properties: { value: { type: 'integer' } }, additionalProperties: false }, projectIds, channels, binding: { type: 'workflow', workflowId: flow.id, resultStep: 'main', resultName: 'result' } }
  ], pages: [] };
  await call('/workbenches/' + wb.id + '/service', { revision: 0, definition }); const release = await call('/workbenches/' + wb.id + '/service/publish', { revision: 1 });
  const invoke = (cap: string, input: unknown, key?: string) => call('/workbench-services/' + wb.id + '/capabilities/' + cap + '/invoke', { projectId: project.id, input }, key);
  const key = createUuid(), started = await invoke('analyze', { request: 'service-result-smoke' }, key), analyzed = await settle(wb.id, started.id);
  assert.equal(analyzed.status, 'succeeded', JSON.stringify(analyzed)); assert.equal(analyzed.result.answer, 'official SDK service result'); assert.equal((await invoke('analyze', { request: 'service-result-smoke' }, key)).id, started.id);
  assert.ok(analyzed.usage.totalTokens > 0, JSON.stringify(analyzed.usage)); assert.equal(analyzed.source, 'api');
  const first = await settle(wb.id, (await invoke('workflow', {})).id); assert.equal(first.status, 'succeeded', JSON.stringify(first)); assert.equal(first.result.value, 1);
  await changeWorkflow(2); const changed = await settle(wb.id, (await invoke('workflow', {})).id); assert.equal(changed.result.value, 2, JSON.stringify(changed)); assert.equal(changed.releaseId, release.id);
  await changeWorkflow('invalid'); const invalid = await settle(wb.id, (await invoke('workflow', {})).id); assert.equal(invalid.status, 'failed');
  const task = await call('/projects/' + project.id + '/tasks', { title: '自然语言页面生成协议验收', content: 'service-page-smoke 请创建并登记自包含 HTML 页面草稿，不要发布。' });
  const taskDeadline = Date.now() + 60000; let detail: any;
  while (Date.now() < taskDeadline) { detail = await call('/tasks/' + task.task.id); const run = detail.runs.at(-1); if (['completed', 'failed', 'interrupted'].includes(run.status)) break; await new Promise(r => setTimeout(r, 500)); }
  assert.equal(detail.runs.at(-1).status, 'completed', JSON.stringify(detail.runs.at(-1)));
  const service = await call('/workbenches/' + wb.id + '/service'); assert.ok(service.draft.pages.some((p: any) => p.key === 'generated')); assert.equal(service.activeReleaseId, release.id);
  assert.ok(provider.modelRequests.some((r: any) => r.tools?.some((t: any) => t.function.name === 'service_result_submit')));
  const reportPath = process.env.SERVICE_EXECUTION_REPORT ?? '.qa/workbench-service-execution.json';
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ status: 'passed', model: 'scripted HTTP fixture; real pi SDK, SQL, S3 and Docker execution', workbenchId: wb.id, agentOperationId: started.id, workflowId: flow.id, firstValue: first.result.value, changedValue: changed.result.value, invalidOutputStatus: invalid.status, generatedPageDraft: true, originalReleaseRetained: true }, null, 2));
  console.log('PASS: Java -> real pi SDK/New2 -> structured result; live Workflow code changes and JSON contracts; agent-generated page remains a draft.');
} finally {
  clearInterval(timer); await worker.stop(); await api.close(); await provider.app.close(); await store.close(); objects.client.destroy(); await new Promise<void>(resolve => mcp.close(() => resolve()));
  if (process.env.SERVICE_EXECUTION_DONE) await writeFile(process.env.SERVICE_EXECUTION_DONE, 'done');
}
