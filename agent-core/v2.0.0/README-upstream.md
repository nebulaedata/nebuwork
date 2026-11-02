# NebuAgentCoreNew2

Distributed agent engine built directly on `@earendil-works/pi-coding-agent@1.1.0`.
Node.js 22.19.0+, MySQL 8, Redis, S3-compatible storage and a Linux Docker daemon are required.
The engine has no dependency on the former AgentCore and does not read host pi settings.

实施状态、验证结果和开发环境切换记录见 [docs/delivery.md](docs/delivery.md)。

## Local verification

```powershell
npm ci --ignore-scripts
docker compose -f deploy/compose.test.yml up -d --wait
docker build -t nebu-agent-sandbox:1 -f deploy/sandbox.Dockerfile .
npm run typecheck
npm test
npm run build
```

Tests use isolated ports 43306, 46379 and 49000. They use the real pi SDK, Docker,
MySQL and object storage, with an explicitly scripted HTTP model/context provider.
These tests do not prove quality or compatibility of a production model.

## Deployment

The normal deployment reuses existing MySQL, Redis and S3 services. It does not start
infrastructure containers. Use a dedicated engine database and a dedicated object prefix
inside a shared bucket. Redis Pub/Sub requires its own channel prefix; selecting a
different Redis database number does not isolate Pub/Sub.

Create a private `.env` from `.env.example` and fill in the connection credentials.
Keep `ENGINE_SIGNING_KEY` / `BUSINESS_API_KEY` matched to the platform's Settings →
智能体引擎 connection form. Java stores these settings encrypted in its database,
not in Nacos. Worker deployment environment remains managed by Docker.
Then explicitly create the engine database (never a NebuWork business database), verify
infrastructure, and build the sandbox image on every Worker host:

```powershell
npm ci --ignore-scripts
npm run infra:prepare -- --create-database --verify-write
docker build -t nebu-agent-sandbox:1 -f deploy/sandbox.Dockerfile .
docker compose --env-file .env -f deploy/compose.yml up -d --build
```

On this development machine `.env` is already configured. MySQL uses
`192.168.204.128:3306/nebu_agent_engine`, Redis uses `192.168.204.128:6379` with channel
prefix `nebu-agent-engine`, and S3 uses `http://192.168.204.1:9000`, bucket `mrtoken`,
object prefix `nebu-agent-engine/`. The Java callback remains
`http://host.docker.internal:42020/nwaa`. Credentials stay in ignored `.env`.

Daily start, health checks and logs:

```powershell
docker compose --env-file .env -f deploy/compose.yml up -d
docker compose --env-file .env -f deploy/compose.yml ps
Invoke-RestMethod http://127.0.0.1:42110/health/ready
Invoke-RestMethod http://127.0.0.1:42111/health/ready
docker compose --env-file .env -f deploy/compose.yml logs -f --tail 100 api1 api2 worker
```

After changing engine source use `up -d --build`. To stop the engine use the same command
prefix followed by `stop`; external infrastructure is unaffected. `migrate` is a one-shot
schema initialization service and normally exits with code 0. Previous infrastructure
volumes are retained; ordinary deployment never deletes or resets business data.
The `.ops/dev-cutover/engine.env` file is a historical deployment backup; current startup
uses root `.env`. Tests still use isolated infrastructure from `compose.test.yml`, never
the shared development database or bucket.

The deployment has two API instances (42110/42111) and three Worker replicas.
Configure both APIs on the platform's engine settings page, or use an HTTP load balancer.
Java rotates requests between configured APIs, and preserves the idempotency key on
eligible failover attempts. A persistent SQL cluster ID and object-storage fingerprint
prevent combining unrelated deployments. `/v1/cluster` requires `engine:admin` and
reports Worker presence (10-second heartbeats, offline after 30 seconds).
Java signs short-lived HS256 tokens
with issuer `nebuwork`, audience `nebu-agent-engine`, subject identifying the service,
and tenantId/ownerId/projects/scopes claims. Browsers only call Java.
The Docker socket is available only to trusted Workers; task containers never receive it.
Runtime containers receive no model credentials or engine service credentials.

`GET /v1/openapi` exposes versioned API schemas. `GET /v1/metrics` requires
`engine:metrics` and returns Prometheus metrics. `/health/live` and `/health/ready`
are unauthenticated infrastructure probes. All public writes require Idempotency-Key.

## Persistence and recovery

MySQL owns execution state; Redis notifications are dispensable. Every 500 ms Workers
also scan SQL. Claims are serialized per session with SKIP LOCKED and a fencing token.
Lease decisions use database time. The normal lease is 30 seconds, renewed every 10 seconds.
The session checkpoint stores the native pi header, entries, active leaf and workspace
object hashes. A model request, tool intent, tool result, compaction and final completion
cross a persistence barrier. API events are emitted only after SQL commit.

