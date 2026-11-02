CREATE INDEX wiki_pages_sources_gin ON wiki_pages USING gin(source_ids);
CREATE INDEX wiki_revisions_sources_gin ON wiki_revisions USING gin(source_ids);
CREATE INDEX wiki_revisions_page_time_idx ON wiki_revisions(page_id,created_at DESC);
CREATE INDEX graph_document_evidence_idx ON graph_records(knowledge_id,created_at,id);
