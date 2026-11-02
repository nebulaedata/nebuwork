-- Split the catalog without overwriting saved knowledge-base selections.
CREATE FUNCTION pg_temp.expand_parser_choices(old jsonb) RETURNS jsonb LANGUAGE sql AS $$
 SELECT '{"pdf": "paddleocr_vl", "word": "anydoc", "presentation": "anydoc", "spreadsheet": "anydoc", "epub": "anydoc", "ofd": "native", "mhtml": "native", "csv": "simple", "markdown": "native", "txt": "simple", "json": "simple", "image": "paddleocr_vl", "audio": "simple", "video": "simple", "docm": "anydoc", "htm": "native", "html": "native", "odp": "anydoc", "ods": "anydoc", "odt": "anydoc", "pptm": "anydoc", "rtf": "anydoc", "xlsm": "anydoc", "xmind": "native", "tsv": "simple", "xml": "simple", "yaml": "simple", "yml": "simple", "log": "simple", "py": "simple", "js": "simple", "ts": "simple", "java": "simple", "go": "simple", "sql": "simple"}'::jsonb || (coalesce(old,'{}'::jsonb)-'text'-'media');
$$;
UPDATE settings SET value=jsonb_set(value,'{parser_engines}',pg_temp.expand_parser_choices(value->'parser_engines')) WHERE key='parser-defaults';
-- Upgrade former factory defaults; keep alternative choices such as LibreOffice.
UPDATE settings SET value=jsonb_set(value,'{parser_engines}',value->'parser_engines' ||
 (SELECT coalesce(jsonb_object_agg(key,new_value),'{}'::jsonb) FROM (VALUES
 ('word','native','anydoc'),('presentation','native','anydoc'),('spreadsheet','native','anydoc'),('image','tesseract','paddleocr_vl')) d(key,old_value,new_value)
 WHERE value->'parser_engines'->>key=old_value)) WHERE key='parser-defaults';
UPDATE knowledge_bases SET config=jsonb_set(config,'{parser_engines}',pg_temp.expand_parser_choices(config->'parser_engines'));
DROP FUNCTION pg_temp.expand_parser_choices(jsonb);
