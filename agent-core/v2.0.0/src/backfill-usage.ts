import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Store } from "./store.js";
import { hash } from "./contracts.js";

const dryRun = process.argv.includes('--dry-run');
const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required; use the engine database connection, never a business database.');
const store = new Store(url);
const statePath = resolve(option('--state') ?? '.ops/usage-backfill-state.json');
let after = option('--after') ?? '';
if (process.argv.includes('--resume')) {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  if (state.database !== hash(url)) throw new Error('Backfill state belongs to another database.');
  after = state.after;
}
async function inventory() {
  try { const [rows] = await store.pool.query("SELECT COUNT(*) AS calls,SUM(measurement_status='known') AS known,SUM(measurement_status<>'known') AS unknown,SUM(total_tokens) AS tokens FROM ae_model_usage"); const [experts] = await store.pool.query("SELECT COUNT(*) AS participations FROM ae_expert_participation"); return {calls:(rows as any[])[0],experts:(experts as any[])[0]}; }
  catch(error) { if ((error as any).code==='ER_NO_SUCH_TABLE') return null; throw error; }
}
const total = { sessions: 0, calls: 0, known: 0, unknown: 0, participations: 0 };
try {
  const before = await inventory();
  // Dry-run reads original session/events only, and does not create tables/state.
  if (!dryRun) await store.usage.migrate();
  for (;;) {
    const report = await store.usage.backfill({ dryRun, after, limit: 50 });
    for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += report[key];
    console.log(JSON.stringify({ dryRun, ...report }));
    if (!report.sessions) break;
    after = report.after;
    if (!dryRun) { await mkdir(dirname(statePath), { recursive: true }); await writeFile(statePath, JSON.stringify({ database: hash(url), after }) + '\n'); }
  }
  console.log(JSON.stringify({ dryRun, scanned: total, after, before, persisted: await inventory() }));
} finally { await store.close(); }
