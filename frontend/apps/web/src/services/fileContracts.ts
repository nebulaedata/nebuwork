import type { ApiResponse } from './contracts';
import type { AgentArtifact } from './agentContracts';

export type FileSource =
  | { kind: 'artifact'; projectId: string; artifactId: string; version: number }
  | { kind: 'knowledge'; scopeKind: string; connectionId?: string; collectionId?: string; documentId: string; sourceRefId?: string; fileVersionId?: string; parseVersionId?: string; referenceId?: string; scopeId?: string }
  | { kind: 'evidence'; taskId: string; evidenceId: string };
export type PreviewState = 'queued' | 'reading' | 'converting' | 'ready' | 'failed' | 'cancelled' | 'expired';
export interface PreviewSheet { id: string; name: string; rowCount: number; columnCount: number }
export interface FilePreviewJob { id: string; status: PreviewState; stage?: string; error?: string; expiresAt: number; metadata: Record<string, unknown>; manifest: {kind: 'native' | 'download-only' | 'pdf' | 'indexed-pdf' | 'table' | ''; pageCount?: number; slideMappingExact?: boolean; sheets?: PreviewSheet[]} }
export interface FileUploadSession { id: string; status: 'uploading' | 'sealing' | 'publishing' | 'complete' | 'failed' | 'cancelled' | 'expired'; name: string; size: number; partSize: number; expiresAt: number; parts: Array<{number: number; size: number; sha256: string}>; result?: AgentArtifact; error?: string }
export interface FileUploadOptions { signal?: AbortSignal; onProgress?: (progress: {id: string; state: string; size: number; confirmed: number}) => void; onRetryComplete?: (artifact: AgentArtifact) => void }
export interface FilesApi {
  createFilePreview(source: FileSource, indexText?: boolean, signal?: AbortSignal): Promise<ApiResponse<FilePreviewJob>>;
  createFileDownload(source: FileSource, signal?: AbortSignal): Promise<ApiResponse<FilePreviewJob>>;
  filePreviewStatus(id: string, signal?: AbortSignal): Promise<ApiResponse<FilePreviewJob>>;
  filePreviewAction(id: string, action: 'retry' | 'cancel', signal?: AbortSignal): Promise<ApiResponse<FilePreviewJob>>;
  filePreviewUrl(id: string): string;
  filePreviewDownloadUrl(id: string): string;
  filePreviewRows(id: string, sheet: string, page?: {row?: number; column?: number; limit?: number; columns?: number}, signal?: AbortSignal): Promise<ApiResponse<{sheet: PreviewSheet; row: number; column: number; cells: Array<{row: number; column: number; text: string; length: number}>}>>;
  filePreviewCell(id: string, sheet: string, row: number, column: number, start: number, signal?: AbortSignal): Promise<ApiResponse<{text: string; length: number; start: number}>>;
  filePreviewLocate(id: string, quote: string, signal?: AbortSignal): Promise<ApiResponse<{reason: 'missing' | 'ambiguous' | null; pages: number[]}>>;
  fileUploadStatus(project: string, id: string, signal?: AbortSignal): Promise<ApiResponse<FileUploadSession>>;
  cancelFileUpload(project: string, id: string, signal?: AbortSignal): Promise<ApiResponse<FileUploadSession>>;
  uploadLargeArtifact(project: string, file: File, taskId?: string, key?: string, options?: FileUploadOptions): Promise<ApiResponse<AgentArtifact>>;
}
