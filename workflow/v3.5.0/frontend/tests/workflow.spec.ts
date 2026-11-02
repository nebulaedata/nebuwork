import { test, expect, type Page } from "@playwright/test";

async function paste(page: Page, text: string) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((text) => navigator.clipboard.writeText(text), text);
  await page.keyboard.press("ControlOrMeta+V");
}

async function replaceCode(page: Page, source: string) {
  const editor = page.locator(".monaco-editor").first();
  await editor.click({ position: { x: 180, y: 30 } });
  await page.keyboard.press("ControlOrMeta+A");
  await paste(page, source);
  const saved = page.waitForResponse(
    (r) => r.url().includes("/source?") && r.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "保存代码", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "保存代码", exact: true }),
  ).toBeDisabled();
}

test("create, edit graph and code, fail, repair, rerun, inspect both artifact versions", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "新建工作流" }).click();
  const create = page.getByRole("dialog", { name: "新建工作流" });
  await create.getByLabel("名称", { exact: true }).fill("验收流程");
  await create.getByLabel("工作流 ID").fill("acceptance-" + Date.now());
  await create.getByRole("button", { name: "创建工作流", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "验收流程", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "添加步骤", exact: true }).click();
  const add = page.getByRole("dialog", { name: "添加步骤" });
  await add.getByLabel("步骤 ID").fill("report");
  await add.getByRole("button", { name: "添加步骤", exact: true }).click();
  await page.getByRole("checkbox", { name: "main", exact: true }).check();
  await page.getByRole("button", { name: "保存流程" }).click();
  await expect(page.getByText(/有未保存的流程修改/)).toHaveCount(0);
  await page.getByRole("tab", { name: "步骤代码", exact: true }).click();
  await page.getByRole("button", { name: "main.py", exact: true }).click();
  await replaceCode(
    page,
    'def run(ctx):\n    ctx.task.save_text("result", "old diagnostic")\n    raise ValueError("intentional acceptance failure")\n',
  );
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await page.getByRole("button", { name: "创建并运行" }).click();
  await expect(page.locator(".page-heading .badge")).toHaveText("失败");
  const taskUrl = page.url();
  const taskId = taskUrl.split("task/")[1];
  await expect(page.locator(".error-trace")).toContainText(
    "intentional acceptance failure",
  );
  await expect(page.getByText("未发布", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "查看工作流" }).click();
  await page.getByRole("tab", { name: "步骤代码", exact: true }).click();
  await page.getByRole("button", { name: "main.py", exact: true }).click();
  await replaceCode(
    page,
    'def run(ctx):\n    ctx.task.save_text("result", "new successful result")\n',
  );
  await page.getByRole("button", { name: "版本历史" }).click();
  await page.getByRole("combobox", { name: "历史版本" }).click();
  await expect(page.locator(".ant-select-item-option")).toHaveCount(3);
  await page.getByRole("combobox", { name: "历史版本" }).press("Escape");
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.goto(taskUrl);
  await page.getByRole("button", { name: "从此步骤重跑" }).click();
  const rerun = page.getByRole("dialog", { name: "确认重跑范围" });
  await expect(rerun.locator(".affected-list")).toContainText("main");
  await expect(rerun.locator(".affected-list")).toContainText("report");
  await rerun.getByRole("button", { name: "执行重跑" }).dblclick();
  await expect(page.locator(".page-heading .badge")).toHaveText("已成功");
  const status = await (await request.get(`/api/v1/tasks/${taskId}`)).json();
  expect(
    status.steps.find((s: { name: string }) => s.name === "main").attempts,
  ).toBe(2);
  expect(
    status.steps.find((s: { name: string }) => s.name === "report").attempts,
  ).toBe(1);
  await expect(page.locator("tbody tr.ant-table-row")).toHaveCount(3);
  const current = page
    .locator("tbody tr.ant-table-row")
    .filter({ hasText: "main" })
    .filter({ hasText: "当前有效" });
  await current.getByRole("button", { name: "查看产物 result" }).click();
  await expect(page.locator(".artifact-preview")).toHaveText(
    "new successful result",
  );
  await page.getByRole("button", { name: "关闭窗口" }).click();
  const previous = page
    .locator("tbody tr.ant-table-row")
    .filter({ hasText: "未发布" });
  await previous.getByRole("button", { name: "查看产物 result" }).click();
  await expect(page.locator(".artifact-preview")).toHaveText("old diagnostic");
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.reload();
  await expect(page.locator(".live-status")).toContainText("事件已连接");
  await expect(page.locator(".page-heading .badge")).toHaveText("已成功");
  await page.screenshot({
    path: "test-results/acceptance.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("external source edits cause a visible conflict without lost updates", async ({
  page,
  request,
}) => {
  const id = "conflict-" + Date.now();
  await request.post("/api/v1/workflows", { data: { id } });
  await page.goto(`/#workflow/${id}`);
  await page.getByRole("tab", { name: "步骤代码", exact: true }).click();
  await expect(page.locator(".monaco-editor").first()).toBeVisible();
  const source = await (
    await request.get(`/api/v1/workflows/${id}/source?path=main.py`)
  ).json();
  await request.put(`/api/v1/workflows/${id}/source?path=main.py`, {
    data: {
      content: "def run(ctx):\n    pass # external\n",
      expected_revision: source.revision,
    },
  });
  const editor = page.locator(".monaco-editor").first();
  await editor.click({ position: { x: 180, y: 30 } });
  await page.keyboard.press("ControlOrMeta+A");
  await paste(page, "def run(ctx):\n    pass # stale browser\n");
  await page.getByRole("button", { name: "保存代码", exact: true }).click();
  await expect(page.locator(".error-notice")).toContainText(
    "File changed outside this editor",
  );
  const latest = await (
    await request.get(`/api/v1/workflows/${id}/source?path=main.py`)
  ).json();
  expect(latest.content).toContain("# external");
});
