CREATE TABLE IF NOT EXISTS nw_workflow_settings (
 id INT PRIMARY KEY, configured BOOLEAN NOT NULL DEFAULT FALSE, enabled BOOLEAN NOT NULL DEFAULT FALSE,
 base_url VARCHAR(2048), api_key_cipher TEXT, request_timeout_ms INT NOT NULL DEFAULT 15000,
 revision BIGINT NOT NULL DEFAULT 0, updated_by VARCHAR(160), updated_at TIMESTAMP(6)
);
INSERT INTO nw_workflow_settings(id) VALUES(1) ON DUPLICATE KEY UPDATE id=id;
CREATE TABLE IF NOT EXISTS nw_workflow_settings_audit (
 revision BIGINT PRIMARY KEY, actor VARCHAR(160) NOT NULL, settings_json MEDIUMTEXT NOT NULL,
 credential_action VARCHAR(16) NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE IF NOT EXISTS nw_workflow_request (
 owner_id VARCHAR(160) NOT NULL, request_key VARCHAR(100) NOT NULL, request_hash CHAR(64) NOT NULL,
 result_json LONGTEXT, PRIMARY KEY(owner_id,request_key)
);
CREATE TABLE IF NOT EXISTS nw_workflow (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(160) NOT NULL, remote_id VARCHAR(100) NOT NULL UNIQUE,
 name VARCHAR(160) NOT NULL, description VARCHAR(2000) NOT NULL,
 state VARCHAR(16) NOT NULL DEFAULT 'pending', error VARCHAR(2000), archived BOOLEAN NOT NULL DEFAULT FALSE,
 lease_token VARCHAR(64), lease_until TIMESTAMP(6),
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 INDEX ix_workflow_owner(owner_id), INDEX ix_workflow_due(state,lease_until)
);
CREATE TABLE IF NOT EXISTS nw_sop_workflow (
 owner_id VARCHAR(160) NOT NULL, sop_id VARCHAR(64) NOT NULL, workflow_id VARCHAR(64) NOT NULL,
 PRIMARY KEY(owner_id,sop_id), FOREIGN KEY(workflow_id) REFERENCES nw_workflow(id)
);
CREATE TABLE IF NOT EXISTS nw_workflow_task (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(160) NOT NULL, workflow_id VARCHAR(64) NOT NULL,
 remote_id VARCHAR(100), input_json LONGTEXT NOT NULL, state VARCHAR(16) NOT NULL DEFAULT 'pending',
 error VARCHAR(2000), lease_token VARCHAR(64), lease_until TIMESTAMP(6),
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 FOREIGN KEY(workflow_id) REFERENCES nw_workflow(id), INDEX ix_workflow_task_owner(owner_id,workflow_id), INDEX ix_workflow_task_due(state,lease_until)
);
