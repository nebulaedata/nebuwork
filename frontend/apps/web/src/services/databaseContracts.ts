import type { ApiResponse } from './contracts';
export type DatabaseKind = 'expert' | 'workbench' | 'project';
export type DatabaseType = 'sqlite' | 'mysql' | 'postgresql';
export interface DatabasePermissions { read: boolean; write: boolean; schema: boolean }
export interface DatabaseConfig { name: string; description?: string; type: DatabaseType; permissions: DatabasePermissions; host?: string; port?: number; database?: string; schema?: string; username?: string; password?: string; tls?: 'verify-full' | 'disabled'; hasPassword?: boolean }
export interface DatabaseResource { id: string; name: string; description: string; type: DatabaseType; scopeKind: DatabaseKind; scopeId: string; revision: number; configVersion: number; dataVersion: number; enabled: boolean; inherited?: boolean; permissions: DatabasePermissions; draft: DatabaseConfig; activeConfig: DatabaseConfig; testStatus?: string; testedAt?: string }
export interface DatabaseReference { id: string; name: string; description: string; type: DatabaseType; scopeKind: DatabaseKind; scopeId: string; configVersion: number; permissions: DatabasePermissions }
export interface DatabaseOperation { id: string; operationId: string; databaseId: string; operation: string; state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'; result?: Record<string, any>; error?: string; errorStatus?: number; cancelRequested?: boolean; createdAt: string; updatedAt: string }
export interface DatabaseSource { projectId: string; artifactId: string; version: number; name?: string }
export interface DatabaseApi {
  fetchDatabaseScope(kind: DatabaseKind, id: string, signal?: AbortSignal): Promise<ApiResponse<{ enabled: boolean; databases: DatabaseResource[] }>>;
  createDatabase(kind: DatabaseKind, id: string, config: DatabaseConfig, signal?: AbortSignal, key?: string): Promise<ApiResponse<DatabaseResource>>;
  fetchDatabase(id: string, signal?: AbortSignal): Promise<ApiResponse<DatabaseResource>>;
  saveDatabase(id: string, body: { revision: number; config: DatabaseConfig; publish: boolean }, signal?: AbortSignal): Promise<ApiResponse<DatabaseResource>>;
  changeDatabase(id: string, action: 'enable' | 'disable' | 'remove', revision: number, signal?: AbortSignal): Promise<ApiResponse<DatabaseResource>>;
  testDatabase(id: string, signal?: AbortSignal): Promise<ApiResponse<{ status: string; message: string; database: DatabaseResource }>>;
  submitDatabaseOperation(id: string, body: { operation: string; arguments: Record<string, unknown>; configVersion?: number; projectId?: string; taskId?: string }, signal?: AbortSignal, key?: string): Promise<ApiResponse<DatabaseOperation>>;
  fetchDatabaseOperation(id: string, operation: string, signal?: AbortSignal): Promise<ApiResponse<DatabaseOperation>>;
  fetchDatabaseOperations(id: string, offset?: number, signal?: AbortSignal): Promise<ApiResponse<{ items: DatabaseOperation[] }>>;
  cancelDatabaseOperation(id: string, operation: string, signal?: AbortSignal): Promise<ApiResponse<DatabaseOperation>>;
  reconcileDatabaseOperation(id: string, operation: string, signal?: AbortSignal): Promise<ApiResponse<DatabaseOperation>>;
  previewDatabaseImport(id: string, body: { source: DatabaseSource; sheet?: string; encoding?: string }, signal?: AbortSignal): Promise<ApiResponse<{ columns: string[]; rows: string[][]; sheets: string[]; rowCount: number; source: DatabaseSource }>>;
  uploadDatabaseImport(id: string, file: File, signal?: AbortSignal, key?: string): Promise<ApiResponse<DatabaseSource>>;
  downloadDatabase(id: string, operation?: string, signal?: AbortSignal): Promise<ApiResponse<Blob>>;
}
