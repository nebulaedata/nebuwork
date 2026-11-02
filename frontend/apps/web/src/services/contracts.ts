import type { AgentApi } from './agentContracts';
import type { DatabaseApi } from './databaseContracts';
import type { ExtensionMarketApi } from './extensionMarketContracts';
import type { FilesApi } from './fileContracts';
import type { WorkbenchServiceApi } from './workbenchServiceContracts';
import type { AgentProfile, AgentRule, ExpertDetail, RuleSet, SopSet, Message, Project, TaskBrowserEntry, TaskContextItem, TaskFile, TaskSession, Workbench } from "../data/types";
import type { WorkbenchConfig, WorkbenchConfiguration, OntologyVersion, ProjectDetail, ExpertTemplate } from '../data/types';

export interface ApiResponse<T> {
  code: number;
  data: T;
  msg?: string;
}

import type { KnowledgeApi } from './knowledgeContracts';
import type { MemoryApi } from './memoryContracts';
export interface NebuWorkbenchApi extends KnowledgeApi, MemoryApi, AgentApi, DatabaseApi, ExtensionMarketApi, FilesApi, WorkbenchServiceApi {
  workflowRequest<T = unknown>(path: string, method?: string, body?: unknown, options?: { signal?: AbortSignal; key?: string }): Promise<T>;
  workflowArtifactUrl(id: string, artifact: string): string;
  login(username: string, password: string): Promise<ApiResponse<{ authenticated: boolean }>>;
  logout(): Promise<ApiResponse<{ authenticated: boolean }>>;
  fetchWorkbenches(): Promise<ApiResponse<Workbench[]>>;
  fetchCaseTemplates(): Promise<ApiResponse<ExpertTemplate[]>>;
  fetchWorkbenchConfig(id: string): Promise<ApiResponse<WorkbenchConfiguration>>;
  createWorkbench(payload: Pick<Workbench, 'name' | 'desc' | 'icon' | 'color'>, key: string): Promise<ApiResponse<Workbench>>;
  updateWorkbench(id: string, payload: Partial<Pick<Workbench, 'name' | 'desc' | 'icon' | 'color'>> & { revision: number }): Promise<ApiResponse<Workbench>>;
  saveWorkbenchConfig(id: string, payload: Partial<WorkbenchConfig> & { revision: number }): Promise<ApiResponse<WorkbenchConfiguration>>;
  setWorkbenchBinding(id: string, kind: 'agents' | 'tpls', target: string, enabled: boolean, revision: number): Promise<ApiResponse<WorkbenchConfiguration>>;
  publishWorkbench(id: string, revision: number): Promise<ApiResponse<{ workbench: Workbench; version: OntologyVersion }>>;
  deleteWorkbench(id: string, revision: number): Promise<ApiResponse<null>>;
  fetchWorkbenchVersions(id: string): Promise<ApiResponse<OntologyVersion[]>>;
  fetchWorkbenchVersion(id: string, version: string): Promise<ApiResponse<OntologyVersion>>;
  fetchProjects(workbenchId?: string | null): Promise<ApiResponse<Project[]>>;
  fetchProjectDetail(id: string, signal?: AbortSignal): Promise<ApiResponse<ProjectDetail>>;
  fetchAgents(): Promise<ApiResponse<AgentProfile[]>>;
  fetchAgentDetail(id: string, taskOffset?: number): Promise<ApiResponse<ExpertDetail>>;
  fetchExpertCatalogs(): Promise<ApiResponse<Record<string, unknown>>>;
  createSop(agent: string, payload: Pick<SopSet, 'name' | 'kind' | 'desc'>, requestKey?: string): Promise<ApiResponse<SopSet>>;
  createSopWorkflow(agent: string, sop: string, requestKey: string): Promise<ApiResponse<SopSet>>;
  updateSop(agent: string, sop: string, mutate: (draft: SopSet) => void): Promise<ApiResponse<SopSet>>;
  deleteSop(agent: string, sop: string): Promise<ApiResponse<null>>;
  uploadSopMaterial(agent: string, sop: string, file: File): Promise<ApiResponse<SopSet>>;
  removeSopMaterial(agent: string, sop: string, material: string): Promise<ApiResponse<SopSet>>;
  sopMaterialUrl(agent: string, sop: string, material: string): string;
  createRuleSet(agent: string, payload: Pick<RuleSet, 'name' | 'desc'>): Promise<ApiResponse<RuleSet>>;
  saveAgentRule(agent: string, rule: AgentRule | null, payload: Partial<AgentRule>): Promise<ApiResponse<AgentRule>>;
  deleteAgentRule(agent: string, rule: AgentRule): Promise<ApiResponse<null>>;
  setExpertBinding(agent: string, kind: 'extensions' | 'tpls', target: string, enabled: boolean): Promise<ApiResponse<ExpertDetail>>;
  hireExpert(market: string): Promise<ApiResponse<AgentProfile>>;
  removeExpert(agent: string, revision: number, membershipRevision: number): Promise<ApiResponse<{ id: string; sourceMarketId: string | null; removed: boolean; membershipRevision: number }>>;
  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'desc' | 'status'>> & { revision: number }): Promise<ApiResponse<Project>>;
  createProject(payload: Pick<Project, "name" | "workbenchId" | "desc">, key: string): Promise<ApiResponse<Project>>;
  createAgent(payload: Pick<AgentProfile, "name" | "role" | "tagline"> & { modelProviderId: string }): Promise<ApiResponse<AgentProfile>>;
  updateAgent(id: string, payload: Pick<AgentProfile, "name" | "role" | "tagline"> & { revision: number; modelProviderId?: string }, options?: { signal?: AbortSignal }): Promise<ApiResponse<AgentProfile>>;
  completeExpertAbility(payload: Pick<AgentProfile, "name" | "role" | "tagline"> & { modelProviderId: string }, options?: { signal?: AbortSignal }): Promise<ApiResponse<{ tagline: string; modelProviderId: string }>>;
}
