CREATE TABLE extraction_runs (
 id uuid PRIMARY KEY, task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
 knowledge_id uuid NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
 file_version_id uuid NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
 parse_version_id uuid NOT NULL REFERENCES parse_versions(id) ON DELETE CASCADE,
 model_id uuid REFERENCES models(id) ON DELETE SET NULL,
 config jsonb NOT NULL, input jsonb NOT NULL, input_hash text NOT NULL,
 summary jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX extraction_runs_document_idx ON extraction_runs(knowledge_id,created_at DESC);
CREATE UNIQUE INDEX extraction_active_document_idx ON tasks(knowledge_id)
 WHERE type='clause_extraction' AND state IN ('queued','running','waiting_configuration');
CREATE TABLE extraction_units (
 run_id uuid NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
 unit_id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(run_id,unit_id)
);
CREATE TABLE extraction_blocks (
 run_id uuid NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
 block_id text NOT NULL, ordinal integer NOT NULL, state text NOT NULL,
 data jsonb NOT NULL, error text, PRIMARY KEY(run_id,block_id)
);
CREATE TABLE extraction_records (
 run_id uuid NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
 id text NOT NULL, block_id text NOT NULL, ordinal integer NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(run_id,id)
);
CREATE INDEX extraction_records_block_idx ON extraction_records(run_id,block_id,ordinal);
CREATE TABLE extraction_coverage (
 run_id uuid NOT NULL REFERENCES extraction_runs(id) ON DELETE CASCADE,
 unit_id text NOT NULL, block_id text NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(run_id,unit_id)
);
