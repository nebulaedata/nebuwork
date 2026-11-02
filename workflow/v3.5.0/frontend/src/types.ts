import type { InputPreset } from './inputPresets';

export type StepSpec = {
  code: string;
  needs?: string[];
  retries?: number;
  retry_delay?: number;
  timeout?: number | null;
};
export type Definition = {
  name: string;
  input_presets?: InputPreset[];
  environment?: { mode: "shared" | "isolated" };
  steps: Record<string, StepSpec>;
  layout?: Record<string, { x: number; y: number }>;
};
export type Workflow = {
  id: string;
  name: string;
  archived: boolean;
  error?: string | null;
  revision: string;
  definition: Definition;
  files: string[];
};
export type Attempt = {
  environment: EnvironmentRecord | null;
  number: number;
  state: string;
  started_at: number;
  finished_at: number | null;
  error: string | null;
  code_hash: string | null;
  dependencies: Record<string, number>;
};
export type Step = {
  name: string;
  state: string;
  attempts: number;
  successful_attempt: number | null;
  history: Attempt[];
};
export type Artifact = {
  id: string;
  name: string;
  scope: string;
  step: string;
  attempt: number;
  kind: string;
  filename: string;
  size: number;
  published: boolean;
  effective: boolean;
  task_id: string;
  created_at: number;
};
export type Task = {
  environment: EnvironmentRecord | null;
  id: string;
  workflow_id: string;
  state: string;
  version: number;
  created_at: number;
  updated_at: number;
  input: unknown;
  definition: Definition;
  steps: Step[];
  artifacts: Artifact[];
};
export type TaskSummary = Pick<
  Task,
  "id" | "workflow_id" | "state" | "version" | "created_at" | "updated_at"
>;
export type Event = {
  id: number;
  kind: string;
  step: string | null;
  attempt: number | null;
  payload: unknown;
  created_at: number;
};
export type Source = { path: string; content: string; revision: string | null };
export type Revision = {
  id: number;
  content: string;
  digest: string;
  created_at: number;
};
export type PythonPackage = { name: string; version: string };
export type EnvironmentInfo = {
  interpreter: string;
  python_version: string;
  packages: PythonPackage[];
  package_count: number;
  observed_at: number;
};
export type EnvironmentRecord = EnvironmentInfo & {
  id: string;
  mode: "shared" | "isolated";
  generation: string | null;
};
export type EnvironmentOperation = {
  id: string;
  kind: "create" | "install" | "rebuild";
  state: string;
  created_at: number;
  finished_at: number | null;
  error: string | null;
  request: {
    packages: string[];
    requirements: boolean;
    requirements_content?: string;
  };
  log: string;
  cursor: number;
  has_more: boolean;
};
export type WorkflowEnvironmentState = {
  mode: "shared" | "isolated";
  workflow_revision: string;
  version: number;
  state: string;
  current: EnvironmentRecord | null;
  error: string | null;
  occupants: { id: string; state: string }[];
  operations: EnvironmentOperation[];
};
export const states: Record<string, string> = {
  ready: "待开始",
  queued: "排队中",
  pending: "待执行",
  running: "运行中",
  succeeded: "已成功",
  failed: "失败",
  blocked: "上游未完成",
  paused: "已暂停",
  pausing: "暂停收尾中",
  cancelling: "取消收尾中",
  cancelled: "已取消",
  interrupted: "已中断",
  waiting_manual: "等待人工处理",
  retry_wait: "等待重试",
  timed_out: "已超时",
};
export const activeStates = ["queued", "running", "pausing", "cancelling"];
