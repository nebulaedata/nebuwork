CREATE TABLE nw_user_account (
 id VARCHAR(128) PRIMARY KEY,
 account VARCHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL UNIQUE,
 password_hash VARCHAR(100) NOT NULL,
 display_name VARCHAR(120) NOT NULL,
 role VARCHAR(16) NOT NULL DEFAULT 'user',
 enabled BOOLEAN NOT NULL DEFAULT TRUE,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
);
CREATE TABLE nw_account_session (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 account_id VARCHAR(128) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 expires_at TIMESTAMP(6) NOT NULL,
 revoked_at TIMESTAMP(6) NULL,
 INDEX ix_account_session_owner (account_id, expires_at),
 CONSTRAINT fk_account_session_owner FOREIGN KEY (account_id) REFERENCES nw_user_account(id)
);
