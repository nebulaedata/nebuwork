CREATE TABLE IF NOT EXISTS nw_agent_request (
 owner_id VARCHAR(128) NOT NULL, scope VARCHAR(255) NOT NULL, request_key VARCHAR(128) NOT NULL,
 request_hash CHAR(64) NOT NULL, result_json JSON,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 PRIMARY KEY(owner_id,scope,request_key)
);
