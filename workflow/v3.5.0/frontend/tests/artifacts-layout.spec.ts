import { test, expect } from "@playwright/test";

test("large artifact directories keep scrollbars, navigation and actions within the viewer", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  const directory = "laws/github/经济法";
  const makeArtifact = (name: string, index: number) => ({
    id: `artifact-${index}`,
    name,
    scope: "workflow",
    step: "publish_storage_with_a_long_step_identifier",
    attempt: 1,
    kind: "text",
    filename: name,
    size: 15000,
    published: true,
    effective: true,
    task_id: "task-layout-fixture",
    created_at: index,
  });
  const artifacts = [
    ...Array.from({ length: 99 }, (_, i) =>
      makeArtifact(
        `${directory}/中华人民共和国有关经济管理与发展特别规定及其实施细则第${i}号-${"abcdef12".repeat(4)}.md`,
        i,
      ),
    ),
    ...Array.from({ length: 80 }, (_, i) =>
      makeArtifact(`root_report_${String(i).padStart(3, "0")}`, 100 + i),
    ),
  ];
  await page.route("**/api/v1/workflows/layout-fixture", (route) =>
    route.fulfill({
      json: {
        id: "layout-fixture",
        name: "大量法律产物浏览",
        archived: false,
        revision: "r1",
        definition: {
          name: "大量法律产物浏览",
          steps: { main: { code: "main.py:run" } },
        },
        files: ["main.py"],
      },
    }),
  );
  await page.route("**/api/v1/workflows/layout-fixture/artifacts", (route) =>
    route.fulfill({ json: artifacts }),
  );
  await page.goto("/#workflow/layout-fixture");
  await page.getByRole("tab", { name: "共享产物", exact: true }).click();
  const browser = page.locator(".artifact-browser");
  await browser.getByText("目录树", { exact: true }).click();
  await browser.locator(".ant-tree-list-holder").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  for (const folder of directory.split("/"))
    await browser
      .getByRole("button", { name: "进入文件夹 " + folder, exact: true })
      .click();
  await expect(browser.locator(".ant-tree-node-selected")).toContainText(
    "经济法",
  );
  await expect(browser.locator(".ant-tree-node-selected")).toBeInViewport();
  const metrics = await browser.evaluate((element) => {
    const table = element.querySelector(".ant-table-body, .ant-table-content")!;
    const footer = element.querySelector(".ant-pagination")!;
    const selected = element.querySelector(".ant-tree-node-selected");
    return {
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      tableHeight: table.clientHeight,
      footerBottom: footer.getBoundingClientRect().bottom,
      windowHeight: window.innerHeight,
      selectedVisible: !!selected,
    };
  });
  expect(metrics.width).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.tableHeight).toBeLessThan(600);
  expect(metrics.footerBottom).toBeLessThanOrEqual(metrics.windowHeight);
  await expect(browser.locator(".ant-tree-node-selected")).toBeVisible();
  const body = browser.locator(".ant-table-body");
  const footer = browser.locator(".artifact-pagination");
  const treeBody = browser.locator(".ant-tree-list-holder");
  for (const scrollArea of [body, treeBody]) {
    const scrollbar = await scrollArea.evaluate((element) => ({
      gutter: element.getBoundingClientRect().width - element.clientWidth,
      overflow: getComputedStyle(element).overflowY,
      bar: getComputedStyle(element, "::-webkit-scrollbar").display,
    }));
    expect(scrollbar.gutter).toBeGreaterThanOrEqual(10);
    // Drag the native vertical thumb, not just wheel the contents.
    const bounds = (await scrollArea.boundingBox())!;
    await scrollArea.evaluate((element) => {
      element.scrollTop = 0;
    });
    const beforeDrag = await scrollArea.evaluate(
      (element) => element.scrollTop,
    );
    await page.mouse.move(
      bounds.x + bounds.width - scrollbar.gutter / 2,
      bounds.y + 24,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width - scrollbar.gutter / 2,
      bounds.y + bounds.height / 2,
      { steps: 10 },
    );
    await page.mouse.up();
    await expect
      .poll(() => scrollArea.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(beforeDrag);
    await scrollArea.evaluate((element) => {
      element.scrollTop = 0;
    });
  }
  const headerBefore = (await browser
    .locator(".ant-table-header")
    .boundingBox())!;
  const footerBefore = (await footer.boundingBox())!;
  const treeBefore = await treeBody.evaluate((element) => element.scrollTop);
  const pageBefore = await page.evaluate(() => window.scrollY);
  await body.hover();
  await page.mouse.wheel(0, 800);
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  expect(await treeBody.evaluate((element) => element.scrollTop)).toBe(
    treeBefore,
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(pageBefore);
  expect(
    (await browser.locator(".ant-table-header").boundingBox())!.y,
  ).toBeCloseTo(headerBefore.y, 0);
  expect((await footer.boundingBox())!.y).toBeCloseTo(footerBefore.y, 0);
  // Native tree scrolling is independent; navigating by breadcrumb reveals the root again.
  const tableBefore = await body.evaluate((element) => element.scrollTop);
  await treeBody.hover();
  await page.mouse.wheel(0, 1600);
  await expect
    .poll(() => treeBody.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(treeBefore);
  expect(await body.evaluate((element) => element.scrollTop)).toBe(tableBefore);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageBefore);
  await browser
    .getByLabel("产物目录路径")
    .getByRole("button", { name: "全部产物", exact: true })
    .click();
  await expect(browser.locator(".ant-tree-node-selected")).toContainText(
    "全部产物",
  );
  await expect(browser.locator(".ant-tree-node-selected")).toBeInViewport();
  for (const folder of directory.split("/"))
    await browser
      .getByRole("button", { name: "进入文件夹 " + folder, exact: true })
      .click();
  await expect(browser.locator(".ant-tree-node-selected")).toContainText(
    "经济法",
  );
  await expect(browser.locator(".ant-tree-node-selected")).toBeInViewport();
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBe(0);
  await page.screenshot({
    path: "test-results/artifacts-scroll.png",
    animations: "disabled",
  });
  for (const size of [
    { width: 1024, height: 768 },
    { width: 800, height: 1100 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBeTruthy();
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeInViewport();
    await body.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.scrollTop = 0;
    });
    const download = body.getByRole("link", {
      name: "下载产物 " + artifacts[0].name,
      exact: true,
    });
    await expect(download).toBeInViewport();
    await expect
      .poll(() =>
        treeBody.evaluate(
          (element) =>
            element.clientHeight <=
            element.closest(".artifact-tree-viewport")!.clientHeight + 1,
        ),
      )
      .toBeTruthy();
  }
  await page.screenshot({
    path: "test-results/artifacts-scroll-mobile.png",
    animations: "disabled",
    fullPage: true,
  });
  await browser.getByText("列表", { exact: true }).click();
  await expect(browser.locator(".artifact-tree")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await browser.locator(".ant-pagination-next button").click();
  await expect
    .poll(() => body.evaluate((element) => element.scrollTop))
    .toBe(0);
  expect(errors).toEqual([]);
});
