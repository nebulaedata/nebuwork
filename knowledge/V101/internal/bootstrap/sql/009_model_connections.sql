CREATE TABLE model_connections (
 id uuid PRIMARY KEY,
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 256),
 base_url text NOT NULL,
 secret bytea,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE models ADD COLUMN connection_id uuid REFERENCES model_connections(id) ON DELETE RESTRICT;
CREATE INDEX models_connection_idx ON models(connection_id);

-- Existing credentials remain encrypted with the installation key. Preserve exact
-- addresses so upgrading does not change a working model endpoint or vector signature.
INSERT INTO model_connections(id,name,base_url,secret)
SELECT gen_random_uuid(),left('已有连接 · '||name,256),base_url,secret
FROM (SELECT DISTINCT ON(base_url,secret) name,base_url,secret
      FROM models ORDER BY base_url,secret,created_at,id) existing;
UPDATE models m SET connection_id=c.id
FROM model_connections c
WHERE m.base_url=c.base_url AND m.secret IS NOT DISTINCT FROM c.secret;
UPDATE models SET secret=NULL WHERE connection_id IS NOT NULL;
ALTER TABLE models ADD CONSTRAINT models_connection_credentials CHECK(connection_id IS NULL OR secret IS NULL);
