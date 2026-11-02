CREATE TABLE workspaces (id text PRIMARY KEY, name text NOT NULL);
INSERT INTO workspaces VALUES ('public','公共空间');
CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE models (
 id uuid PRIMARY KEY, name text NOT NULL, purpose text NOT NULL, protocol text NOT NULL DEFAULT 'openai',
 base_url text NOT NULL, model_name text NOT NULL, secret bytea, dimension integer,
 config jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE knowledge_bases (
 id uuid PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) DEFAULT 'public',
 name text NOT NULL CHECK (length(trim(name))>0), description text NOT NULL DEFAULT '',
 config jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE knowledge (
 id uuid PRIMARY KEY, knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
 name text NOT NULL, file_type text NOT NULL, status text NOT NULL DEFAULT 'queued',
 current_file_version_id uuid, current_parse_version_id uuid, config jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_kb_idx ON knowledge(knowledge_base_id,created_at DESC);
CREATE TABLE file_versions (
 id uuid PRIMARY KEY, knowledge_id uuid NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
 hash text NOT NULL, path text NOT NULL UNIQUE, size bigint NOT NULL CHECK(size>=0), mime_type text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(knowledge_id,id)
);
CREATE TABLE parse_versions (
 id uuid PRIMARY KEY, knowledge_id uuid NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
 file_version_id uuid NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
 engine text NOT NULL, content text NOT NULL DEFAULT '', metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE source_refs (
 id uuid PRIMARY KEY, knowledge_id uuid NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
 file_version_id uuid NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
 parse_version_id uuid NOT NULL REFERENCES parse_versions(id) ON DELETE CASCADE,
 locators jsonb NOT NULL, quote text NOT NULL, precision text NOT NULL,
 char_start integer NOT NULL, char_end integer NOT NULL CHECK(char_end>=char_start), status text NOT NULL DEFAULT 'available'
);
CREATE TABLE chunks (
 id uuid PRIMARY KEY, knowledge_id uuid NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
 parse_version_id uuid NOT NULL REFERENCES parse_versions(id) ON DELETE CASCADE,
 source_ref_id uuid NOT NULL REFERENCES source_refs(id) ON DELETE CASCADE,
 ordinal integer NOT NULL, content text NOT NULL, search_vector tsvector NOT NULL,
 UNIQUE(parse_version_id,ordinal)
);
CREATE INDEX chunks_search_idx ON chunks USING gin(search_vector);
CREATE INDEX chunks_knowledge_idx ON chunks(knowledge_id);
CREATE TABLE embedding_spaces (
 id uuid PRIMARY KEY, model_id uuid NOT NULL REFERENCES models(id), dimension integer NOT NULL CHECK(dimension>0),
 kind text NOT NULL, config_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(model_id,kind,config_hash)
);
CREATE TABLE embeddings (
 id uuid PRIMARY KEY, space_id uuid NOT NULL REFERENCES embedding_spaces(id) ON DELETE CASCADE,
 chunk_id uuid REFERENCES chunks(id) ON DELETE CASCADE, source_ref_id uuid NOT NULL REFERENCES source_refs(id) ON DELETE CASCADE,
 embedding vector NOT NULL, UNIQUE(space_id,source_ref_id)
);
CREATE TABLE outlines (
 id uuid PRIMARY KEY, knowledge_id uuid NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
 parse_version_id uuid NOT NULL REFERENCES parse_versions(id) ON DELETE CASCADE,
 status text NOT NULL, structure jsonb NOT NULL DEFAULT '[]', reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE assets (
 id uuid PRIMARY KEY, knowledge_id uuid NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
 file_version_id uuid NOT NULL REFERENCES file_versions(id) ON DELETE CASCADE,
 kind text NOT NULL, path text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE media (
 file_version_id uuid PRIMARY KEY REFERENCES file_versions(id) ON DELETE CASCADE,
 duration_ms bigint, metadata jsonb NOT NULL DEFAULT '{}', transcript jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE wiki_pages (
 id uuid PRIMARY KEY, knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
 title text NOT NULL, content text NOT NULL, source_ids jsonb NOT NULL DEFAULT '[]',
 search_vector tsvector NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(knowledge_base_id,title)
);
CREATE INDEX wiki_search_idx ON wiki_pages USING gin(search_vector);
CREATE TABLE wiki_revisions (
 id uuid PRIMARY KEY, page_id uuid NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,
 content text NOT NULL, source_ids jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE graph_records (
 id uuid PRIMARY KEY, knowledge_id uuid NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
 source_ref_id uuid NOT NULL REFERENCES source_refs(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, synced_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE upload_sessions (
 id uuid PRIMARY KEY, knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
 name text NOT NULL, size bigint NOT NULL, offset_bytes bigint NOT NULL DEFAULT 0,
 path text NOT NULL, state text NOT NULL DEFAULT 'uploading', expires_at timestamptz NOT NULL,
 knowledge_id uuid REFERENCES knowledge(id) ON DELETE SET NULL
);
CREATE TABLE tasks (
 id uuid PRIMARY KEY, knowledge_base_id uuid REFERENCES knowledge_bases(id) ON DELETE CASCADE,
 knowledge_id uuid REFERENCES knowledge(id) ON DELETE CASCADE, type text NOT NULL,
 state text NOT NULL DEFAULT 'queued', stage text NOT NULL DEFAULT 'pending',
 config jsonb NOT NULL DEFAULT '{}', checkpoint jsonb NOT NULL DEFAULT '{}', error jsonb,
 attempts integer NOT NULL DEFAULT 0, cancel_requested boolean NOT NULL DEFAULT false,
 lease_until timestamptz, owner text, next_run_at timestamptz NOT NULL DEFAULT now(),
 idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_dispatch_idx ON tasks(state,next_run_at);
CREATE TABLE task_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 event jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_events_task_idx ON task_events(task_id,id);
CREATE TABLE outbox (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
 kind text NOT NULL, payload jsonb NOT NULL, delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE request_keys (
 scope text NOT NULL, key text NOT NULL, request_hash text NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scope,key)
);
