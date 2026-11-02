-- Existing experts keep their display names; never infer private credentials by model name.
ALTER TABLE nw_expert MODIFY COLUMN model_name VARCHAR(255) NOT NULL;
ALTER TABLE nw_expert ADD COLUMN model_provider_id VARCHAR(64) NULL;
CREATE INDEX ix_expert_model_provider ON nw_expert(model_provider_id);
ALTER TABLE nw_expert ADD CONSTRAINT fk_expert_model_provider
  FOREIGN KEY (model_provider_id) REFERENCES nw_model_provider(id) ON DELETE SET NULL;
