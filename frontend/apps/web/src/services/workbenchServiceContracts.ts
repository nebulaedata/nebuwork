import type { ApiResponse } from './contracts';
export interface HtmlResourceReference { path: string; artifactId: string; version: number }
export interface ServicePage { key: string; name: string; assetId: string; capabilities: string[]; projectIds?: string[]; refreshSeconds?: number }
export interface ServiceAsset { id: string; html?: string; sha256: string; size: number; source: Record<string, unknown> }
export type ServiceAssetInput = { html: string } | { projectId: string; artifactId: string; version: number; entryPath?: string; resources?: HtmlResourceReference[] };
export interface WorkbenchServiceApi {
  createServiceAsset(workbenchId: string, body: ServiceAssetInput, signal?: AbortSignal): Promise<ApiResponse<ServiceAsset>>;
  fetchServiceAsset(workbenchId: string, id: string, signal?: AbortSignal): Promise<ApiResponse<ServiceAsset>>;
  serviceUrl(workbenchId: string, suffix?: string): string;
}
