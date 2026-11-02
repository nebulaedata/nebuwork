import type { ApiResponse } from './contracts';
import type { TokenUsage } from '../data/types';
export type RunStatus = 'queued' | 'preparing' | 'running' | 'waiting_input' | 'waiting_children' | 'recovering' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface AgentEvent { schemaVersion: 1; eventId: string; sessionId: string; sequence: number; runId: string | null; invocationId: string | null; type: string; occurredAt: string; payload: Record<string, unknown> }
export interface AgentArtifact { id: string; version: number; projectId: string; sessionId?: string; runId?: string; name: string; size: number; sha256: string; mediaType: string; createdAt: string; source?: Record<string, unknown> }
export interface AgentTask { id: string; projectId: string; sessionId: string; title: string; status: RunStatus | 'idle'; context: Record<string, unknown>; createdAt: string; updatedAt: string; usage?: TokenUsage }
export interface AgentRun { id: string; sessionId: string; status: RunStatus; manifest?: Record<string, unknown>; manifestHash?: string; mcpCatalog?: Record<string,unknown>; mcpStatus?: Record<string,string>; children?: AgentRun[]; error?: unknown; usage?: TokenUsage }
export interface TaskSnapshot { task: AgentTask; session: { id: string }; runs: AgentRun[]; events: AgentEvent[]; cursor: number; hasEarlier: boolean; usage?: TokenUsage }
export interface AgentApi {
  fetchKnowledgeEvidence(task: string, id: string, signal?: AbortSignal): Promise<ApiResponse<Record<string, unknown>>>;
  readKnowledgeEvidence(task: string, id: string, payload: {page?: number}, signal?: AbortSignal): Promise<ApiResponse<Record<string, unknown>>>;
  knowledgeEvidenceContent(task: string, id: string, action: 'preview' | 'media', payload: {download?: boolean}, signal?: AbortSignal): Promise<ApiResponse<Blob>>;
  fetchTask(id: string, signal?: AbortSignal): Promise<ApiResponse<TaskSnapshot>>;
  fetchProjectTasks(project: string, signal?: AbortSignal): Promise<ApiResponse<AgentTask[]>>;
  createTask(project: string, body: { title: string; content?: string; context?: Record<string, unknown> }, key?: string): Promise<ApiResponse<TaskSnapshot>>;
  editTask(id: string, body: { title: string; context?: Record<string, unknown> }): Promise<ApiResponse<TaskSnapshot>>;
  sendTask(id: string, body: { content: string; fileIds?: string[]; fileRefs?: {id:string;version:number}[]; context?: Record<string, unknown>; retryOf?: string }, key?: string): Promise<ApiResponse<AgentRun>>;
  fetchTaskRuns(id:string,signal?:AbortSignal):Promise<ApiResponse<{items:AgentRun[];usage?:TokenUsage}>>;
  fetchAgentRun(id: string, run: string, signal?: AbortSignal): Promise<ApiResponse<AgentRun>>;
  commandRun(id: string, run: string, body: { type: 'steer' | 'follow_up' | 'cancel' | 'resume'; content?: string }, key?: string): Promise<ApiResponse<unknown>>;
  fetchProjectArtifacts(project: string, signal?: AbortSignal): Promise<ApiResponse<{ items: AgentArtifact[] }>>;
  fetchArtifact(project:string,id:string,version:number,signal?:AbortSignal):Promise<ApiResponse<AgentArtifact>>;
  artifactUrl(project: string, file: AgentArtifact): string;
  artifactContent(project: string, file: AgentArtifact, signal?: AbortSignal): Promise<ApiResponse<Blob>>;
}
