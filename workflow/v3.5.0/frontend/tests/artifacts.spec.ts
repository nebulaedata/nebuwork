import {
  test,
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { readFile } from "node:fs/promises";

const flow = "artifact-browser-" + Date.now();
let taskId: string;
const folderPath = "laws/国家/行政";
const source = `def run(ctx):
    version = ctx.input['version']
    file = ctx.work_dir / '原始文件.txt'
    file.write_text('文件内容 ' + version, encoding='utf-8')
    for space in (ctx.task, ctx.workflow):
        space.save_text('laws/国家/行政/法甲.md', '正文 ' + version)
        space.save_json('laws/国家/行政/report.json', {'version': version})
        space.save_file('laws/国家/行政/attachment', file)
    ctx.workflow.save_text('laws', '同名文件与目录 ' + version)
    ctx.workflow.save_text('../保留名称', '历史名称不解析为路径')
    if version == 'new':
        for index in range(14):
            ctx.workflow.save_text(f'many/file-{index:02d}.txt', str(index))
    if version == 'failed':
        raise ValueError('测试未发布产物')
`;

async function result(response: APIResponse) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

async function execute(request: APIRequestContext, version: string) {
  const task = await result(
    await request.post("/api/v1/tasks", {
      data: {
        workflow_id: flow,
        input: { version },
        command_id: `${flow}-${version}`,
      },
    }),
  );
  await result(
    await request.post(`/api/v1/tasks/${task.id}/actions/start`, {
      data: {
        expected_version: task.version,
        command_id: `${flow}-${version}-start`,
      },
    }),
  );
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/v1/tasks/${task.id}`)).json()).state,
      { timeout: 20000 },
    )
    .toBe(version === "failed" ? "failed" : "succeeded");
  return task.id as string;
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(60000);
  await result(
    await request.post("/api/v1/workflows", {
      data: { id: flow, name: "目录产物验收" },
    }),
  );
  const current = await result(
    await request.get(`/api/v1/workflows/${flow}/source?path=main.py`),
  );
  await result(
    await request.put(`/api/v1/workflows/${flow}/source?path=main.py`, {
      data: {
        expected_revision: current.revision,
        content: source,
      },
    }),
  );
  await execute(request, "old");
  taskId = await execute(request, "new");
  await execute(request, "failed");
});

test("shared artifacts: flat list, nested folders, history, preview, download and pagination", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/#workflow/${flow}`);
  await page.getByRole("tab", { name: "共享产物", exact: true }).click();
  const browser = page.locator(".artifact-browser");
  await expect(
    browser.getByRole("radio", { name: "列表", exact: true }),
  ).toBeChecked();
  await expect(browser.locator("tbody tr.ant-table-row")).toHaveCount(12);
  await browser.locator(".ant-pagination-next button").click();
  await browser.getByText("目录树", { exact: true }).click();
  await expect(
    browser.getByRole("button", { name: "返回上一级" }),
  ).toBeDisabled();
  // The folder and the three versions of the same-named root file coexist.
  await expect(
    browser.getByRole("button", { name: "进入文件夹 laws", exact: true }),
  ).toBeVisible();
  await expect(
    browser.getByRole("button", { name: "查看产物 laws", exact: true }),
  ).toHaveCount(3);
  await expect(
    browser.getByRole("button", { name: "查看产物 ../保留名称", exact: true }),
  ).toHaveCount(3);
  for (const folder of ["laws", "国家", "行政"])
    await browser
      .getByRole("button", { name: "进入文件夹 " + folder, exact: true })
      .click();
  await expect(browser.getByLabel("产物目录路径")).toContainText(
    "全部产物/laws/国家/行政",
  );
  await expect(browser.locator("tbody tr.ant-table-row")).toHaveCount(9);
  const current = browser
    .locator("tbody tr.ant-table-row")
    .filter({ hasText: "当前有效" });
  await current
    .getByRole("button", {
      name: `查看产物 ${folderPath}/法甲.md`,
      exact: true,
    })
    .click();
  await expect(page.locator(".artifact-preview")).toHaveText("正文 new");
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  const failed = browser
    .locator("tbody tr.ant-table-row")
    .filter({ hasText: "未发布" });
  await failed
    .getByRole("button", {
      name: `查看产物 ${folderPath}/法甲.md`,
      exact: true,
    })
    .click();
  await expect(page.locator(".artifact-preview")).toHaveText("正文 failed");
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await current
    .getByRole("button", {
      name: `查看产物 ${folderPath}/report.json`,
      exact: true,
    })
    .click();
  await expect(page.locator(".artifact-preview")).toContainText(
    '"version": "new"',
  );
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await current
    .getByRole("button", {
      name: `查看产物 ${folderPath}/attachment`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText("请下载查看");
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "下载产物", exact: true })
    .click();
  const download = await downloading;
  expect(await readFile((await download.path())!, "utf8")).toBe("文件内容 new");
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await browser.getByRole("button", { name: "返回上一级" }).click();
  await expect(
    browser.getByRole("button", { name: "进入文件夹 行政", exact: true }),
  ).toBeVisible();
  // Double-clicking a folder row also enters it, just like an explorer.
  await browser
    .locator("tbody tr.ant-table-row")
    .filter({ hasText: "行政" })
    .getByRole("cell")
    .nth(1)
    .dblclick();
  await expect(browser.locator("tbody tr.ant-table-row")).toHaveCount(9);
  await page.screenshot({
    path: "test-results/artifacts-tree.png",
    fullPage: true,
    animations: "disabled",
  });
  await browser
    .getByLabel("产物目录路径")
    .getByRole("button", { name: "全部产物", exact: true })
    .click();
  await browser
    .getByRole("button", { name: "进入文件夹 many", exact: true })
    .click();
  await expect(browser.locator("tbody tr.ant-table-row")).toHaveCount(12);
  await browser.locator(".ant-pagination-next button").click();
  await expect(browser.locator("tbody tr.ant-table-row")).toHaveCount(2);
  await browser.getByRole("button", { name: "返回上一级" }).click();
  await expect(
    browser.getByRole("button", { name: "进入文件夹 laws", exact: true }),
  ).toBeVisible();
  // Navigating via the tree shares the same directory state as the table.
  await browser
    .getByLabel("产物目录树")
    .getByTitle(folderPath, { exact: true })
    .click();
  await expect(browser.locator("tbody tr.ant-table-row")).toHaveCount(9);
  await browser.getByText("列表", { exact: true }).click();
  await expect(browser.locator(".artifact-tree")).toHaveCount(0);
  await expect(browser.locator("tbody tr.ant-table-row")).toHaveCount(12);
  await page.screenshot({
    path: "test-results/artifacts-list.png",
    fullPage: true,
    animations: "disabled",
  });
  await browser.getByText("目录树", { exact: true }).click();
  await expect(browser.getByLabel("产物目录路径")).toContainText("行政");
  await page.setViewportSize({ width: 800, height: 1100 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  await page.reload();
  await page.getByRole("tab", { name: "共享产物", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "目录树", exact: true }),
  ).toBeChecked();
  expect(errors).toEqual([]);
});

