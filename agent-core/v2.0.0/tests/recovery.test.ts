import { createUuid } from '../src/uuid.js';
import { beforeAll, afterAll, it, expect } from "vitest";
import { Store, type ToolRecord } from "../src/store.js";
import { Objects } from "../src/objects.js";
import { Worker } from "../src/worker.js";
import { Business } from "../src/business.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { hash, type Principal, type Run } from "../src/contracts.js";
import { fixture, testConfig } from "./fixture.js";
const store = new Store(testConfig.DATABASE_URL),
  objects = new Objects(testConfig),
  p: Principal = {
    service: "test",
    tenantId: "tests",
    ownerId: createUuid(),
    projects: ["p"],
    scopes: ["engine:*"],
  };
let provider: Awaited<ReturnType<typeof fixture>>,
  business: Business,
  workers: Worker[] = [],
  env = { ...testConfig };
beforeAll(async () => {
  await store.migrate();
  await objects.initialize();
  provider = await fixture();
  env.BUSINESS_API_URL = `http://127.0.0.1:${provider.port}`;
  business = new Business(env);
  workers = [0, 1, 2].map(() => new Worker(env, store, objects, business));
});
afterAll(async () => {
  await Promise.all(workers.map((w) => w.stop()));
  await provider?.app.close();
  await store.close();
  objects.client.destroy();
});
async function settle(runId: string) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    await Promise.all(workers.map((w) => w.tick()));
    const run = await store.run(runId);
    if (["completed", "failed", "interrupted"].includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw Error("timeout");
}
async function seed(policy: string, completed: boolean) {
  const session = await store.createSession(
    p,
    { projectId: "p", taskId: createUuid(), title: "recover" },
    createUuid(),
  );
  const run = await store.createRun(
    p,
    session.id,
    { content: "resume seeded tool boundary", fileIds: [] },
    createUuid(),
  );
  const manifest = await business.resolve(run, session),
    lease = { id: run.id, workerId: "crashed", fence: 1 };
  await store.pool.query(
    "UPDATE ae_runs SET status='running',worker_id='crashed',fence=1,attempt=1,lease_until=UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000+30000 WHERE id=?",
    [run.id],
  );
  await store.update(lease, { manifest, manifestHash: hash(manifest) });
  const manager = SessionManager.inMemory("/workspace");
  manager.appendMessage({
    role: "user",
    content: "resume seeded tool boundary",
    timestamp: Date.now(),
  });
  manager.appendMessage({
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "durable-call",
        name: policy === "reconcile" ? "shell" : "workspace_write",
        arguments:
          policy === "reconcile"
            ? { command: "echo do-not-repeat" }
            : { path: "restored.txt", content: "restored" },
      },
    ],
    api: "openai-completions",
    provider: "fixture",
    model: "scripted-model",
    usage: {
      input: 10,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 20,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  });
  const cp = {
    entries: [manager.getHeader(), ...manager.getEntries()],
    leafId: manager.getLeafId(),
    workspace: [],
    sdkVersion: "1.1.0" as const,
    runId: run.id,
    modelAttempt: 1,
  };
  const record: ToolRecord = {
    callId: "durable-call",
    name: policy === "reconcile" ? "shell" : "workspace_write",
    arguments:
      policy === "reconcile"
        ? { command: "echo do-not-repeat" }
        : { path: "restored.txt", content: "restored" },
    status: "started",
    replay: policy,
  };
  await store.toolStart(lease, record);
  await store.checkpoint(lease, cp);
  if (completed)
    await store.toolComplete(
      lease,
      {
        ...record,
        status: "completed",
        result: {
          content: [{ type: "text", text: "saved-before-node-exit" }],
          details: {},
        },
      },
      cp,
    );
  await store.pool.query("UPDATE ae_runs SET lease_until=0 WHERE id=?", [
    run.id,
  ]);
  return run;
}
it("recovers a committed tool result without repeating its side effect and keeps frozen config", async () => {
  provider.setRevision("frozen");
  const run = await seed("idempotent", true);
  provider.setRevision("new-published");
  const recovered = await settle(run.id);
  expect(recovered.error).toBeNull();
  expect(recovered.status).toBe("completed");
  expect(recovered.attempt).toBe(2);
  expect(recovered.manifest!.model.revision).toBe("frozen");
  const events = await store.events(run.sessionId, 0, 1000);
  expect(events.filter((e) => e.type === "tool.completed")).toHaveLength(1);
  const cp = (await store.session(run.sessionId)).checkpoint!;
  expect(JSON.stringify(cp.entries)).toContain("saved-before-node-exit");
  expect(cp.workspace).toHaveLength(0);
});
it("halts an uncertain external write and exposes its stable call ID", async () => {
  const run = await seed("reconcile", false);
  const recovered = await settle(run.id);
  expect(recovered.status).toBe("interrupted");
  expect(recovered.error).toMatchObject({
    code: "tool_outcome_unknown",
    details: { callId: "durable-call" },
  });
  expect((await store.toolRecords(run.id))[0]!.status).toBe("started");
  await store.command(p, run.id, { type: "cancel" }, createUuid());
});
it("loads full required skill directories and real stdio MCP through the official extension", async () => {
  const script = `process.stdin.setEncoding('utf8');let pending='';process.stdin.on('data',chunk=>{pending+=chunk;let i;while((i=pending.indexOf('\\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);if(!line.trim())continue;const m=JSON.parse(line);if(m.id===undefined)continue;let result={};if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};if(m.method==='tools/list')result={tools:[{name:'echo_value',description:'Echo test evidence',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']}}]};if(m.method==='tools/call')result={content:[{type:'text',text:m.params.arguments.value}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');}});`;
  const files = [];
  for (const [path, text] of [
    ["agent.md", "Use the project evidence."],
    [
      "skills/evidence/SKILL.md",
      "Required evidence skill. Read references/facts.txt before reporting.",
    ],
    ["skills/evidence/references/facts.txt", "full-directory-evidence"],
    ["mcp/echo.cjs", script],
  ])
    files.push({
      path,
      ...(await objects.put(p.tenantId, p.ownerId, Buffer.from(text!))),
    });
  provider.setTransform((m) => ({
    ...m,
    files,
    skills: [
      {
        id: "evidence",
        name: "Evidence",
        description: "Use evidence",
        directory: "skills/evidence",
        revision: "one",
        required: true,
      },
    ],
    mcp: [
      {
        id: "echo",
        transport: "stdio",
        command: "node",
        args: ["mcp/echo.cjs"],
        required: true,
      },
    ],
  }));
  const session = await store.createSession(
      p,
      { projectId: "p", taskId: createUuid(), title: "resources" },
      createUuid(),
    ),
    run = await store.createRun(
      p,
      session.id,
      { content: "use-mcp", fileIds: [] },
      createUuid(),
    );
  const result = await settle(run.id);
  expect(result.error).toBeNull();
  expect(result.status).toBe("completed");
  const events = await store.events(session.id, 0, 1000);
  expect(
    events.some((e) => e.type === "skill.loaded" && e.payload.required),
  ).toBe(true);
  expect(
    events.some(
      (e) => e.type === "mcp.status" && e.payload.status === "connected",
    ),
  ).toBe(true);
  expect(JSON.stringify(events)).toContain("mcp verified");
  expect(JSON.stringify(provider.modelRequests.at(-1))).toContain(
    "Required evidence skill",
  );
  expect(JSON.stringify(provider.modelRequests.at(-1))).toContain(
    "Use the project evidence",
  );
  const cp = (await store.session(session.id)).checkpoint!;
  expect(
    cp.workspace.some((f) => f.path === "skills/evidence/references/facts.txt"),
  ).toBe(true);
  provider.setTransform((m) => m);
});
it("executes two independent experts while the parent waits without occupying its model slot", async () => {
  provider.setTransform((m) => ({
    ...m,
    experts: [
      { id: "analyst", name: "Analyst", instructions: "Analyze", skillIds: [] },
      { id: "writer", name: "Writer", instructions: "Write", skillIds: [] },
    ],
  }));
  const s = await store.createSession(
      p,
      { projectId: "p", taskId: createUuid(), title: "experts" },
      createUuid(),
    ),
    r = await store.createRun(
      p,
      s.id,
      { content: "delegate-experts", fileIds: [] },
      createUuid(),
    );
  const result = await settle(r.id);
  expect(result.error).toBeNull();
  expect(result.status).toBe("completed");
  const children = await store.children(r.id);
  expect(children).toHaveLength(2);
  expect(children.every((c) => c.status === "completed")).toBe(true);
  expect(new Set(children.map((c) => c.sessionId)).size).toBe(2);
  expect(children.every((c) => c.manifest?.experts.length === 0)).toBe(true);
  const usage = await store.usage.read(p, { taskId: s.taskId });
  expect(usage.summary.usageKnown).toBe(true);
  expect(usage.summary.totalTokens).toBe(usage.summary.callCount * 30);
  expect(usage.experts).toEqual(expect.arrayContaining([expect.objectContaining({id:'analyst',tasks:1,totalTokens:30}),expect.objectContaining({id:'writer',tasks:1,totalTokens:30})]));
  provider.setTransform((m) => m);
});
