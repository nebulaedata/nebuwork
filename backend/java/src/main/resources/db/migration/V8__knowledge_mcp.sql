-- Account-owned MCP connections. Remote documents and indexes remain on the provider.
CREATE TABLE nw_knowledge_connection (
  id VARCHAR(64) PRIMARY KEY,
  owner_id VARCHAR(160) NOT NULL,
  scope_kind VARCHAR(16) NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  driver VARCHAR(64) NOT NULL,
  endpoint VARCHAR(2048) NOT NULL,
  auth_type VARCHAR(16) NOT NULL,
  auth_header VARCHAR(128) NOT NULL,
  secret_cipher TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision BIGINT NOT NULL DEFAULT 1,
  test_status VARCHAR(16) NOT NULL DEFAULT 'untested',
  test_message VARCHAR(500) NOT NULL DEFAULT '',
  tested_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);
CREATE INDEX ix_knowledge_connection_owner ON nw_knowledge_connection(owner_id,scope_kind,scope_id);
CREATE TABLE nw_knowledge_scope (
  owner_id VARCHAR(160) NOT NULL,
  scope_kind VARCHAR(16) NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY(owner_id,scope_kind,scope_id)
);
CREATE TABLE nw_knowledge_reference (
  id VARCHAR(64) PRIMARY KEY,
  owner_id VARCHAR(160) NOT NULL,
  scope_kind VARCHAR(16) NOT NULL,
  scope_id VARCHAR(64) NOT NULL,
  connection_id VARCHAR(64) NOT NULL,
  collection_id TEXT NOT NULL,
  collection_hash CHAR(64) NOT NULL,
  collection_name VARCHAR(500) NOT NULL,
  indexing_status VARCHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(owner_id,scope_kind,scope_id,connection_id,collection_hash),
  FOREIGN KEY(connection_id) REFERENCES nw_knowledge_connection(id)
);
CREATE INDEX ix_knowledge_reference_scope ON nw_knowledge_reference(owner_id,scope_kind,scope_id);
-- Explicit pins keep historical releases reachable even after draft references are removed.
CREATE TABLE nw_knowledge_publication (
  version_id VARCHAR(64) NOT NULL,
  connection_id VARCHAR(64) NOT NULL,
  owner_id VARCHAR(160) NOT NULL,
  PRIMARY KEY(version_id,connection_id),
  FOREIGN KEY(version_id) REFERENCES nw_ontology_version(id),
  FOREIGN KEY(connection_id) REFERENCES nw_knowledge_connection(id)
);

