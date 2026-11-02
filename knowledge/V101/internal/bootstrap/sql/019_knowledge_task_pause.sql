ALTER TABLE knowledge_bases ADD COLUMN tasks_paused boolean NOT NULL DEFAULT false;
ALTER TABLE knowledge_bases ADD COLUMN tasks_pause_generation bigint NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN pause_generation bigint NOT NULL DEFAULT 0;
