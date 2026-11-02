-- Existing expert records are shared configuration. Removal affects only the verified account's list.
CREATE TABLE nw_expert_membership (
  owner_id VARCHAR(160) NOT NULL,
  expert_id VARCHAR(64) NOT NULL,
  removed BOOLEAN NOT NULL DEFAULT FALSE,
  revision BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY(owner_id, expert_id),
  FOREIGN KEY(expert_id) REFERENCES nw_expert(id) ON DELETE CASCADE
);
