import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { EngineError, id, type EngineEvent, type Principal, type Run, type Session } from "./contracts.js";
import type { Store, Lease } from "./store.js";

export type TokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number };
export type UsageSummary = { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; totalTokens: number | null; callCount: number; unknownCalls: number; pendingCalls: number; usageKnown: boolean; cost: null };
const parse = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;
const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function hasReportedUsage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const usage = value as Record<string, unknown>;
  return integer(usage.prompt_tokens) && integer(usage.completion_tokens);
}
export function tokens(value: unknown): TokenUsage | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (![v.input, v.output, v.totalTokens].every(integer)) return null;
  const result = { input: v.input as number, output: v.output as number, cacheRead: v.cacheRead ?? 0, cacheWrite: v.cacheWrite ?? 0, totalTokens: v.totalTokens as number };
  return integer(result.cacheRead) && integer(result.cacheWrite) && result.input + result.output + Number(result.cacheRead) + Number(result.cacheWrite) === result.totalTokens ? result as TokenUsage : null;
}
export const emptyUsage = (): UsageSummary => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, callCount: 0, unknownCalls: 0, pendingCalls: 0, usageKnown: true, cost: null });
function summary(row?: Record<string, unknown>): UsageSummary {
  if (!row || !Number(row.callCount)) return emptyUsage();
  const known = Number(row.knownCalls), out = emptyUsage();
  for (const key of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens"] as const) out[key] = known ? Number(row[key] ?? 0) : null;
  return { ...out, callCount: Number(row.callCount), unknownCalls: Number(row.callCount) - known, pendingCalls: Number(row.pendingCalls), usageKnown: known === Number(row.callCount) };
}
const sums = `COUNT(*) AS callCount,SUM(measurement_status='known') AS knownCalls,SUM(measurement_status='pending') AS pendingCalls,SUM(input_tokens) AS inputTokens,SUM(output_tokens) AS outputTokens,SUM(cache_read_tokens) AS cacheReadTokens,SUM(cache_write_tokens) AS cacheWriteTokens,SUM(total_tokens) AS totalTokens`;
const terminal = new Set(["completed", "failed", "cancelled"]);
export function taskMetrics(tasks: { status: string }[]) {
  const ended = tasks.filter(t => terminal.has(t.status));
  return { tasks: tasks.length, activeRuns: tasks.filter(t => !terminal.has(t.status) && t.status !== "idle").length, successRate: ended.length ? 100 * ended.filter(t => t.status === "completed").length / ended.length : null };
}

/** Durable metering facts live beside the engine events, never in browser caches. */
export class UsageStore {
  constructor(private store: Store) {}
  async migrate() {
    for (const sql of [
      `CREATE TABLE IF NOT EXISTS ae_model_usage(call_id VARCHAR(128) PRIMARY KEY,tenant_id VARCHAR(128) NOT NULL,owner_id VARCHAR(128) NOT NULL,project_id VARCHAR(128) NOT NULL,task_id VARCHAR(128) NOT NULL,session_id VARCHAR(128) NOT NULL,run_id VARCHAR(128) NOT NULL,root_run_id VARCHAR(128) NOT NULL,expert_id VARCHAR(128),provider_id VARCHAR(128) NOT NULL,model VARCHAR(255) NOT NULL,purpose VARCHAR(32) NOT NULL,worker_id VARCHAR(255),fence BIGINT NOT NULL DEFAULT 0,occurred_at DATETIME(3) NOT NULL,measurement_status VARCHAR(16) NOT NULL,input_tokens BIGINT,output_tokens BIGINT,cache_read_tokens BIGINT,cache_write_tokens BIGINT,total_tokens BIGINT,source_event_id VARCHAR(128) UNIQUE,INDEX usage_owner(tenant_id,owner_id,project_id,occurred_at),INDEX usage_task(tenant_id,owner_id,task_id),INDEX usage_expert(tenant_id,owner_id,expert_id,task_id),INDEX usage_run(run_id))`,
      `CREATE TABLE IF NOT EXISTS ae_expert_participation(run_id VARCHAR(128) PRIMARY KEY,tenant_id VARCHAR(128) NOT NULL,owner_id VARCHAR(128) NOT NULL,project_id VARCHAR(128) NOT NULL,task_id VARCHAR(128) NOT NULL,root_run_id VARCHAR(128) NOT NULL,session_id VARCHAR(128) NOT NULL,expert_id VARCHAR(128) NOT NULL,expert_name VARCHAR(255) NOT NULL,role VARCHAR(24) NOT NULL,occurred_at DATETIME(3) NOT NULL,INDEX participation_owner(tenant_id,owner_id,expert_id,task_id),INDEX participation_project(tenant_id,owner_id,project_id))`,
    ]) await this.store.pool.query(sql);
  }
  private async identity(c: PoolConnection, run: Run) {
    const session = await this.store.session(run.sessionId, c);
    const root = run.parentRunId ? await this.store.run(run.parentRunId, c) : run;
    const rootSession = run.parentRunId ? await this.store.session(root.sessionId, c) : session;
    // Historical attribution uses frozen evidence only. The roster is availability, not participation.
    const explicit = run.input.context?.expertId;
    const sources = [...new Set((run.manifest?.instructions ?? []).filter(item => item.source.startsWith('expert:')).map(item => item.source.slice(7)))];
    const expert = session.expertId ?? run.manifest?.primaryExpertId ?? (typeof explicit === "string" && run.manifest?.experts.some(e => e.id === explicit) ? explicit : sources.length === 1 ? sources[0]! : null);
    return { session, root, taskId: rootSession.taskId, expert };
  }
  async participate(c: PoolConnection, run: Run, occurredAt: string) {
    const scope = await this.identity(c, run);
    if (!scope.expert) return;
    const expert = run.manifest?.experts.find(e => e.id === scope.expert);
    await c.query(`INSERT IGNORE INTO ae_expert_participation(run_id,tenant_id,owner_id,project_id,task_id,root_run_id,session_id,expert_id,expert_name,role,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`, [run.id, run.tenantId, run.ownerId, run.projectId, scope.taskId, scope.root.id, run.sessionId, scope.expert, expert?.name ?? scope.session.title, run.parentRunId ? "collaborator" : "primary", new Date(occurredAt)]);
  }
  async event(c: PoolConnection, e: EngineEvent) {
    if (e.type === "run.started" && e.runId) await this.participate(c, await this.store.run(e.runId, c), e.occurredAt);
    if (e.type === "expert.delegated" && typeof e.payload.runId === "string") await this.participate(c, await this.store.run(e.payload.runId, c), e.occurredAt);
  }
  private async insert(c: PoolConnection, run: Run, callId: string, occurredAt: string, purpose: string, sourceEvent: string, binding?: { providerId: string; model: string }) {
    const scope = await this.identity(c, run);
    const model = binding ?? run.manifest?.model;
    await c.query(`INSERT IGNORE INTO ae_model_usage(call_id,tenant_id,owner_id,project_id,task_id,session_id,run_id,root_run_id,expert_id,provider_id,model,purpose,worker_id,fence,occurred_at,measurement_status,source_event_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?)`, [callId, run.tenantId, run.ownerId, run.projectId, scope.taskId, run.sessionId, run.id, scope.root.id, scope.expert, model?.providerId ?? "unknown", model?.model ?? "unknown", purpose, run.workerId, run.fence, new Date(occurredAt), sourceEvent]);
  }
  async start(lease: Lease, callId: string, purpose: string, binding: { providerId: string; model: string }, attempt: number) {
    return this.store.fenced(lease, async (c, run) => {
      const e = await this.store.emit(c, run.sessionId, run.id, "model.started", { callId, purpose, attempt, ...binding });
      await this.insert(c, run, callId, e.occurredAt, purpose, e.eventId, binding);
    });
  }
  private async settle(c: PoolConnection, callId: string, usage: TokenUsage | null) {
    const [result] = await c.query(`UPDATE ae_model_usage SET measurement_status=?,input_tokens=?,output_tokens=?,cache_read_tokens=?,cache_write_tokens=?,total_tokens=? WHERE call_id=? AND measurement_status<>'known'`, [usage ? "known" : "unknown", usage?.input ?? null, usage?.output ?? null, usage?.cacheRead ?? null, usage?.cacheWrite ?? null, usage?.totalTokens ?? null, callId]);
    return (result as { affectedRows: number }).affectedRows > 0;
  }
  async finish(lease: Lease, callId: string, value: unknown) {
    const usage = tokens(value);
    return this.store.tx(async c => {
      const [rows] = await c.query<RowDataPacket[]>("SELECT * FROM ae_model_usage WHERE call_id=? FOR UPDATE", [callId]);
      const row = rows[0];
      // A cancelled/stale Worker may settle ONLY its previously committed request.
      // This cannot create a request, change the run, or overwrite confirmed usage.
      if (!row || row.run_id !== lease.id || row.worker_id !== lease.workerId || Number(row.fence) !== lease.fence) throw new EngineError(409, "usage_identity", "模型调用计量身份不匹配");
      if (row.measurement_status === "known" || (!usage && row.measurement_status === "unknown")) return;
      await this.settle(c, callId, usage);
      await this.store.emit(c, row.session_id, row.run_id, "model.usage", { callId, usageKnown: Boolean(usage), usage });
    });
  }
  private filter(p: Principal, filter: { projectId?: string; taskId?: string; expertId?: string }, alias = "") {
    const a = alias ? alias + "." : "", parts = [`${a}tenant_id=?`, `${a}owner_id=?`], args: unknown[] = [p.tenantId, p.ownerId];
    if (!p.projects.includes("*")) { parts.push(p.projects.length ? `${a}project_id IN (${p.projects.map(() => "?").join(",")})` : "1=0"); args.push(...p.projects); }
    for (const [key, column] of [["projectId", "project_id"], ["taskId", "task_id"], ["expertId", "expert_id"]] as const) if (filter[key]) { parts.push(`${a}${column}=?`); args.push(filter[key]); }
    return { sql: parts.join(" AND "), args };
  }
  async read(p: Principal, filter: { projectId?: string; taskId?: string; expertId?: string } = {}) {
    const f = this.filter(p, filter);
    const query = async (sql: string, args = f.args) => (await this.store.pool.query<RowDataPacket[]>(sql, args))[0];
    const groups = async (column: string) => query(`SELECT ${column} AS id,${sums} FROM ae_model_usage WHERE ${f.sql} GROUP BY ${column}`);
    const [overall, projects, taskUsage, expertUsage, daily, taskRows, participation, projectDaily] = await Promise.all([
      query(`SELECT ${sums} FROM ae_model_usage WHERE ${f.sql}`), groups("project_id"), groups("task_id"), groups("expert_id"),
      query(`SELECT DATE_FORMAT(DATE_ADD(occurred_at,INTERVAL 8 HOUR),'%Y-%m-%d') AS date,${sums} FROM ae_model_usage WHERE ${f.sql} GROUP BY date ORDER BY date`),
      (() => { const s = this.filter(p, { projectId: filter.projectId, taskId: filter.taskId }, "s"); return query(`SELECT s.doc,(SELECT r.status FROM ae_runs r WHERE r.session_id=s.id ORDER BY CASE WHEN r.status IN ('completed','failed','cancelled') THEN 1 ELSE 0 END,r.created_at DESC,r.id DESC LIMIT 1) AS status FROM ae_sessions s WHERE ${s.sql} AND s.parent_run_id IS NULL`, s.args); })(),
      (() => { const s = this.filter(p, filter, "x"); return query(`SELECT x.*,r.status,r.created_at AS run_created_at FROM ae_expert_participation x JOIN ae_runs r ON r.id=x.run_id WHERE ${s.sql} ORDER BY r.created_at,r.id`, s.args); })(),
      query(`SELECT project_id AS projectId,DATE_FORMAT(DATE_ADD(occurred_at,INTERVAL 8 HOUR),'%Y-%m-%d') AS date,${sums} FROM ae_model_usage WHERE ${f.sql} GROUP BY project_id,date ORDER BY date`),
    ]);
    const usageByTask = new Map(taskUsage.map(r => [r.id, summary(r)]));
    const latest = new Map<string, RowDataPacket>();
    for (const row of participation) latest.set(`${row.expert_id}:${row.task_id}`, row);
    let tasks = taskRows.map(row => { const s = parse<Session>(row.doc); return { taskId: s.taskId, sessionId: s.id, projectId: s.projectId, title: s.title, updatedAt: s.updatedAt, status: String(row.status ?? "idle"), ...usageByTask.get(s.taskId) ?? emptyUsage() }; });
    if (filter.expertId) tasks = tasks.filter(t => latest.has(`${filter.expertId}:${t.taskId}`)).map(t => { const row = latest.get(`${filter.expertId}:${t.taskId}`)!; const roles = [...new Set(participation.filter(r => r.task_id === t.taskId).map(r => String(r.role)))]; return { ...t, status: row.status, role: roles.join(","), participatedAt: new Date(row.occurred_at).toISOString(), runId: row.run_id }; });
    const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const withMetrics = (usage: UsageSummary, list: typeof tasks) => ({ ...usage, ...taskMetrics(list) });
    const projectMetrics = projects.map(r => ({ id: r.id, ...withMetrics(summary(r), tasks.filter(t => t.projectId === r.id)) }));
    for (const t of tasks) if (!projectMetrics.some(r => r.id === t.projectId)) projectMetrics.push({ id: t.projectId, ...withMetrics(emptyUsage(), tasks.filter(x => x.projectId === t.projectId)) });
    const experts = [...new Set(participation.map(r => String(r.expert_id)))].map(expertId => ({ id: expertId, ...withMetrics(summary(expertUsage.find(r => r.id === expertId)), [...latest.values()].filter(r => r.expert_id === expertId).map(r => ({ status: String(r.status) })) as typeof tasks) }));
    return { summary: withMetrics(summary(overall[0]), tasks), projects: projectMetrics, experts, tasks: tasks.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), daily: daily.map(r => ({ date: r.date as string, tokens: summary(r).totalTokens, ...summary(r) })), projectDaily: projectDaily.map(r => ({ projectId: r.projectId as string, date: r.date as string, tokens: summary(r).totalTokens, ...summary(r) })), tokenToday: summary(daily.find(r => r.date === today)).totalTokens };
  }
  async expertTasks(p: Principal, expertId: string, offset = 0, limit = 50) {
    const data = await this.read(p, { expertId });
    return { ...data, taskStates: data.tasks.map(task => ({ status: task.status })), tasks: data.tasks.slice(offset, offset + limit), taskTotal: data.tasks.length, offset, limit, hasMore: offset + limit < data.tasks.length };
  }
  async runUsage(p: Principal, runId: string, includeChildren = true) {
    const f = this.filter(p, {});
    const [rows] = await this.store.pool.query<RowDataPacket[]>(`SELECT ${sums} FROM ae_model_usage WHERE ${f.sql} AND ${includeChildren ? "root_run_id" : "run_id"}=?`, [...f.args, runId]);
    return summary(rows[0]);
  }

  /** Entire event history, paged by sequence. No model, tool, or business writes. */
  async backfill(options: { dryRun: boolean; after?: string; limit?: number }) {
    const [sessions] = await this.store.pool.query<RowDataPacket[]>("SELECT id,checkpoint FROM ae_sessions WHERE id>? ORDER BY id LIMIT ?", [options.after ?? "", options.limit ?? 100]);
    const report = { sessions: 0, calls: 0, known: 0, unknown: 0, participations: 0, after: options.after ?? "" };
    for (const session of sessions) {
      const pending = new Map<string, { callId: string; event: EngineEvent }>();
      const runs = new Map<string, Run>();
      const run = async (runId: string) => { if (!runs.has(runId)) runs.set(runId, await this.store.run(runId)); return runs.get(runId)!; };
      let cursor = 0;
      const checkpoint = session.checkpoint ? parse<{ runId?: string; entries?: { message?: Record<string, any> }[] }>(session.checkpoint) : null;
      const finishLegacy = async (call: { callId: string; event: EngineEvent }, before = Date.now()) => {
        const r = await run(call.event.runId!);
        // A durable SDK reply with no completed event is usable only when both its
        // frozen run and its request interval identify exactly this call.
        const candidates = checkpoint?.runId === r.id ? (checkpoint.entries ?? []).map(x => x.message).filter(m => m?.role === 'assistant' && m.model === r.manifest?.model.model && Number(m.timestamp) >= Date.parse(call.event.occurredAt) && Number(m.timestamp) < before && (tokens(m.usage)?.totalTokens ?? 0) > 0) : [];
        const usage = candidates.length === 1 ? tokens(candidates[0]!.usage) : null;
        if (usage) report.known++; else report.unknown++;
        if (!options.dryRun) await this.store.tx(c => this.settle(c, call.callId, usage));
      };
      for (;;) {
        const events = await this.store.events(session.id, cursor, 1000);
        if (!events.length) break;
        for (const e of events) {
          cursor = e.sequence;
          if (!e.runId) continue;
          const r = await run(e.runId);
          if (e.type === "run.started" || e.type === "expert.delegated") {
            report.participations++;
            if (!options.dryRun) await this.store.tx(c => this.event(c, e));
          }
          if (e.type === "model.started") {
            const previous = pending.get(e.runId);
            if (previous && !previous.event.payload.callId) await finishLegacy(previous, Date.parse(e.occurredAt));
            const callId = typeof e.payload.callId === "string" ? e.payload.callId : `legacy:${e.eventId}`;
            pending.set(e.runId, { callId, event: e }); report.calls++;
            if (!options.dryRun) await this.store.tx(c => this.insert(c, r, callId, e.occurredAt, String(e.payload.purpose ?? "legacy"), e.eventId));
          }
          if (e.type !== "message.completed" || e.payload.role !== "assistant") continue;
          const call = pending.get(e.runId);
          // New calls are settled by model.usage, never by a replayed UI message.
          if (call?.event.payload.callId || e.payload.metered) { pending.delete(e.runId); continue; }
          let usage = e.payload.usageKnown === true ? tokens(e.payload.usage) : null;
          if (!usage && call) {
            const matches = (checkpoint?.entries ?? []).map(x => x.message).filter(m => m?.role === "assistant" && m.model === r.manifest?.model.model && Number(m.timestamp) >= Date.parse(call.event.occurredAt) - 2000 && Number(m.timestamp) <= Date.parse(e.occurredAt) && (m.content as any[] | undefined)?.filter(x => x.type === "text").map(x => x.text).join("") === e.payload.content);
            if (matches.length === 1 && tokens(matches[0]?.usage)?.totalTokens) usage = tokens(matches[0]!.usage);
          }
          const callId = call?.callId ?? `legacy:${e.eventId}`;
          if (!call) report.calls++;
          if (usage) report.known++; else report.unknown++;
          if (!options.dryRun) await this.store.tx(async c => {
            if (!call) await this.insert(c, r, callId, e.occurredAt, "legacy", e.eventId);
            await this.settle(c, callId, usage);
          });
          pending.delete(e.runId);
        }
      }
      for (const call of pending.values()) if (!call.event.payload.callId) {
        await finishLegacy(call);
      }
      report.sessions++; report.after = session.id;
    }
    return report;
  }
}
