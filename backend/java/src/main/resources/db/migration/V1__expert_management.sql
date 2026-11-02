CREATE TABLE nw_expert (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  role_label VARCHAR(240) NOT NULL,
  tagline VARCHAR(2000) NOT NULL,
  model_name VARCHAR(160) NOT NULL,
  initials VARCHAR(16) NOT NULL,
  color VARCHAR(9) NOT NULL,
  source_market_id VARCHAR(64) UNIQUE,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE nw_sop (
  id VARCHAR(64) PRIMARY KEY,
  expert_id VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  definition_json LONGTEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (expert_id) REFERENCES nw_expert(id)
);
CREATE INDEX ix_sop_expert ON nw_sop(expert_id);
CREATE TABLE nw_rule_set (
  id VARCHAR(64) PRIMARY KEY,
  expert_id VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE (expert_id, name),
  UNIQUE (expert_id, id),
  FOREIGN KEY (expert_id) REFERENCES nw_expert(id)
);
CREATE TABLE nw_rule (
  id VARCHAR(64) PRIMARY KEY,
  expert_id VARCHAR(64) NOT NULL,
  rule_set_id VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  content LONGTEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY (expert_id, rule_set_id) REFERENCES nw_rule_set(expert_id, id)
);
CREATE TABLE nw_extension (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  version_label VARCHAR(64) NOT NULL,
  color VARCHAR(9) NOT NULL
);
CREATE TABLE nw_expert_extension (
  expert_id VARCHAR(64) NOT NULL,
  extension_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(expert_id, extension_id),
  FOREIGN KEY(expert_id) REFERENCES nw_expert(id),
  FOREIGN KEY(extension_id) REFERENCES nw_extension(id)
);
CREATE TABLE nw_case_template (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  scene VARCHAR(160) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  color VARCHAR(9) NOT NULL,
  agent_count INT NOT NULL DEFAULT 1
);
CREATE TABLE nw_expert_case (
  expert_id VARCHAR(64) NOT NULL,
  template_id VARCHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(expert_id, template_id),
  FOREIGN KEY(expert_id) REFERENCES nw_expert(id),
  FOREIGN KEY(template_id) REFERENCES nw_case_template(id)
);
CREATE TABLE nw_market_expert (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  role_label VARCHAR(240) NOT NULL,
  tagline VARCHAR(2000) NOT NULL,
  color VARCHAR(9) NOT NULL,
  model_name VARCHAR(160) NOT NULL
);
CREATE TABLE nw_file (
  id VARCHAR(64) PRIMARY KEY,
  original_name VARCHAR(255) NOT NULL,
  storage_key VARCHAR(64) NOT NULL UNIQUE,
  byte_size BIGINT NOT NULL,
  sha256 VARCHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE TABLE nw_sop_material (
  id VARCHAR(64) PRIMARY KEY,
  sop_id VARCHAR(64) NOT NULL,
  file_id VARCHAR(64),
  display_name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  FOREIGN KEY(sop_id) REFERENCES nw_sop(id),
  FOREIGN KEY(file_id) REFERENCES nw_file(id)
);
CREATE TABLE nw_config_audit (
  id VARCHAR(64) PRIMARY KEY,
  actor VARCHAR(160) NOT NULL,
  object_type VARCHAR(32) NOT NULL,
  object_id VARCHAR(64) NOT NULL,
  action_name VARCHAR(32) NOT NULL,
  change_json LONGTEXT NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX ix_audit_object ON nw_config_audit(object_type, object_id);
CREATE TABLE nw_seed_history (
  seed_key VARCHAR(64) PRIMARY KEY,
  completed_at TIMESTAMP(6) NULL
);
INSERT INTO nw_seed_history(seed_key) VALUES ('expert-config-v1');
