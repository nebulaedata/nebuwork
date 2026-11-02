-- Optional source selection; dedicated publication IDs and historical snapshots stay immutable.
ALTER TABLE nw_core_template_release MODIFY COLUMN base_template_id VARCHAR(100) NULL;
ALTER TABLE nw_core_template_release MODIFY COLUMN base_version VARCHAR(64) NULL;
ALTER TABLE nw_workbench MODIFY COLUMN source_template_id VARCHAR(100) NULL;
