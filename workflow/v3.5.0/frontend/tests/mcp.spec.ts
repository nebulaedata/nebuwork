import { test, expect } from "@playwright/test";
import { createServer } from "node:net";

test("save HTTP settings, start a real MCP service, detect and stop from the page", async ({
  page,
  request,
}) => {
  const port = await new Promise<number>((resolve, reject) => {
    const listener = createServer();
    listener.on("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      if (!address || typeof address === "string")
        return reject(new Error("No test port"));
      listener.close(() => resolve(address.port));
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const tasks = await (await request.get("/api/v1/tasks")).json();
  await page.goto("/#mcp");
  await expect(page.getByText("已停止", { exact: true })).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "MCP 端口", exact: true })
    .fill(String(port));
  await expect(
    page.getByRole("button", { name: "启动 MCP", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存配置", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("spinbutton", { name: "MCP 端口", exact: true }),
  ).toHaveValue(String(port));
  await page.getByRole("button", { name: "启动 MCP", exact: true }).click();
  try {
    await expect(page.getByText("运行中", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("spinbutton", { name: "MCP 端口", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "启动 MCP", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "检测连接", exact: true }).click();
    await expect(
      page.getByText("MCP 服务可连接", { exact: true }),
    ).toBeVisible();
    await page.getByText("启动日志", { exact: true }).click();
    await expect(page.locator(".mcp-schema").first()).toContainText(
      "Uvicorn running",
    );
    await page.screenshot({
      path: "test-results/mcp-running.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "停止 MCP", exact: true }).click();
    await expect(page.getByText("已停止", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "检测连接", exact: true }).click();
    await expect(
      page.getByText("MCP 服务未连接", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "启动 MCP", exact: true }),
    ).toBeEnabled();
    expect(await (await request.get("/api/v1/tasks")).json()).toEqual(tasks);
    expect(errors).toEqual([]);
  } finally {
    const state = await (await request.get("/api/v1/mcp/service")).json();
    await request.post("/api/v1/mcp/service/stop", {
      data: { expected_version: state.version, command_id: `cleanup-${port}` },
    });
  }
});

test("MCP navigation, connection settings, copy, tool search and unavailable service", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const before = await (await request.get("/api/v1/tasks")).json();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("link", { name: "MCP 接入", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "MCP 接入", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("28 个工具", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "MCP 接入", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: "工作流", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
  await expect(page.getByText("连接尚未检测", { exact: true })).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "MCP 端口", exact: true })
    .fill("18767");
  await expect(page.getByRole("textbox", { name: "MCP 地址" })).toHaveValue(
    "http://127.0.0.1:18767/mcp",
  );
  await expect(page.getByLabel("启动命令", { exact: true })).toContainText(
    "--port 18767",
  );
  await page
    .getByRole("button", { name: "复制智能体配置", exact: true })
    .click();
  let config = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  expect(config.mcpServers["nebulae-workflow"].url).toBe(
    "http://127.0.0.1:18767/mcp",
  );
  // This deliberately checks a non-MCP local service (the test API).
  const apiPort = new URL(page.url()).port;
  await page
    .getByRole("spinbutton", { name: "MCP 端口", exact: true })
    .fill(apiPort);
  await page.getByRole("button", { name: "检测连接", exact: true }).click();
  await expect(page.getByText("MCP 服务未连接", { exact: true })).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "MCP 端口", exact: true })
    .fill("18767");
  await expect(page.getByText("连接尚未检测", { exact: true })).toBeVisible();
  await page.getByText("stdio", { exact: true }).click();
  await expect(
    page.getByText("由智能体启动 MCP 子进程", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "复制智能体配置", exact: true })
    .click();
  config = JSON.parse(
    await page.evaluate(() => navigator.clipboard.readText()),
  );
  expect(config.mcpServers["nebulae-workflow"].args).toEqual([
    "-m",
    "nebulae",
    "--url",
    new URL(page.url()).origin,
    "mcp",
  ]);
  expect(config.mcpServers["nebulae-workflow"].command).toContain("python");
  expect(config.mcpServers["nebulae-workflow"].cwd).toBeTruthy();
  await page.getByRole("textbox", { name: "搜索 MCP 工具" }).fill("task_rerun");
  await expect(
    page.getByRole("cell", { name: "task_rerun", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "task_rerun_preview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "workflow_health", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "task_rerun", exact: true }),
    })
    .getByRole("button", { name: "展开行" })
    .click();
  await expect(page.locator(".mcp-schema")).toContainText(
    "expected_environment",
  );
  await page.screenshot({ path: "test-results/mcp-stdio.png", fullPage: true });
  await page.getByText("Streamable HTTP", { exact: true }).click();
  await page.getByRole("textbox", { name: "搜索 MCP 工具" }).fill("");
  await page.screenshot({ path: "test-results/mcp-http.png", fullPage: true });
  await page.setViewportSize({ width: 800, height: 1100 });
  await expect(
    page.getByRole("heading", { name: "MCP 接入", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
  expect(await (await request.get("/api/v1/tasks")).json()).toEqual(before);
  expect(errors).toEqual([]);
});

test("older running server gets a restart instruction", async ({ page }) => {
  await page.route("**/api/v1/mcp/info", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ detail: "Not Found" }),
    }),
  );
  await page.goto("/#mcp");
  await expect(page.getByRole("alert")).toContainText(
    "请在 PyCharm 中重启 Workflow 服务",
  );
});
