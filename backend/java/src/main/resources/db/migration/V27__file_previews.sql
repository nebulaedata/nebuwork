-- Account-scoped immutable sources, fenced conversion leases and private derivatives.
CREATE TABLE IF NOT EXISTS nw_file_preview (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL,
 cache_key CHAR(64) NOT NULL, source_json LONGTEXT NOT NULL, metadata_json LONGTEXT NOT NULL,
 status VARCHAR(24) NOT NULL, stage VARCHAR(64) NOT NULL DEFAULT '',
 lease_token VARCHAR(64), lease_until BIGINT NOT NULL DEFAULT 0, started_at BIGINT NOT NULL DEFAULT 0, attempt INT NOT NULL DEFAULT 0,
 manifest_json LONGTEXT, error_text VARCHAR(500),
 source_sha256 CHAR(64), created_at BIGINT NOT NULL, expires_at BIGINT NOT NULL,
 UNIQUE KEY uq_preview_source(owner_id,cache_key), INDEX idx_preview_queue(status,lease_until,expires_at)
);
CREATE TABLE IF NOT EXISTS nw_file_preview_output (
 preview_id VARCHAR(64) NOT NULL, owner_id VARCHAR(128) NOT NULL,
 output_name VARCHAR(128) NOT NULL, upload_id VARCHAR(128) NOT NULL,
 PRIMARY KEY(preview_id,output_name), UNIQUE KEY uq_preview_upload(upload_id)
);
