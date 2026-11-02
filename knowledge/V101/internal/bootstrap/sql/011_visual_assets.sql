-- Older PDF parsers stored page images in source references but omitted assets.
-- Register the existing files; do not reparse or change historical references.
WITH visuals AS (
 SELECT DISTINCT ON (parse_version_id, metadata->>'image_path')
  knowledge_id, file_version_id, parse_version_id, metadata->>'image_path' AS path,
  locators->0 AS locator
 FROM source_refs
 WHERE coalesce(metadata->>'image_path','')<>''
 ORDER BY parse_version_id, metadata->>'image_path', char_start, id
)
INSERT INTO assets(id,knowledge_id,file_version_id,kind,path,metadata)
SELECT md5('visual:'||v.parse_version_id::text||':'||v.path)::uuid,
 v.knowledge_id,v.file_version_id,
 CASE WHEN v.locator ? 'page' THEN 'pdf_page' WHEN v.locator->>'type'='frame' THEN 'video_frame' ELSE 'image' END,
 v.path,jsonb_build_object('parse_version_id',v.parse_version_id,'page',v.locator->'page','time_ms',v.locator->'time_ms')
FROM visuals v
WHERE NOT EXISTS (SELECT 1 FROM assets a WHERE a.knowledge_id=v.knowledge_id AND a.file_version_id=v.file_version_id AND a.path=v.path
 AND (a.metadata->>'parse_version_id'=v.parse_version_id::text OR NOT a.metadata ? 'parse_version_id'))
ON CONFLICT(id) DO NOTHING;

CREATE INDEX source_refs_visual_idx ON source_refs(parse_version_id,(metadata->>'image_path'),char_start)
 WHERE coalesce(metadata->>'image_path','')<>'';
CREATE INDEX assets_parse_idx ON assets((metadata->>'parse_version_id'));
