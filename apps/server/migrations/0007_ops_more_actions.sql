-- migrate: foreign_keys=off
-- migrate: breaking ops_requests is rebuilt to widen the action list; every row, its rowid and both indexes are kept
-- Adds the maintenance actions logs, prune and helper-renew (migration 0006 fixed the list in a CHECK, which
-- SQLite can only change by rebuilding the table). access and port stay reserved. logs only reads, so it
-- joins doctor and check-update outside the one-active-request index.
CREATE TABLE ops_requests_new (
  id            TEXT PRIMARY KEY,
  action        TEXT NOT NULL CHECK (action IN ('update','rollback','backup','restart','doctor','check-update','logs','prune','helper-renew','access','port')),
  params        TEXT NOT NULL DEFAULT '{}',
  secret_sealed BLOB,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','ok','failed','expired','cancelled')),
  requested_by  TEXT NOT NULL,
  requested_at  TEXT NOT NULL,
  claimed_at    TEXT,
  finished_at   TEXT,
  exit_code     INTEGER,
  summary       TEXT,
  output        TEXT,
  steps         TEXT
);
INSERT INTO ops_requests_new (rowid, id, action, params, secret_sealed, status, requested_by, requested_at, claimed_at, finished_at, exit_code, summary, output, steps)
  SELECT rowid, id, action, params, secret_sealed, status, requested_by, requested_at, claimed_at, finished_at, exit_code, summary, output, steps FROM ops_requests ORDER BY rowid;
DROP TABLE ops_requests;
ALTER TABLE ops_requests_new RENAME TO ops_requests;
CREATE INDEX idx_ops_status ON ops_requests(status, requested_at);
CREATE UNIQUE INDEX idx_ops_one_active ON ops_requests((1)) WHERE status IN ('queued','running') AND action NOT IN ('doctor','check-update','logs');
