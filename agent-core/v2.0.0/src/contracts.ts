import { createUuid } from './uuid.js';
import { z } from "zod";
import { createHash } from "node:crypto";

export const id = () => createUuid();
export const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
export const hash = (value: unknown) =>
  createHash("sha256")
    .update(
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : canonical(value),
    )
    .digest("hex");
export const ID = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export const safePath = (path: string) => {
  const normalized = path.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((p) => !p || p === ".." || p === ".") ||
    /[\x00-\x1f]/.test(normalized)
  )
    throw new EngineError(
      422,
      "invalid_path",
      "文件路径必须是工作区内的相对路径",
    );
  return normalized;
};
export const Resource = z
  .object({
    path: z.string().transform(safePath),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.number().int().nonnegative(),
    objectKey: z.string().min(1),
    mediaType: z.string().default("application/octet-stream"),
  })
  .strict();
export type ResourceFile = z.infer<typeof Resource>;
export const ModelBinding = z
  .object({
    providerId: ID,
    revision: z.union([z.string(), z.number()]),
    protocol: z.literal("openai-compatible"),
    baseUrl: z.string().url(),
    model: z.string().min(1),
    credentialRef: ID,
    contextWindow: z.number().int().positive().default(32768),
    maxTokens: z.number().int().positive().default(8192),
    reasoning: z.boolean().default(false),
    images: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    timeoutMs: z.number().int().positive().default(120000),
  })
  .strict();
export const Instruction = z
  .object({
    source: z.string(),
    path: z.string().default("AGENTS.md").transform(safePath),
    scope: z
      .string()
      .default("")
      .transform((v) => (v ? safePath(v) : v)),
    content: z.string(),
    revision: z.string(),
  })
  .strict();
export const Skill = z
  .object({
    id: ID,
    name: z.string(),
    description: z.string(),
    directory: z.string().transform(safePath),
    required: z.boolean().default(false),
    available: z.boolean().default(true),
    revision: z.string(),
    requiredFiles: z.array(z.string().transform(safePath)).default([]),
  })
  .strict();
