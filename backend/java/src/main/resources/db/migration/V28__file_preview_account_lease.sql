-- Keep V27 immutable: it has already been applied without this lease field.
ALTER TABLE nw_file_preview ADD COLUMN active_owner VARCHAR(128);
CREATE UNIQUE INDEX uq_preview_account ON nw_file_preview(active_owner);
