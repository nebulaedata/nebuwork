-- Extend the service ledger without changing the initial service migration.
ALTER TABLE nw_service_operation ADD COLUMN source_channel VARCHAR(16) NOT NULL DEFAULT 'api';
ALTER TABLE nw_service_operation ADD COLUMN usage_json LONGTEXT;
