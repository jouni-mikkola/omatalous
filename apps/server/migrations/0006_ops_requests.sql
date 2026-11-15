-- Web maintenance requests (Asetukset > Palvelin > Ylläpito). The app only writes rows; a helper on the
-- host polls them through `ops poll` and runs fixed scripts. The helper keeps its own journal, so a
-- restored database cannot make it repeat a request. Audit goes to security_events (kinds ops_*).
-- access and port are reserved for a later release; the server refuses them for now.
CREATE TABLE ops_requests (
  id            TEXT PRIMARY KEY,
  action        TEXT NOT NULL CHECK (action IN ('update','rollback','backup','restart','doctor','check-update','access','port')),
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
CREATE INDEX idx_ops_status ON ops_requests(status, requested_at);
-- one mutating request at a time; doctor and check-update only read
CREATE UNIQUE INDEX idx_ops_one_active ON ops_requests((1)) WHERE status IN ('queued','running') AND action NOT IN ('doctor','check-update');
