import { createUuid } from '../src/uuid.js';
import { beforeAll, afterAll, it, expect } from "vitest";
import { Store, type Lease } from "../src/store.js";
import { tokens, hasReportedUsage } from "../src/usage.js";
import { validateManifest, type Principal, type Session } from "../src/contracts.js";
import { testConfig } from "./fixture.js";
import { createApi } from "../src/api.js";
import { Objects } from "../src/objects.js";
import { sign } from "../src/auth.js";

const store = new Store(testConfig.DATABASE_URL);
const p: Principal = { service: "usage-test", tenantId: "metering-tests", ownerId: createUuid(), projects: ["p"], scopes: ["engine:*"] };
beforeAll(async () => { await store.migrate(); });
afterAll(async () => { await store.close(); });
const model = { providerId: "test", revision: "1", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:1/v1", model: "test", credentialRef: "key", maxTokens: 1024 };
async function session(taskId = createUuid(), parent?: { runId: string; expertId: string }) {
  return store.createSession(p, { projectId: "p", taskId, title: taskId }, createUuid(), parent);
}
async function run(s: Session, primaryExpertId?: string) {
  const manifest = validateManifest({ schemaVersion: 1, tenantId: p.tenantId, ownerId: p.ownerId, projectId: "p", taskId: s.taskId, resolvedAt: new Date().toISOString(), model, primaryExpertId, experts: ["main", "helper", "unused"].map(id => ({ id, name: id, instructions: id })) });
  const result = await store.createRun(p, s.id, { content: "test", fileIds: [] }, createUuid(), manifest);
  await store.pool.query("UPDATE ae_runs SET status='running',worker_id='meter',fence=1,lease_until=UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000+60000 WHERE id=?", [result.id]);
  const lease = { id: result.id, workerId: "meter", fence: 1 };
  await store.append(lease, "run.started", {});
  return lease;
}
async function measure(lease: Lease, usage: unknown, callId = createUuid()) {
  await store.usage.start(lease, callId, "assistant", { providerId: "test", model: "test" }, 1);
  await store.usage.finish(lease, callId, usage);
  return callId;
}
const fifty = { input: 20, output: 30, cacheRead: 0, cacheWrite: 0, totalTokens: 50 };

it("deduplicates expert tasks and counts main plus parallel/repeated expert calls exactly once", async () => {
  const s = await session(), root = await run(s, "main");
  const callId = await measure(root, { input: 50, output: 30, cacheRead: 20, cacheWrite: 0, totalTokens: 100 });
  await store.usage.finish(root, callId, { input: 999, output: 1, totalTokens: 1000 });
  for (let i = 0; i < 2; i++) {
    const child = await session(`child-${createUuid()}`, { runId: root.id, expertId: "helper" });
    const invocation = await run(child, "helper");
    await store.tx(c => store.emit(c, s.id, root.id, "expert.delegated", { runId: invocation.id, expertId: "helper" }));
    await measure(invocation, fifty);
    await store.update(invocation, { status: "completed" });
  }
  await store.update(root, { status: "completed" });
  const data = await store.usage.read(p, { taskId: s.taskId });
  expect(data.summary).toMatchObject({ totalTokens: 200, callCount: 3, tasks: 1, successRate: 100, cacheReadTokens: 20 });
  expect(data.projects[0]).toMatchObject({ totalTokens: 200, tasks: 1 });
  expect(data.experts.find(x => x.id === "helper")).toMatchObject({ totalTokens: 100, tasks: 1 });
  expect(data.experts.some(x => x.id === "unused")).toBe(false);
  expect(await store.usage.runUsage(p, root.id)).toMatchObject({ totalTokens: 200 });
  expect(await store.usage.read({ ...p, ownerId: createUuid() })).toMatchObject({ summary: { totalTokens: 0, tasks: 0 } });
  expect(await store.usage.read({ ...p, projects: ["other"] })).toMatchObject({ summary: { totalTokens: 0, tasks: 0 } });
  const expert = await store.usage.expertTasks(p, "helper", 0, 1);
  expect(expert.taskTotal).toBe(1); expect(expert.tasks[0]).toMatchObject({ taskId: s.taskId, totalTokens: 100, status: "completed" });
});

it("keeps zero, unknown, partial, cancelled and late settlements distinct", async () => {
  expect(hasReportedUsage({})).toBe(false);
  expect(hasReportedUsage({prompt_tokens: 100})).toBe(false);
  expect(hasReportedUsage({prompt_tokens: 0, completion_tokens: 0})).toBe(true);
  const s = await session(), root = await run(s);
  await measure(root, { input: 0, output: 0, totalTokens: 0 });
  expect((await store.usage.read(p, { taskId: s.taskId })).summary).toMatchObject({ totalTokens: 0, usageKnown: true });
  await measure(root, null);
  expect((await store.usage.read(p, { taskId: s.taskId })).summary).toMatchObject({ totalTokens: 0, usageKnown: false, unknownCalls: 1 });
  const late = createUuid(); await store.usage.start(root, late, "summary", { providerId: "test", model: "test" }, 3);
  await store.pool.query("UPDATE ae_runs SET status='cancelled',fence=2,lease_until=NULL WHERE id=?", [root.id]);
  await store.usage.finish(root, late, fifty);
  expect((await store.run(root.id)).status).toBe("cancelled");
  expect((await store.usage.read(p, { taskId: s.taskId })).summary).toMatchObject({ totalTokens: 50, callCount: 3, unknownCalls: 1, successRate: 0 });
  await expect(store.usage.finish({ ...root, workerId: "intruder" }, late, fifty)).rejects.toThrow("身份");
  const unknownSession = await session(), unknownRun = await run(unknownSession);
  await measure(unknownRun, null);
  expect((await store.usage.read(p, { taskId: unknownSession.taskId })).summary).toMatchObject({ totalTokens: null, usageKnown: false });
  expect(tokens({ input: 40, output: 20, cacheRead: 10, totalTokens: 60 })).toBeNull();
});

it("backfills full histories beyond 500 events, preserves unknown attribution and never duplicates modern calls", async () => {
  const s = await session(), root = await run(s);
  await store.tx(async c => {
    await store.emit(c, s.id, root.id, "model.started", { attempt: 1 });
    await store.emit(c, s.id, root.id, "message.completed", { messageId: "old", role: "assistant", content: "old", usageKnown: true, usage: fifty });
    for (let i = 0; i < 1005; i++) await store.emit(c, s.id, root.id, "history.marker", {});
  });
  await measure(root, fifty);
  await store.append(root, "message.completed", { messageId: "modern", role: "assistant", metered: true, usageKnown: true, usage: fifty });
  const first = await store.usage.backfill({ dryRun: true, limit: 10000 });
  expect(first.known).toBeGreaterThan(0);
  expect((await store.usage.read(p, { taskId: s.taskId })).summary.totalTokens).toBe(50);
  await store.usage.backfill({ dryRun: false, limit: 10000 });
  await store.usage.backfill({ dryRun: false, limit: 10000 });
  const data = await store.usage.read(p, { taskId: s.taskId });
  expect(data.summary).toMatchObject({ totalTokens: 100, callCount: 2 });
  expect(data.experts).toEqual([]);
  expect((await store.snapshot(s.id)).events.length).toBe(500);
  const interruptedSession = await session(), interrupted = await run(interruptedSession);
  const start = await store.append(interrupted, 'model.started', { attempt: 1 });
  await store.checkpoint(interrupted, { runId: interrupted.id, leafId: null, workspace: [], sdkVersion: '1.1.0', modelAttempt: 1, entries: [{ id: 'durable-reply', message: {role:'assistant',model:'test',timestamp:Date.parse(start.occurredAt)+1,content:[{type:'text',text:'durable reply'}],usage:fifty} }] });
  await store.usage.backfill({ dryRun: false, limit: 10000 });
  expect((await store.usage.read(p, { taskId: interruptedSession.taskId })).summary).toMatchObject({ totalTokens: 50, callCount: 1, usageKnown: true });
});

it("exposes authenticated summaries, paginated totals and UTC+8 boundaries", async () => {
  const s = await session(), root = await run(s, "main"), callId = await measure(root, fifty);
  await store.pool.query("UPDATE ae_model_usage SET occurred_at='2026-10-15 16:01:00' WHERE call_id=?", [callId]);
  const objects = new Objects(testConfig), app = await createApi(testConfig, store, objects);
  try {
    const token = await sign(p, testConfig.ENGINE_SIGNING_KEY), headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ url: "/v1/usage" })).statusCode).toBe(401);
    const result = await app.inject({ url: `/v1/usage?taskId=${s.taskId}`, headers });
    expect(result.statusCode).toBe(200); expect(result.json().daily).toEqual([expect.objectContaining({ date: "2026-10-16", totalTokens: 50 })]);
    expect((await app.inject({ url: "/v1/usage?projectId=other", headers })).statusCode).toBe(404);
    const page = (await app.inject({ url: "/v1/experts/main/tasks?limit=1", headers })).json();
    expect(page.tasks).toHaveLength(1); expect(page.taskTotal).toBeGreaterThan(1); expect(page.hasMore).toBe(true);
    const detail = (await app.inject({ url: `/v1/sessions/${s.id}`, headers })).json();
    expect(detail.usage.totalTokens).toBe(50);
  } finally { await app.close(); objects.client.destroy(); }
});
