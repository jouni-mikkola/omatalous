-- Schema for a multi-user household instance. Every financial row carries
-- user_id (its owner); the FinanceRepo adds `WHERE user_id = ?` to every query.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,          -- pbkdf2_sha256$<iterations>$<salt>$<hash>
  role TEXT NOT NULL DEFAULT 'member',  -- admin | member
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- The cookie holds a random token; only its SHA-256 is stored here.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

-- A user's own Enable Banking application (optional; otherwise the
-- instance-wide EB_APP_ID / EB_PRIVATE_KEY is used). Key is AES-GCM encrypted.
CREATE TABLE bank_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Bank consents (one Enable Banking session = one connection)
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
CREATE INDEX idx_connections_user ON connections(user_id);

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
CREATE INDEX idx_accounts_user ON accounts(user_id);

-- Read-only access to an account for another household member.
CREATE TABLE account_shares (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX idx_shares_user ON account_shares(user_id);

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
);
CREATE INDEX idx_tx_user_date ON transactions(user_id, booking_date);
CREATE INDEX idx_tx_account_date ON transactions(account_id, booking_date);
CREATE INDEX idx_tx_user_merchant ON transactions(user_id, merchant);

-- The user's own categorisation rules; built-in rules live in code.
CREATE TABLE category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field TEXT NOT NULL,                  -- merchant | description | counterparty | any
  pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_rules_user ON category_rules(user_id);

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
CREATE INDEX idx_sync_runs_user ON sync_runs(user_id, id);

-- Small key/value store: data version, pending authorisation states, locks.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
