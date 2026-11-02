CREATE TABLE qa_sessions (
 id uuid PRIMARY KEY, title text NOT NULL DEFAULT '新对话',
 knowledge_base_ids jsonb NOT NULL DEFAULT '[]', knowledge_ids jsonb NOT NULL DEFAULT '[]',
 system_prompt text, enable_wiki boolean NOT NULL DEFAULT false, enable_graph boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qa_sessions_updated_idx ON qa_sessions(updated_at DESC,id);
CREATE TABLE qa_messages (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES qa_sessions(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('user','assistant')), content text NOT NULL DEFAULT '',
 state text NOT NULL DEFAULT 'completed' CHECK(state IN ('queued','running','completed','failed','cancelled','interrupted')),
 user_message_id uuid REFERENCES qa_messages(id) ON DELETE CASCADE,
 retry_of uuid REFERENCES qa_messages(id) ON DELETE SET NULL,
 request_key text, request_hash text, config jsonb NOT NULL DEFAULT '{}',
 sources jsonb NOT NULL DEFAULT '[]', images jsonb NOT NULL DEFAULT '[]', warnings jsonb NOT NULL DEFAULT '[]',
 rewritten_query text NOT NULL DEFAULT '', image_analysis text NOT NULL DEFAULT '', stage text NOT NULL DEFAULT '',
 error jsonb, cancel_requested boolean NOT NULL DEFAULT false, owner text, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qa_messages_history_idx ON qa_messages(session_id,created_at,id);
CREATE UNIQUE INDEX qa_one_active_turn_idx ON qa_messages(session_id) WHERE role='assistant' AND state IN ('queued','running');
CREATE UNIQUE INDEX qa_request_key_idx ON qa_messages(session_id,request_key) WHERE request_key IS NOT NULL;
CREATE TABLE qa_events (
 id bigserial PRIMARY KEY, message_id uuid NOT NULL REFERENCES qa_messages(id) ON DELETE CASCADE,
 kind text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX qa_events_message_idx ON qa_events(message_id,id);
