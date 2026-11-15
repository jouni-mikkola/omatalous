-- migrate: breaking ops_requests is rebuilt without the list of actions; every row, its rowid and both indexes are kept
-- The CHECK on action goes for good. Migration 0006 fixed the list of maintenance actions in it and 0007 rebuilt the
-- table to widen it, since SQLite changes a CHECK only by a rebuild. The gates are elsewhere and stay: the server
-- stores a row only for a name in OPS_ACTIONS (services/ops-validate.ts), and the host helper runs only a name in its
-- own ACTIONS list (scripts/ops-helper.sh). This release adds prerelease-on and prerelease-off, and a later action
-- needs no migration. The CHECK on status stays.
-- Unlike 0007 this file does not switch foreign keys off: the table has no foreign key and no table points at it, and
-- with them off the runner checks every table before the commit, so one old orphan row elsewhere would stop the update.
CREATE TABLE ops_requests_new (
  id            TEXT PRIMARY KEY,
  action        TEXT NOT NULL,
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
