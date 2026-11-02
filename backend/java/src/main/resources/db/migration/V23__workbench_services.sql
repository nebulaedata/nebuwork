CREATE TABLE nw_service (
 owner_id VARCHAR(128) NOT NULL, workbench_id VARCHAR(128) NOT NULL,
 revision BIGINT NOT NULL DEFAULT 0, draft_json LONGTEXT NOT NULL,
 active_release_id VARCHAR(128), enabled BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(owner_id,workbench_id)
);
CREATE TABLE nw_service_release (
 id VARCHAR(128) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, workbench_id VARCHAR(128) NOT NULL,
 version INT NOT NULL, source_revision BIGINT NOT NULL, definition_json LONGTEXT NOT NULL,
 execution_json LONGTEXT NOT NULL, preview BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY nw_sr_version(owner_id,workbench_id,version), UNIQUE KEY nw_sr_revision(owner_id,workbench_id,source_revision,preview)
);
CREATE TABLE nw_service_asset (
 id VARCHAR(128) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, workbench_id VARCHAR(128) NOT NULL,
 content_hash VARCHAR(64) NOT NULL, html LONGTEXT NOT NULL, source_json LONGTEXT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE nw_service_app (
 id VARCHAR(128) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, workbench_id VARCHAR(128) NOT NULL,
 name VARCHAR(200) NOT NULL, secret_hash VARCHAR(64) NOT NULL, revision BIGINT NOT NULL DEFAULT 1,
 scope_json LONGTEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE nw_service_oauth_request (
 id VARCHAR(128) PRIMARY KEY, app_id VARCHAR(128) NOT NULL, request_json LONGTEXT NOT NULL,
 owner_id VARCHAR(128), code_hash VARCHAR(64), consumed BOOLEAN NOT NULL DEFAULT FALSE,
 expires_at BIGINT NOT NULL
);
CREATE TABLE nw_service_token (
 token_hash VARCHAR(64) PRIMARY KEY, app_id VARCHAR(128), owner_id VARCHAR(128) NOT NULL,
 workbench_id VARCHAR(128) NOT NULL, app_revision BIGINT, scope_json LONGTEXT NOT NULL,
 expires_at BIGINT NOT NULL, revoked BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE nw_service_operation (
 id VARCHAR(128) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, workbench_id VARCHAR(128) NOT NULL,
 app_id VARCHAR(128) NOT NULL, release_id VARCHAR(128) NOT NULL, capability_key VARCHAR(80) NOT NULL,
 project_id VARCHAR(128) NOT NULL, request_key VARCHAR(128) NOT NULL, request_hash VARCHAR(64) NOT NULL,
 input_json LONGTEXT NOT NULL, state VARCHAR(32) NOT NULL, target_id VARCHAR(128),
 submitted_json LONGTEXT, result_json LONGTEXT, error_message VARCHAR(2000), revision BIGINT NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY nw_so_request(owner_id,app_id,workbench_id,request_key), INDEX nw_so_state(state)
);
CREATE TABLE nw_service_event (
 id BIGINT AUTO_INCREMENT PRIMARY KEY, operation_id VARCHAR(128) NOT NULL,
 event_json LONGTEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX nw_se_operation(operation_id,id)
);
CREATE TABLE nw_service_page_instance (
 id VARCHAR(128) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, workbench_id VARCHAR(128) NOT NULL,
 app_id VARCHAR(128) NOT NULL, release_id VARCHAR(128) NOT NULL, page_key VARCHAR(80) NOT NULL,
 project_id VARCHAR(128) NOT NULL, context_json LONGTEXT NOT NULL,
 state_json LONGTEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 0,
 request_key VARCHAR(128) NOT NULL, request_hash VARCHAR(64) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY nw_spi_request(owner_id,app_id,workbench_id,request_key)
);
