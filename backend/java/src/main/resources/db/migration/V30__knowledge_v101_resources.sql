-- V101 sessions and query images belong to the verified NebuWork account.
ALTER TABLE nw_knowledge_operation ADD COLUMN request_json LONGTEXT;
CREATE TABLE nw_knowledge_v101_resource (
 id VARCHAR(64) NOT NULL PRIMARY KEY,
 service_key VARCHAR(64) NOT NULL,
 owner_id VARCHAR(160) NOT NULL,
 kind VARCHAR(24) NOT NULL,
 remote_id VARCHAR(64) NOT NULL,
 parent_id VARCHAR(64),
 scope_json LONGTEXT NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_v101_resource (service_key,kind,remote_id),
 KEY ix_v101_owner (service_key,owner_id,kind)
);