export const Mcp = z
  .object({
    id: ID,
    transport: z.enum(["http", "stdio"]),
    url: z.string().url().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
    credentialRef: ID.optional(),
    required: z.boolean().default(false),
    tools: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((s, c) => {
    if (s.transport === "http" ? !s.url || !!s.command : !s.command || !!s.url)
      c.addIssue({ code: "custom", message: "MCP 连接与 transport 不匹配" });
  });
export const BusinessTool = z
  .object({
    name: ID,
    description: z.string(),
    capability: z.enum(["workflow", "knowledge", "memory", "service", "database"]),
    operation: z.string(),
    parameters: z
      .record(z.unknown())
      .default({ type: "object", properties: {} }),
    required: z.boolean().default(false),
    replay: z.enum(["read", "idempotent", "reconcile"]).default("reconcile"),
  })
  .strict();
export const KnowledgeReference = z.object({
  id: ID,
  name: z.string(),
  scopeKind: z.enum(["project", "expert"]),
  scopeId: ID,
}).strict();
export const DatabaseReference = z.object({
  id: ID, name: z.string().max(240), description: z.string().max(2400).default(""),
  type: z.enum(["sqlite", "mysql", "postgresql"]),
  scopeKind: z.enum(["project", "workbench", "expert"]), scopeId: ID,
  configVersion: z.number().int().positive(),
  permissions: z.object({ read: z.boolean(), write: z.boolean(), schema: z.boolean() }).strict(),
}).strict();
export const Expert = z
  .object({
    id: ID,
    name: z.string(),
    instructions: z.string(),
    skillIds: z.array(ID).default([]),
    model: ModelBinding.optional(),
    runtime: z.object({
      instructions:z.array(Instruction).default([]),files:z.array(Resource).default([]),
      skills:z.array(Skill).default([]),mcp:z.array(Mcp).default([]),
      knowledgeRefs:z.array(ID).optional(),
      knowledgeReferences:z.array(KnowledgeReference).optional(),
      databaseReferences:z.array(DatabaseReference).optional(),
      businessTools:z.array(BusinessTool).optional(),
    }).strict().optional(),
  })
  .strict();
export const Manifest = z
  .object({
    schemaVersion: z.literal(1),
    tenantId: ID,
    ownerId: ID,
    projectId: ID,
    workbenchId: ID.optional(),
    taskId: ID,
    primaryExpertId: ID.nullable().optional(),
    service: z.object({operationId: ID,releaseId: ID,outputSchema: z.union([z.record(z.unknown()),z.boolean()])}).strict().optional(),
    platformMcp: z.object({catalogVersion:z.string(),workbenchId:ID,policyRevision:z.number().int(),policy:z.object({enabled:z.boolean(),scope:z.enum(["current_project","selected","account"]),tools:z.array(z.string()),resources:z.array(z.object({kind:z.string(),id:z.string(),connectionId:z.string().optional()}).strict())}).strict()}).strict().optional(),
    resolvedAt: z.string().datetime(),
    bundleVersions: z
      .array(z.object({ id: ID, version: z.string(), hash: z.string() }))
      .default([]),
    instructions: z.array(Instruction).default([]),
    files: z.array(Resource).default([]),
    skills: z.array(Skill).default([]),
    mcp: z.array(Mcp).default([]),
    model: ModelBinding,
    experts: z.array(Expert).default([]),
    businessTools: z.array(BusinessTool).default([]),
    memory: z
      .object({
        status: z.string(),
        facts: z.array(z.unknown()),
        problems: z.array(z.unknown()).default([]),
      })
      .default({ status: "disabled", facts: [], problems: [] }),
    knowledgeRefs: z.array(ID).default([]),
    knowledgeReferences: z.array(KnowledgeReference).default([]),
    databaseReferences: z.array(DatabaseReference).default([]),
    sessionGrants: z.array(ID).default([]),
    image: z.string().default("nebu-agent-sandbox:1"),
    imageDigest: z.string().optional(),
    environment: z.object({cpu:z.literal(2),memoryMiB:z.literal(2048),pids:z.literal(256),workspaceMiB:z.literal(512),maxFileMiB:z.literal(32),node:z.literal('22.19.0'),pi:z.literal('1.1.0')}).default({cpu:2,memoryMiB:2048,pids:256,workspaceMiB:512,maxFileMiB:32,node:'22.19.0',pi:'1.1.0'}),
    permissionProfile: z.literal("full_access").default("full_access"),
    maxExpertConcurrency: z.number().int().min(1).max(16).default(3),
    maxTurns: z.number().int().positive().default(128),
    workspaceRevision: z.number().int().nonnegative().default(0),
    degraded: z.array(z.object({kind:z.string(),resourceId:z.string(),reason:z.string()})).default([]),
  })
  .strict();
export type RuntimeManifest = z.infer<typeof Manifest>;
export type Principal = {
  service: string;
  tenantId: string;
  ownerId: string;
  projects: string[];
  scopes: string[];
};
export type RunStatus =
  | "queued"
  | "preparing"
  | "running"
  | "waiting_input"
  | "waiting_children"
  | "recovering"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export const terminal = new Set<RunStatus>([
  "completed",
  "failed",
  "cancelled",
]);
const transitions: Record<RunStatus, RunStatus[]> = {
  queued: ["preparing", "cancelled"],
  preparing: ["running", "recovering", "failed", "cancelled"],
  running: [
    "waiting_input",
    "waiting_children",
    "recovering",
    "completed",
    "failed",
    "cancelled",
    "interrupted",
  ],
  waiting_input: ["running", "recovering", "failed", "cancelled"],
  waiting_children: [
    "running",
    "recovering",
    "failed",
    "cancelled",
    "interrupted",
  ],
  recovering: ["running", "failed", "cancelled", "interrupted"],
  interrupted: ["recovering", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};
export function assertTransition(from: RunStatus, to: RunStatus) {
  if (from !== to && !transitions[from].includes(to))
    throw new EngineError(
      409,
      "invalid_transition",
      `不允许的执行状态转换：${from} → ${to}`,
    );
}
export type Session = {
  id: string;
  tenantId: string;
  ownerId: string;
  projectId: string;
  taskId: string;
  title: string;
  parentRunId: string | null;
  expertId: string | null;
  cursor: number;
  checkpoint: Checkpoint | null;
  createdAt: string;
  updatedAt: string;
};
export type Run = {
  id: string;
  sessionId: string;
  tenantId: string;
  ownerId: string;
  projectId: string;
  input: RunInput;
  status: RunStatus;
  manifest: RuntimeManifest | null;
  manifestHash: string | null;
  fence: number;
  workerId: string | null;
  leaseUntil: number | null;
  attempt: number;
  parentRunId: string | null;
  mcpCatalog?: Record<string, unknown>;
  mcpStatus?: Record<string, string>;
  error: unknown;
  createdAt: string;
  updatedAt: string;
};
export type RunInput = {
  content: string;
  fileIds: string[];
  fileRefs?: { id: string; version: number }[];
  resolvedFiles?: { id: string; version: number }[];
  context?: Record<string, unknown>;
  retryOf?: string;
};
export type Checkpoint = {
  entries: unknown[];
  leafId: string | null;
  workspace: ResourceFile[];
  sdkVersion: "1.1.0";
  runId: string;
  modelAttempt: number;
  mcpCatalog?: Record<string, unknown>;
};
export type EngineEvent = {
  schemaVersion: 1;
  eventId: string;
  sessionId: string;
  sequence: number;
  runId: string | null;
  invocationId: string | null;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
};
export type Artifact = {
  id: string;
  version: number;
  tenantId: string;
  ownerId: string;
  projectId: string;
  sessionId: string | null;
  runId: string | null;
  name: string;
  mediaType: string;
  size: number;
  sha256: string;
  objectKey: string;
  source: Record<string, unknown>;
  createdAt: string;
};
export class EngineError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const assertScope = (p: Principal, scope: string, project?: string) => {
  if (!p.scopes.includes(scope) && !p.scopes.includes("engine:*"))
    throw new EngineError(403, "forbidden", "服务没有该操作权限");
  if (project && !p.projects.includes(project) && !p.projects.includes("*"))
    throw new EngineError(404, "not_found", "项目不存在");
};
export function validateManifest(input: unknown): RuntimeManifest {
  const m = Manifest.parse(input);
  const paths = new Set<string>();
  for (const f of m.files) {
    const path = f.path.replace(/(^|\/)agent\.md$/i, "$1AGENTS.md");
    if (paths.has(path.toLowerCase()))
      throw new EngineError(422, "resource_conflict", `重复资源：${path}`);
    paths.add(path.toLowerCase());
    f.path = path;
  }
  for(const s of m.skills){
    const missing=['SKILL.md',...s.requiredFiles].filter(path=>!paths.has(`${s.directory}/${path}`.toLowerCase()));
    if(!missing.length)continue;
    if(s.required)throw new EngineError(422,missing.includes('SKILL.md')?'missing_skill':'missing_skill_dependency',`技能 ${s.name} 缺少必需资源 ${missing.join('、')}`);
    s.available=false;
    m.degraded.push({kind:'skill',resourceId:s.id,reason:`缺少资源：${missing.join('、')}`});
  }
  for (const collection of [m.skills, m.mcp, m.experts])
    if (new Set(collection.map((x) => x.id)).size !== collection.length)
      throw new EngineError(422, "duplicate_id", "资源 ID 重复");
  if(new Set(m.knowledgeRefs).size!==m.knowledgeRefs.length||new Set(m.knowledgeReferences.map(r=>r.id)).size!==m.knowledgeReferences.length)
    throw new EngineError(422,"duplicate_id","知识库引用 ID 重复");
  for(const ref of m.knowledgeReferences)if(!m.knowledgeRefs.includes(ref.id)||(ref.scopeKind==="project"&&ref.scopeId!==m.projectId))
    throw new EngineError(422,"knowledge_scope","知识库目录超出本轮授权范围");
  for(const expert of m.experts)for(const ref of expert.runtime?.knowledgeRefs??[]){
    const source=m.knowledgeReferences.find(source=>source.id===ref);
    if(!m.knowledgeRefs.includes(ref)||(source?.scopeKind==="expert"&&source.scopeId!==expert.id))
      throw new EngineError(422,"knowledge_scope","专家知识库超出自身授权范围");
  }
  if(new Set(m.databaseReferences.map(r=>r.id)).size!==m.databaseReferences.length)
    throw new EngineError(422,"duplicate_id","数据库引用 ID 重复");
  for(const ref of m.databaseReferences)if(
    (ref.scopeKind==="project"&&ref.scopeId!==m.projectId)||
    (ref.scopeKind==="expert"&&ref.scopeId!==m.primaryExpertId)||
    (ref.scopeKind==="workbench"&&(!m.workbenchId||ref.scopeId!==m.workbenchId)))
    throw new EngineError(422,"database_scope","数据库目录超出本轮授权范围");
  for(const expert of m.experts)for(const ref of expert.runtime?.databaseReferences??[]){
    const common=m.databaseReferences.find(r=>r.id===ref.id);
    if(ref.scopeKind==="expert"?ref.scopeId!==expert.id:
      !common||JSON.stringify(common)!==JSON.stringify(ref))
      throw new EngineError(422,"database_scope","专家数据库超出自身授权范围");
  }
  for (const expert of m.experts)
    for (const skill of expert.skillIds)
      if (!(expert.runtime?.skills??m.skills).some((s) => s.id === skill))
        throw new EngineError(
          422,
          "missing_skill",
          `专家引用未知技能 ${skill}`,
        );
  for(const expert of m.experts)if(expert.runtime)validateManifest({
    ...m,...expert.runtime,primaryExpertId:expert.id,experts:[],
    databaseReferences:expert.runtime.databaseReferences??m.databaseReferences.filter(r=>r.scopeKind!=="expert"||r.scopeId===expert.id),
    knowledgeReferences:(expert.runtime.knowledgeReferences??m.knowledgeReferences).filter(
      ref=>(expert.runtime?.knowledgeRefs??m.knowledgeRefs).includes(ref.id),
    ),
  });
  return m;
}
