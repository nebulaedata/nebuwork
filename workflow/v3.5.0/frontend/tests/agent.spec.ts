import { test, expect } from "@playwright/test";

test("tool activity keeps failures visible, separates messages and bounds long details", async ({
  page,
  request,
}) => {
  await request.post("/api/v1/workflows", {
    data: { id: "pi-tool-layout", name: "工具展示验收" },
  });
  const base = await (
    await request.post("/api/v1/agent/sessions", {
      data: {
        workflow_id: "pi-tool-layout",
        title: "构建采集工作流",
        command_id: "tool-layout-session",
      },
    })
  ).json();
  const calls = Array.from({ length: 20 }, (_, i) => ({
    round_id: "layout-round",
    call_id: "call-" + i,
    name: "source_save",
    state:
      i === 1
        ? "failed"
        : i === 6
          ? "unknown"
          : i === 19
            ? "running"
            : "succeeded",
    arguments: {
      path: `steps/${"很长的采集模块目录/".repeat(6)}collect_${i}.py`,
      expected_revision: i < 10 ? null : "prior",
      content: "# 实际文件内容\n".repeat(100),
    },
    result:
      i === 19
        ? null
        : i === 1
          ? { error: "文件已在外部修改，请重新读取后合并。" }
          : {
              result: {
                revision: "saved-revision",
                text: "逐行检查的工具结果\n".repeat(100),
              },
            },
    changes: null,
    created_at: 100,
    finished_at: i === 19 ? null : 101.6,
  }));
  const events: {
    id: number;
    round_id: string;
    kind: string;
    payload: object;
  }[] = [];
  const emit = (kind: string, payload: object) =>
    events.push({
      id: events.length + 1,
      round_id: "layout-round",
      kind,
      payload,
    });
  emit("user.message", { text: "整理采集步骤并检查文件变更。" });
  for (const [index, call] of calls.entries()) {
    if (index === 10) {
      emit("pi.message_start", {});
      emit("pi.message", {
        text: "发现一处外部修改，已保留原文件。继续整理其余步骤。",
      });
    }
    // Empty model messages must not create gaps between individual calls.
    emit("pi.message_start", {});
    emit("pi.message", { text: "" });
    emit("tool.start", { call_id: call.call_id, name: call.name });
  }
  await page.route(`**/agent/sessions/${base.id}`, (route) =>
    route.fulfill({
      json: {
        ...base,
        state: "running",
        calls,
        rounds: [{ id: "layout-round", state: "running", error: null }],
      },
    }),
  );
  await page.route(`**/agent/sessions/${base.id}/stream`, (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body:
        "retry: 30000\n\n" +
        events
          .map((e) => `id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`)
          .join(""),
    }),
  );
  await page.goto(`/#agent/${base.id}`);
  const chat = page.getByRole("region", { name: "工作流助手" });
  const groups = chat.getByRole("region", { name: "工具执行记录" });
  await expect(groups).toHaveCount(2);
  await expect(chat.locator(".agent-tool")).toHaveCount(8);
  await expect(chat.locator(".agent-tool-target").last()).toHaveText(
    "collect_19.py",
  );
  await expect(chat.locator(".agent-tool-target").last()).toHaveAttribute(
    "title",
    calls[19].arguments.path,
  );
  await expect(
    chat.getByRole("img", { name: "工具执行中", exact: true }),
  ).toBeVisible();
  await expect(
    chat.getByText("发现一处外部修改，已保留原文件。继续整理其余步骤。"),
  ).toBeVisible();
  await expect(
    groups.first().getByRole("button", { name: "1 项失败" }),
  ).toBeVisible();
  await expect(
    groups.first().getByRole("button", { name: "1 项待核对" }),
  ).toBeVisible();
  await chat.locator(".agent-messages").evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({
    path: "test-results/agent-tools.png",
    animations: "disabled",
  });
  await groups.first().getByRole("button", { name: "1 项失败" }).click();
  await expect(groups.first().locator(".agent-tool")).toHaveCount(10);
  const failure = groups.first().locator('[data-tool-state="failed"]');
  await failure.locator(".ant-collapse-header").focus();
  await page.keyboard.press("Enter");
  await expect(failure.locator(".ant-alert")).toContainText("文件已在外部修改");
  await failure.getByRole("tab", { name: "调用参数" }).click();
  const output = failure.getByLabel("工具调用参数");
  await expect(output).toBeVisible();
  const scroll = await output.evaluate((el) => ({
    height: el.clientHeight,
    content: el.scrollHeight,
  }));
  expect(scroll.height).toBeLessThanOrEqual(240);
  expect(scroll.content).toBeGreaterThan(scroll.height);
  const before = await chat
    .locator(".agent-messages")
    .evaluate((el) => el.scrollTop);
  await output.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(
    await chat.locator(".agent-messages").evaluate((el) => el.scrollTop),
  ).toBe(before);
  await expect(chat.getByLabel("给工作流助手的消息")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chat.locator(".agent-tool")).toHaveCount(8);
  const bounds = await chat.evaluate((el) => ({
    width: el.clientWidth,
    scroll: el.scrollWidth,
    bottom: el.querySelector(".agent-composer")!.getBoundingClientRect().bottom,
  }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
  expect(bounds.bottom).toBeLessThanOrEqual(844);
  await page.screenshot({
    path: "test-results/agent-tools-mobile.png",
    animations: "disabled",
  });
});

test("Pi builds, executes, repairs a workflow and restores its conversation", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#agent-settings");
  await expect(page.getByRole("heading", { name: "智能体设置" })).toBeVisible();
  await expect(page.getByText("已就绪", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "测试已保存配置" }).click();
  await expect(
    page.getByText("连接成功：流式响应和工具调用验证通过。"),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/agent-settings.png",
    fullPage: true,
  });
  await page.goto("/#workflows");
  await page.getByRole("button", { name: "AI 创建", exact: true }).click();
  await page.getByLabel("AI 工作流名称").fill("智能体构建验收");
  await page.getByLabel("AI 工作流 ID").fill("pi-browser-test");
  await page
    .getByLabel("构建需求", { exact: true })
    .fill(
      "创建并调试一个串行、并行、汇合流程，失败后修复并重跑，显式保存最终产物。",
    );
  await page.getByRole("button", { name: "开始构建", exact: true }).click();
  const chat = page.getByRole("region", { name: "工作流助手" });
  await expect(
    chat.getByText("工作流已构建并调试成功，产物 total ="),
  ).toBeVisible({ timeout: 45000 });
  await expect(
    chat.getByRole("button", { name: "发送", exact: true }),
  ).toBeVisible();
  const sessionId = page.url().split("#agent/")[1];
  const data = await (
    await request.get("/api/v1/agent/sessions/" + sessionId)
  ).json();
  expect(data.calls).toHaveLength(18);
  expect(data.state).toBe("succeeded");
  await page.reload();
  await expect(
    chat.getByText("工作流已构建并调试成功，产物 total ="),
  ).toBeVisible();
  const after = await (
    await request.get("/api/v1/agent/sessions/" + sessionId)
  ).json();
  expect(after.rounds).toHaveLength(1);
  expect(after.calls).toHaveLength(18);
  // Tool-only model turns form one compact activity stream, with full history on demand.
  await expect(chat.getByRole("region", { name: "工具执行记录" })).toHaveCount(
    1,
  );
  await expect(chat.locator(".agent-tool")).toHaveCount(4);
  await chat.getByRole("button", { name: "展开全部 18 项操作" }).click();
  await expect(chat.locator(".agent-tool")).toHaveCount(18);
  await expect(
    chat.locator('.agent-tool[data-tool-name="source_save"]').first(),
  ).toContainText("创建文件");
  // Historical code revisions are reviewable from the actual tool journal.
  const card = chat.locator('.agent-tool[data-tool-name="source_save"]').last();
  await card.locator(".ant-collapse-header").click();
  // Keyboard activation remains stable while the surrounding history pane expands.
  const argumentsTab = card.getByRole("tab", { name: "调用参数" });
  await argumentsTab.focus();
  await argumentsTab.press("Enter");
  await expect(argumentsTab).toHaveAttribute("aria-selected", "true");
  await expect(card.getByLabel("工具调用参数")).toContainText("right.py");
  await card.getByRole("tab", { name: "返回结果" }).click();
  await card.getByRole("button", { name: "right.py · 查看差异" }).click();
  await expect(page.getByRole("dialog")).toContainText("修改差异 · right.py");
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await card.locator(".ant-collapse-header").click();
  await chat.getByRole("button", { name: "收起较早的操作" }).click();
  await expect(
    chat.getByText("工作流已构建并调试成功，产物 total ="),
  ).toBeVisible();
  await expect(chat.locator(".agent-chat-meta")).toContainText("已完成");
  await chat.locator(".agent-messages").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.screenshot({
    path: "test-results/agent-workbench.png",
    fullPage: false,
    animations: "disabled",
  });
  await expect(chat.locator(".agent-chat-meta")).toContainText("已完成");
  const dimensions = await chat.evaluate((el) => ({
    body: document.documentElement.scrollWidth,
    width: innerWidth,
    composer: el.querySelector(".agent-composer")!.getBoundingClientRect()
      .bottom,
  }));
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.width + 1);
  expect(dimensions.composer).toBeLessThanOrEqual(1000);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog", { name: "工作流助手" })).toBeVisible();
  await expect(page.getByLabel("给工作流助手的消息")).toBeVisible();
  await expect(
    page
      .getByRole("dialog", { name: "工作流助手" })
      .getByText("工作流已构建并调试成功，产物 total ="),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.getByRole("dialog", { name: "工作流助手" }).boundingBox())
          ?.x,
    )
    .toBe(0);
  await page.screenshot({
    path: "test-results/agent-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("assistant update preserves an unsaved workflow graph", async ({
  page,
  request,
}) => {
  await request.post("/api/v1/workflows", {
    data: { id: "pi-conflict", name: "草稿冲突" },
  });
  await page.goto("/#workflow/pi-conflict");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const input = page.getByRole("textbox", { name: "流程 JSON" });
  const draft = JSON.parse(await input.inputValue());
  draft.name = "本地未保存草稿";
  await input.fill(JSON.stringify(draft));
  await page.getByRole("button", { name: "应用到画布" }).click();
  const remote = await (
    await request.get("/api/v1/workflows/pi-conflict")
  ).json();
  await request.put("/api/v1/workflows/pi-conflict/definition", {
    data: {
      definition: { ...remote.definition, name: "助手远程修改" },
      expected_revision: remote.revision,
    },
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("nebulae:workflow-change", { detail: "pi-conflict" }),
    ),
  );
  await expect(
    page.getByText(
      "流程定义已被助手修改，当前未保存草稿已保留。请比较流程 JSON 后合并，避免覆盖变更。",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  expect(JSON.parse(await input.inputValue()).name).toBe("本地未保存草稿");
});

test("a lost first message response can be retried without a second round", async ({
  page,
  request,
}) => {
  await request.post("/api/v1/workflows", {
    data: { id: "pi-retry", name: "网络重试验收" },
  });
  await page.goto("/#workflow/pi-retry");
  await page.getByRole("button", { name: "工作流助手", exact: true }).click();
  const bodies: { command_id: string; expected_version: number }[] = [];
  await page.route("**/api/v1/agent/sessions/*/messages", async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByLabel("给工作流助手的消息").fill("完成并调试当前工作流");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByText("工作流已构建并调试成功，产物 total ="),
  ).toBeVisible({ timeout: 45000 });
  await expect(
    page.getByRole("button", { name: "发送", exact: true }),
  ).toBeEnabled();
  // A failed call stays discoverable even when the older calls are folded away.
  await page.getByRole("button", { name: "1 项失败", exact: true }).click();
  const failed = page.locator('.agent-tool[data-tool-name="workflow_create"]');
  await expect(failed).toHaveAttribute("data-tool-state", "failed");
  await failed.locator(".ant-collapse-header").click();
  await expect(failed.locator(".ant-alert")).toBeVisible();
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("给工作流助手的消息")).toHaveValue("");
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  const sessions = await (
    await request.get("/api/v1/agent/sessions?workflow_id=pi-retry")
  ).json();
  const detail = await (
    await request.get("/api/v1/agent/sessions/" + sessions[0].id)
  ).json();
  expect(detail.rounds).toHaveLength(1);
});
