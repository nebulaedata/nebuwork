ALTER TABLE upload_sessions ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
CREATE INDEX upload_expiry_idx ON upload_sessions(expires_at);
CREATE INDEX sources_parse_idx ON source_refs(parse_version_id);
CREATE INDEX assets_version_idx ON assets(file_version_id);
