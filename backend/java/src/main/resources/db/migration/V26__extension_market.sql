CREATE TABLE nw_market_extension (
 id VARCHAR(64) PRIMARY KEY, kind VARCHAR(16) NOT NULL, name VARCHAR(160) NOT NULL,
 description VARCHAR(2000) NOT NULL, published_name VARCHAR(160), published_description VARCHAR(2000),
 revision BIGINT NOT NULL DEFAULT 1, draft_json JSON NOT NULL,
 published_version_id VARCHAR(64), listed BOOLEAN NOT NULL DEFAULT FALSE, created_by VARCHAR(128) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE nw_market_asset (
 id VARCHAR(64) PRIMARY KEY, extension_id VARCHAR(64) NOT NULL, path VARCHAR(1024) NOT NULL,
 artifact_owner VARCHAR(128) NOT NULL, artifact_id VARCHAR(128) NOT NULL, artifact_version INT NOT NULL,
 media_type VARCHAR(240) NOT NULL, size_bytes BIGINT NOT NULL, sha256 CHAR(64) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX market_asset_extension(extension_id)
);
CREATE TABLE nw_market_auth (
 id VARCHAR(64) PRIMARY KEY, extension_id VARCHAR(64) NOT NULL, binding_hash CHAR(64) NOT NULL,
 secret_ciphertext TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 1,
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE KEY market_auth_binding(extension_id,binding_hash)
);
CREATE TABLE nw_market_version (
 id VARCHAR(64) PRIMARY KEY, extension_id VARCHAR(64) NOT NULL, version_number INT NOT NULL,
 payload_json JSON NOT NULL, auth_profile_id VARCHAR(64), release_notes VARCHAR(4000) NOT NULL,
 created_by VARCHAR(128) NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY market_version_number(extension_id,version_number)
);
CREATE TABLE nw_market_installation (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, scope_kind VARCHAR(16) NOT NULL,
 scope_id VARCHAR(128) NOT NULL, extension_id VARCHAR(64) NOT NULL, version_id VARCHAR(64) NOT NULL,
 payload_json JSON NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY market_install_version(owner_id,scope_kind,scope_id,extension_id,version_id)
);
CREATE TABLE nw_market_operation (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, scope_kind VARCHAR(16) NOT NULL,
 scope_id VARCHAR(128) NOT NULL, extension_id VARCHAR(64) NOT NULL, version_id VARCHAR(64) NOT NULL,
 runtime_revision BIGINT NOT NULL, request_key VARCHAR(160) NOT NULL, request_hash CHAR(64) NOT NULL,
 state VARCHAR(24) NOT NULL DEFAULT 'pending', progress_json JSON NOT NULL, result_json JSON,
 error_message VARCHAR(1000), lease_until TIMESTAMP(6), execution_token VARCHAR(64),
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE KEY market_operation_key(owner_id,request_key),
 INDEX market_operation_work(state,lease_until)
);
