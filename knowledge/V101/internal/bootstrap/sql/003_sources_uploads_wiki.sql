ALTER TABLE source_refs ADD COLUMN origin text NOT NULL DEFAULT 'native';
ALTER TABLE source_refs ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
CREATE TABLE upload_parts(upload_id uuid NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,part_number integer NOT NULL CHECK(part_number>0),size bigint NOT NULL,checksum text NOT NULL,path text NOT NULL,PRIMARY KEY(upload_id,part_number));
CREATE TABLE query_images(id uuid PRIMARY KEY,path text NOT NULL,size bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL);
CREATE TABLE wiki_folders(id uuid PRIMARY KEY,knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,name text NOT NULL,parent_id uuid REFERENCES wiki_folders(id) ON DELETE CASCADE);
ALTER TABLE wiki_pages ADD COLUMN folder_id uuid REFERENCES wiki_folders(id) ON DELETE SET NULL;
CREATE TABLE document_folders(id uuid PRIMARY KEY,knowledge_base_id uuid NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,name text NOT NULL,parent_id uuid REFERENCES document_folders(id) ON DELETE CASCADE);
ALTER TABLE knowledge ADD COLUMN folder_id uuid REFERENCES document_folders(id) ON DELETE SET NULL;
ALTER TABLE knowledge ADD COLUMN tags jsonb NOT NULL DEFAULT '[]';
