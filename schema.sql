CREATE TABLE IF NOT EXISTS gifts (
 id TEXT PRIMARY KEY,
 mk1_salt TEXT NOT NULL,
 mk1_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','draft','locked')),
 upload_hash TEXT,
 upload_expires INTEGER,
 salt TEXT,
 iv TEXT,
 chunk_count INTEGER,
 fail_count INTEGER NOT NULL DEFAULT 0,
 blocked_until INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 locked_at INTEGER
);
CREATE TABLE IF NOT EXISTS gift_chunks (
 gift_id TEXT NOT NULL,
 idx INTEGER NOT NULL,
 data TEXT NOT NULL,
 PRIMARY KEY(gift_id,idx),
 FOREIGN KEY(gift_id) REFERENCES gifts(id)
);
CREATE TABLE IF NOT EXISTS read_sessions (
 token_hash TEXT PRIMARY KEY,
 gift_id TEXT NOT NULL,
 expires INTEGER NOT NULL,
 FOREIGN KEY(gift_id) REFERENCES gifts(id)
);
CREATE INDEX IF NOT EXISTS idx_read_sessions_expiry ON read_sessions(expires);
