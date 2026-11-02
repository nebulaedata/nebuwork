CREATE TABLE IF NOT EXISTS nw_agent_engine_settings (
 id INT PRIMARY KEY, configured BOOLEAN NOT NULL DEFAULT FALSE,
 api_urls_json JSON NOT NULL, namespace VARCHAR(128) NOT NULL DEFAULT 'nebuwork-v2',
 signing_key_cipher TEXT, callback_key_cipher TEXT,
 cluster_id VARCHAR(128), storage_id VARCHAR(128),
 sandbox_image VARCHAR(240) NOT NULL DEFAULT 'nebu-agent-sandbox:1',
 request_timeout_ms INT NOT NULL DEFAULT 15000, revision BIGINT NOT NULL DEFAULT 0,
 updated_by VARCHAR(128), updated_at TIMESTAMP(6)
);
INSERT INTO nw_agent_engine_settings(id,api_urls_json) VALUES(1,'[]');
CREATE TABLE IF NOT EXISTS nw_agent_engine_admin (owner_id VARCHAR(128) PRIMARY KEY);
CREATE TABLE IF NOT EXISTS nw_agent_engine_settings_audit (
 revision BIGINT PRIMARY KEY, actor VARCHAR(128) NOT NULL,
 settings_json JSON NOT NULL, credential_action VARCHAR(128) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
