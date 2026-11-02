-- OFD previously had only the factory native extractor. Upgrade that selection
-- once; keep frozen tasks, all parse versions and source references untouched.
UPDATE settings
SET value=jsonb_set(value,'{parser_engines}',coalesce(value->'parser_engines','{}'::jsonb)||'{"ofd":"paddleocr_vl"}'::jsonb)
WHERE key='parser-defaults' AND coalesce(value->'parser_engines'->>'ofd','native')='native';
UPDATE knowledge_bases
SET config=jsonb_set(config,'{parser_engines}',coalesce(config->'parser_engines','{}'::jsonb)||'{"ofd":"paddleocr_vl"}'::jsonb)
WHERE coalesce(config->'parser_engines'->>'ofd','native')='native';
