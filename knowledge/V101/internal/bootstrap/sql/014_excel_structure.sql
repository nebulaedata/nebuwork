-- Freeze existing implicit choices before changing the factory default. No
-- historical parse, task, source or generated result is rewritten.
UPDATE knowledge_bases SET config=jsonb_set(config,'{parser_engines}',coalesce(config->'parser_engines','{}') || '{"spreadsheet":"anydoc"}')
WHERE NOT coalesce(config->'parser_engines','{}') ? 'spreadsheet';
UPDATE settings SET value=jsonb_set(value,'{parser_engines}',coalesce(value->'parser_engines','{}') || '{"spreadsheet":"excel"}'),updated_at=now()
WHERE key='parser-defaults';
