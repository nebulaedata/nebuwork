-- Memory sources are business records; Hindsight is a rebuildable derived index.
-- Safe to replay after manually applying this exact schema; existing data is preserved.
CREATE TABLE IF NOT EXISTS nw_memory_scope (
 id CHAR(64) PRIMARY KEY, owner_id VARCHAR(160) NOT NULL, kind VARCHAR(16) NOT NULL,
 object_id VARCHAR(160) NOT NULL, bank_id VARCHAR(160) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_memory_scope(owner_id,kind,object_id), UNIQUE KEY uq_memory_bank(bank_id)
);
CREATE TABLE IF NOT EXISTS nw_memory_entry (
 id VARCHAR(64) PRIMARY KEY, scope_id CHAR(64) NOT NULL, title VARCHAR(300) NOT NULL,
 content_md MEDIUMTEXT NOT NULL, source_json MEDIUMTEXT NOT NULL,
 state VARCHAR(20) NOT NULL, revision BIGINT NOT NULL DEFAULT 1,
 synced_revision BIGINT NOT NULL DEFAULT 0, sync_state VARCHAR(20) NOT NULL DEFAULT 'pending',
 document_id VARCHAR(100) NOT NULL, automatic BOOLEAN NOT NULL DEFAULT FALSE,
 source_run_id VARCHAR(64) NULL, error_message VARCHAR(500) NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY ix_memory_scope(scope_id,state,created_at), KEY ix_memory_source(source_run_id),
 UNIQUE KEY uq_memory_document(scope_id,document_id)
);
CREATE TABLE IF NOT EXISTS nw_memory_version (
 entry_id VARCHAR(64) NOT NULL, revision BIGINT NOT NULL, actor VARCHAR(160) NOT NULL,
 action_name VARCHAR(32) NOT NULL, body_json MEDIUMTEXT NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY(entry_id,revision)
);
CREATE TABLE IF NOT EXISTS nw_memory_job (
 id VARCHAR(64) PRIMARY KEY, entry_id VARCHAR(64) NOT NULL, revision BIGINT NOT NULL,
 kind VARCHAR(16) NOT NULL, payload_json MEDIUMTEXT NOT NULL,
 operation_id CHAR(36) NOT NULL, remote_submitted BOOLEAN NOT NULL DEFAULT FALSE,
 state VARCHAR(20) NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0,
 sequence_no BIGINT NOT NULL AUTO_INCREMENT, lease_token VARCHAR(64) NULL,
 lease_until TIMESTAMP(6) NULL, next_attempt_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 error_message VARCHAR(500) NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_memory_job(entry_id,revision), UNIQUE KEY uq_memory_job_order(sequence_no),
 KEY ix_memory_job_due(state,next_attempt_at)
);
CREATE TABLE IF NOT EXISTS nw_memory_run_context (
 run_id VARCHAR(64) PRIMARY KEY, context_json MEDIUMTEXT NOT NULL,
 send_to_core BOOLEAN NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE IF NOT EXISTS nw_memory_request (
 owner_id VARCHAR(160) NOT NULL, request_key VARCHAR(160) NOT NULL, request_hash CHAR(64) NOT NULL,
 result_json MEDIUMTEXT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(owner_id,request_key)
);
