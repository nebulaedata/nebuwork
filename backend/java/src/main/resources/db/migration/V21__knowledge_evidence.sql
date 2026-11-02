CREATE TABLE IF NOT EXISTS nw_knowledge_evidence (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(128) NOT NULL, task_id VARCHAR(64) NOT NULL,
 run_id VARCHAR(128) NOT NULL, call_id VARCHAR(255) NOT NULL, scope_kind VARCHAR(16) NOT NULL,
 scope_id VARCHAR(128) NOT NULL, reference_id VARCHAR(128) NOT NULL, snapshot_json JSON NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY ix_knowledge_evidence_task(owner_id,task_id,run_id)
);
