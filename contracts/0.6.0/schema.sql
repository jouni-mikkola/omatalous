-- Frozen schema of a fresh Omatalous 0.6.0 database. apps/server/test/contracts.test.ts checks that later versions
-- keep it (contracts/README.md). Regenerate while 0.6.0 is unreleased: UPDATE_CONTRACT=0.6.0 pnpm test apps/server/test/contracts.test.ts
CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT, compat TEXT);
CREATE TABLE account_shares (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, user_id)
);
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,               -- enablebanking | csv | demo
  external_id TEXT,                     -- provider's account uid (changes with every consent)
  identity TEXT,                        -- stable hash of IBAN / identification_hash: the same real account
  name TEXT NOT NULL,
  iban TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  type TEXT NOT NULL DEFAULT 'checking', -- checking | savings | credit_card | other
  balance_cents INTEGER,
  balance_at TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE bank_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field TEXT NOT NULL,                  -- merchant | description | counterparty | any
  pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL
);
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  institution TEXT NOT NULL,
  country TEXT NOT NULL,
  status TEXT NOT NULL,                 -- active | expired | revoked
  valid_until TEXT,
  created_at TEXT NOT NULL,
  last_synced_at TEXT
);
CREATE TABLE merchant_industry (
  merchant TEXT PRIMARY KEY,
  status TEXT NOT NULL,                 -- found | none | ambiguous | error
  business_id TEXT,
  company_name TEXT,
  industry_code TEXT,                   -- TOL code, e.g. 56300
  code_set TEXT,                        -- TOL2008 | TOL2025
  industry_label TEXT,                  -- Finnish description from the register
  checked_at TEXT NOT NULL
);
CREATE TABLE merchant_industry_users (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  merchant TEXT NOT NULL,
  PRIMARY KEY (user_id, merchant)
);
CREATE TABLE "ops_requests" (
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
CREATE TABLE security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  detail TEXT,
  notify INTEGER NOT NULL DEFAULT 0,
  seen_at TEXT
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,                -- schedule | manual | connect
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,                 -- running | ok | partial | failed
  fetched INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  message TEXT
);
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  booking_date TEXT NOT NULL,           -- YYYY-MM-DD
  value_date TEXT,
  amount_cents INTEGER NOT NULL,        -- negative = money out
  currency TEXT NOT NULL,
  status TEXT NOT NULL,                 -- booked | pending
  counterparty TEXT,
  counterparty_iban TEXT,
  description TEXT,
  reference TEXT,
  mcc TEXT,
  merchant TEXT NOT NULL,
  category TEXT NOT NULL,
  category_source TEXT NOT NULL,        -- user | rule | mcc | default | transfer
  is_transfer INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,                 -- enablebanking | csv | demo
  raw TEXT,
  imported_at TEXT NOT NULL
, search_text TEXT NOT NULL DEFAULT '');
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,          -- pbkdf2_sha256$<iterations>$<salt>$<hash>
  role TEXT NOT NULL DEFAULT 'member',  -- admin | member
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_connections_user ON connections(user_id);
CREATE UNIQUE INDEX idx_ops_one_active ON ops_requests((1)) WHERE status IN ('queued','running') AND action NOT IN ('doctor','check-update','logs');
CREATE INDEX idx_ops_status ON ops_requests(status, requested_at);
CREATE INDEX idx_rules_user ON category_rules(user_id);
CREATE INDEX idx_security_events_at ON security_events(at);
CREATE INDEX idx_security_events_user ON security_events(user_id, at);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_shares_user ON account_shares(user_id);
CREATE INDEX idx_sync_runs_user ON sync_runs(user_id, id);
CREATE INDEX idx_tx_account_date ON transactions(account_id, booking_date);
CREATE INDEX idx_tx_account_pending ON transactions(account_id) WHERE status = 'pending';
CREATE INDEX idx_tx_user_category_date ON transactions(user_id, category, booking_date DESC, id);
CREATE INDEX idx_tx_user_date ON transactions(user_id, booking_date);
CREATE INDEX idx_tx_user_date_amount ON transactions(user_id, booking_date, amount_cents);
CREATE INDEX idx_tx_user_merchant ON transactions(user_id, merchant);
CREATE INDEX idx_tx_user_merchant_date ON transactions(user_id, merchant, booking_date DESC, id);
CREATE INDEX idx_tx_user_uncategorised ON transactions(user_id) WHERE category_source = 'default';
