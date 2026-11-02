import type { ApiResponse } from './contracts';
export type ExtensionTargetKind = 'expert' | 'workbench' | 'project';
export type ExtensionReference = { installationId: string; required?: boolean };
export type MarketInstallationState = { installationId: string; targetKind: ExtensionTargetKind; targetId: string; versionId: string; version: number; inDraft: boolean; inPublished: boolean };
export type MarketExtension = { id: string; kind: 'skill' | 'mcp'; name: string; description: string; revision: number; listed: boolean; versionId: string | null; version: number | null; installations?: MarketInstallationState[] };
export type MarketOperation = { id: string; state: 'pending' | 'running' | 'succeeded' | 'failed' | 'conflict' | 'unknown'; targetKind: ExtensionTargetKind; targetId: string; copiedFiles: number; extensionId?: string; versionId?: string; extensionName?: string; version?: number; error?: string; result?: { installationId: string; runtimeRevision: number } };
export interface ExtensionMarketApi {
  fetchExtensionMarket(filter?: Record<string, string | number | boolean>, signal?: AbortSignal): Promise<ApiResponse<{ enabled: boolean; canManage: boolean; items: MarketExtension[]; total: number; offset?: number; hasMore?: boolean }>>;
  fetchMarketExtension(id: string, signal?: AbortSignal): Promise<ApiResponse<MarketExtension & { canManage: boolean; authConfigured?: boolean; draft?: Record<string, unknown>; versions: { id: string; version: number; notes: string; payload: Record<string, unknown> }[] }>>;
  fetchMarketTargets(signal?: AbortSignal): Promise<ApiResponse<{ kind: ExtensionTargetKind; id: string; name: string }[]>>;
  createMarketExtension(body: Record<string, unknown>): Promise<ApiResponse<MarketExtension>>;
  saveMarketExtension(id: string, body: Record<string, unknown>): Promise<ApiResponse<MarketExtension>>;
  saveMarketExtensionAuth(id: string, body: Record<string, unknown>): Promise<ApiResponse<MarketExtension>>;
  publishMarketExtension(id: string, revision: number): Promise<ApiResponse<MarketExtension>>;
  listMarketExtension(id: string, revision: number, listed: boolean): Promise<ApiResponse<MarketExtension>>;
  uploadMarketAsset(id: string, file: File, path: string, key: string, revision: number): Promise<ApiResponse<{ id: string; path: string; size: number }>>;
  installMarketExtension(id: string, body: { targetKind: ExtensionTargetKind; targetId: string; versionId: string; runtimeRevision: number }): Promise<ApiResponse<MarketOperation>>;
  fetchMarketOperations(signal?: AbortSignal): Promise<ApiResponse<MarketOperation[]>>;
  fetchMarketOperation(id: string, signal?: AbortSignal): Promise<ApiResponse<MarketOperation>>;
  fetchMarketInstallations(kind: ExtensionTargetKind, id: string, signal?: AbortSignal): Promise<ApiResponse<Record<string, unknown>>>;
  removeMarketInstallation(id: string, body: { targetKind: ExtensionTargetKind; targetId: string; revision: number }): Promise<ApiResponse<Record<string, unknown>>>;
  retryMarketOperation(id: string): Promise<ApiResponse<MarketOperation>>;
}
