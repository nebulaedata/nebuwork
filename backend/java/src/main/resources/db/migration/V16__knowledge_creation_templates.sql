CREATE TABLE nw_knowledge_template (
 id VARCHAR(64) PRIMARY KEY,
 connection_id VARCHAR(64) NOT NULL,
 name VARCHAR(200) NOT NULL,
 revision BIGINT NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT FALSE,
 is_default BOOLEAN NOT NULL DEFAULT FALSE,
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX ix_knowledge_template_connection ON nw_knowledge_template(connection_id);
CREATE TABLE nw_knowledge_template_version (
 template_id VARCHAR(64) NOT NULL,
 revision BIGINT NOT NULL,
 config_json LONGTEXT NOT NULL,
 target_hash CHAR(64) NOT NULL,
 created_by VARCHAR(160) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(template_id,revision)
);
CREATE TABLE nw_knowledge_creation_job (
 id VARCHAR(64) PRIMARY KEY,
 owner_id VARCHAR(160) NOT NULL,
 connection_id VARCHAR(64) NOT NULL,
 template_id VARCHAR(64) NOT NULL,
 template_revision BIGINT NOT NULL,
 request_key VARCHAR(100) NOT NULL,
 request_hash CHAR(64) NOT NULL,
 target_hash CHAR(64) NOT NULL,
 config_json LONGTEXT NOT NULL,
 input_json LONGTEXT NOT NULL,
 business_json LONGTEXT NULL,
 payload_json LONGTEXT NULL,
 receipt_id VARCHAR(64) NULL,
 collection_id TEXT NULL,
 status VARCHAR(32) NOT NULL,
 step VARCHAR(32) NOT NULL,
 error_message VARCHAR(1000) NULL,
 lease_token VARCHAR(64) NULL,
 lease_until TIMESTAMP(6) NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE(owner_id,request_key)
);
CREATE INDEX ix_knowledge_creation_queue ON nw_knowledge_creation_job(status,lease_until);
CREATE INDEX ix_knowledge_creation_owner ON nw_knowledge_creation_job(owner_id,created_at);
