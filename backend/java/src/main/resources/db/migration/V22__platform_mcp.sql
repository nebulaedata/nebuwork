CREATE TABLE nw_platform_mcp_policy (
 owner_id VARCHAR(128) NOT NULL, workbench_id VARCHAR(128) NOT NULL,
 revision BIGINT NOT NULL DEFAULT 1, draft_json LONGTEXT NOT NULL,
 published_json LONGTEXT NULL, published_revision BIGINT NULL, revoked BOOLEAN NOT NULL DEFAULT FALSE,
 revoked_before_revision BIGINT NOT NULL DEFAULT 0,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(owner_id,workbench_id)
);
CREATE TABLE nw_platform_mcp_grant (
 token_hash VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL,
 run_id VARCHAR(128) NOT NULL, identity_json LONGTEXT NOT NULL,
 expires_at BIGINT NOT NULL, revoked BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX nw_pm_grant_run(run_id), INDEX nw_pm_grant_expiry(expires_at)
);
CREATE TABLE nw_platform_mcp_call (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, run_id VARCHAR(128) NOT NULL,
 task_id VARCHAR(128) NOT NULL, call_id VARCHAR(255) NOT NULL, tool_name VARCHAR(128) NOT NULL,
 request_hash VARCHAR(64) NOT NULL, policy_hash VARCHAR(64) NOT NULL, arguments_json LONGTEXT NOT NULL,
 state VARCHAR(24) NOT NULL, result_json LONGTEXT NULL, error_message VARCHAR(1000) NULL,
 target_task_id VARCHAR(128) NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY nw_pm_call_identity(owner_id,run_id,call_id), INDEX nw_pm_call_target(target_task_id)
);
CREATE TABLE nw_platform_mcp_resource (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, run_id VARCHAR(128) NOT NULL,
 descriptor_json LONGTEXT NOT NULL, expires_at BIGINT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX nw_pm_resource_owner(owner_id,run_id)
);
