ALTER TABLE knowledge ADD COLUMN relative_path text NOT NULL DEFAULT '';
ALTER TABLE knowledge ADD COLUMN source_archive_id uuid REFERENCES knowledge(id) ON DELETE SET NULL;
ALTER TABLE knowledge ADD COLUMN storage_reason text NOT NULL DEFAULT '';
UPDATE knowledge SET relative_path=name WHERE relative_path='';
CREATE INDEX knowledge_source_archive_idx ON knowledge(source_archive_id) WHERE source_archive_id IS NOT NULL;
