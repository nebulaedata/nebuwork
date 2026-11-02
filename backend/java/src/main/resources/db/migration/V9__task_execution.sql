-- Business task state only. Core owns its execution database and file storage.
CREATE TABLE nw_task (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(160) NOT NULL, project_id VARCHAR(64) NOT NULL,
 title VARCHAR(300) NOT NULL, provider_id VARCHAR(64) NOT NULL, core_thread_id VARCHAR(64) NULL,
 sync_status VARCHAR(24) NOT NULL DEFAULT 'pending', revision BIGINT NOT NULL DEFAULT 1,
 request_key VARCHAR(160) NOT NULL, request_hash CHAR(64) NOT NULL,
 deleted_at TIMESTAMP(6) NULL, created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_task_request(owner_id,request_key), KEY ix_task_project(project_id,created_at)
);
CREATE TABLE nw_task_run (
 id VARCHAR(64) PRIMARY KEY, task_id VARCHAR(64) NOT NULL, owner_id VARCHAR(160) NOT NULL,
 project_id VARCHAR(64) NOT NULL, provider_id VARCHAR(64) NOT NULL, core_run_id VARCHAR(64) NULL,
 status VARCHAR(32) NOT NULL DEFAULT 'queued', input_json LONGTEXT NOT NULL, snapshot_json LONGTEXT NOT NULL,
 retry_of VARCHAR(64) NULL, request_key VARCHAR(160) NOT NULL, request_hash CHAR(64) NOT NULL,
 event_cursor BIGINT NOT NULL DEFAULT 0, stream_json LONGTEXT NULL, input_tokens BIGINT NOT NULL DEFAULT 0, output_tokens BIGINT NOT NULL DEFAULT 0,
 usage_known BOOLEAN NOT NULL DEFAULT FALSE, error_message VARCHAR(1000) NULL,
 projection_done BOOLEAN NOT NULL DEFAULT FALSE, lease_token VARCHAR(64) NULL, lease_until TIMESTAMP(6) NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), started_at TIMESTAMP(6) NULL, completed_at TIMESTAMP(6) NULL,
 UNIQUE KEY uq_run_request(task_id,request_key), UNIQUE KEY uq_run_core(core_run_id),
 KEY ix_run_task(task_id,created_at), KEY ix_run_sync(projection_done,lease_until), KEY ix_run_provider(provider_id,status)
);
CREATE TABLE nw_task_event (
 run_id VARCHAR(64) NOT NULL, sequence_no BIGINT NOT NULL, event_json LONGTEXT NOT NULL,
 PRIMARY KEY(run_id,sequence_no)
);
CREATE TABLE nw_task_record (
 task_id VARCHAR(64) NOT NULL, kind VARCHAR(24) NOT NULL, id VARCHAR(160) NOT NULL,
 run_id VARCHAR(64) NOT NULL, sequence_no BIGINT NOT NULL DEFAULT 0, body_json LONGTEXT NOT NULL,
 PRIMARY KEY(task_id,kind,id), KEY ix_task_record_run(run_id,kind,sequence_no)
);
CREATE TABLE nw_task_file (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(160) NOT NULL, project_id VARCHAR(64) NOT NULL, task_id VARCHAR(64) NOT NULL,
 core_artifact_id VARCHAR(64) NULL, name VARCHAR(300) NOT NULL, media_type VARCHAR(200) NOT NULL,
 size_bytes BIGINT NOT NULL, sha256 CHAR(64) NOT NULL, file_role VARCHAR(16) NOT NULL,
 source_run_id VARCHAR(64) NULL, request_key VARCHAR(160) NULL, sync_status VARCHAR(24) NOT NULL DEFAULT 'pending',
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_task_upload(owner_id,request_key), UNIQUE KEY uq_task_artifact(project_id,core_artifact_id), KEY ix_task_file(task_id)
);
CREATE TABLE nw_task_run_file (
 run_id VARCHAR(64) NOT NULL, file_id VARCHAR(64) NOT NULL, PRIMARY KEY(run_id,file_id)
);
CREATE TABLE nw_task_override (
 task_id VARCHAR(64) NOT NULL, kind VARCHAR(24) NOT NULL, target_id VARCHAR(256) NOT NULL,
 value_json TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 1, actor VARCHAR(160) NOT NULL,
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), PRIMARY KEY(task_id,kind,target_id)
);
CREATE TABLE nw_task_command (
 id VARCHAR(64) PRIMARY KEY, owner_id VARCHAR(160) NOT NULL, project_id VARCHAR(64) NOT NULL, task_id VARCHAR(64) NOT NULL,
 run_id VARCHAR(64) NULL, kind VARCHAR(24) NOT NULL, payload_json LONGTEXT NOT NULL,
 request_key VARCHAR(160) NOT NULL, request_hash CHAR(64) NOT NULL,
 state VARCHAR(24) NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0,
 lease_token VARCHAR(64) NULL, lease_until TIMESTAMP(6) NULL, error_message VARCHAR(1000) NULL,
 sequence_no BIGINT NOT NULL AUTO_INCREMENT, next_attempt_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_command_order(sequence_no), UNIQUE KEY uq_task_command(task_id,request_key), KEY ix_command_due(state,next_attempt_at)
);
CREATE TABLE nw_task_model_call (
 id VARCHAR(64) NOT NULL, run_id VARCHAR(64) NOT NULL, state VARCHAR(24) NOT NULL DEFAULT 'started',
 input_tokens BIGINT NULL, output_tokens BIGINT NULL, error_message VARCHAR(500) NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), completed_at TIMESTAMP(6) NULL,
 PRIMARY KEY(run_id,id)
);