On restart, committed tool results are reused. Idempotent tools can be reconstructed.
Unknown external writes stop with `tool_outcome_unknown`; cancellation or a new Run is
available, and external adapters can reconcile their stable call ID. No universal
exactly-once guarantee is made for external side effects. Temporary processes are not
restored. Redis outage does not prevent queued SQL work or HTTP event replay.

Resources, workspace files and artifacts are content-addressed S3 objects. Skills retain
their complete directory. Required skills load before the model; optional skills expose
descriptions and a read path. MCP is initialized through pi's official extension; stdio
runs inside the task container. Scoped AGENTS resources are loaded before tools execute.
Each new Run resolves published resources; recovery retains its original Manifest.

Simple queries and status checks return their answer in the conversation; they do not
require a file or artifact. Publish actual file deliverables with `publish_artifact`.
Use `mode: "create"` for a new artifact and omit `artifactId`/`baseVersion`. Use
`mode: "update"` with an existing artifact ID and its current `baseVersion` to append
an immutable version. A missing ID, missing base version, or nonexistent target creates
an independent artifact with a new ID and version 1. An existing target with a stale
base version still returns a version conflict. The upload API uses the same rules;
legacy requests without `mode` remain supported.

## Java callbacks

All callbacks are POST under `/internal/agent/` and use the separate bearer service key:

| Endpoint | Result |
|---|---|
| `context` | Validated RuntimeManifest for the exact account/project/task |
| `credentials` | In-memory apiKey / headers / MCP environment for a declared credentialRef |
| `authorize` | Current access decision, rechecked before each model/tool call |
| `tools/execute` | Workflow / knowledge / memory result with stable callId |
| `tools/reconcile` | completed + result, not_started, or unknown |

Never put a real model key in a Manifest, resource, task, event or callback error.
Production model and business engines must be configured by the existing management UI.

## Database resources

`/v1/capabilities` declares `databaseResources: true`. Java executes JDBC and owns all connection credentials; Workers receive only optional `databaseReferences` and the `database` business-tool capability. Old Manifests default to an empty reference list. Delegation preserves common workbench/project references and the selected expert's own references; sibling experts' databases are excluded. Run-created grants are resolved by Java without rewriting the original Manifest. Tool receipts distinguish queued/running/completed/failed/cancelled/unknown; unknown writes must not be submitted again with a new operation key.

Authenticated `POST /v1/database-objects` and `GET /v1/database-objects/:digest` store/read immutable SQLite snapshots in the existing S3 bucket, bounded to 128 MiB. Object identity derives from tenant/account and SHA-256; callers cannot supply an arbitrary object key. Uploads require a valid SQLite header and matching content digest. Keep Java metadata and these objects together in backups and storage migrations; do not apply task-workspace retention to database objects. Upgrade New2 API/Worker before enabling Java's default-off `nebu.databases.enabled` flag.

`tests/database.test.ts` covers contract/delegation and real test-MySQL/MinIO object isolation. `scripts/database-browser-host.ts` and `scripts/database-agent-acceptance.ts` are isolated acceptance fixtures using a scripted local model, not production hosting or model configuration.


## Token 用量与专家参与（2026-10-16）

消耗只统计 Token，不配置单价、不计算金额。旧 cost 字段返回 null。引擎在每次实际模型请求边界记录 ae_model_usage，并通过 ae_expert_participation 记录主专家开始执行和成功委派的协作专家；可用专家名单不计参与。主执行与专家子执行共同归属根业务任务，任务数去重、调用用量累加，缓存拆分不重复增加 totalTokens。primaryExpertId 随新 Run 的 Manifest 冻结。

受现有 engine:read、账号和项目权限保护的 GET /v1/usage 支持 projectId、taskId、expertId 过滤，返回摘要、项目/专家分组、任务状态及 UTC+8 日用量。GET /v1/experts/{id}/tasks 支持 offset/limit，任务总数和状态分布不受当前页影响。会话和执行详情也提供 usage。无 usage 的实际调用保留未知；真正的零、部分已知和服务不可用分别展示。终态后的计量仅能补记原 Worker 已持久化的调用，不能更改 Run 状态或覆盖已确认用量。

先迁移引擎数据库，再更新 API/Worker，最后更新 Java 和前端。历史回填读取完整事件和能唯一关联的检查点，不运行模型或工具，不改写历史 Manifest。历史主专家仅按冻结 primaryExpertId、明确输入或唯一 expert: 指令来源恢复，缺少依据的归属保持未知。

本地回填：npm run usage:backfill -- --dry-run；确认统计后运行 npm run usage:backfill。可用 --resume 与 --state 指定断点文件，也可用 --after 指定上次完成的会话 ID。生产镜像包含 dist/backfill-usage.js，可通过 docker exec 在 API 容器内运行。dry-run 不创建表、不写断点；正式回填只新增计量/参与记录，稳定来源键保证重复执行不重复累计。报告 scanned 中的 participations 是检查过的参与事件数，实际参与记录数见 persisted.experts.participations。
