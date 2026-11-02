import { createUuid } from '../src/uuid.js';
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Store } from "../src/store.js";
import { Objects } from "../src/objects.js";
import { Worker } from "../src/worker.js";
import { Business } from "../src/business.js";
import { createApi } from "../src/api.js";
import { sign } from "../src/auth.js";
import { fixture, testConfig } from "./fixture.js";
import {
  validateManifest,
  hash,
  type Principal,
  type Run,
} from "../src/contracts.js";
import { DockerSandbox } from "../src/sandbox.js";

describe("durable distributed engine", () => {
  const store = new Store(testConfig.DATABASE_URL),
    objects = new Objects(testConfig);
  const p: Principal = {
    service: "integration-test",
    tenantId: "tests",
    ownerId: createUuid(),
    projects: ["project-a"],
    scopes: ["engine:*"],
  };
  let env = { ...testConfig },
    business: Awaited<ReturnType<typeof fixture>>,
    apis: Awaited<ReturnType<typeof createApi>>[] = [],
    workers: Worker[] = [],
    token: string;
  beforeAll(async () => {
    await store.migrate();
    await objects.initialize();
    business = await fixture();
    env.BUSINESS_API_URL = `http://127.0.0.1:${business.port}`;
    token = await sign(p, env.ENGINE_SIGNING_KEY);
    apis = await Promise.all([
      createApi(env, store, objects),
      createApi(env, store, objects),
    ]);
    workers = [0, 1, 2].map(
      () => new Worker(env, store, objects, new Business(env)),
    );
  });
  afterAll(async () => {
    await Promise.all(workers.map((w) => w.stop()));
    await Promise.all(apis.map((a) => a.close()));
    await business?.app.close();
    await store.close();
    objects.client.destroy();
  });
  const request = (
    index: number,
    method: any,
    url: string,
    payload?: unknown,
    key = createUuid(),
  ) =>
    apis[index]!.inject({
      method,
      url,
      payload: payload as any,
      headers: { authorization: `Bearer ${token}`, "idempotency-key": key },
    });
  it('keeps immutable artifact versions and freezes input references before dispatch',async()=>{
    const s=await store.createSession(p,{projectId:'project-a',taskId:createUuid(),title:'versions'},createUuid());
    const upload={name:'data.txt',contentBase64:Buffer.from('version-one').toString('base64'),mediaType:'text/plain',sessionId:s.id};
    const first=(await request(0,'POST','/v1/projects/project-a/artifacts',upload)).json();
    const queued=await store.createRun(p,s.id,{content:'read frozen input',fileIds:[first.id]},createUuid());
    const body={...upload,artifactId:first.id,baseVersion:1,contentBase64:Buffer.from('version-two').toString('base64')},key=createUuid();
    const second=(await request(1,'POST','/v1/projects/project-a/artifacts',body,key)).json();
    expect(second.version).toBe(2);expect((await request(0,'POST','/v1/projects/project-a/artifacts',body,key)).json()).toEqual(second);
    expect((await request(0,'POST','/v1/projects/project-a/artifacts',body)).statusCode).toBe(409);
    expect((await request(0,'POST','/v1/projects/project-a/artifacts',{...body,mode:'update',baseVersion:9})).statusCode).toBe(409);
    expect((await store.run(queued.id)).input.resolvedFiles).toEqual([{id:first.id,version:1}]);
    expect((await request(1,'GET',`/v1/artifacts/${first.id}/content?version=1`)).body).toBe('version-one');
    expect((await request(0,'GET',`/v1/artifacts/${first.id}/versions`)).json().items).toHaveLength(2);
    await store.command(p,queued.id,{type:'cancel'},createUuid());
  });
  it.each([
    { label: "legacy empty ID with a placeholder version", target: { artifactId: "", baseVersion: 1 } },
    { label: "update without a target ID", target: { mode: "update", baseVersion: 1 } },
    { label: "update without a base version", target: { mode: "update", artifactId: "$existing" } },
    { label: "update with nullable fields", target: { mode: "update", artifactId: null, baseVersion: null } },
    { label: "update targeting a nonexistent artifact", target: { mode: "update", artifactId: "missing-artifact", baseVersion: 5 } },
    { label: "explicit create despite update fields", target: { mode: "create", artifactId: "$existing", baseVersion: 1 } },
  ])("creates version one for $label and reuses its idempotent receipt", async ({ target }) => {
    const upload = { name: "new.txt", contentBase64: Buffer.from("new content").toString("base64"), mediaType: "text/plain" };
    const original = (await request(0, "POST", "/v1/projects/project-a/artifacts", upload)).json();
    const body = { ...upload, ...target, ...(target.artifactId === "$existing" ? { artifactId: original.id } : {}) };
    const key = createUuid();
    const response = await request(0, "POST", "/v1/projects/project-a/artifacts", body, key);
    expect(response.statusCode).toBe(201);
    const created = response.json();
    expect(created.version).toBe(1);
    expect(created.id).not.toBe(original.id);
    expect(created.id).not.toBe(target.artifactId);
    expect((await request(1, "POST", "/v1/projects/project-a/artifacts", body, key)).json()).toEqual(created);
    expect((await request(0, "GET", `/v1/artifacts/${original.id}/versions`)).json().items).toHaveLength(1);
  });
  async function settle(runId: string) {
    const until = Date.now() + 75000;
    while (Date.now() < until) {
      await Promise.all(workers.map((w) => w.tick()));
      const run = await store.run(runId);
      if (["completed", "failed", "interrupted"].includes(run.status))
        return run;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error("run timed out");
  }
  it("publishes legacy arguments, updates an existing version and creates missing targets through real SDK tools", async () => {
    const session = await store.createSession(p, { projectId: "project-a", taskId: createUuid(), title: "artifact publication" }, createUuid());
    const steps = [
      { name: "workspace_write", arguments: { path: "result.md", content: "first version" } },
      { name: "publish_artifact", arguments: { path: "result.md", artifactId: "", baseVersion: 1 } },
      { name: "workspace_write", arguments: { path: "result.md", content: "second version" } },
      { name: "publish_artifact", arguments: { path: "result.md", mode: "update", artifactId: "$first", baseVersion: 1 } },
      { name: "publish_artifact", arguments: { path: "result.md", mode: "update", artifactId: "missing-tool-artifact", baseVersion: 9 } },
      { name: "publish_artifact", arguments: { path: "result.md", mode: "update", artifactId: "$first", baseVersion: null } },
      { name: "publish_artifact", arguments: { path: "result.md", mode: "create", artifactId: "$first", baseVersion: 1 } },
    ];
    const run = await store.createRun(p, session.id, { content: "artifact-publication|" + JSON.stringify(steps), fileIds: [] }, createUuid());
    const result = await settle(run.id);
    expect(result.error).toBeNull();
    expect(result.status).toBe("completed");
    const events = await store.events(session.id, 0);
    const artifacts = events.filter((e: any) => e.type === "artifact.created").map((e: any) => e.payload.artifact);
    expect(artifacts.map((a: any) => a.version)).toEqual([1, 2, 1, 1, 1]);
    expect(artifacts[1].id).toBe(artifacts[0].id);
    expect(new Set(artifacts.slice(1).map((a: any) => a.id)).size).toBe(4);
    expect((await request(0, "GET", `/v1/artifacts/${artifacts[0].id}/content?version=1`)).body).toBe("first version");
    expect((await request(0, "GET", `/v1/artifacts/${artifacts[0].id}/content?version=2`)).body).toBe("second version");
  });
  it("answers a simple query without requiring a file or artifact", async () => {
    const session = await store.createSession(p, { projectId: "project-a", taskId: createUuid(), title: "simple query" }, createUuid());
    const requestOffset = business.modelRequests.length;
    const run = await store.createRun(p, session.id, { content: "当前有哪些工作台？只查询，直接回复。", fileIds: [] }, createUuid());
    expect((await settle(run.id)).status).toBe("completed");
    const prompt = JSON.stringify(business.modelRequests.slice(requestOffset).at(-1).messages);
    expect(prompt).toContain("简单查询、状态查看和普通问答直接在对话中回复");
    expect(prompt).not.toContain("请使用 publish_artifact 发布最终成果");
    const events = await store.events(session.id, 0);
    expect(events.some((e: any) => e.type === "artifact.created")).toBe(false);
    expect(events.some((e: any) => e.type === "tool.started")).toBe(false);
  });
  it("claims one lease, fences stale nodes and serializes a session", async () => {
    const s = await store.createSession(
      p,
      { projectId: "project-a", taskId: createUuid(), title: "lease" },
      createUuid(),
    );
    const first = await store.createRun(
      p,
      s.id,
      { content: "lease", fileIds: [] },
      createUuid(),
    );
    await store.createRun(
      p,
      s.id,
      { content: "queued next", fileIds: [] },
      createUuid(),
    );
    const claims = await Promise.all([
      store.claim("w1", 3000, [env.SANDBOX_IMAGE]),
      store.claim("w2", 3000, [env.SANDBOX_IMAGE]),
    ]);
    const active = claims.filter(Boolean) as Run[];
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(first.id);
    await store.pool.query("UPDATE ae_runs SET lease_until=0 WHERE id=?", [
      first.id,
    ]);
    const reclaimed = await store.claim("w3", 3000, [env.SANDBOX_IMAGE]);
    expect(reclaimed!.fence).toBe(2);
    await expect(
      store.append(
        { id: first.id, workerId: active[0]!.workerId!, fence: 1 },
        "invalid",
        {},
      ),
    ).rejects.toMatchObject({ code: "lease_lost" });
    await store.command(p, first.id, { type: "cancel" }, createUuid());
    for (const r of await store.runs(s.id))
      if (r.status === "queued")
        await store.command(p, r.id, { type: "cancel" }, createUuid());
  });
  it("uses real pi, two APIs, three workers, Docker tools and shared objects", async () => {
    const body = {
        projectId: "project-a",
        taskId: createUuid(),
        title: "write report",
      },
      key = createUuid();
    const copies = await Promise.all([
      request(0, "POST", "/v1/sessions", body, key),
      request(1, "POST", "/v1/sessions", body, key),
    ]);
    expect(copies.map((x) => x.statusCode)).toEqual([201, 201]);
    const session = copies[0]!.json();
    expect(copies[1]!.json().id).toBe(session.id);
    expect(
      (
        await request(
          0,
          "POST",
          "/v1/sessions",
          { ...body, title: "conflict" },
          key,
        )
      ).statusCode,
    ).toBe(409);
    const submit = await request(0, "POST", `/v1/sessions/${session.id}/runs`, {
      content: "write-report",
      fileIds: [],
    });
    expect(submit.statusCode).toBe(202);
    const result = await settle(submit.json().id);
    expect(result.error).toBeNull();
    expect(result.status).toBe("completed");
    const snapshot = (
      await request(1, "GET", `/v1/sessions/${session.id}`)
    ).json();
    expect(snapshot.usage.usageKnown).toBe(true);
    expect(snapshot.usage.callCount).toBeGreaterThan(1);
    expect(snapshot.usage.totalTokens).toBe(snapshot.usage.callCount * 30);
    expect(snapshot.events.map((e: any) => e.sequence)).toEqual(
      Array.from({ length: snapshot.cursor }, (_, i) => i + 1),
    );
    const artifact = snapshot.events.find(
      (e: any) => e.type === "artifact.created",
    )?.payload.artifact;
    expect(artifact).toBeTruthy();
    const content = await request(
      1,
      "GET",
      `/v1/artifacts/${artifact.id}/content`,
    );
    expect(content.body).toContain("Verified output");
    expect(JSON.stringify(snapshot)).not.toContain("fixture-secret");
    expect(snapshot.session.checkpoint).toBeUndefined();
    const stored = await store.session(session.id);
    expect(JSON.stringify(stored.checkpoint?.entries)).toContain("toolResult");
    expect(JSON.stringify(stored.checkpoint)).not.toContain("fixture-secret");
    business.setRevision("2");
    const next = await request(1, "POST", `/v1/sessions/${session.id}/runs`, {
      content: "continue",
      fileIds: [],
    });
    const nextRun = await settle(next.json().id);
    expect(nextRun.status).toBe("completed");
    expect(nextRun.manifest!.model.revision).toBe("2");
    expect((await store.run(result.id)).manifest!.model.revision).toBe("1");
    expect(JSON.stringify(business.modelRequests.at(-1).messages)).toContain(
      "Verified output",
    );
    expect(
      business.modelRequests
        .at(-1)
        .messages.some((m: any) => m.role === "tool"),
    ).toBeTruthy();
  });
  it("denies another account and requires explicit revocable session grants", async () => {
    const source = await store.createSession(
        p,
        { projectId: "project-a", taskId: createUuid(), title: "source" },
        createUuid(),
      ),
      target = await store.createSession(
        p,
        { projectId: "project-a", taskId: createUuid(), title: "target" },
        createUuid(),
      );
    await store.tx((c) =>
      store.emit(c, source.id, null, "message.created", {
        role: "user",
        content: "private",
      }),
    );
    await expect(
      store.ownedSession({ ...p, ownerId: "another" }, source.id),
    ).rejects.toMatchObject({ code: "not_found" });
    const grant = await store.grant(
      p,
      {
        sourceSessionId: source.id,
        targetSessionId: target.id,
        beforeSequence: 1,
      },
      createUuid(),
    );
    expect(await store.grantedHistory(p, grant.id, target.id)).toHaveLength(1);
    await store.revokeGrant(p, grant.id);
    await expect(
      store.grantedHistory(p, grant.id, target.id),
    ).rejects.toMatchObject({ code: "grant_revoked" });
  });
  it("reacquires account and worker capacity after waiting", async () => {
    const workerId='quota-'+createUuid();
    const sessions=await Promise.all([0,1].map(i=>store.createSession(p,{projectId:'project-a',taskId:createUuid(),title:'quota-'+i},createUuid())));
    const runs=await Promise.all(sessions.map(s=>store.createRun(p,s.id,{content:'quota',fileIds:[]},createUuid())));
    const [parent,other]=runs;
    await store.pool.query("UPDATE ae_runs SET status='running',worker_id=?,fence=1,lease_until=UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000+30000 WHERE id IN (?,?)",[workerId,parent.id,other.id]);
    await store.pool.query("UPDATE ae_runs SET status='waiting_children' WHERE id=?",[parent.id]);
    const lease={id:parent.id,workerId,fence:1};
    try {
      expect(await store.acquireCapacity(lease,1,1)).toBe(false);
      await store.command(p,other.id,{type:'cancel'},createUuid());
      expect(await store.acquireCapacity(lease,1,1)).toBe(true);
      expect((await store.run(parent.id)).status).toBe('running');
    } finally {for(const r of runs)if((await store.run(r.id)).status!=='cancelled')await store.command(p,r.id,{type:'cancel'},createUuid());}
  });

});
