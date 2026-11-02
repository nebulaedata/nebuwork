-- Project-local quick execution settings; independent of published templates and project revisions.
CREATE TABLE nw_project_execution_preset (
 project_id VARCHAR(64) PRIMARY KEY,
 owner_id VARCHAR(160) NOT NULL,
 title VARCHAR(300) NOT NULL DEFAULT '',
 content LONGTEXT NOT NULL,
 provider_id VARCHAR(64) NULL,
 revision BIGINT NOT NULL DEFAULT 1,
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 KEY ix_execution_preset_owner(owner_id),
 FOREIGN KEY(project_id) REFERENCES nw_project(id)
);
