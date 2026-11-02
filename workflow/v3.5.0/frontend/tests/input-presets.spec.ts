import { createUuid } from '../src/uuid.js';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const presets = [
  { id: 'initial', name: '初始化', description: '首次处理指定范围', input: { mode: 'initial', ids: [1] }, fields: { '/mode': '执行模式', '/ids': '目标列表', '/ids/0': '目标编号' } },
  { id: 'delta', name: '增量更新', description: '继续已有状态', input: { mode: 'delta' }, fields: { '/mode': '增量处理模式' } },
];
async function create(request: APIRequestContext, withPresets = true) {
  const id = 'presets-' + createUuid();
  const response = await request.post('/api/v1/workflows', { data: { id, name: '场景验收' } });
  expect(response.ok()).toBeTruthy();
  const flow = await response.json();
  if (withPresets) {
    const saved = await request.put(`/api/v1/workflows/${id}/definition`, { data: { definition: { ...flow.definition, input_presets: presets }, expected_revision: flow.revision } });
    expect(saved.ok()).toBeTruthy();
  }
  return id;
}
async function choose(page: Page, name: string) {
  await page.getByRole('combobox', { name: '运行场景', exact: true }).click();
  await page.locator('.ant-select-item-option').filter({ hasText: name }).click();
}

test('configure order and documentation, retain drafts, submit only the edited input', async ({ page, request }) => {
  const id = await create(request);
  await page.goto('/#workflow/' + id);
  await page.getByRole('button', { name: '运行场景', exact: true }).click();
  const configuration = page.getByRole('dialog', { name: '运行场景配置' });
  await configuration.getByLabel('参数说明 /ids/0', { exact: true }).fill('要处理的目标编号');
  await configuration.getByRole('button', { name: /^下\s*移$/ }).click();
  await configuration.getByRole('button', { name: '应用到流程草稿' }).click();
  await expect(page.getByRole('button', { name: '创建任务', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存流程', exact: true }).click();
  await expect(page.getByRole('button', { name: '保存流程', exact: true })).toBeDisabled();
  const saved = await (await request.get(`/api/v1/workflows/${id}`)).json();
  expect(saved.definition.input_presets.map((item: { id: string }) => item.id)).toEqual(['delta', 'initial']);
  expect(saved.definition.input_presets[1].fields['/ids/0']).toBe('要处理的目标编号');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建任务' }), input = dialog.getByLabel('输入（JSON）', { exact: true });
  expect(JSON.parse(await input.inputValue())).toEqual({ mode: 'delta' });
  await input.fill('{"mode":"delta","edited":true}');
  await choose(page, '初始化'); await expect(dialog.getByText('要处理的目标编号', { exact: true })).toBeVisible();
  await input.fill('{invalid'); await expect(dialog.getByRole('button', { name: '仅创建', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('JSON 格式错误');
  await dialog.getByRole('button', { name: '恢复预设' }).click();
  expect(JSON.parse(await input.inputValue())).toEqual(presets[0].input);
  await choose(page, '增量更新'); expect(JSON.parse(await input.inputValue())).toEqual({ mode: 'delta', edited: true });
  await dialog.getByRole('button', { name: '仅创建', exact: true }).click();
  await expect(page).toHaveURL(/#task\//);
  const task = await (await request.get('/api/v1/tasks/' + page.url().split('#task/')[1])).json();
  expect(task.state).toBe('ready'); expect(task.input).toEqual({ mode: 'delta', edited: true });
  expect(task.definition.input_presets).toEqual(saved.definition.input_presets);
});

test('lost create and start responses reuse both original commands', async ({ page, request }) => {
  const id = await create(request), creates: unknown[] = [], starts: unknown[] = [];
  await page.route('**/api/v1/tasks', async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    creates.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (creates.length === 1) await route.abort('failed'); else await route.fulfill({ response });
  });
  await page.route('**/api/v1/tasks/*/actions/start', async route => {
    starts.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (starts.length === 1) await route.abort('failed'); else await route.fulfill({ response });
  });
  await page.goto('/#workflow/' + id);
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建任务' }), run = dialog.getByRole('button', { name: '创建并运行' });
  await run.click(); await expect(dialog.getByRole('alert')).toContainText('可使用相同输入重试');
  await expect(run).toBeEnabled(); await run.click();
  await expect.poll(() => starts.length).toBe(1); await expect(run).toBeEnabled();
  await run.click(); await expect(page).toHaveURL(/#task\//);
  expect(creates).toHaveLength(2); expect(creates[1]).toEqual(creates[0]);
  expect(starts).toHaveLength(2); expect(starts[1]).toEqual(starts[0]);
  const tasks = await (await request.get(`/api/v1/tasks?workflow_id=${id}`)).json();
  expect(tasks).toHaveLength(1);
});

test('opening task creation reads presets saved after the page was loaded', async ({ page, request }) => {
  const id = await create(request, false);
  await page.goto('/#workflow/' + id);
  const createTask = page.getByRole('button', { name: '创建任务', exact: true });
  await expect(createTask).toBeEnabled();
  const flow = await (await request.get(`/api/v1/workflows/${id}`)).json();
  const saved = await request.put(`/api/v1/workflows/${id}/definition`, { data: {
    definition: { ...flow.definition, input_presets: presets }, expected_revision: flow.revision,
  } });
  expect(saved.ok()).toBeTruthy();
  await createTask.click();
  const dialog = page.getByRole('dialog', { name: '创建任务' });
  expect(JSON.parse(await dialog.getByLabel('输入（JSON）', { exact: true }).inputValue())).toEqual(presets[0].input);
  await expect(dialog.getByText('目标编号', { exact: true })).toBeVisible();
});

test('unconfigured workflows keep custom JSON and responsive input help', async ({ page, request }) => {
  const id = await create(request, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#workflow/' + id); await page.getByRole('button', { name: '创建任务', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '创建任务' });
  await expect(dialog).toContainText('未配置运行场景');
  await expect(dialog.getByLabel('输入（JSON）', { exact: true })).toHaveValue('{}');
  await dialog.getByLabel('输入（JSON）', { exact: true }).fill('false');
  await expect(dialog.getByText('boolean', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '仅创建', exact: true })).toBeEnabled();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
});
