import type { ApiResponse } from './contracts';
export type MemoryKind = 'user' | 'task' | 'project' | 'workbench' | 'expert';
export type MemoryRecallStatus = 'disabled' | 'unsupported' | 'unavailable' | 'partial' | 'empty' | 'ready';
export type MemorySyncState = 'pending' | 'syncing' | 'ready' | 'failed' | 'not_required';
export interface MemoryScope { kind: MemoryKind; scopeId: string; name: string; readOnly: boolean }
export interface MemoryFact { entryId: string; revision: number; kind: MemoryKind; scopeId: string; title: string; text: string; source: Record<string, unknown> }
export interface MemoryEntry {
  id: string; kind: MemoryKind; scopeId: string; title: string; content: string;
  state: 'draft' | 'active' | 'disabled' | 'rejected' | 'deleted';
  revision: number; syncedRevision: number; syncState: MemorySyncState;
  source: Record<string, unknown>; sourceTaskDeleted: boolean; automatic: boolean;
  error: string | null; createdAt: string; updatedAt: string;
}
export interface MemoryRecall {
  status: MemoryRecallStatus; results: MemoryFact[]; problems: { kind?: MemoryKind; scopeId?: string; status: string }[]; retrievedAt: string;
}
export interface MemoryDetail extends MemoryEntry {
  history: { revision: number; actor: string; action: string; createdAt: string; entry: MemoryEntry }[];
  facts: MemoryFact[]; extractionStatus: 'not_ready' | 'unavailable' | 'empty' | 'ready';
}
export interface MemoryApi {
  fetchMemorySettings(signal?: AbortSignal): Promise<ApiResponse<MemorySettingsView>>;
  saveMemorySettings(body: MemorySettingsDraft, requestKey: string, signal?: AbortSignal): Promise<ApiResponse<MemorySettingsView>>;
  testMemorySettings(body: MemorySettingsDraft, signal?: AbortSignal): Promise<ApiResponse<{ reachable: boolean; latencyMs: number; message: string }>>;
  fetchMemoryScope(kind: MemoryKind, id: string, offset?: number, signal?: AbortSignal): Promise<ApiResponse<{ scope: MemoryScope; enabled: boolean; items: MemoryEntry[]; hasMore: boolean; nextOffset: number }>>;
  searchMemory(kind: MemoryKind, id: string, query: string, signal?: AbortSignal): Promise<ApiResponse<MemoryRecall>>;
  fetchMemoryTargets(signal?: AbortSignal): Promise<ApiResponse<MemoryScope[]>>;
  fetchMemoryCleanup(signal?: AbortSignal): Promise<ApiResponse<Pick<MemoryEntry, 'id' | 'title' | 'revision' | 'syncState' | 'error' | 'kind'>[]>>;
  fetchMemory(id: string, signal?: AbortSignal): Promise<ApiResponse<MemoryDetail>>;
  createMemory(kind: MemoryKind, id: string, body: { title: string; content: string }, signal?: AbortSignal): Promise<ApiResponse<MemoryEntry>>;
  updateMemory(id: string, body: { title: string; content: string; revision: number }, signal?: AbortSignal): Promise<ApiResponse<MemoryEntry>>;
  memoryAction(id: string, action: 'approve' | 'reject' | 'disable' | 'delete', revision: number, signal?: AbortSignal): Promise<ApiResponse<MemoryEntry>>;
  promoteMemory(id: string, body: { title: string; content: string; revision: number; kind: Exclude<MemoryKind, 'task'>; scopeId: string }, signal?: AbortSignal): Promise<ApiResponse<MemoryEntry>>;
  retryMemory(id: string, revision: number, signal?: AbortSignal): Promise<ApiResponse<MemoryEntry>>;
  fetchTaskMemoryContext(id: string, signal?: AbortSignal): Promise<ApiResponse<{
    runs: { runId: string; context: MemoryRecall; createdAt: string }[];
    used: { runId: string; entries: { entryId: string; revision: number }[] }[];
    searches: { runId: string; record: { query: string; context: MemoryRecall } }[];
  }>>;
}
export interface MemorySettingsDraft {
  revision: number; enabled: boolean; baseUrl: string; apiKey?: string; clearApiKey?: boolean;
  recallTimeoutMs: number; requestTimeoutMs: number; recallMaxTokens: number;
}
export type MemorySettingsView = {
  actorId: string; configured: boolean; enabled: boolean;
} & ({ canEdit: false } | {
  canEdit: true; revision: number; baseUrl: string; hasApiKey: boolean; originLocked: boolean;
  recallTimeoutMs: number; requestTimeoutMs: number; recallMaxTokens: number;
  updatedBy: string | null; updatedAt: string | null;
});
