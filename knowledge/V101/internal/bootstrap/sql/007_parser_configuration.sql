-- Only fill previously absent selections; preserve all explicit settings.
UPDATE settings SET value = jsonb_set(value, '{parser_engines}',
  '{"pdf":"paddleocr_vl","word":"native","spreadsheet":"native","presentation":"native","text":"native","image":"tesseract","media":"ffmpeg"}'::jsonb || coalesce(value->'parser_engines','{}'::jsonb))
WHERE key='parser-defaults';
UPDATE knowledge_bases SET config = jsonb_set(config, '{parser_engines}',
  '{"pdf":"paddleocr_vl","word":"native","spreadsheet":"native","presentation":"native","text":"native","image":"tesseract","media":"ffmpeg"}'::jsonb || coalesce(config->'parser_engines','{}'::jsonb));
