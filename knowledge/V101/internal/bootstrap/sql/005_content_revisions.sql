ALTER TABLE wiki_pages ADD COLUMN state text NOT NULL DEFAULT 'ready';
CREATE TABLE chunk_revisions(id uuid PRIMARY KEY,chunk_id uuid NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,content text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE wiki_links(source_id uuid NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,target_id uuid NOT NULL REFERENCES wiki_pages(id) ON DELETE CASCADE,PRIMARY KEY(source_id,target_id));
