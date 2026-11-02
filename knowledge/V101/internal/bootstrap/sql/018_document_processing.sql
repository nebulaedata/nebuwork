CREATE INDEX tasks_document_processing_idx ON tasks(knowledge_id,created_at DESC,id DESC)
WHERE type IN ('ingest','rebuild','extract_archive','preview');
