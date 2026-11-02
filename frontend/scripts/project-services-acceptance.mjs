import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const output = resolve('apps/web/.qa/project-services'); await mkdir(output, { recursive: true });
let mode = 'published', reads = 0, writes = 0; const requests = [];
const definition = {
  name: '法律咨询服务', description: '项目业务服务',
  pages: [{ key: 'report', name: '法律法规看板', capabilities: [], projectIds: ['project'] }, { key: 'other', name: '其他项目页面', capabilities: [], projectIds: ['other'] }],
  capabilities: [{ key: 'law-search', name: '法规查询', description: '检索当前项目的法律法规与适用条款', projectIds: ['project'], channels: { api: true, mcp: true } }, { key: 'other-tool', name: '其他项目能力', projectIds: ['other'], channels: { api: true, mcp: true } }],
};
const fixture = `import '/src/styles.css';import '/src/form-controls.css';import '/src/layout-overrides.css';import '/src/shared/icons.js';
import {createWorkbenchServiceApi} from '/src/services/workbenchServiceApi.js';
import {authSession} from '/src/services/authSession.js';import '/src/features/projects/detailView.js';
window.UI={skeleton:()=>'<p>加载中…</p>'};
const request=async(path,options={})=>{const response=await fetch(path.startsWith('/api/')?'/nebulaedev/nwaa'+path:path,options),result=await response.json();if(!response.ok)throw Error(result.message);return result;};
window.API={...createWorkbenchServiceApi(request,p=>'/nebulaedev/nwaa'+p,authSession),fetchProjectDetail:()=>request('/__fixture/project')};
const host=document.getElementById('project-root');window.showOverview=()=>window.Views.project.render(host,'project');window.showTasks=()=>window.Views.project.render(host,'project',{tab:'sessions'});window.clearIdentity=()=>authSession.invalidate();
window.showOverview();`;
const server = await createServer({ root: resolve('apps/web'), server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'project-services-fixture', resolveId(id) { if (id === '/__project_services.jsx') return id; }, load(id) { if (id === '/__project_services.jsx') return fixture; },
  configureServer(vite) { vite.middlewares.use((req, res, next) => { void (async () => {
    const path = new URL(req.url, 'http://fixture.invalid').pathname;
    if (path === '/__project_services') {
      res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(path, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>项目概览服务验收</title><body><div id="topbar" style="position:static"><div id="topbar-title"></div><span id="topbar-crumb"></span><div id="topbar-tabs"></div></div><main id="app-content" style="position:static;height:calc(100vh - 56px);margin:0;overflow:auto"><div class="route-view" id="project-root"></div></main><script type="module" src="/__project_services.jsx"></script></body></html>')); return;
    }
    if (!path.startsWith('/__fixture/') && !path.startsWith('/nebulaedev/nwaa/api/')) return next();
    requests.push(path);
    const json = (data, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
    if (req.method !== 'GET') writes++;
    if (path === '/__fixture/project') return json({ data: { project: { id: 'project', name: '法律问题咨询', desc: '法律问题咨询', workbenchId: 'wb', workbenchName: '法律法规工作台', status: 'active', stats: { tasks: 2 } }, usage: { totalTokens: 1105036, callCount: 57, successRate: 100 }, sessions: [{ id: 'task', title: '法律法规看板生成', status: 'completed', updatedAt: '2026-10-19T05:45:17Z' }], files: [], workbenchVersion: { version: 1, publishedAt: '2026-10-16T01:57:01Z', snapshot: { config: { bizName: '法律法规咨询' } } } } });
    reads++;
    if (mode === 'error') return json({ message: '服务读取失败，请重试' }, 503);
    if (path.endsWith('/service/releases')) return json({ data: [{ id: 'history', version: 3, definition: { name: '历史服务', pages: [], capabilities: [] } }, { id: 'active', version: 2, createdAt: '2026-10-21T01:30:00Z', definition }] });
    if (path.endsWith('/service')) return json({ data: { available: mode !== 'unavailable', enabled: mode !== 'disabled', activeReleaseId: mode === 'empty' ? null : 'active', draft: { name: '未发布草稿服务' } } });
    if (path.includes('/pages/report')) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end('<!doctype html><meta charset="utf-8"><h1>已发布法律法规看板</h1>'); }
    if (path.endsWith('/openapi.json')) return json({ openapi: '3.1.0' });
    json({ message: 'unexpected fixture route' }, 404);
  })().catch(error => { res.statusCode = 500; res.end(error.message); }); }); },
}] });
await server.listen(); const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ headless: true }); const errors = []; let inspectedPage;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(); inspectedPage = page; page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/__project_services#/project/project');
  const section = page.getByRole('region', { name: '已发布服务' });
  await section.getByRole('link', { name: '打开页面' }).waitFor();
  assert.equal(await section.getByText('其他项目页面').count(), 0); assert.equal(await section.getByText('其他项目能力').count(), 0); assert.equal(await section.getByText('未发布草稿服务').count(), 0);
  assert.equal(await section.evaluate(el => el.parentElement.previousElementSibling.textContent.includes('业务配置')), true);
  await section.getByRole('button', { name: '复制MCP 连接地址' }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), origin + '/nebulaedev/nwaa/api/workbench-services/wb/mcp');
  const popupPromise = context.waitForEvent('page'); await section.getByRole('link', { name: '打开页面' }).click(); const popup = await popupPromise;
  await popup.getByRole('heading', { name: '已发布法律法规看板' }).waitFor(); assert.equal(new URL(popup.url()).searchParams.get('projectId'), 'project'); await popup.close();
  const docs = await section.getByRole('link', { name: '查看文档' }).getAttribute('href');
  assert.equal(new URL(docs).searchParams.get('releaseId'), 'active'); assert.equal((await (await page.request.get(docs)).json()).openapi, '3.1.0');
  await page.screenshot({ path: resolve(output, 'desktop.png'), fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.body.style.overflow = 'auto'; const main = document.getElementById('app-content'); main.style.height = 'auto'; main.style.overflow = 'visible'; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.getElementById('app-content').scrollWidth > innerWidth), false);
  await page.screenshot({ path: resolve(output, 'mobile.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => document.documentElement.dataset.theme = 'dark'); await page.screenshot({ path: resolve(output, 'dark-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.evaluate(() => document.documentElement.dataset.theme = 'light');
  mode = 'error'; await section.getByRole('button', { name: '刷新已发布服务' }).click(); await section.getByRole('alert').waitFor(); assert.equal(await section.getByRole('link', { name: '打开页面' }).count(), 0);
  mode = 'empty'; await section.getByRole('button', { name: '重新加载' }).click(); await section.getByText(/当前项目暂无已发布服务/).waitFor();
  mode = 'disabled'; await section.getByRole('button', { name: '刷新已发布服务' }).click(); await section.getByText(/服务已停用/).waitFor();
  mode = 'unavailable'; await section.getByRole('button', { name: '刷新已发布服务' }).click(); await section.getByText('运行功能未启用', { exact: true }).waitFor(); assert.equal(await section.getByRole('link', { name: '打开页面' }).count(), 0);
  mode = 'published'; await section.getByRole('button', { name: '刷新已发布服务' }).click(); await section.getByRole('link', { name: '打开页面' }).waitFor();
  await page.evaluate(() => window.showTasks()); assert.equal(await section.count(), 0);
  await page.evaluate(() => window.showOverview()); await section.getByRole('link', { name: '打开页面' }).waitFor();
  const before = reads; await page.evaluate(() => window.clearIdentity()); await section.getByText(/登录状态已变化/).waitFor(); assert.equal(reads, before); assert.equal(await section.locator('a').count(), 0);
  assert.deepEqual(errors, []); assert.equal(writes, 0);
  const result = { passed: true, ui: 'actual project overview, service component and URL helper', api: 'isolated scripted authorized-service responses', checks: ['formal release and project scope', 'HTML project-bound entry', 'API document entry', 'MCP clipboard', '390px layout', 'light/dark rendering', 'error/retry/empty/disabled/unavailable', 'navigation cleanup', 'identity cleanup', 'no writes'] };
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ errors, requests: requests.slice(-8), pages: await Promise.all(inspectedPage.context().pages().map(async p => ({ url: p.url(), body: (await p.locator('body').innerText().catch(() => ''))?.slice(0, 1000) }))) }));
  await inspectedPage?.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }); throw error;
} finally { await browser.close(); await server.close(); }
