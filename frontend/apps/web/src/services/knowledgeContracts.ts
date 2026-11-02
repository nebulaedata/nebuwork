import type { ApiResponse } from './contracts';
import type { KnowledgeMcpDriver, KnowledgeMcpConnection, KnowledgeCollection, KnowledgeConnectionInput, KnowledgeScopeKind, KnowledgeScopeState, KnowledgeReadInput, KnowledgeUsage } from '../data/knowledgeTypes';
type Response<T> = Promise<ApiResponse<T>>;
export interface KnowledgeApi {
  knowledgeV101Url(connectionId: string, path?: string): string;
  knowledgeCatalogContent(connectionId: string, collectionId: string, action: 'preview' | 'media', payload: Record<string, unknown>, signal?: AbortSignal): Response<Blob>;
  knowledgeReferenceContent(kind: KnowledgeScopeKind, id: string, reference: string, action: 'preview' | 'media', payload: Record<string, unknown>, signal?: AbortSignal): Response<Blob>;
  fetchKnowledgeCreationTemplates(connectionId?: string, signal?: AbortSignal): Response<KnowledgeCreationTemplate[]>;
  fetchKnowledgeCreationResources(id: string, signal?: AbortSignal): Response<any>;
  saveKnowledgeCreationTemplate(connectionId: string, id: string | undefined, payload: Record<string, unknown>, signal?: AbortSignal): Response<KnowledgeCreationTemplate>;
  validateKnowledgeCreationTemplate(id: string, config: Record<string, unknown>, signal?: AbortSignal): Response<{ valid: boolean }>;
  createKnowledgeJob(payload: Record<string, unknown>, signal?: AbortSignal): Response<KnowledgeCreationJob>;
  fetchKnowledgeCreationJobs(signal?: AbortSignal): Response<KnowledgeCreationJob[]>;
  fetchKnowledgeCreationJob(id: string, signal?: AbortSignal): Response<KnowledgeCreationJob>;
  confirmKnowledgeCreationJob(id: string, business: Record<string, unknown>, signal?: AbortSignal): Response<KnowledgeCreationJob>;
  retryKnowledgeCreationJob(id: string, recover: boolean, signal?: AbortSignal): Response<KnowledgeCreationJob>;
  fetchKnowledgeSettings(signal?: AbortSignal): Response<{ canEdit: boolean; actorId: string }>;
  discoverKnowledgeCollections(id: string, signal?: AbortSignal): Response<{ collections: KnowledgeCollection[] }>;
  assignKnowledgeCollection(id: string, payload: { collectionId: string; ownerId: string }, signal?: AbortSignal): Response<{ assigned: boolean }>;
  manageKnowledge(id: string, payload: Record<string, unknown>, signal?: AbortSignal): Response<{ result: any; operationId?: string }>;
  fetchKnowledgeOperations(signal?: AbortSignal): Response<any[]>;
  recoverKnowledgeOperation(id: string, signal?: AbortSignal): Response<{ result: any; operationId: string }>;
  fetchKnowledgeProgress(id: string, signal?: AbortSignal): Response<any>;
  downloadKnowledgeErrors(id: string, signal?: AbortSignal): Response<Blob>;
  /** FormData: file, fileName, collectionId, requestKey and optional relativePath. */
  uploadKnowledgeFile(id: string, form: FormData, signal?: AbortSignal): Response<{ result: any; operationId: string; outcome?: 'accepted' | 'duplicate' }>;
  downloadKnowledgeFile(id: string, payload: Record<string, unknown>, signal?: AbortSignal): Response<Blob>;
  fetchKnowledgeDrivers(signal?: AbortSignal): Response<KnowledgeMcpDriver[]>;
  fetchKnowledgeTargets(kind: KnowledgeScopeKind, signal?: AbortSignal): Response<Array<{ id: string; name: string }>>;
  fetchKnowledgeConnections(kind?: 'user' | KnowledgeScopeKind, id?: string, signal?: AbortSignal): Response<KnowledgeMcpConnection[]>;
  createKnowledgeConnection(payload: KnowledgeConnectionInput, signal?: AbortSignal): Response<KnowledgeMcpConnection>;
  updateKnowledgeConnection(id: string, payload: KnowledgeConnectionInput, signal?: AbortSignal): Response<KnowledgeMcpConnection>;
  deleteKnowledgeConnection(id: string, revision: number, signal?: AbortSignal): Response<null>;
  testKnowledgeDraft(connection: KnowledgeConnectionInput, connectionId?: string, signal?: AbortSignal): Response<{ collections: KnowledgeCollection[]; tools: string[] }>;
  testKnowledgeConnection(id: string, signal?: AbortSignal): Response<{ connection: KnowledgeMcpConnection; collections: KnowledgeCollection[]; tools: string[] }>;
  fetchKnowledgeCollections(id: string, signal?: AbortSignal, includeDocumentCounts?: boolean): Response<{ collections: KnowledgeCollection[] }>;
  fetchKnowledgeUsages(id: string, signal?: AbortSignal): Response<KnowledgeUsage[]>;
  fetchKnowledgeScope(kind: KnowledgeScopeKind, id: string, signal?: AbortSignal): Response<KnowledgeScopeState>;
  bindKnowledge(kind: KnowledgeScopeKind, id: string, payload: { revision: number; connectionId: string; collectionId: string }, signal?: AbortSignal): Response<KnowledgeScopeState>;
  createLocalKnowledge(kind: KnowledgeScopeKind, id: string, payload: { revision: number; connection: KnowledgeConnectionInput; collectionId: string }, signal?: AbortSignal): Response<KnowledgeScopeState>;
  unbindKnowledge(kind: KnowledgeScopeKind, id: string, ref: string, revision: number, signal?: AbortSignal): Response<KnowledgeScopeState>;
  readKnowledgeReference(kind: KnowledgeScopeKind, id: string, ref: string, payload: KnowledgeReadInput, signal?: AbortSignal): Response<Record<string, unknown>>;
  readKnowledgeCatalog(connectionId: string, collectionId: string, payload: KnowledgeReadInput, signal?: AbortSignal): Response<Record<string, unknown>>;
}
export interface KnowledgeCreationTemplate { id: string; connectionId: string; name: string; revision: number; enabled: boolean; isDefault: boolean; capabilities: { rag: boolean; wiki: boolean; graph: boolean; image: boolean }; config?: any }
export interface KnowledgeCreationJob { id: string; connectionId: string; templateId: string; templateRevision: number; status: 'queued' | 'running' | 'preview' | 'completed' | 'failed' | 'unknown'; step: string; error?: string; collectionId?: string; name?: string; description?: string; business?: any; createdAt?: string }
