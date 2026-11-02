-- Replays preserve saved configuration, credentials, revisions and audit history.
CREATE TABLE IF NOT EXISTS nw_memory_settings (
    id INT NOT NULL PRIMARY KEY,
    configured BOOLEAN NOT NULL DEFAULT FALSE,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    base_url VARCHAR(2048) NULL,
    api_key_cipher TEXT NULL,
    recall_timeout_ms INT NOT NULL DEFAULT 3000,
    request_timeout_ms INT NOT NULL DEFAULT 15000,
    recall_max_tokens INT NOT NULL DEFAULT 3000,
    revision BIGINT NOT NULL DEFAULT 0,
    updated_by VARCHAR(160) NULL,
    updated_at TIMESTAMP(6) NULL
);
INSERT INTO nw_memory_settings(id) VALUES(1) ON DUPLICATE KEY UPDATE id=id;

CREATE TABLE IF NOT EXISTS nw_memory_settings_audit (
    revision BIGINT NOT NULL PRIMARY KEY,
    actor VARCHAR(160) NOT NULL,
    settings_json MEDIUMTEXT NOT NULL,
    credential_action VARCHAR(16) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