test("task artifacts keep both scopes with identical paths and refresh keeps the open folder", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/#task/${taskId}`);
  const browser = page.locator(".artifact-browser");
  await browser.getByText("目录树", { exact: true }).click();
  for (const folder of ["laws", "国家", "行政"])
    await browser
      .getByRole("button", { name: "进入文件夹 " + folder, exact: true })
      .click();
  await expect(browser.locator("tbody tr.ant-table-row")).toHaveCount(6);
  const own = browser
    .locator("tbody tr.ant-table-row")
    .filter({ hasText: "任务级" });
  const shared = browser
    .locator("tbody tr.ant-table-row")
    .filter({ hasText: "工作流级" });
  await expect(own).toHaveCount(3);
  await expect(shared).toHaveCount(3);
  await own
    .getByRole("button", {
      name: `查看产物 ${folderPath}/法甲.md`,
      exact: true,
    })
    .click();
  await expect(page.locator(".artifact-preview")).toHaveText("正文 new");
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await page.getByRole("button", { name: "刷新任务", exact: true }).click();
  await expect(browser.getByLabel("产物目录路径")).toContainText("行政");
  await expect(browser.locator("tbody tr.ant-table-row")).toHaveCount(6);
  expect(errors).toEqual([]);
});

test("empty shared artifacts can switch views and stay at root", async ({
  page,
  request,
}) => {
  const id = flow + "-empty";
  await result(await request.post("/api/v1/workflows", { data: { id } }));
  await page.goto(`/#workflow/${id}`);
  await page.getByRole("tab", { name: "共享产物", exact: true }).click();
  await expect(page.getByText("尚无保存的产物", { exact: true })).toBeVisible();
  await page.getByText("目录树", { exact: true }).click();
  await expect(page.getByRole("button", { name: "返回上一级" })).toBeDisabled();
  await expect(page.getByText("尚无保存的产物", { exact: true })).toBeVisible();
});
