CREATE TABLE nw_model_provider (
  id VARCHAR(64) PRIMARY KEY,
  owner_id VARCHAR(160) NOT NULL,
  provider_type VARCHAR(16) NOT NULL,
  base_url VARCHAR(2048) NOT NULL,
  model_name VARCHAR(255) NOT NULL,
  config_fingerprint CHAR(64) NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
  test_status VARCHAR(16) NOT NULL DEFAULT 'untested',
  last_tested_at TIMESTAMP(6) NULL,
  last_latency_ms BIGINT NULL,
  last_model_found BOOLEAN NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(owner_id, config_fingerprint)
);
CREATE INDEX ix_model_provider_owner ON nw_model_provider(owner_id, created_at);

CREATE TABLE nw_user_model_settings (
  user_id VARCHAR(160) PRIMARY KEY,
  default_provider_id VARCHAR(64) NULL,
  audit_fallback_provider_id VARCHAR(64) NULL,
  retain_audit_trail BOOLEAN NOT NULL DEFAULT TRUE,
  auto_archive_artifacts BOOLEAN NOT NULL DEFAULT TRUE,
  auto_memory_backflow BOOLEAN NOT NULL DEFAULT TRUE,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(default_provider_id) REFERENCES nw_model_provider(id),
  FOREIGN KEY(audit_fallback_provider_id) REFERENCES nw_model_provider(id)
);
