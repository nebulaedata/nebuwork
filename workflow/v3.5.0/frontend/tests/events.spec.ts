import { test, expect, type APIRequestContext } from "@playwright/test";

async function createWorkflow(
  request: APIRequestContext,
  id: string,
  code: string,
) {
  expect(
    (
      await request.post("/api/v1/workflows", {
        data: { id, name: "运行事件中文验收" },
      })
    ).ok(),
  ).toBeTruthy();
  for (const [path, content] of [
    ["fetch.py", code],
    [
      "summarize.py",
      "def run(ctx):\n    ctx.task.save_text('summary', 'done')\n",
    ],
  ]) {
    expect(
      (
        await request.put(`/api/v1/workflows/${id}/source?path=${path}`, {
          data: { content, expected_revision: null },
        })
      ).ok(),
    ).toBeTruthy();
  }
  const workflow = await (await request.get(`/api/v1/workflows/${id}`)).json();
  expect(
    (
      await request.put(`/api/v1/workflows/${id}/definition`, {
        data: {
          expected_revision: workflow.revision,
          definition: {
            name: "运行事件中文验收",
            steps: {
              fetch_trending: { code: "fetch.py:run", timeout: 1 },
              summarize: {
                code: "summarize.py:run",
                needs: ["fetch_trending"],
              },
            },
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
  return (
    await request.post("/api/v1/tasks", {
      data: { workflow_id: id, input: {}, command_id: id + "-create" },
    })
  ).json();
}

test("runtime events explain a real timeout and blocked downstream, then retain correct history after rerun", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const id = "events-timeout";
  const task = await createWorkflow(
    request,
    id,
    `import time
def run(ctx):
    print("0.02s - Debugger warning: It seems that frozen modules are being used, which may\\n0.00s - make the debugger miss breakpoints. Please pass -Xfrozen_modules=off\\n0.00s - to python to disable frozen modules.\\n0.00s - Note: Debugging will proceed. Set PYDEVD_DISABLE_FILE_VALIDATION=1 to disable this validation.", flush=True)
    ctx.log("开始采集榜单")
    ctx.progress(25, "正在读取项目资料")
    ctx.emit("采集统计", {"message": "发现 3 个项目", "count": 3})
    ctx.task.save_text("pending", "尚未发布的采集内容")
    time.sleep(20)
`,
  );
  expect(
    (
      await request.post(`/api/v1/tasks/${task.id}/actions/start`, {
        data: { expected_version: task.version, command_id: id + "-start" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/#task/${task.id}`);
  await expect(page.locator(".page-heading .badge")).toHaveText("失败");
  await page.getByRole("tab", { name: "运行事件", exact: true }).click();
  const panel = page.getByRole("region", { name: "运行事件记录" });
  await expect(panel.locator(".event-outcome")).toContainText(
    "1 个步骤异常，1 个步骤受上游影响",
  );
  await expect(panel.locator(".event-outcome")).toContainText(
    "超过设置的 1 秒",
  );
  await expect(panel.locator(".event-outcome")).toContainText(
    "未执行的下游：summarize",
  );
  const timeout = panel.locator('[data-event-kind="step.timed_out"]');
  const blocked = panel.locator('[data-event-kind="step.blocked"]');
  await expect(timeout).toContainText("步骤执行超时");
  await expect(timeout).toContainText("修改工作流后创建新任务");
  await expect(blocked).toContainText("上游未成功，本步骤未执行");
  await expect(blocked).toContainText("fetch_trending");
  await expect(panel.getByText("task.state", { exact: true })).toHaveCount(0);
  await page
    .locator(".task-records")
    .screenshot({ path: "test-results/events-readable.png" });

  await timeout.getByRole("button", { name: "技术详情", exact: true }).click();
  await expect(timeout.getByLabel("事件完整内容")).toContainText(
    "Step execution exceeded its timeout",
  );
  await timeout.getByRole("tab", { name: "原始事件" }).click();
  await expect(timeout.getByLabel("原始事件数据")).toContainText(
    "step.timed_out",
  );
  await blocked.getByRole("button", { name: "summarize", exact: true }).click();
  await expect(page.locator(".step-inspector h2")).toHaveText("summarize");

  await panel.getByText("日志与进度", { exact: true }).click();
  await expect(panel.locator(".event-row")).toHaveCount(4);
  await expect(panel).toContainText("步骤进度 · 25%");
  await expect(panel).toContainText("正在读取项目资料");
  await expect(panel).toContainText("业务事件 · 采集统计");
  const consoleEvent = panel.locator('[data-event-kind="console"]');
  await expect(consoleEvent).toContainText("Python 调试器提示");
  await expect(consoleEvent).toContainText("不表示步骤执行失败");
  await consoleEvent
    .getByRole("button", { name: "查看完整内容与技术详情" })
    .click();
  await expect(consoleEvent.getByLabel("事件完整内容")).toContainText(
    "PYDEVD_DISABLE_FILE_VALIDATION",
  );
  await panel.getByLabel("搜索运行事件").fill("项目资料");
  await expect(panel.locator(".event-row")).toHaveCount(1);
  await panel.getByLabel("搜索运行事件").fill("");
  await panel.getByText(/^异常与提醒/).click();
  await expect(panel.locator(".event-row")).toHaveCount(3);
  await panel.getByRole("combobox", { name: "筛选事件步骤" }).click();
  await page.locator('.ant-select-item-option[title="summarize"]').click();
  await expect(panel.locator(".event-row")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".task-records")
    .screenshot({ path: "test-results/events-mobile.png" });
  expect(
    await panel.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBeTruthy();
  await page.setViewportSize({ width: 1440, height: 1000 });

  const source = await (
    await request.get(`/api/v1/workflows/${id}/source?path=fetch.py`)
  ).json();
  expect(
    (
      await request.put(`/api/v1/workflows/${id}/source?path=fetch.py`, {
        data: {
          expected_revision: source.revision,
          content:
            "def run(ctx):\n    ctx.task.save_text('result', '已修复')\n",
        },
      })
    ).ok(),
  ).toBeTruthy();
  const preview = await (
    await request.post(`/api/v1/tasks/${task.id}/preview`, {
      data: { from_steps: ["fetch_trending"] },
    })
  ).json();
  expect(
    (
      await request.post(`/api/v1/tasks/${task.id}/actions/rerun`, {
        data: {
          from_steps: ["fetch_trending"],
          expected_version: preview.version,
          expected_environment: preview.environment_token,
          command_id: id + "-rerun",
        },
      })
    ).ok(),
  ).toBeTruthy();
  await expect(page.locator(".page-heading .badge")).toHaveText("已成功");
  await expect(panel.locator(".event-outcome")).toContainText(
    "全部 2 个步骤已成功",
  );
  await page.reload();
  await page.getByRole("tab", { name: "运行事件", exact: true }).click();
  await expect(panel.locator(".event-outcome")).toContainText(
    "早前的错误不代表当前仍然失败",
  );
  await timeout
    .getByRole("button", { name: "fetch_trending", exact: true })
    .click();
  await expect(page.locator(".step-inspector .ant-select")).toContainText(
    "第 1 次 · 已超时",
  );
  await expect(
    panel.locator('[data-event-kind="task.invalidated"]'),
  ).toContainText("重新执行 2 个步骤");
  expect(errors).toEqual([]);
});

test("runtime events preserve custom output and explain recovery, retries and missing modules", async ({
  page,
  request,
}) => {
  const task = await createWorkflow(
    request,
    "events-details",
    "def run(ctx):\n    pass\n",
  );
  const fixtures: [string, unknown][] = [
    [
      "step.failed",
      {
        error:
          "Traceback (most recent call last):\nModuleNotFoundError: No module named 'requests'",
      },
    ],
    ["step.retry_scheduled", { delay: 3 }],
    ["step.interrupted", null],
    ["task.manual_required", { reason: "Runtime restarted" }],
    ["custom.log", { message: "中文多行日志\n".repeat(200) }],
    [
      "console",
      {
        text: "Debugger warning: It seems that frozen modules are being used\nValueError: real business error",
      },
    ],
    ["custom.progress", { percent: "invalid" }],
    [
      "custom.业务统计",
      [0, false, "<script>throw new Error('not executable')</script>"],
    ],
    ["future.event", null],
  ];
  const events = fixtures.map(([kind, payload], i) => ({
    id: i + 1,
    created_at: task.created_at + i,
    kind,
    payload,
    step: kind.startsWith("task.") ? null : "fetch_trending",
    attempt: kind.startsWith("task.") ? null : 1,
  }));
  await page.route(`**/tasks/${task.id}/events`, (route) =>
    route.fulfill({ json: events }),
  );
  await page.goto(`/#task/${task.id}`);
  await page.getByRole("tab", { name: "运行事件", exact: true }).click();
  const panel = page.getByRole("region", { name: "运行事件记录" });
  await expect(panel).toContainText(
    "当前执行环境找不到 Python 模块「requests」",
  );
  await expect(panel).toContainText("已安排在 3 秒后再次执行");
  await expect(panel).toContainText("不会推断为成功，也不会自动补跑");
  await expect(panel).toContainText("服务重启，等待人工处理");
  const output = panel.locator('[data-event-kind="console"]');
  await expect(output.locator(".event-heading")).toHaveText(/控制台输出/);
  await expect(output).toContainText("ValueError: real business error");
  await expect(panel).not.toContainText("NaN");
  const log = panel.locator('[data-event-kind="custom.log"]');
  await log.getByRole("button", { name: "查看完整内容与技术详情" }).click();
  const full = log.getByLabel("事件完整内容");
  await expect(full).toBeVisible();
  expect(
    await full.evaluate(
      (el) => el.scrollHeight > el.clientHeight && el.clientHeight <= 260,
    ),
  ).toBeTruthy();
  const top = await panel.locator(".event-list").evaluate((el) => el.scrollTop);
  await full.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(
    await panel.locator(".event-list").evaluate((el) => el.scrollTop),
  ).toBe(top);
  const custom = panel.locator('[data-event-kind="custom.业务统计"]');
  await custom.getByRole("button", { name: "查看完整内容与技术详情" }).click();
  await expect(custom.getByLabel("原始事件数据")).toContainText("<script>");
  await panel.getByLabel("搜索运行事件").fill("不存在的内容");
  await expect(panel.getByText("没有符合筛选条件的事件")).toBeVisible();
});
