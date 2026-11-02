-- SOP materials are immutable engine artifacts, not files on a Java node.
ALTER TABLE nw_sop_material ADD COLUMN artifact_id VARCHAR(128);
ALTER TABLE nw_sop_material ADD COLUMN artifact_version INT;
ALTER TABLE nw_sop_material ADD COLUMN artifact_owner_id VARCHAR(128);
ALTER TABLE nw_sop_material ADD COLUMN byte_size BIGINT;
ALTER TABLE nw_sop_material ADD COLUMN sha256 CHAR(64);
