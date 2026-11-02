import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";
import { UsageStore } from "./usage.js";
import { migrateFileTransfers } from "./file-transfers.js";
import {
  id,
  hash,
  EngineError,
  terminal,
  assertTransition,
  type Principal,
  type Session,
  type Run,
  type RunInput,
  type RuntimeManifest,
  type Checkpoint,
  type EngineEvent,
  type Artifact,
  type RunStatus,
} from "./contracts.js";

const now = () => new Date().toISOString();
const databaseTime = async (c: Conn) =>
  Number(
    (
      await rows(c, "SELECT UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS time")
    )[0]!.time,
  );
const decode = <T>(v: unknown): T =>
  (typeof v === "string" ? JSON.parse(v) : v) as T;
type Conn = Pool | PoolConnection;
async function rows(
  c: Conn,
  sql: string,
  args: unknown[] = [],
): Promise<RowDataPacket[]> {
  const [r] = await c.query(sql, args);
  return r as RowDataPacket[];
}
export type Lease = { id: string; workerId: string; fence: number };
export type ToolRecord = {
  callId: string;
  name: string;
  arguments: unknown;
  replay: string;
  status: "started" | "completed" | "unknown";
  result?: unknown;
};

export class Store {
  readonly pool: Pool;
  readonly usage: UsageStore;
  constructor(url: string) {
    this.pool = mysql.createPool({
      uri: url,
      connectionLimit: 16,
      timezone: "Z",
      decimalNumbers: true,
    });
    this.usage = new UsageStore(this);
  }
  async close() {
    await this.pool.end();
  }
  async migrate() {
    const statements = [
      `CREATE TABLE IF NOT EXISTS ae_cluster(id INT PRIMARY KEY, cluster_id VARCHAR(128) NOT NULL UNIQUE)`,
      `CREATE TABLE IF NOT EXISTS ae_workers(id VARCHAR(255) PRIMARY KEY, last_seen BIGINT NOT NULL, doc JSON NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS ae_sessions(id VARCHAR(128) PRIMARY KEY, tenant_id VARCHAR(128) NOT NULL, owner_id VARCHAR(128) NOT NULL, project_id VARCHAR(128) NOT NULL, task_id VARCHAR(128) NOT NULL, parent_run_id VARCHAR(128), event_cursor BIGINT NOT NULL DEFAULT 0, doc JSON NOT NULL, checkpoint JSON, created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3), INDEX session_project(tenant_id,owner_id,project_id), INDEX session_task(tenant_id,task_id))`,
      `CREATE TABLE IF NOT EXISTS ae_runs(id VARCHAR(128) PRIMARY KEY,session_id VARCHAR(128) NOT NULL,tenant_id VARCHAR(128) NOT NULL, parent_run_id VARCHAR(128), status VARCHAR(32) NOT NULL, worker_id VARCHAR(128), fence BIGINT NOT NULL DEFAULT 0, lease_until BIGINT, attempt INT NOT NULL DEFAULT 0, doc JSON NOT NULL, created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3), INDEX run_queue(status,lease_until), INDEX run_session(session_id,created_at), INDEX run_parent(parent_run_id))`,
      `CREATE TABLE IF NOT EXISTS ae_events(session_id VARCHAR(128) NOT NULL,sequence BIGINT NOT NULL,event_id VARCHAR(128) NOT NULL,doc JSON NOT NULL,PRIMARY KEY(session_id,sequence),UNIQUE KEY(event_id))`,
      `CREATE TABLE IF NOT EXISTS ae_requests(scope VARCHAR(255) NOT NULL,request_key VARCHAR(128) NOT NULL,request_hash CHAR(64) NOT NULL,result JSON NOT NULL,PRIMARY KEY(scope,request_key))`,
      `CREATE TABLE IF NOT EXISTS ae_outbox(id BIGINT AUTO_INCREMENT PRIMARY KEY,topic VARCHAR(64) NOT NULL,payload JSON NOT NULL,published_at BIGINT,INDEX outbox_pending(published_at))`,
      `CREATE TABLE IF NOT EXISTS ae_tools(run_id VARCHAR(128) NOT NULL,call_id VARCHAR(255) NOT NULL,doc JSON NOT NULL,PRIMARY KEY(run_id,call_id))`,
      `CREATE TABLE IF NOT EXISTS ae_artifacts(id VARCHAR(128) NOT NULL,version INT NOT NULL,tenant_id VARCHAR(128) NOT NULL,owner_id VARCHAR(128) NOT NULL,project_id VARCHAR(128) NOT NULL,run_id VARCHAR(128),doc JSON NOT NULL,PRIMARY KEY(id,version),INDEX artifact_project(tenant_id,owner_id,project_id))`,
      `CREATE TABLE IF NOT EXISTS ae_bundles(id VARCHAR(128) NOT NULL,version VARCHAR(128) NOT NULL,tenant_id VARCHAR(128) NOT NULL,owner_id VARCHAR(128) NOT NULL,doc JSON NOT NULL,PRIMARY KEY(id,version))`,
      `CREATE TABLE IF NOT EXISTS ae_grants(id VARCHAR(128) PRIMARY KEY,tenant_id VARCHAR(128) NOT NULL,owner_id VARCHAR(128) NOT NULL,source_session VARCHAR(128) NOT NULL,target_session VARCHAR(128) NOT NULL,revoked BOOLEAN NOT NULL DEFAULT FALSE,doc JSON NOT NULL,INDEX grant_target(target_session,revoked))`,
      `CREATE TABLE IF NOT EXISTS ae_commands(id VARCHAR(128) PRIMARY KEY,run_id VARCHAR(128) NOT NULL,doc JSON NOT NULL,consumed BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP(3),INDEX command_pending(run_id,consumed))`,
      `CREATE TABLE IF NOT EXISTS ae_metrics(name VARCHAR(80) PRIMARY KEY,value DOUBLE NOT NULL DEFAULT 0,samples BIGINT NOT NULL DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS ae_account_schedule(tenant_id VARCHAR(128) NOT NULL,owner_id VARCHAR(128) NOT NULL,PRIMARY KEY(tenant_id,owner_id))`,
      `CREATE TABLE IF NOT EXISTS ae_worker_schedule(worker_id VARCHAR(128) PRIMARY KEY)`,
    ];
    for (const sql of statements) await this.pool.query(sql);
    await this.usage.migrate();
    await migrateFileTransfers(this);
    await this.pool.query('INSERT IGNORE INTO ae_cluster(id,cluster_id) VALUES(1,?)', [id()]);
  }
  async clusterId(): Promise<string> {
    return (await rows(this.pool, 'SELECT cluster_id FROM ae_cluster WHERE id=1'))[0]!.cluster_id;
  }
  async workerPresence(workerId: string, doc: Record<string, unknown>) {
    await this.pool.query('INSERT INTO ae_workers(id,last_seen,doc) VALUES(?,UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000,?) ON DUPLICATE KEY UPDATE last_seen=VALUES(last_seen),doc=VALUES(doc)', [workerId, JSON.stringify(doc)]);
  }
  async removeWorker(workerId: string) { await this.pool.query('DELETE FROM ae_workers WHERE id=?', [workerId]); }
  async clusterWorkers() {
    const current = await databaseTime(this.pool);
    return (await rows(this.pool, 'SELECT * FROM ae_workers WHERE last_seen>? ORDER BY id', [current - 86400000]))
      .map(r => ({id:r.id, ...decode<Record<string, unknown>>(r.doc), lastSeen:new Date(Number(r.last_seen)).toISOString(), online: current - Number(r.last_seen) < 30000}));
  }
  async tx<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const c = await this.pool.getConnection();
      try {
        await c.beginTransaction();
        const result = await fn(c);
        await c.commit();
        return result;
      } catch (e) {
        await c.rollback();
        if (
          attempt < 3 &&
          ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(
            (e as { code?: string }).code ?? "",
          )
        )
          continue;
        throw e;
      } finally {
        c.release();
      }
    }
  }
  async once<T>(
    c: PoolConnection,
    scope: string,
    key: string,
    input: unknown,
    action: () => Promise<T>,
  ): Promise<T> {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(key))
      throw new EngineError(
        422,
        "idempotency_required",
        "请提供有效 Idempotency-Key",
      );
    const digest = hash(input);
    // The unique row is inserted before any mutation. Concurrent retries block on it.
    await c.query(
      "INSERT IGNORE INTO ae_requests(scope,request_key,request_hash,result) VALUES(?,?,?,CAST(? AS JSON))",
      [scope, key, digest, "null"],
    );
    const [r] = await rows(
      c,
      "SELECT * FROM ae_requests WHERE scope=? AND request_key=? FOR UPDATE",
      [scope, key],
    );
    if (r!.request_hash !== digest)
      throw new EngineError(
        409,
        "idempotency_conflict",
        "同一请求编号不能提交不同内容",
      );
    const prior = decode<T | null>(r!.result);
    if (prior !== null) return prior;
    const value = await action();
    await c.query(
      "UPDATE ae_requests SET result=? WHERE scope=? AND request_key=?",
      [JSON.stringify(value), scope, key],
    );
    return value;
  }
  private sessionRow(r: RowDataPacket): Session {
    return {
      ...decode<Session>(r.doc),
      cursor: Number(r.event_cursor),
      checkpoint: decode<Checkpoint | null>(r.checkpoint),
    };
  }
  private runRow(r: RowDataPacket): Run {
    return {
      ...decode<Run>(r.doc),
      status: r.status,
      fence: Number(r.fence),
      workerId: r.worker_id,
      leaseUntil: r.lease_until === null ? null : Number(r.lease_until),
      attempt: r.attempt,
    };
  }
  async session(
    sessionId: string,
    c: Conn = this.pool,
    lock = false,
  ): Promise<Session> {
    const [r] = await rows(
      c,
      `SELECT * FROM ae_sessions WHERE id=?${lock ? " FOR UPDATE" : ""}`,
      [sessionId],
    );
    if (!r) throw new EngineError(404, "not_found", "会话不存在");
    return this.sessionRow(r);
  }
  async run(runId: string, c: Conn = this.pool): Promise<Run> {
    const [r] = await rows(c, "SELECT * FROM ae_runs WHERE id=?", [runId]);
    if (!r) throw new EngineError(404, "not_found", "执行不存在");
    return this.runRow(r);
  }
  async ownedSession(p: Principal, sessionId: string) {
    const s = await this.session(sessionId);
    if (
      s.tenantId !== p.tenantId ||
      s.ownerId !== p.ownerId ||
      (!p.projects.includes("*") && !p.projects.includes(s.projectId))
    )
      throw new EngineError(404, "not_found", "会话不存在");
    return s;
  }
  async sessionStatuses(p:Principal,ids:string[]){if(!ids.length)return [];const result=await rows(this.pool,`SELECT s.id,s.project_id,(SELECT status FROM ae_runs r WHERE r.session_id=s.id ORDER BY CASE WHEN r.status IN ('completed','failed','cancelled') THEN 1 ELSE 0 END,r.created_at DESC,r.id DESC LIMIT 1) AS run_status FROM ae_sessions s WHERE s.tenant_id=? AND s.owner_id=? AND s.id IN (${ids.map(()=>'?').join(',')}) LIMIT 100`,[p.tenantId,p.ownerId,...ids]);return result.filter(row=>p.projects.includes('*')||p.projects.includes(row.project_id)).map(row=>({id:row.id,status:row.run_status??'idle'}));}
  async listSessions(p: Principal, projectId: string) {
    return (
      await rows(
        this.pool,
        "SELECT s.*,(SELECT status FROM ae_runs r WHERE r.session_id=s.id ORDER BY CASE WHEN r.status IN ('completed','failed','cancelled') THEN 1 ELSE 0 END,r.created_at DESC,r.id DESC LIMIT 1) AS run_status FROM ae_sessions s WHERE tenant_id=? AND owner_id=? AND project_id=? AND parent_run_id IS NULL ORDER BY created_at DESC",
        [p.tenantId, p.ownerId, projectId],
      )
    ).map((r) => ({...this.sessionRow(r),status:r.run_status??'idle'}));
  }
  async createSession(
    p: Principal,
    body: { projectId: string; taskId: string; title: string },
    key: string,
    parent?: { runId: string; expertId: string },
    connection?: PoolConnection,
  ): Promise<Session> {
    const action = (c: PoolConnection) =>
      this.once(
        c,
        `session:${p.tenantId}:${p.ownerId}`,
        key,
        body,
        async () => {
          const s: Session = {
            id: id(),
            tenantId: p.tenantId,
            ownerId: p.ownerId,
            ...body,
            parentRunId: parent?.runId ?? null,
            expertId: parent?.expertId ?? null,
            cursor: 0,
            checkpoint: null,
            createdAt: now(),
            updatedAt: now(),
          };
          await c.query(
            "INSERT INTO ae_sessions(id,tenant_id,owner_id,project_id,task_id,parent_run_id,doc) VALUES(?,?,?,?,?,?,?)",
            [
              s.id,
              s.tenantId,
              s.ownerId,
              s.projectId,
              s.taskId,
              s.parentRunId,
              JSON.stringify(s),
            ],
          );
          return s;
        },
      );
    return connection ? action(connection) : this.tx(action);
  }
  async emit(
    c: PoolConnection,
    sessionId: string,
    runId: string | null,
    type: string,
    payload: Record<string, unknown>,
  ): Promise<EngineEvent> {
    const s = await this.session(sessionId, c, true);
    const e: EngineEvent = {
      schemaVersion: 1,
      eventId: id(),
      sessionId,
      sequence: s.cursor + 1,
      runId,
      invocationId: runId,
      type,
      occurredAt: now(),
      payload,
    };
    await c.query(
      "UPDATE ae_sessions SET event_cursor=?,doc=JSON_SET(doc,'$.updatedAt',?) WHERE id=?",
      [e.sequence, e.occurredAt, sessionId],
    );
    await c.query("INSERT INTO ae_events VALUES(?,?,?,?)", [
      sessionId,
      e.sequence,
      e.eventId,
      JSON.stringify(e),
    ]);
    await c.query("INSERT INTO ae_outbox(topic,payload) VALUES(?,?)", [
      "events",
      JSON.stringify({ sessionId, sequence: e.sequence }),
    ]);
    await this.usage.event(c, e);
    return e;
  }
  async createRun(
    p: Principal,
    sessionId: string,
    input: RunInput,
    key: string,
    manifest?: RuntimeManifest,
    connection?: PoolConnection,
  ): Promise<Run> {
    const action = (c: PoolConnection) =>
      this.once(c, `run:${sessionId}`, key, input, async () => {
        const s = await this.session(sessionId, c, true);
        if (s.ownerId !== p.ownerId || s.tenantId !== p.tenantId)
          throw new EngineError(404, "not_found", "会话不存在");
        const resolvedFiles = [];
        for (const ref of [...input.fileIds.map(id => ({id, version: undefined as number | undefined})), ...(input.fileRefs ?? [])]) {
          const artifact = await this.artifact(p, ref.id, ref.version);
          if (artifact.projectId !== s.projectId) throw new EngineError(404, 'not_found', '附件不属于当前项目');
          resolvedFiles.push({id:artifact.id, version:artifact.version});
        }
        const r: Run = {
          id: id(),
          sessionId,
          tenantId: s.tenantId,
          ownerId: s.ownerId,
          projectId: s.projectId,
          input: {...input, resolvedFiles},
          status: "queued",
          manifest: manifest ?? null,
          manifestHash: manifest ? hash(manifest) : null,
          fence: 0,
          workerId: null,
          leaseUntil: null,
          attempt: 0,
          parentRunId: s.parentRunId,
          error: null,
          createdAt: now(),
          updatedAt: now(),
        };
        await c.query(
          "INSERT INTO ae_runs(id,session_id,tenant_id,parent_run_id,status,doc) VALUES(?,?,?,?,?,?)",
          [
            r.id,
            sessionId,
            r.tenantId,
            r.parentRunId,
            r.status,
            JSON.stringify(r),
          ],
        );
        await this.emit(c, sessionId, r.id, "message.created", {
          messageId: `user:${r.id}`,
          role: "user",
          content: input.content,
          fileIds: input.fileIds,
          fileRefs: resolvedFiles,
        });
        await this.emit(c, sessionId, r.id, "run.queued", {});
        await c.query("INSERT INTO ae_outbox(topic,payload) VALUES(?,?)", [
          "runs",
          JSON.stringify({ runId: r.id }),
        ]);
        return r;
      });
    return connection ? action(connection) : this.tx(action);
  }
  async runs(sessionId: string) {
    return (
      await rows(
        this.pool,
        "SELECT * FROM ae_runs WHERE session_id=? ORDER BY created_at,id",
        [sessionId],
      )
    ).map((r) => this.runRow(r));
  }
  async children(runId: string) {
    return (
      await rows(
        this.pool,
        "SELECT * FROM ae_runs WHERE parent_run_id=? ORDER BY created_at",
        [runId],
      )
    ).map((r) => this.runRow(r));
  }
  async toolRecords(runId: string) {
    return (
      await rows(this.pool, "SELECT doc FROM ae_tools WHERE run_id=?", [runId])
    ).map((r) => decode<ToolRecord>(r.doc));
  }
  async events(
    sessionId: string,
    after: number,
    limit = 500,
    c: Conn = this.pool,
  ) {
    return (
      await rows(
        c,
        "SELECT doc FROM ae_events WHERE session_id=? AND sequence>? ORDER BY sequence LIMIT ?",
        [sessionId, after, Math.min(1000, limit)],
      )
    ).map((r) => decode<EngineEvent>(r.doc));
  }
  async snapshot(sessionId: string) {
    return this.tx(async (c) => {
      const s = await this.session(sessionId, c, true);
      const events = await this.events(
        sessionId,
        Math.max(0, s.cursor - 500),
        500,
        c,
      );
      return {
        session: s,
        events,
        cursor: s.cursor,
        hasEarlier: s.cursor > 500,
      };
    });
  }
  async claim(
    workerId: string,
    leaseMs: number,
    images: string[],
    accountConcurrency = 6,
    workerConcurrency = 100000,
  ): Promise<Run | null> {
    return this.tx(async (c) => {
      const time = await databaseTime(c);
      await c.query('INSERT IGNORE INTO ae_worker_schedule(worker_id) VALUES(?)',[workerId]);
      await rows(c,'SELECT worker_id FROM ae_worker_schedule WHERE worker_id=? FOR UPDATE',[workerId]);
      const workerOccupied = await rows(c,"SELECT id FROM ae_runs WHERE worker_id=? AND status IN ('preparing','running','recovering') AND lease_until>=? FOR UPDATE",[workerId,time]);
      if(workerOccupied.length>=workerConcurrency)return null;
      const candidates = await rows(
        c,
        `SELECT s.id FROM ae_sessions s WHERE EXISTS(SELECT 1 FROM ae_runs r WHERE r.session_id=s.id AND r.status IN ('queued','preparing','running','waiting_children','recovering') AND (r.lease_until IS NULL OR r.lease_until<?)) AND NOT EXISTS(SELECT 1 FROM ae_runs a WHERE a.session_id=s.id AND a.status NOT IN ('completed','failed','cancelled') AND a.lease_until>=?) ORDER BY s.created_at LIMIT 8 FOR UPDATE SKIP LOCKED`,
        [time, time],
      );
      for (const candidate of candidates) {
        const [r] = await rows(
          c,
          "SELECT * FROM ae_runs WHERE session_id=? AND status NOT IN ('completed','failed','cancelled') ORDER BY created_at,id LIMIT 1 FOR UPDATE",
          [candidate.id],
        );
        if (!r || ["waiting_input", "interrupted"].includes(r.status)) continue;
        const value = this.runRow(r);
        if (value.manifest && !images.includes(value.manifest.image)) continue;
        await c.query('INSERT IGNORE INTO ae_account_schedule(tenant_id,owner_id) VALUES(?,?)',[value.tenantId,value.ownerId]);
        await rows(c,'SELECT owner_id FROM ae_account_schedule WHERE tenant_id=? AND owner_id=? FOR UPDATE',[value.tenantId,value.ownerId]);
        const occupied = await rows(c,"SELECT r.id FROM ae_runs r JOIN ae_sessions s ON s.id=r.session_id WHERE s.tenant_id=? AND s.owner_id=? AND r.status IN ('preparing','running','recovering') AND r.lease_until>=? FOR UPDATE",[value.tenantId,value.ownerId,time]);
        if(occupied.length>=accountConcurrency)continue;
        value.status = value.attempt ? "recovering" : "preparing";
        value.workerId = workerId;
        value.fence++;
        value.attempt++;
        value.leaseUntil = time + leaseMs;
        await c.query(
          "UPDATE ae_runs SET status=?,worker_id=?,fence=?,attempt=?,lease_until=? WHERE id=?",
          [
            value.status,
            workerId,
            value.fence,
            value.attempt,
            value.leaseUntil,
            value.id,
          ],
        );
        await this.emit(c, value.sessionId, value.id, `run.${value.status}`, {
          attempt: value.attempt,
        });
        return value;
      }
      return null;
    });
  }
  async fenced<T>(
    lease: Lease,
    fn: (c: PoolConnection, r: Run) => Promise<T>,
  ): Promise<T> {
    return this.tx(async (c) => {
      const [row] = await rows(
        c,
        "SELECT * FROM ae_runs WHERE id=? FOR UPDATE",
        [lease.id],
      );
      if (
        !row ||
        row.worker_id !== lease.workerId ||
        Number(row.fence) !== lease.fence ||
        Number(row.lease_until) <= (await databaseTime(c)) ||
        terminal.has(row.status)
      )
        throw new EngineError(409, "lease_lost", "执行权已失效");
      return fn(c, this.runRow(row));
    });
  }
  async heartbeat(lease: Lease, leaseMs: number) {
    await this.fenced(lease, async (c) => {
      await c.query("UPDATE ae_runs SET lease_until=? WHERE id=?", [
        (await databaseTime(c)) + leaseMs,
        lease.id,
      ]);
    });
  }
  async acquireCapacity(lease: Lease, accountConcurrency: number, workerConcurrency: number) {
    return this.fenced(lease, async (c, run) => {
      if (run.status === 'running') return true;
      await c.query('INSERT IGNORE INTO ae_worker_schedule(worker_id) VALUES(?)',[lease.workerId]);
      await rows(c,'SELECT worker_id FROM ae_worker_schedule WHERE worker_id=? FOR UPDATE',[lease.workerId]);
      await c.query('INSERT IGNORE INTO ae_account_schedule(tenant_id,owner_id) VALUES(?,?)',[run.tenantId,run.ownerId]);
      await rows(c,'SELECT owner_id FROM ae_account_schedule WHERE tenant_id=? AND owner_id=? FOR UPDATE',[run.tenantId,run.ownerId]);
      const time=await databaseTime(c);
      const occupied=await rows(c,"SELECT r.id,r.worker_id,s.tenant_id,s.owner_id FROM ae_runs r JOIN ae_sessions s ON s.id=r.session_id WHERE (r.worker_id=? OR (s.tenant_id=? AND s.owner_id=?)) AND r.id<>? AND r.status IN ('preparing','running','recovering') AND r.lease_until>=? FOR UPDATE",[lease.workerId,run.tenantId,run.ownerId,run.id,time]);
      if(occupied.filter(r=>r.worker_id===lease.workerId).length>=workerConcurrency || occupied.filter(r=>r.tenant_id===run.tenantId&&r.owner_id===run.ownerId).length>=accountConcurrency)return false;
      assertTransition(run.status,'running');
      await c.query("UPDATE ae_runs SET status='running' WHERE id=?",[run.id]);
      return true;
    });
  }
  async update(
    lease: Lease,
    values: Partial<Run>,
    event?: { type: string; payload: Record<string, unknown> },
  ) {
    return this.fenced(lease, async (c, r) => {
      if (values.status) assertTransition(r.status, values.status);
      const next = { ...r, ...values, updatedAt: now() };
      await c.query("UPDATE ae_runs SET doc=?,status=? WHERE id=?", [
        JSON.stringify(next),
        next.status,
        r.id,
      ]);
      if (event)
        await this.emit(c, r.sessionId, r.id, event.type, event.payload);
      return next;
    });
  }
  async append(lease: Lease, type: string, payload: Record<string, unknown>) {
    return this.fenced(lease, (c, r) =>
      this.emit(c, r.sessionId, r.id, type, payload),
    );
  }
  async checkpoint(lease: Lease, checkpoint: Checkpoint) {
    return this.fenced(lease, async (c, r) => {
      await c.query("UPDATE ae_sessions SET checkpoint=? WHERE id=?", [
        JSON.stringify(checkpoint),
        r.sessionId,
      ]);
      for (const entry of checkpoint.entries as {
        message?: { commandId?: string };
      }[])
        if (entry.message?.commandId)
          await c.query(
            "UPDATE ae_commands SET consumed=TRUE WHERE id=? AND run_id=?",
            [entry.message.commandId, r.id],
          );
    });
  }
  async toolStart(lease: Lease, record: ToolRecord) {
    return this.fenced(lease, async (c, r) => {
      const [existing] = await rows(
        c,
        "SELECT doc FROM ae_tools WHERE run_id=? AND call_id=? FOR UPDATE",
        [r.id, record.callId],
      );
      if (existing) {
        const prior = decode<ToolRecord>(existing.doc);
        if (
          hash(prior.arguments) !== hash(record.arguments) ||
          prior.name !== record.name
        )
          throw new EngineError(409, "tool_conflict", "工具调用编号冲突");
        return prior;
      }
      await c.query("INSERT INTO ae_tools VALUES(?,?,?)", [
        r.id,
        record.callId,
        JSON.stringify(record),
      ]);
      await this.emit(c, r.sessionId, r.id, "tool.started", {
        toolCallId: record.callId,
        name: record.name,
        arguments: record.arguments,
      });
      return null;
    });
  }
  async toolComplete(lease: Lease, record: ToolRecord, checkpoint: Checkpoint) {
    return this.fenced(lease, async (c, r) => {
      await c.query("UPDATE ae_tools SET doc=? WHERE run_id=? AND call_id=?", [
        JSON.stringify({ ...record, status: "completed" }),
        r.id,
        record.callId,
      ]);
      await c.query("UPDATE ae_sessions SET checkpoint=? WHERE id=?", [
        JSON.stringify(checkpoint),
        r.sessionId,
      ]);
      await this.emit(c, r.sessionId, r.id, "tool.completed", {
        toolCallId: record.callId,
        name: record.name,
        result: record.result,
      });
    });
  }
  async addArtifact(
    p: Principal,
    artifact: Artifact,
    key: string,
    lease?: Lease,
  ): Promise<Artifact> {
    const action = (c: PoolConnection) =>
      this.once(
        c,
        `artifact:${p.tenantId}:${p.ownerId}`,
        key,
        {
          name: artifact.name,
          sha256: artifact.sha256,
          projectId: artifact.projectId,
          sessionId: artifact.sessionId,
          mediaType: artifact.mediaType,
          source: artifact.source,
          target: artifact.version > 1 ? {id:artifact.id, version:artifact.version} : undefined,
        },
        async () => {
          if (artifact.version > 1) {
            const prior = await rows(c, 'SELECT doc,version FROM ae_artifacts WHERE id=? AND tenant_id=? AND owner_id=? ORDER BY version DESC LIMIT 1 FOR UPDATE', [artifact.id,p.tenantId,p.ownerId]);
            if (!prior[0] || decode<Artifact>(prior[0].doc).projectId !== artifact.projectId) throw new EngineError(404, 'not_found', '原产物不存在');
            if (Number(prior[0].version) !== artifact.version-1) throw new EngineError(409, 'artifact_version_conflict', '产物版本已更新，请重新读取');
          }
          await c.query("INSERT INTO ae_artifacts VALUES(?,?,?,?,?,?,?)", [
            artifact.id,
            artifact.version,
            p.tenantId,
            p.ownerId,
            artifact.projectId,
            artifact.runId,
            JSON.stringify(artifact),
          ]);
          if (artifact.sessionId)
            await this.emit(
              c,
              artifact.sessionId,
              artifact.runId,
              "artifact.created",
              { artifact },
            );
          return artifact;
        },
      );
    return lease ? this.fenced(lease, (c) => action(c)) : this.tx(action);
  }
  async artifacts(p: Principal, projectId: string) {
    return (
      await rows(
        this.pool,
        "SELECT a.doc FROM ae_artifacts a WHERE tenant_id=? AND owner_id=? AND project_id=? AND NOT EXISTS(SELECT 1 FROM ae_artifacts b WHERE b.id=a.id AND b.version>a.version) ORDER BY a.id",
        [p.tenantId, p.ownerId, projectId],
      )
    ).map((r) => decode<Artifact>(r.doc));
  }
  async artifact(p: Principal, artifactId: string, version?: number) {
    const [r] = await rows(
      this.pool,
      `SELECT doc FROM ae_artifacts WHERE id=? AND tenant_id=? AND owner_id=?${version ? " AND version=?" : ""} ORDER BY version DESC LIMIT 1`,
      [artifactId, p.tenantId, p.ownerId, ...(version ? [version] : [])],
    );
    if (!r) throw new EngineError(404, "not_found", "文件不存在");
    const a = decode<Artifact>(r.doc);
    if (!p.projects.includes("*") && !p.projects.includes(a.projectId))
      throw new EngineError(404, "not_found", "文件不存在");
    return a;
  }
  async artifactVersions(p: Principal, artifactId: string) {
    await this.artifact(p,artifactId);
    return (await rows(this.pool,'SELECT doc FROM ae_artifacts WHERE id=? AND tenant_id=? AND owner_id=? ORDER BY version DESC',[artifactId,p.tenantId,p.ownerId])).map(r=>decode<Artifact>(r.doc));
  }
  async command(
    p: Principal,
    runId: string,
    body: { type: string; content?: string },
    key: string,
  ) {
    return this.tx((c) =>
      this.once(c, `command:${runId}`, key, body, async () => {
        const run = await this.run(runId, c);
        if (run.tenantId !== p.tenantId || run.ownerId !== p.ownerId)
          throw new EngineError(404, "not_found", "执行不存在");
        const command = { id: id(), ...body };
        if (body.type === "cancel") {
          const targets = [run, ...(await this.children(runId))];
          for (const target of targets) {
            if (terminal.has(target.status)) continue;
            await c.query(
              "UPDATE ae_runs SET status='cancelled',lease_until=NULL WHERE id=?",
              [target.id],
            );
            await this.emit(
              c,
              target.sessionId,
              target.id,
              "run.cancelled",
              {},
            );
          }
        } else if (body.type === "resume") {
          if (!["interrupted", "waiting_input"].includes(run.status))
            throw new EngineError(409, "invalid_state", "当前执行不能恢复");
          const alive =
            run.leaseUntil !== null && run.leaseUntil > (await databaseTime(c));
          await c.query(
            "UPDATE ae_runs SET status=?,lease_until=? WHERE id=?",
            [
              alive ? "waiting_input" : "recovering",
              alive ? run.leaseUntil : null,
              runId,
            ],
          );
          await this.emit(c, run.sessionId, run.id, "run.recovering", {
            reason: "user_resume",
          });
        } else if (terminal.has(run.status))
          throw new EngineError(409, "invalid_state", "执行已经结束");
        if ((body.type === "steer" || body.type === "resume") && body.content)
          await this.emit(c, run.sessionId, run.id, "message.created", {
            messageId: command.id,
            role: "user",
            content: body.content,
            steering: true,
          });
        await c.query("INSERT INTO ae_commands(id,run_id,doc) VALUES(?,?,?)", [
          command.id,
          runId,
          JSON.stringify(command),
        ]);
        return command;
      }),
    );
  }
  async commands(lease: Lease) {
    return this.fenced(lease, async (c) =>
      (
        await rows(
          c,
          "SELECT doc FROM ae_commands WHERE run_id=? AND consumed=FALSE ORDER BY created_at",
          [lease.id],
        )
      ).map((r) =>
        decode<{ id: string; type: string; content?: string }>(r.doc),
      ),
    );
  }
  async consumeCommand(lease: Lease, commandId: string) {
    return this.fenced(lease, async (c) => {
      await c.query(
        "UPDATE ae_commands SET consumed=TRUE WHERE id=? AND run_id=?",
        [commandId, lease.id],
      );
    });
  }
  async saveBundle(
    p: Principal,
    bundle: { id: string; version: string; [k: string]: unknown },
    key: string,
  ) {
    return this.tx((c) =>
      this.once(
        c,
        `bundle:${p.tenantId}:${p.ownerId}`,
        key,
        bundle,
        async () => {
          const [old] = await rows(
            c,
            "SELECT doc FROM ae_bundles WHERE id=? AND version=?",
            [bundle.id, bundle.version],
          );
          if (old)
            throw new EngineError(409, "immutable_version", "发布版本不可覆盖");
          await c.query("INSERT INTO ae_bundles VALUES(?,?,?,?,?)", [
            bundle.id,
            bundle.version,
            p.tenantId,
            p.ownerId,
            JSON.stringify(bundle),
          ]);
          return bundle;
        },
      ),
    );
  }
  async bundle(p: Principal, bundleId: string, version: string) {
    const [r] = await rows(
      this.pool,
      "SELECT doc FROM ae_bundles WHERE id=? AND version=? AND tenant_id=? AND owner_id=?",
      [bundleId, version, p.tenantId, p.ownerId],
    );
    if (!r) throw new EngineError(404, "not_found", "运行资源包不存在");
    return decode<Record<string, unknown>>(r.doc);
  }
  async grant(
    p: Principal,
    body: {
      sourceSessionId: string;
      targetSessionId: string;
      beforeSequence: number;
    },
    key: string,
  ) {
    await this.ownedSession(p, body.sourceSessionId);
    await this.ownedSession(p, body.targetSessionId);
    return this.tx((c) =>
      this.once(c, `grant:${p.tenantId}:${p.ownerId}`, key, body, async () => {
        const g = { id: id(), ...body };
        await c.query(
          "INSERT INTO ae_grants(id,tenant_id,owner_id,source_session,target_session,doc) VALUES(?,?,?,?,?,?)",
          [
            g.id,
            p.tenantId,
            p.ownerId,
            g.sourceSessionId,
            g.targetSessionId,
            JSON.stringify(g),
          ],
        );
        return g;
      }),
    );
  }
  async grantedHistory(p: Principal, grantId: string, targetSession: string) {
    return (await this.grantedHistoryPage(p,grantId,targetSession)).items;
  }
  async grantedHistoryPage(p: Principal, grantId: string, targetSession: string, after=0) {
    const [r] = await rows(
      this.pool,
      "SELECT doc FROM ae_grants WHERE id=? AND tenant_id=? AND owner_id=? AND target_session=? AND revoked=FALSE",
      [grantId, p.tenantId, p.ownerId, targetSession],
    );
    if (!r)
      throw new EngineError(403, "grant_revoked", "会话未授权或授权已撤销");
    const g = decode<{ sourceSessionId: string; beforeSequence: number }>(
      r.doc,
    );
    const events=(await this.events(g.sourceSessionId, after, 1000)).filter(e=>e.sequence<=g.beforeSequence);
    const cursor=events.at(-1)?.sequence??after;
    return {items:events.filter(
      (e) => e.sequence <= g.beforeSequence && e.type.startsWith("message."),
    ),cursor,hasMore:events.length===1000&&cursor<g.beforeSequence};
  }
  async listGrants(p:Principal,targetSession:string){
    const result=await rows(this.pool,'SELECT doc,revoked FROM ae_grants WHERE tenant_id=? AND owner_id=? AND target_session=? ORDER BY id LIMIT 100',[p.tenantId,p.ownerId,targetSession]);
    return result.map(row=>({...decode<Record<string,unknown>>(row.doc),revoked:Boolean(row.revoked)}));
  }
  async revokeGrant(p: Principal, grantId: string) {
    await this.pool.query(
      "UPDATE ae_grants SET revoked=TRUE WHERE id=? AND tenant_id=? AND owner_id=?",
      [grantId, p.tenantId, p.ownerId],
    );
    return { revoked: true };
  }
  async requestResult(p:Principal,kind:'run'|'command'|'artifact',objectId:string,key:string){
    let scope:string;
    if(kind==='run'){await this.ownedSession(p,objectId);scope=`run:${objectId}`;}
    else if(kind==='command'){const run=await this.run(objectId);await this.ownedSession(p,run.sessionId);scope=`command:${objectId}`;}
    else scope=`artifact:${p.tenantId}:${p.ownerId}`;
    const [row]=await rows(this.pool,'SELECT result FROM ae_requests WHERE scope=? AND request_key=?',[scope,key]);
    if(!row)return {found:false};
    const result=decode<any>(row.result);
    if(kind==='artifact')await this.artifact(p,result.id,result.version);
    return {found:true,result};
  }
  async publishOutbox(
    publish: (topic: string, payload: string) => Promise<void>,
  ) {
    const records = await rows(
      this.pool,
      "SELECT * FROM ae_outbox WHERE published_at IS NULL ORDER BY id LIMIT 100",
    );
    for (const r of records) {
      await publish(r.topic, JSON.stringify(decode(r.payload)));
      await this.pool.query("UPDATE ae_outbox SET published_at=? WHERE id=?", [
        Date.now(),
        r.id,
      ]);
    }
  }
  async metric(name: string, value = 1) {
    if (!/^[a-z_]+$/.test(name) || !Number.isFinite(value)) return;
    await this.pool.query(
      "INSERT INTO ae_metrics(name,value,samples) VALUES(?,?,1) ON DUPLICATE KEY UPDATE value=value+VALUES(value),samples=samples+1",
      [name, value],
    );
  }
  async metrics() {
    const data = await rows(this.pool, "SELECT * FROM ae_metrics");
    const states = await rows(
      this.pool,
      "SELECT status,COUNT(*) AS count FROM ae_runs GROUP BY status",
    );
    return (
      [
        ...data.flatMap((r) => [
          `nebu_agent_${r.name}_sum ${r.value}`,
          `nebu_agent_${r.name}_count ${r.samples}`,
        ]),
        ...states.map(
          (r) => `nebu_agent_runs{status="${r.status}"} ${r.count}`,
        ),
      ].join("\n") + "\n"
    );
  }
}
