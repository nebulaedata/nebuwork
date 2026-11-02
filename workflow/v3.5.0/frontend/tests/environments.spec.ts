import { test, expect } from "@playwright/test";

test("shared inventory, create isolated environment, install offline requirements and execute", async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#environment");
  await expect(
    page.getByRole("heading", { name: "Python 环境" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "搜索 Python 包" }).fill("fastapi");
  await expect(
    page.getByRole("cell", { name: "fastapi", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "刷新包列表" }).click();
  await expect(page.getByRole("button", { name: "刷新包列表" })).toBeEnabled();
  await page.screenshot({
    path: "test-results/shared-environment.png",
    fullPage: true,
  });

  await page.goto("/#workflow/environment-acceptance");
  await page.getByRole("tab", { name: "执行环境", exact: true }).click();
  await page
    .getByRole("radio", { name: "工作流独立环境", exact: true })
    .check();
  await expect(
    page.getByRole("radio", { name: "工作流独立环境", exact: true }),
  ).toBeChecked();
  await page.getByRole("button", { name: "保存环境选择", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存环境选择", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "创建独立环境", exact: true }).click();
  const operation = page.getByRole("dialog", { name: "环境操作记录" });
  await expect(operation.getByText("已完成", { exact: true })).toBeVisible({
    timeout: 60000,
  });
  await operation
    .getByRole("button", { name: "关闭窗口", exact: true })
    .click();
  await page
    .getByRole("radio", { name: "requirements.txt", exact: true })
    .check();
  await page.getByRole("button", { name: "安装依赖", exact: true }).click();
  await expect(operation.getByText("已完成", { exact: true })).toBeVisible({
    timeout: 40000,
  });
  await expect(operation.getByLabel("安装日志")).toContainText("环境已就绪");
  await operation
    .getByRole("button", { name: "关闭窗口", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "nebulae-env-fixture", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/workflow-environment.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  await page.getByRole("button", { name: "创建并运行", exact: true }).click();
  await expect(page.locator(".page-heading .badge")).toHaveText("已成功");
  await expect(page.locator(".task-environment")).toContainText("独立环境");
  const id = page.url().split("task/")[1];
  const status = await (await request.get(`/api/v1/tasks/${id}`)).json();
  expect(status.environment.mode).toBe("isolated");
  expect(status.steps[0].history[0].environment.id).toBe(status.environment.id);
  await page.getByRole("button", { name: "完整重跑", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "确认重跑范围" }),
  ).toContainText("独立环境");
  await page
    .getByRole("dialog", { name: "确认重跑范围" })
    .getByRole("button", { name: "关闭窗口", exact: true })
    .click();
  await page.screenshot({
    path: "test-results/task-environment.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
