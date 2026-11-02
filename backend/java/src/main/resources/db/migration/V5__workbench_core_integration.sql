-- Business mappings only; never reads or writes NebuAgentCore's database.
CREATE TABLE nw_workbench_core (
  workbench_id VARCHAR(64) PRIMARY KEY,
  instance_id VARCHAR(24) NOT NULL,
  template_id VARCHAR(100) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(instance_id, template_id),
  FOREIGN KEY(workbench_id) REFERENCES nw_workbench(id)
);

CREATE TABLE nw_core_template_release (
  version_id VARCHAR(64) PRIMARY KEY,
  workbench_id VARCHAR(64) NOT NULL,
  base_template_id VARCHAR(100) NOT NULL,
  base_version VARCHAR(64) NOT NULL,
  core_version VARCHAR(64) NOT NULL,
  base_hash CHAR(64) NULL,
  package_hash CHAR(64) NULL,
  package_blob LONGBLOB NULL,
  compiler_version VARCHAR(24) NOT NULL DEFAULT '1',
  sync_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  published_at TIMESTAMP(6) NULL,
  operation_id VARCHAR(64) NOT NULL,
  UNIQUE(workbench_id, core_version),
  FOREIGN KEY(workbench_id, version_id) REFERENCES nw_ontology_version(workbench_id, id)
);

CREATE TABLE nw_project_core (
  project_id VARCHAR(64) PRIMARY KEY,
  instance_id VARCHAR(24) NOT NULL,
  version_id VARCHAR(64) NOT NULL,
  core_slug VARCHAR(100) NOT NULL,
  core_project_id VARCHAR(64) NULL,
  create_payload LONGTEXT NOT NULL,
  sync_status VARCHAR(16) NOT NULL DEFAULT 'pending',
  synced_revision BIGINT NOT NULL DEFAULT 0,
  UNIQUE(instance_id, core_slug),
  UNIQUE(instance_id, core_project_id),
  FOREIGN KEY(project_id) REFERENCES nw_project(id),
  FOREIGN KEY(version_id) REFERENCES nw_core_template_release(version_id)
);

CREATE TABLE nw_core_sync_job (
  id VARCHAR(64) PRIMARY KEY,
  sequence_no BIGINT NOT NULL AUTO_INCREMENT,
  owner_id VARCHAR(160) NOT NULL,
  workbench_id VARCHAR(64) NOT NULL,
  resource_key VARCHAR(64) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  job_kind VARCHAR(24) NOT NULL,
  target_revision BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  step VARCHAR(32) NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  lease_token VARCHAR(64) NULL,
  lease_until TIMESTAMP(6) NULL,
  next_attempt_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  error_message VARCHAR(500) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(sequence_no),
  UNIQUE(job_kind, target_id, target_revision),
  FOREIGN KEY(workbench_id) REFERENCES nw_workbench(id)
);
CREATE INDEX ix_core_job_dispatch ON nw_core_sync_job(status, next_attempt_at, lease_until);
CREATE INDEX ix_core_job_resource ON nw_core_sync_job(resource_key, sequence_no);
