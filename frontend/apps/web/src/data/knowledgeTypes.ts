export type KnowledgeScopeKind = 'expert' | 'workbench' | 'project';
export interface KnowledgeMcpDriver { id: string; name: string; transport: 'streamable_http' | 'rest'; capabilities: string[]; knowledgeBaseTypes?: Array<'document' | 'faq' | 'wiki'> }
export interface KnowledgeMcpConnection {
  id: string; scopeKind: 'system' | 'user' | KnowledgeScopeKind; scopeId: string; name: string; driver: string; driverName?: string; endpoint?: string;
  authType?: 'none' | 'bearer' | 'header'; authHeader?: string; hasSecret?: boolean;
  capabilities?: string[]; canEdit?: boolean; published?: boolean; tenantId?: string;
  enabled: boolean; revision?: number; testStatus: 'untested' | 'ready' | 'failed'; testMessage?: string; testedAt?: string | null;
}
export interface KnowledgeConnectionInput {
  name: string; driver: string; endpoint: string; authType: KnowledgeMcpConnection['authType']; authHeader: string;
  secret?: string; enabled: boolean; revision?: number;
  published?: boolean; tenantId?: string;
}
export interface KnowledgeCollection {
  id: string; name: string; indexingStatus: string; description?: string;
  documentCount?: number | null; documentCountSource?: 'reported' | 'visible' | null;
  documentCountError?: string; documentCountWarning?: string;
  type?: 'document' | 'faq' | 'wiki'; canManage?: boolean; ownerId?: string;
}
export interface KnowledgeReference {
  id: string; connectionId: string; collectionId: string; name: string; indexingStatus: string;
  scopeKind: KnowledgeScopeKind; scopeId: string; inherited: boolean; sourceVersion?: number; sourceWorkbenchId?: string;
  connectionName?: string; driver?: string; enabled?: boolean; connectionStatus?: string;
}
export interface KnowledgeScopeState {
  kind: KnowledgeScopeKind; id: string; revision: number; knowledgeBases: KnowledgeReference[];
  connections: KnowledgeMcpConnection[]; executionIntegrated: boolean;
}
export interface KnowledgeReadInput { operation: 'documents' | 'document' | 'search' | 'answer' | 'capabilities' | 'chunk' | 'graph' | 'gallery' | 'wiki.folders' | 'wiki.graph' | 'wiki.stats'; chunkId?: string; mode?: string; nodeId?: string; limit?: number; folder_id?: string; parent_id?: string; searchIn?: string[]; sortBy?: string; sortOrder?: 'asc' | 'desc'; isEnabled?: boolean; documentIds?: string[]; attrFilters?: Record<string, string[]>; query?: string; topK?: number; documentId?: string; contentKind?: 'document' | 'faq' | 'wiki'; page?: number; pageSize?: number }
export interface KnowledgeCitation {
  id: string; collectionId: string; collectionName?: string; documentId: string; chunkId?: string; title?: string; page?: number; headingPath?: string[];
  contentKind?: 'document' | 'faq' | 'wiki'; sourceLocators?: unknown[]; evidenceId?: string; evidenceUrl?: string; referenceId?: string; sourceHash?: string; version?: number;
}
export interface KnowledgeSearchResult {
  query: string; partial: boolean; warnings: Array<string | { message?: string }>;
  results: Array<{ text: string; citation: KnowledgeCitation; score?: number; rerankScore?: number }>;
}
export interface KnowledgeUsage { kind: KnowledgeScopeKind | 'publication'; id: string; name: string; version?: number; collectionId?: string; collectionName?: string; inherited?: boolean }
