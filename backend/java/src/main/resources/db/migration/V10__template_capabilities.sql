-- Immutable template resources. Draft removal never deletes a published resource.
CREATE TABLE nw_template_resource (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(160) NOT NULL, workbench_id VARCHAR(64) NOT NULL,
 path VARCHAR(1000) NOT NULL, sha256 CHAR(64) NOT NULL, size_bytes BIGINT NOT NULL,
 content LONGBLOB NOT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY ix_template_resource_workbench(workbench_id)
);
CREATE TABLE nw_template_mcp_secret (
 workbench_id VARCHAR(64) NOT NULL, server_id VARCHAR(100) NOT NULL, owner_id VARCHAR(160) NOT NULL,
 encrypted_value LONGTEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY(workbench_id,server_id)
);
ALTER TABLE nw_project ADD COLUMN template_parameters LONGTEXT NULL;
ALTER TABLE nw_project ADD COLUMN template_execution_json LONGTEXT NULL;
ALTER TABLE nw_task ADD COLUMN template_version_id VARCHAR(64) NULL;
ALTER TABLE nw_task ADD COLUMN template_hash CHAR(64) NULL;
ALTER TABLE nw_task ADD COLUMN template_snapshot LONGTEXT NULL;
UPDATE nw_task SET
 template_version_id=(SELECT p.ontology_version_id FROM nw_project p WHERE p.id=nw_task.project_id),
 template_hash=(SELECT r.package_hash FROM nw_project p JOIN nw_core_template_release r ON r.version_id=p.ontology_version_id WHERE p.id=nw_task.project_id),
 template_snapshot=(SELECT v.snapshot_json FROM nw_project p JOIN nw_ontology_version v ON v.id=p.ontology_version_id WHERE p.id=nw_task.project_id);
CREATE TABLE nw_template_upgrade (
 operation_id VARCHAR(64) PRIMARY KEY, project_id VARCHAR(64) NOT NULL,
 from_version_id VARCHAR(64) NOT NULL, to_version_id VARCHAR(64) NOT NULL,
 request_key VARCHAR(128) NOT NULL, request_hash CHAR(64) NOT NULL, payload_json LONGTEXT NOT NULL, execution_json LONGTEXT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), UNIQUE KEY uq_upgrade_request(project_id,request_key)
);

ALTER TABLE nw_core_template_release ADD COLUMN execution_json LONGTEXT NULL;

CREATE TABLE nw_task_model_attempt (
 run_id VARCHAR(64) NOT NULL, call_id VARCHAR(64) NOT NULL, attempt_no INT NOT NULL,
 http_status INT NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(run_id,call_id,attempt_no)
);
