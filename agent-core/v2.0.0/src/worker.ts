import { createUuid } from './uuid.js';
import { hostname } from "node:os";
import { Store } from "./store.js";
import { Objects } from "./objects.js";
import { Business } from "./business.js";
import { AgentRuntime } from "./runtime.js";
import { DockerSandbox, type Sandbox } from "./sandbox.js";
import { EngineError, hash, type Run } from "./contracts.js";
import type { Config } from "./config.js";
export class Worker {
  readonly id = `${hostname()}:${createUuid()}`;
  private active = new Map<
    string,
    { controller: AbortController; runtime?: AgentRuntime; done: Promise<void> }
  >();
  private stopped = false;
  private lastPresence = 0;
  constructor(
    private config: Config,
    private store: Store,
    private objects: Objects,
    private business: Business,
    private sandboxFactory: (run: Run) => Promise<Sandbox> = (run) =>
      DockerSandbox.create(
        config,
        run.id,
        run.fence,
        run.manifest?.imageDigest,
      ),
  ) {}
  async tick() {
    if (this.stopped) return;
    let occupied = [...this.active.values()].filter(
      (x) => !x.runtime?.waiting,
    ).length;
    if (Date.now() - this.lastPresence > 10000) {
      await this.store.workerPresence(this.id, { hostname: hostname(), capacity: this.config.WORKER_CONCURRENCY,
        active: occupied, waiting: this.active.size - occupied, image: this.config.SANDBOX_IMAGE, storageId: this.objects.storageId(), managedMarketMcp: true });
      this.lastPresence = Date.now();
    }
    while (occupied < this.config.WORKER_CONCURRENCY && this.active.size < 64) {
      const run = await this.store.claim(this.id, this.config.LEASE_MS, [
        this.config.SANDBOX_IMAGE,
      ], this.config.ACCOUNT_CONCURRENCY, this.config.WORKER_CONCURRENCY);
      if (!run) break;
      const controller = new AbortController();
      const entry: {
        controller: AbortController;
        runtime?: AgentRuntime;
        done: Promise<void>;
      } = { controller, done: Promise.resolve() };
      this.active.set(run.id, entry);
      entry.done = this.execute(run, controller, entry).finally(() =>
        this.active.delete(run.id),
      );
      occupied++;
    }
  }
  private async execute(
    run: Run,
    controller: AbortController,
    entry: { runtime?: AgentRuntime },
  ) {
    const lease = { id: run.id, workerId: this.id, fence: run.fence };
    let sandbox: Sandbox | undefined;
    let beating = false;
    const heartbeat = setInterval(
      () => {
        if (beating) return;
        beating = true;
        this.store
          .heartbeat(lease, this.config.LEASE_MS)
          .then(() => sandbox?.heartbeat?.())
          .catch(() => controller.abort())
          .finally(() => {
            beating = false;
          });
      },
      Math.floor(this.config.LEASE_MS / 3),
    );
    try {
      const session = await this.store.session(run.sessionId);
      await this.store.metric(run.attempt > 1 ? 'recovery_count' : 'queue_wait_ms',run.attempt > 1 ? 1 : Math.max(0,Date.now()-Date.parse(run.createdAt)));
      if (!run.manifest) {
        const started = Date.now();
        const manifest = await this.business.resolve(run, session);
        for(const file of manifest.files){
          const skills=manifest.skills.filter(s=>file.path.startsWith(s.directory+'/'));
          if(skills.length && skills.every(s=>!s.available))continue;
          try {this.objects.authorize(run.tenantId,run.ownerId,file.objectKey);await this.objects.bytes(file.objectKey,file.sha256);}
          catch(error){
            await this.store.metric('object_failure_count');
            if(!skills.length||skills.some(s=>s.required))throw new EngineError(422,'required_resource_unavailable',`必需资源不可读取或校验失败：${file.path}`);
            for(const skill of skills){skill.available=false;manifest.degraded.push({kind:'skill',resourceId:skill.id,reason:`资源不可读取或校验失败：${file.path}`});}
          }
        }
        manifest.imageDigest = await DockerSandbox.imageDigest(this.config);
        run = await this.store.update(
          lease,
          { manifest, manifestHash: hash(manifest) },
          {
            type: "context.resolved",
            payload: {
              manifestHash: hash(manifest),
              instructions: manifest.instructions.map((i) => ({
                source: i.source,
                path: i.path,
                revision: i.revision,
              })),
              skills: manifest.skills.map((s) => ({
                id: s.id,
                name: s.name,
                revision: s.revision,
              })),
              model: {
                providerId: manifest.model.providerId,
                model: manifest.model.model,
              },
              memoryStatus: manifest.memory.status,
            },
          },
        );
        await this.store.metric('context_prepare_ms',Date.now()-started);
      }
      if (run.manifest!.image !== this.config.SANDBOX_IMAGE)
        throw new EngineError(
          422,
          "unsupported_image",
          "当前节点不支持此执行环境",
        );
      sandbox = await this.sandboxFactory(run);
      entry.runtime = new AgentRuntime(
        this.store,
        this.objects,
        this.business,
        sandbox,
        run,
        session,
        controller.signal,
        () => this.store.acquireCapacity(lease, this.config.ACCOUNT_CONCURRENCY, this.config.WORKER_CONCURRENCY),
      );
      await entry.runtime.execute();
    } catch (e) {
      if (!controller.signal.aborted) {
        const error =
          e instanceof EngineError
            ? { code: e.code, message: e.message, details: e.details }
            : { code: "execution_error", message: "执行失败，请查看服务诊断" };
        try {
          await this.store.update(
            lease,
            {
              status:
                e instanceof EngineError && e.code === "tool_outcome_unknown"
                  ? "interrupted"
                  : "failed",
              error,
            },
            {
              type:
                e instanceof EngineError && e.code === "tool_outcome_unknown"
                  ? "run.interrupted"
                  : "run.failed",
              payload: error,
            },
          );
        } catch {
          /* A newer fencing token or cancellation owns the state. */
        }
        if (!(e instanceof EngineError))
          console.error(
            "Worker execution failed",
            {runId:run.id, errorType:e instanceof Error ? e.name : "unknown"},
          );
      }
    } finally {
      clearInterval(heartbeat);
      await sandbox?.close().catch(() => {});
    }
  }
  async stop() {
    this.stopped = true;
    for (const task of this.active.values()) task.controller.abort();
    await Promise.allSettled([...this.active.values()].map((t) => t.done));
    await this.store.removeWorker(this.id);
  }
}
