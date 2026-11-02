-- Existing owner_id remains the AES-GCM credential identity, not authorization.
ALTER TABLE nw_knowledge_connection ADD published BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE nw_knowledge_connection ADD tenant_id VARCHAR(32) NOT NULL DEFAULT '';
ALTER TABLE nw_knowledge_connection ADD legacy_migrated BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE nw_knowledge_guard (id INT PRIMARY KEY);
INSERT INTO nw_knowledge_guard(id) VALUES(1);
CREATE TABLE nw_knowledge_library (
  id VARCHAR(64) PRIMARY KEY,
  service_key CHAR(64) NOT NULL,
  collection_hash CHAR(64) NOT NULL,
  collection_id TEXT NOT NULL,
  connection_id VARCHAR(64) NOT NULL,
  owner_id VARCHAR(160) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(service_key,collection_hash)
);
CREATE TABLE nw_knowledge_library_access (
  library_id VARCHAR(64) NOT NULL,
  owner_id VARCHAR(160) NOT NULL,
  PRIMARY KEY(library_id,owner_id)
);
CREATE TABLE nw_knowledge_operation (
  id VARCHAR(64) PRIMARY KEY,
  owner_id VARCHAR(160) NOT NULL,
  connection_id VARCHAR(64) NOT NULL,
  collection_id TEXT NULL,
  request_key VARCHAR(100) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  operation VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  result_json LONGTEXT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(owner_id,request_key)
);
CREATE INDEX ix_knowledge_operation_connection ON nw_knowledge_operation(connection_id,status);
