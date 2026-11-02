CREATE TABLE nw_workbench (
  id VARCHAR(64) PRIMARY KEY,
  owner_id VARCHAR(160) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  icon VARCHAR(64) NOT NULL,
  color VARCHAR(9) NOT NULL,
  source_template_id VARCHAR(64) NULL,
  active_version_id VARCHAR(64) NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  create_request_key VARCHAR(128) NOT NULL,
  create_request_hash CHAR(64) NOT NULL,
  deleted_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(owner_id, create_request_key)
);
CREATE INDEX ix_workbench_owner ON nw_workbench(owner_id, deleted_at, created_at);

CREATE TABLE nw_workbench_draft (
  workbench_id VARCHAR(64) PRIMARY KEY,
  definition_json LONGTEXT NOT NULL,
  FOREIGN KEY(workbench_id) REFERENCES nw_workbench(id)
);
CREATE TABLE nw_workbench_agent (
  workbench_id VARCHAR(64) NOT NULL,
  expert_id VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL,
  PRIMARY KEY(workbench_id, expert_id),
  FOREIGN KEY(workbench_id) REFERENCES nw_workbench(id),
  FOREIGN KEY(expert_id) REFERENCES nw_expert(id)
);
CREATE TABLE nw_workbench_case (
  workbench_id VARCHAR(64) NOT NULL,
  template_id VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL,
  PRIMARY KEY(workbench_id, template_id),
  FOREIGN KEY(workbench_id) REFERENCES nw_workbench(id),
  FOREIGN KEY(template_id) REFERENCES nw_case_template(id)
);
CREATE TABLE nw_ontology_version (
  id VARCHAR(64) PRIMARY KEY,
  workbench_id VARCHAR(64) NOT NULL,
  version_number INT NOT NULL,
  source_revision BIGINT NOT NULL,
  snapshot_json LONGTEXT NOT NULL,
  content_hash CHAR(64) NOT NULL,
  published_by VARCHAR(160) NOT NULL,
  published_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(workbench_id, version_number),
  UNIQUE(workbench_id, source_revision),
  UNIQUE(workbench_id, id),
  FOREIGN KEY(workbench_id) REFERENCES nw_workbench(id)
);
CREATE TABLE nw_project (
  id VARCHAR(64) PRIMARY KEY,
  owner_id VARCHAR(160) NOT NULL,
  workbench_id VARCHAR(64) NOT NULL,
  ontology_version_id VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(2000) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  revision BIGINT NOT NULL DEFAULT 1,
  create_request_key VARCHAR(128) NOT NULL,
  create_request_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  UNIQUE(owner_id, create_request_key),
  FOREIGN KEY(workbench_id) REFERENCES nw_workbench(id),
  FOREIGN KEY(workbench_id, ontology_version_id) REFERENCES nw_ontology_version(workbench_id, id)
);
CREATE INDEX ix_project_owner_workbench ON nw_project(owner_id, workbench_id, created_at);
