-- Preserve historical source IDs and bytes, but stop treating page screenshots
-- and their generated descriptions as extracted figures.
UPDATE assets SET metadata=metadata||'{"visual_role":"page_preview"}'::jsonb
 WHERE kind='pdf_page';
UPDATE source_refs s SET metadata=s.metadata||'{"visual_role":"page_preview"}'::jsonb
 WHERE coalesce(s.metadata->>'image_path','')<>'' AND EXISTS(
 SELECT 1 FROM assets a WHERE a.kind='pdf_page' AND a.path=s.metadata->>'image_path'
 AND a.file_version_id=s.file_version_id AND a.knowledge_id=s.knowledge_id
 AND (a.metadata->>'parse_version_id'=s.parse_version_id::text OR NOT a.metadata ? 'parse_version_id'));
