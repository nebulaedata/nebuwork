-- Additive schema only. Business reset and removal of retired tables is an explicit operation.
ALTER TABLE nw_project ADD COLUMN parameters_json JSON;
CREATE TABLE IF NOT EXISTS nw_agent_task (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, project_id VARCHAR(64) NOT NULL,
 session_id VARCHAR(128), title VARCHAR(240) NOT NULL, context_json JSON NOT NULL,
 request_key VARCHAR(128) NOT NULL, request_hash CHAR(64) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), deleted_at TIMESTAMP(6),
 UNIQUE KEY uq_agent_task_request(owner_id,project_id,request_key),
 UNIQUE KEY uq_agent_task_session(session_id), KEY ix_agent_task_project(owner_id,project_id)
);
CREATE TABLE IF NOT EXISTS nw_agent_resource (
 owner_id VARCHAR(128) NOT NULL, scope_kind VARCHAR(16) NOT NULL, scope_id VARCHAR(128) NOT NULL,
 revision BIGINT NOT NULL DEFAULT 1, document_json JSON NOT NULL, active_version_id VARCHAR(64),
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(owner_id,scope_kind,scope_id)
);
CREATE TABLE IF NOT EXISTS nw_agent_resource_version (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, scope_kind VARCHAR(16) NOT NULL,
 scope_id VARCHAR(128) NOT NULL, source_revision BIGINT NOT NULL, bundle_id VARCHAR(128) NOT NULL,
 bundle_version VARCHAR(128) NOT NULL, document_json JSON NOT NULL, content_hash CHAR(64) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_agent_resource_revision(owner_id,scope_kind,scope_id,source_revision)
);
CREATE TABLE IF NOT EXISTS nw_agent_call (
 run_id VARCHAR(128) NOT NULL, call_id VARCHAR(255) NOT NULL, owner_id VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL, state VARCHAR(24) NOT NULL, result_json JSON,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(run_id,call_id)
);
CREATE TABLE IF NOT EXISTS nw_agent_credential (
 id VARCHAR(128) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, label VARCHAR(240) NOT NULL,
 secret_ciphertext TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 1,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
