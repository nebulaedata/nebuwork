-- Independent configuration, live SQLite versions, durable operations and additive Run grants.
CREATE TABLE IF NOT EXISTS nw_database (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL,
 scope_kind VARCHAR(16) NOT NULL, scope_id VARCHAR(128) NOT NULL,
 name VARCHAR(240) NOT NULL, description TEXT, driver VARCHAR(16) NOT NULL,
 revision BIGINT NOT NULL DEFAULT 1, draft_json LONGTEXT NOT NULL,
 active_version BIGINT, enabled BOOLEAN NOT NULL DEFAULT FALSE, deleted BOOLEAN NOT NULL DEFAULT FALSE,
 data_version BIGINT NOT NULL DEFAULT 0, object_sha256 VARCHAR(64), storage_id VARCHAR(128),
 test_status VARCHAR(24), tested_at TIMESTAMP(6),
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 INDEX idx_database_scope(owner_id,scope_kind,scope_id,deleted)
);
CREATE TABLE IF NOT EXISTS nw_database_version (
 database_id VARCHAR(64) NOT NULL, version BIGINT NOT NULL, owner_id VARCHAR(128) NOT NULL,
 config_json LONGTEXT NOT NULL, secret_ciphertext LONGTEXT,
 endpoint_hash VARCHAR(64) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(database_id,version)
);
CREATE TABLE IF NOT EXISTS nw_database_snapshot (
 database_id VARCHAR(64) NOT NULL, version BIGINT NOT NULL, owner_id VARCHAR(128) NOT NULL,
 object_sha256 VARCHAR(64) NOT NULL, storage_id VARCHAR(128) NOT NULL, size_bytes BIGINT NOT NULL,
 operation_id VARCHAR(64), created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(database_id,version)
);
CREATE TABLE IF NOT EXISTS nw_database_operation (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, database_id VARCHAR(64) NOT NULL,
 request_key VARCHAR(160) NOT NULL, request_hash VARCHAR(64) NOT NULL, operation VARCHAR(32) NOT NULL,
 config_version BIGINT NOT NULL, arguments_ciphertext LONGTEXT NOT NULL,
 state VARCHAR(24) NOT NULL DEFAULT 'queued', result_json LONGTEXT, error_status INT, error_message VARCHAR(1000),
 project_id VARCHAR(128), task_id VARCHAR(128), run_id VARCHAR(128), identity_json LONGTEXT,
 cancel_requested BOOLEAN NOT NULL DEFAULT FALSE, worker_token VARCHAR(64), lease_until TIMESTAMP(6),
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_database_operation(owner_id,database_id,request_key),
 INDEX idx_database_operations(state,lease_until), INDEX idx_database_history(owner_id,database_id,created_at)
);
CREATE TABLE IF NOT EXISTS nw_database_run_grant (
 database_id VARCHAR(64) NOT NULL, owner_id VARCHAR(128) NOT NULL, run_id VARCHAR(128) NOT NULL,
 include_children BOOLEAN NOT NULL DEFAULT FALSE, config_version BIGINT NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(database_id,run_id)
);
