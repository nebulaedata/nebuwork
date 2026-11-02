import Fastify from "fastify";
import swagger from "@fastify/swagger";
import { registerFileTransfers } from './file-transfers.js';
import { z } from "zod";
import { Readable } from "node:stream";
import { verify } from "./auth.js";
import {
  EngineError,
  ID,
  Resource,
  Instruction,
  Skill,
  Mcp,
  ModelBinding,
  Expert,
  BusinessTool,
  assertScope,
  hash,
  id,
  type Principal,
  type Artifact,
} from "./contracts.js";
import type { Store } from "./store.js";
import type { Objects } from "./objects.js";
import type { Config } from "./config.js";
import { resolveArtifactPublication } from "./artifact-publication.js";
import { createHtmlBundle } from './html-bundle.js';
import {
  createSessionSchema,
  inputSchema,
  bundleSchema,
  commandSchema,
  artifactUploadSchema,
  routeSchema,
  manifestJsonSchema,
} from "./api-schemas.js";

export async function createApi(
  config: Config,
  store: Store,
  objects: Objects,
) {
  const app = Fastify({
    ajv: { customOptions: { removeAdditional: false, allowUnionTypes:true } },
    logger:
      config.TEST_MODE === "true"
        ? false
        : {
            redact: [
              "req.headers.authorization",
              "*.apiKey",
              "*.secret",
              "*.headers.Authorization",
            ],
          },
    bodyLimit: 32 * 1024 ** 2,
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Nebu Agent Engine", version: "1.0.0" },
      components: {
        schemas: { RuntimeManifest: manifestJsonSchema as any },
        securitySchemes: {
          serviceToken: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
      security: [{ serviceToken: [] }],
    },
  });
  app.addHook("onRoute", (route) => {
    route.schema = { ...route.schema, ...routeSchema(route.method, route.url) };
  });
  const principals = new WeakMap<object, Principal>();
  app.addHook("onRequest", async (request) => {
    if (request.url === "/health/live" || request.url === "/health/ready")
      return;
    principals.set(
      request,
      await verify(request.headers.authorization, config.ENGINE_SIGNING_KEY),
    );
    if (request.headers['x-engine-cluster-id'] && request.headers['x-engine-cluster-id'] !== await store.clusterId())
      throw new EngineError(409, 'cluster_mismatch', 'API 节点不属于已配置的引擎集群');
    if (request.headers['x-engine-storage-id'] && request.headers['x-engine-storage-id'] !== objects.storageId())
      throw new EngineError(409, 'storage_mismatch', 'API 节点的共享文件配置不一致');
  });
  const principal = (r: object) => principals.get(r)!;
  const key = (r: { headers: Record<string, unknown> }) =>
    String(r.headers["idempotency-key"] ?? "");
  const param = (r: { params: unknown }, name: string) =>
    ID.parse((r.params as Record<string, string>)[name]);
  app.setErrorHandler((error, request, reply) => {
    if ((error as {code?:string}).code === "FST_ERR_CTP_BODY_TOO_LARGE")
      return reply.code(413).send({error:{code:"body_too_large",message:"请求内容超过上传容量限制"}});
    if ((error as { validation?: unknown }).validation)
      return reply
        .code(422)
        .send({
          error: { code: "validation_error", message: "请求格式不正确" },
        });
    if (error instanceof z.ZodError)
      return reply
        .code(422)
        .send({
          error: {
            code: "validation_error",
            message: "请求格式不正确",
            details: error.issues,
          },
        });
    if (error instanceof EngineError)
      return reply
        .code(error.status)
        .send({
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        });
    request.log.error(
      { code: (error as { code?: string }).code },
      "engine request failed",
    );
    return reply
      .code(500)
      .send({
        error: { code: "internal_error", message: "引擎服务暂时不可用" },
      });
  });
  app.get("/health/live", async () => ({
    service: "nebu-agent-engine",
    status: "ok",
    version: "2.0.0",
  }));
  app.get("/health/ready", async () => {
    await store.pool.query("SELECT 1");
    await objects.initialize();
    return { status: "ready" };
  });
  app.get("/v1/openapi", async (r) => {
    assertScope(principal(r), "engine:read");
    return app.swagger();
  });
  app.get("/v1/metrics", async (r, reply) => {
    assertScope(principal(r), "engine:metrics");
    reply.type("text/plain; version=0.0.4");
    return store.metrics();
  });
  app.get("/v1/capabilities", async (r) => {
    assertScope(principal(r), "engine:read");
    return {
      service: "nebu-agent-engine",
      integrationVersion: 1,
      workbenchServiceResults: true,
      htmlArtifactBundles: true,
      databaseResources: true,
      managedMarketMcp: true,
      sdkVersion: "1.1.0",
      schemaVersion: 1,
      distributed: true,
      clusterId: await store.clusterId(),
      storageId: objects.storageId(),
      permissionProfile: "full_access",
      mcp: ["http", "stdio"],
      modelProtocols: ["openai-compatible"],
      expertDepth: 1,
      images: [config.SANDBOX_IMAGE],
    };
  });
  app.get('/v1/cluster', async r => {
    assertScope(principal(r), 'engine:admin');
    return { clusterId: await store.clusterId(), storageId: objects.storageId(), workers: await store.clusterWorkers(), checkedAt: new Date().toISOString() };
  });
  app.get('/v1/usage', async r => {
    const p = principal(r); assertScope(p, 'engine:read');
    const filter = z.object({ projectId: ID.optional(), taskId: ID.optional(), expertId: ID.optional() }).strict().parse(r.query);
    if (filter.projectId) assertScope(p, 'engine:read', filter.projectId);
    return store.usage.read(p, filter);
  });
  app.get('/v1/experts/:id/tasks', async r => {
    const p = principal(r); assertScope(p, 'engine:read');
    const query = z.object({ offset: z.coerce.number().int().min(0).default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse(r.query);
    return store.usage.expertTasks(p, param(r, 'id'), query.offset, query.limit);
  });
  app.post("/v1/sessions", async (r, reply) => {
    const body = createSessionSchema.parse(r.body),
      p = principal(r);
    assertScope(p, "engine:write", body.projectId);
    reply.code(201);
    return store.createSession(p, body, key(r));
  });
  app.get("/v1/projects/:id/sessions", async (r) => {
    const p = principal(r),
      project = param(r, "id");
    assertScope(p, "engine:read", project);
    return {
      items: (await store.listSessions(p, project)).map((s) => ({
        ...s,
        checkpoint: undefined,
      })),
    };
  });
  app.get("/v1/sessions/:id", async (r) => {
    const p = principal(r),
      sessionId = param(r, "id");
    assertScope(p, "engine:read");
    await store.ownedSession(p, sessionId);
    const snapshot = await store.snapshot(sessionId);
    const runs = await store.runs(sessionId);
    const usage = snapshot.session.parentRunId
      ? await store.usage.runUsage(p, (await store.runs(sessionId))[0]?.id ?? '', false)
      : (await store.usage.read(p, { taskId: snapshot.session.taskId })).summary;
    return {
      ...snapshot,
      usage,
      session: { ...snapshot.session, checkpoint: undefined, status: [...runs].reverse().find(run => !['completed','failed','cancelled'].includes(run.status))?.status ?? runs.at(-1)?.status ?? 'idle' },
      runs,
    };
  });
  app.post("/v1/sessions/:id/runs", async (r, reply) => {
    const p = principal(r),
      sessionId = param(r, "id");
    assertScope(p, "engine:write");
    const s = await store.ownedSession(p, sessionId),
      body = inputSchema.parse(r.body);
    for (const file of body.fileIds) {
      const a = await store.artifact(p, file);
      if (a.projectId !== s.projectId)
        throw new EngineError(404, "not_found", "附件不属于当前项目");
    }
    reply.code(202);
    return store.createRun(p, sessionId, body, key(r));
  });
  app.get("/v1/runs/:id", async (r) => {
    const p = principal(r);
    assertScope(p, "engine:read");
    const run = await store.run(param(r, "id"));
    await store.ownedSession(p, run.sessionId);
    const children = await store.children(run.id);
    return { ...run, usage: await store.usage.runUsage(p, run.id, !run.parentRunId), children: await Promise.all(children.map(async child => ({ ...child, usage: await store.usage.runUsage(p, child.id, false) }))) };
  });
  app.get('/v1/sessions/:id/runs',async r=>{const p=principal(r);assertScope(p,'engine:read');const session=await store.ownedSession(p,param(r,'id'));const runs=await store.runs(session.id);const usage=session.parentRunId?await store.usage.runUsage(p,runs[0]?.id??'',false):(await store.usage.read(p,{taskId:session.taskId})).summary;return {usage,items:await Promise.all(runs.map(async run=>({id:run.id,sessionId:run.sessionId,status:run.status,createdAt:run.createdAt,updatedAt:run.updatedAt,parentRunId:run.parentRunId,error:run.error,usage:await store.usage.runUsage(p,run.id,!run.parentRunId)})))};});
  app.post("/v1/runs/:id/commands", async (r) => {
    const p = principal(r);
    assertScope(p, "engine:write");
    const run = await store.run(param(r, "id"));
    await store.ownedSession(p, run.sessionId);
    const body = z
      .object({
        type: z.enum(["steer", "follow_up", "cancel", "resume"]),
        content: z.string().max(100000).optional(),
      })
      .strict()
      .parse(r.body);
    if (["steer", "follow_up"].includes(body.type) && !body.content?.trim())
      throw new EngineError(422, "content_required", "请输入内容");
    if (body.type === "follow_up")
      return store.createRun(
        p,
        run.sessionId,
        { content: body.content!, fileIds: [] },
        key(r),
      );
    return store.command(p, run.id, body, key(r));
  });
  app.get("/v1/sessions/:id/events", async (r, reply) => {
    const p = principal(r),
      sessionId = param(r, "id");
    assertScope(p, "engine:read");
    await store.ownedSession(p, sessionId);
    const query = r.query as { after?: string; format?: string };
    let after = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(r.headers["last-event-id"] ?? query.after ?? 0);
    if (query.format === "json")
      return { items: await store.events(sessionId, after) };
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    });
    let closed = false;
    reply.raw.on("close", () => {
      closed = true;
    });
    const opened = Date.now();
    let beat = 0;
    try {
      while (!closed && Date.now() - opened < 55000) {
        await verify(r.headers.authorization, config.ENGINE_SIGNING_KEY);
        for (const e of await store.events(sessionId, after)) {
          if (
            !reply.raw.write(
              `id: ${e.sequence}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`,
            )
          ) {
            await new Promise<void>((resolve) => {
              const done = () => {
                reply.raw.removeListener("drain", done);
                reply.raw.removeListener("close", done);
                resolve();
              };
              reply.raw.once("drain", done);
              reply.raw.once("close", done);
            });
          }
          after = e.sequence;
        }
        if (Date.now() - beat > 15000) {
          reply.raw.write(": heartbeat\n\n");
          beat = Date.now();
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } catch {
      if (!closed)
        reply.raw.write(
          'event: stream.error\ndata: {"message":"事件流中断，请重连"}\n\n',
        );
    } finally {
      reply.raw.end();
    }
  });
  // SQLite snapshots have their own bounded binary transport. Ordinary artifacts
  // retain the existing 20 MiB/base64 contract.
  app.addContentTypeParser("application/octet-stream", {parseAs:"buffer", bodyLimit:128*1024**2}, (_r,body,done)=>done(null,body));
  app.post("/v1/database-objects", {bodyLimit:128*1024**2}, async r=>{
    const p=principal(r);assertScope(p,"engine:write");
    const bytes=r.body;
    if(!Buffer.isBuffer(bytes)||bytes.length<100||bytes.subarray(0,16).toString("binary")!=="SQLite format 3\0")
      throw new EngineError(422,"invalid_database","必须上传完整 SQLite 数据库快照");
    const digest=hash(bytes);
    if(r.headers["x-content-sha256"]!==digest)throw new EngineError(422,"database_hash","数据库快照校验失败");
    const stored=await objects.put(p.tenantId,p.ownerId,bytes,"application/vnd.sqlite3");
    return store.tx(c=>store.once(c,"database-object:"+p.tenantId+":"+p.ownerId,key(r),{sha256:digest},async()=>stored));
  });
  app.get("/v1/database-objects/:digest",async(r,reply)=>{
    const p=principal(r);assertScope(p,"engine:read");
    const digest=z.string().regex(/^[a-f0-9]{64}$/).parse((r.params as {digest:string}).digest);
    const objectKey=objects.key(p.tenantId,p.ownerId,digest);
    objects.authorize(p.tenantId,p.ownerId,objectKey);
    const object=await objects.get(objectKey);
    if((object.ContentLength??0)>128*1024**2)throw new EngineError(413,"database_size","数据库快照超过 128 MiB");
    reply.type("application/vnd.sqlite3").header("etag",`"${digest}"`).header("x-content-type-options","nosniff");
    if(object.ContentLength!==undefined)reply.header("content-length",object.ContentLength);
    return Readable.from(object.Body as AsyncIterable<Uint8Array>);
  });
  app.post("/v1/objects", async (r) => {
    const p = principal(r);
    assertScope(p, "engine:write");
    const body = z
      .object({
        contentBase64: z.string().max(28 * 1024 ** 2),
        mediaType: z.string().default("application/octet-stream"),
      })
      .strict()
      .parse(r.body);
    const stored = await objects.put(
      p.tenantId,
      p.ownerId,
      Buffer.from(body.contentBase64, "base64"),
      body.mediaType,
    );
    return store.tx((c) =>
      store.once(
        c,
        "object:" + p.tenantId + ":" + p.ownerId,
        key(r),
        stored,
        async () => stored,
      ),
    );
  });
  app.post("/v1/runtime-bundles", async (r, reply) => {
    const p = principal(r);
    assertScope(p, "engine:write");
    const b = bundleSchema.parse(r.body);
    const seen = new Set<string>();
    for (const f of b.files) {
      f.path = f.path.replace(/(^|\/)agent\.md$/i, "$1AGENTS.md");
      if (seen.has(f.path.toLowerCase()))
        throw new EngineError(422, "resource_conflict", "资源路径重复");
      seen.add(f.path.toLowerCase());
      objects.authorize(p.tenantId, p.ownerId, f.objectKey);
      await objects.bytes(f.objectKey, f.sha256);
    }
    for (const s of b.skills)
      if (['SKILL.md',...s.requiredFiles].some(path=>!seen.has(`${s.directory}/${path}`.toLowerCase())))
        throw new EngineError(
          422,
          "missing_skill",
          `技能缺少 SKILL.md：${s.name}`,
        );
    reply.code(201);
    return store.saveBundle(p, { ...b, hash: hash(b) }, key(r));
  });
  app.get("/v1/runtime-bundles/:id/:version", async (r) => {
    const p = principal(r);
    assertScope(p, "engine:read");
    return store.bundle(p, param(r, "id"), param(r, "version"));
  });
  app.post("/v1/projects/:id/artifacts", async (r, reply) => {
    const p = principal(r),
      project = param(r, "id");
    assertScope(p, "engine:write", project);
    const b = artifactUploadSchema.parse(r.body);
    if (b.sessionId) {
      const s = await store.ownedSession(p, b.sessionId);
      if (s.projectId !== project)
        throw new EngineError(404, "not_found", "会话不属于该项目");
    }
    const target = await resolveArtifactPublication(store, p, project, b);
    const data = await objects.put(
      p.tenantId,
      p.ownerId,
      Buffer.from(b.contentBase64, "base64"),
      b.mediaType,
    );
    const a: Artifact = {
      ...target,
      tenantId: p.tenantId,
      ownerId: p.ownerId,
      projectId: project,
      sessionId: b.sessionId ?? null,
      runId: null,
      name: b.name,
      ...data,
      source: b.source ?? { kind: "upload" },
      createdAt: new Date().toISOString(),
    };
    reply.code(201);
    return store.addArtifact(p, a, key(r));
  });
  app.get("/v1/projects/:id/artifacts", async (r) => {
    const p = principal(r),
      project = param(r, "id");
    assertScope(p, "engine:read", project);
    return { items: await store.artifacts(p, project) };
  });
  app.post('/v1/projects/:id/html-bundles', async r => createHtmlBundle(principal(r), param(r, 'id'), r.body, store, objects));
  app.get("/v1/artifacts/:id", async (r) => {
    const p = principal(r);
    assertScope(p, "engine:read");
    return store.artifact(
      p,
      param(r, "id"),
      (r.query as { version?: number }).version,
    );
  });
  app.get('/v1/artifacts/:id/versions',async r=>{const p=principal(r);assertScope(p,'engine:read');return {items:await store.artifactVersions(p,param(r,'id'))};});
  app.get("/v1/artifacts/:id/content", async (r, reply) => {
    const p = principal(r);
    assertScope(p, "engine:read");
    const a = await store.artifact(
      p,
      param(r, "id"),
      (r.query as { version?: number }).version,
    );
    if (r.headers["if-none-match"] === `"${a.sha256}"`)
      return reply.code(304).send();
    const range = r.headers.range;
    if (range && !/^bytes=\d*-\d*$/.test(range))
      throw new EngineError(416, "invalid_range", "不支持该字节范围");
    const object = await objects.get(a.objectKey, range);
    reply
      .header("etag", `"${a.sha256}"`)
      .header("accept-ranges", "bytes")
      .header("content-type", a.mediaType)
      .header(
        "content-disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      )
      .header("x-content-type-options", "nosniff");
    if (object.ContentRange)
      reply.code(206).header("content-range", object.ContentRange);
    if (object.ContentLength !== undefined)
      reply.header("content-length", object.ContentLength);
    return reply.send(object.Body as Readable);
  });
  app.get('/v1/sessions/status',async r=>{const p=principal(r);assertScope(p,'engine:read');const ids=z.array(ID).max(100).parse(String((r.query as {ids?:string}).ids??'').split(',').filter(Boolean));return {items:await store.sessionStatuses(p,ids)};});
  app.get('/v1/requests/:kind/:id',async r=>{const p=principal(r);assertScope(p,'engine:read');const kind=z.enum(['run','command','artifact']).parse(param(r,'kind'));const key=z.string().min(1).max(128).parse((r.query as {key?:string}).key);return store.requestResult(p,kind,param(r,'id'),key);});
  app.get('/v1/session-grants',async r=>{
    const p=principal(r);assertScope(p,'engine:read');
    const target=ID.parse((r.query as {targetSessionId?:string}).targetSessionId);
    await store.ownedSession(p,target);
    return {items:await store.listGrants(p,target)};
  });
  app.get('/v1/session-grants/:id/events',async r=>{
    const p=principal(r);assertScope(p,'engine:read');
    const q=r.query as {targetSessionId?:string;after?:string};
    const target=ID.parse(q.targetSessionId);await store.ownedSession(p,target);
    return store.grantedHistoryPage(p,param(r,'id'),target,z.coerce.number().int().nonnegative().parse(q.after??0));
  });
  app.post("/v1/session-grants", async (r) => {
    const p = principal(r);
    assertScope(p, "engine:write");
    return store.grant(
      p,
      z
        .object({
          sourceSessionId: ID,
          targetSessionId: ID,
          beforeSequence: z.number().int().positive(),
        })
        .strict()
        .parse(r.body),
      key(r),
    );
  });
  app.post("/v1/session-grants/:id/revoke", async (r) => {
    const p = principal(r);
    assertScope(p, "engine:write");
    const target=(r.body as {targetSessionId?:string}|undefined)?.targetSessionId;
    if(target){await store.ownedSession(p,ID.parse(target));await store.grantedHistoryPage(p,param(r,'id'),target);}
    return store.revokeGrant(p, param(r, "id"));
  });
  await registerFileTransfers(app, store, objects, config, principal);
  return app;
}
