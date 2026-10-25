-- migrate: compat 0.64.0
-- Service tokens: a key a script or a coding agent sends as `Authorization: Bearer omt_…` to read one user's data
-- (services/service-tokens.ts). Only the SHA-256 of the token is stored, as with sessions, so a copy of the database
-- signs no one in. Made on the command line (`service-token create`), listed and removed there and in Asetukset. A token
-- reads with a member's rights and never writes; it ends at expires_at. Adds a table older code never reads: 0.64.0
-- opens a database that has it, and a rollback keeps it (its tokens then open nothing).
-- id: a short random handle that names the token in lists and the log; never part of the token.
-- last_used_at, last_used_ip: written at most once an hour, with a security event.
CREATE TABLE service_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  last_used_ip TEXT
);
CREATE INDEX idx_service_tokens_user ON service_tokens(user_id);
