import type { KnowledgeReference } from './knowledgeTypes';
export type ProjectStatus = "active" | "paused" | "archived";
export type TaskStatus = "idle" | "queued" | "preparing" | "running" | "waiting_input" | "waiting_children" | "recovering" | "completed" | "failed" | "cancelled" | "interrupted";
export type ExtensionKind = "skill" | "mcp" | "plugin";
export interface TokenUsage {
  totalTokens: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  callCount?: number | null;
  unknownCalls?: number | null;
  pendingCalls?: number | null;
  usageKnown?: boolean;
  unavailable?: boolean;
  cost?: null;
  daily?: Array<TokenUsage & { date: string }>;
}


export interface Workbench {
  id: string;
  name: string;
  icon: string;
  color: string;
  desc: string;
  projectIds: string[];
  stats: { running: number | null; tokenToday: number | string | null };
  taskStats?: TokenUsage & { tasks: number | null; activeRuns: number | null; tokens: number | null };
  revision?: number;
  activeVersionId?: string | null;
  activeVersion?: number | null;
  publishStatus?: 'unpublished' | 'published' | 'draft';
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkbenchConfig {
  bizName: string;
  domain: string;
  bizDef: string;
  kbRefs: string[];
  agentIds: string[];
  tplIds: string[];
  wikiMd?: string;
  applicabilityMd?: string;
  exclusionsMd?: string;
  systemPrompt?: string;
  entities?: OntologyEntity[];
  relations?: OntologyRelation[];
  defaultAgentId?: string | null;
  revision?: number;
}

export interface OntologyEntity { id: string; name: string; description: string }
export interface OntologyRelation extends OntologyEntity { sourceEntityId: string; targetEntityId: string }
export type WorkbenchAgentReference = Pick<AgentProfile, 'id' | 'name' | 'role' | 'initials' | 'color' | 'revision'>;
export type WorkbenchCaseReference = Pick<ExpertTemplate, 'id' | 'name' | 'scene' | 'desc' | 'color'>;
export interface WorkbenchConfiguration {
  workbench: Workbench;
  config: WorkbenchConfig;
  agents: WorkbenchAgentReference[];
  templates: WorkbenchCaseReference[];
  knowledgeBases: KnowledgeReference[];
}
export interface OntologyVersion {
  id: string; version: number; sourceRevision: number; contentHash: string; publishedBy: string; publishedAt: string | null;
  snapshot?: Omit<WorkbenchConfiguration, 'workbench'> & { schemaVersion: number; workbench: Pick<Workbench, 'id' | 'name' | 'desc' | 'icon' | 'color'> };
}
export interface ProjectDetail {
  project: Project;
  workbench: Workbench;
  workbenchVersion: OntologyVersion;
  sessions: unknown[]; files: unknown[]; knowledgeBases: KnowledgeReference[]; databases: unknown[];
  memories: unknown[]; cronJobs: unknown[]; extensions: unknown[]; intel: unknown[]; fileTree: unknown[]; approvals: unknown[];
  usage: TokenUsage & { successRate: number | null; series?: unknown[]; days?: unknown[]; avgPerTask?: number | null };
  capabilities: { execution: boolean; resources: boolean };
}

export interface WorkflowNode {
  id: string;
  t: string;
  d: string;
  x?: number;
  y?: number;
}

export interface WorkflowSopSet {
  workflow?: { id: string; status: 'pending' | 'syncing' | 'ready' | 'failed'; error: string | null } | null;
  id: string;
  revision: number;
  materialRefs: SopMaterial[];
  name: string;
  kind: "workflow";
  desc: string;
  updatedAt: string;
  wf: { source: string; rules: string; input: string; output: string; nodes: WorkflowNode[]; edges?: WorkflowEdge[] };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface ProcessSopSet {
  id: string;
  revision: number;
  materialRefs: SopMaterial[];
  name: string;
  kind: "process";
  desc: string;
  updatedAt: string;
  proc: {
    source?: string; rules?: string; input?: string; output?: string;
    materials: string[];
    specRefs: string[];
    steps: Array<{ id: string; t: string; d: string; sys?: string; rpa?: boolean; x?: number; y?: number }>;
  };
}

export type SopSet = WorkflowSopSet | ProcessSopSet;

export interface SopMaterial {
  id: string;
  name: string;
  status: 'available' | 'missing';
  size: number | null;
}

export interface RuleSet {
  id: string;
  revision: number;
  name: string;
  desc: string;
}

export interface AgentRule {
  id: string;
  ruleSetId: string;
  revision: number;
  name: string;
  scene: string;
  content: string;
  enabled: boolean;
  hits: number;
  updatedAt: string;
}

export interface Project {
  parameters?: Record<string, unknown>;
  id: string;
  name: string;
  workbenchId: string;
  status: ProjectStatus;
  desc: string;
  createdAt: string;
  agentIds: string[];
  stats: TokenUsage & { tasks: number | null; tokens: number | string | null; activeRuns?: number | null };
  revision?: number;
  updatedAt?: string;
  workbenchName?: string;
  ontologyVersionId?: string;
  ontologyVersion?: number;
  agents?: WorkbenchAgentReference[];
  capabilities?: { execution: boolean; resources: boolean };
  runtime?: { engine: string; state: string };
}

export interface AgentProfile {
  id: string;
  revision?: number;
  sourceMarketId?: string | null;
  membershipRevision?: number;
  name: string;
  initials: string;
  color: string;
  role: string;
  model: string;
  modelProviderId?: string | null;
  level: number;
  xp: number;
  tagline: string;
  sop: string[];
  kbIds: string[];
  plugins: string[];
  stats: TokenUsage & { tasks: number | null; successRate: number | null; tokens: number | string | null };
}

export interface ExpertExtension {
  id: string; name: string; kind: ExtensionKind; desc: string; version: string; color: string;
  installs: number; bindings: number;
}
export interface ExpertTemplate {
  id: string; name: string; scene: string; desc: string; color: string;
  uses: number; agents: number; bindings: number;
}
export interface ExpertDetail {
  agent: AgentProfile;
  sopSets: SopSet[];
  ruleSets: RuleSet[];
  rules: AgentRule[];
  extensions: ExpertExtension[];
  runtimeExtensionCount?: number;
  templates: ExpertTemplate[];
  knowledgeBases: KnowledgeReference[];
  tasks: unknown[];
  growth: unknown[];
  taskTotal?: number | null;
  offset?: number;
  hasMore?: boolean;
  usage: TokenUsage & { successRate: number | null; daily: Array<TokenUsage & { date: string; tokens: number | null }>; taskStates?: Array<{ status: string }>; executionAvailable: boolean };
}

export interface TaskSession {
  id: string;
  projectId: string;
  agentId?: string;
  agentIds?: string[];
  kind: "normal" | "cron";
  title: string;
  status: TaskStatus;
  updatedAt: string;
  tokens: string;
  msgCount: number;
  providerId?: string;
  revision?: number;
  currentRun?: Record<string, unknown> | null;
}

export interface Message {
  incomplete?: boolean;
  streaming?: boolean;
  feedback?: { value: "up" | "down" | "none" };
  id: string;
  role: "user" | "agent" | "assistant" | "tool" | "system";
  type: "text" | "steps";
  time: string;
  content: string;
  steps?: Array<{ icon: string; title: string; detail: string; status: string; duration: string }>;
  attachments?: Array<{ id: string; name: string }>;
  runId?: string | null;
  sequence?: number;
  createdAt?: string;
  name?: string | null;
  toolCallId?: string | null;
}

export interface AgentRunEvent {
  id: string;
  type: string;
  run_id: string;
  thread_id: string;
  sequence: number;
  created_at: string;
  data: Record<string, unknown>;
}

export interface TaskFile {
  id: string;
  taskId: string;
  name: string;
  filename: string;
  type: string;
  mediaType: string;
  size: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  roles: Array<"input" | "output">;
  runIds: string[];
}

export interface TaskContextItem {
  id: string;
  type: "kb" | "doc" | "file" | "web" | "db" | "knowledge";
  evidence?: Record<string, unknown>;
  name: string;
  meta: string;
  sourceId: string | null;
  runId: string | null;
  url: string | null;
}

export interface TaskBrowserEntry {
  id: string;
  runId: string | null;
  url: string;
  title: string;
  preview: string;
  source: string;
  visitedAt: string;
}

export interface MockDatabase {
  workbenches: Workbench[];
  wbConfigs: Record<string, WorkbenchConfig | WorkbenchConfiguration>;
  projects: Project[];
  agents: AgentProfile[];
  sopSets: Record<string, SopSet[]>;
  ruleSets: Record<string, RuleSet[]>;
  agentRules: Record<string, AgentRule[]>;
  sessions: TaskSession[];
  messages: Record<string, Message[]>;
  [collection: string]: unknown;
}
