-- Frozen schema of a fresh Omatalous 0.70.0 database. apps/server/test/contracts.test.ts checks that later versions
-- keep it (contracts/README.md). Regenerate while 0.70.0 is unreleased: UPDATE_CONTRACT=0.70.0 pnpm test apps/server/test/contracts.test.ts
CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT, compat TEXT);
CREATE TABLE access_token (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  hash TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT
);
CREATE TABLE account_agreement (
  account_key TEXT NOT NULL,
  valid_from TEXT NOT NULL CHECK (length(valid_from) = 10),
  kind TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(value)),
  set_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (account_key, valid_from)
) WITHOUT ROWID;
CREATE TABLE account_balances (
  account_key TEXT NOT NULL,
  day TEXT NOT NULL,
  type TEXT NOT NULL,
  reference_date TEXT,
  cents INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (account_key, day, type)
) WITHOUT ROWID;
CREATE TABLE account_fetch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE account_history (
  account_id TEXT PRIMARY KEY,
  asked_from TEXT NOT NULL,
  first_row_day TEXT,
  source TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE TABLE account_shares (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, user_id)
);
CREATE TABLE account_split (
  account_key TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('source')),
  set_by TEXT,
  set_at TEXT NOT NULL
);
CREATE TABLE account_use (
  account_key TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  weight INTEGER NOT NULL CHECK (weight >= 0),
  said_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  said_at TEXT NOT NULL
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
, custom_name TEXT, holder TEXT, card_mask TEXT, credit_limit_cents INTEGER, bank_type_code TEXT, bank_usage TEXT, bank_product TEXT, psu_status TEXT, type_source TEXT CHECK (type_source IN ('bank', 'user')));
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
CREATE TABLE contract_terms (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_key TEXT NOT NULL,
  notice_days INTEGER,
  renews_on TEXT,
  answered_at TEXT NOT NULL,
  PRIMARY KEY (user_id, series_key)
);
CREATE TABLE expected_bills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  due_date TEXT NOT NULL,                -- the first due date, YYYY-MM-DD; later ones follow the cadence
  cadence TEXT NOT NULL CHECK (cadence IN ('once', 'quarterly', 'semiannual', 'yearly')),
  category TEXT,
  created_at TEXT NOT NULL
, reference TEXT, payee_iban TEXT);
CREATE TABLE foreign_rows (
  account_key TEXT NOT NULL,
  raw_key TEXT NOT NULL,
  booking_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  scale INTEGER NOT NULL CHECK (scale BETWEEN 0 AND 3),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  text TEXT,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (account_key, raw_key)
);
CREATE TABLE household_member (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 0),
  created_at TEXT NOT NULL
);
CREATE TABLE loans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- what the user calls it
  lender TEXT,                           -- who lent
  kind TEXT NOT NULL,                    -- mortgage | consumer | car | student | credit_line | card | instalment | other
  granted_cents INTEGER CHECK (granted_cents > 0),
  balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),  -- owed on balance_date
  balance_date TEXT NOT NULL,
  rate_bp INTEGER CHECK (rate_bp >= 0),  -- the whole rate a year, reference and margin together
  reference TEXT,                        -- euribor_12 | euribor_6 | euribor_3 | fixed
  margin_bp INTEGER CHECK (margin_bp >= 0),
  repayment TEXT,                        -- annuity | equal_principal | fixed_instalment | bullet
  interval_months INTEGER CHECK (interval_months >= 1),  -- months between payments
  payment_cents INTEGER CHECK (payment_cents > 0),  -- paid each interval; equal_principal: the amortisation alone
  end_date TEXT,                         -- the last due date
  limit_cents INTEGER CHECK (limit_cents > 0),  -- the limit of a credit line or card
  series_key TEXT,                       -- the debt series its payments belong to, NULL until linked
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL, rate_review_date TEXT);
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
CREATE TABLE optimise_inputs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  as_of   TEXT NOT NULL,                 -- the day it was saved, YYYY-MM-DD; a stale input counts as missing
  PRIMARY KEY (user_id, key)
);
CREATE TABLE optimise_snapshots (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, month)
);
CREATE TABLE optimise_states (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  finding_id     TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('done', 'dismissed', 'snoozed')),
  reason         TEXT,
  until          TEXT,
  effective_date TEXT,
  mid_cents      INTEGER,
  baseline       TEXT,
  decided_at     TEXT NOT NULL,
  PRIMARY KEY (user_id, finding_id)
);
CREATE TABLE owner_answer (
  account_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('in', 'opening')),
  key TEXT NOT NULL,
  owner TEXT NOT NULL,
  said_by TEXT NOT NULL,
  said_at TEXT NOT NULL,
  PRIMARY KEY (account_key, kind, key)
);
CREATE TABLE payer_role (
  scope TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  counterparty_key TEXT NOT NULL,
  role TEXT NOT NULL,
  answered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  answered_at TEXT NOT NULL,
  CHECK ((scope = 'member') = (user_id IS NOT NULL))
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
CREATE TABLE settlement_closed (
  account_key TEXT NOT NULL,
  month TEXT NOT NULL CHECK (length(month) = 7),
  closed_on TEXT NOT NULL CHECK (length(closed_on) = 10),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  written_at TEXT NOT NULL,
  PRIMARY KEY (account_key, month)
) WITHOUT ROWID;
CREATE TABLE spending_goal (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_cents INTEGER NOT NULL CHECK (monthly_cents > 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE statement_bill (
  bill_tx_id TEXT PRIMARY KEY REFERENCES transactions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_key TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  statement_cents INTEGER,
  saved_at TEXT NOT NULL,
  detached_at TEXT,
  detached_reason TEXT,
  CHECK (period_from <= period_to)
);
CREATE TABLE statement_rows (
  id TEXT PRIMARY KEY,
  bill_tx_id TEXT NOT NULL REFERENCES statement_bill(bill_tx_id) ON UPDATE CASCADE ON DELETE CASCADE,
  account_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  cents INTEGER NOT NULL CHECK (cents <> 0),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 120),
  row_key TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE (bill_tx_id, row_key)
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
, search_text TEXT NOT NULL DEFAULT '', bank_txn_code TEXT);
CREATE TABLE tx_part (
  tx_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  owner TEXT NOT NULL,
  kind TEXT NOT NULL,
  grp TEXT NOT NULL DEFAULT '',
  cents INTEGER NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tx_id, owner, kind, grp)
) WITHOUT ROWID;
CREATE TABLE tx_part_state (
  account_key TEXT PRIMARY KEY,
  signature TEXT NOT NULL,
  built_at TEXT NOT NULL,
  lots TEXT NOT NULL
);
CREATE TABLE user_factor (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  secret TEXT NOT NULL,
  label TEXT,
  last_step INTEGER,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE TABLE user_marks (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject   TEXT NOT NULL,
  mark      TEXT NOT NULL CHECK (mark IN ('in_use','cancelled','dismissed')),
  marked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, subject)
);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,          -- pbkdf2_sha256$<iterations>$<salt>$<hash>
  role TEXT NOT NULL DEFAULT 'member',  -- admin | member
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE valued_asset (
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  day TEXT NOT NULL,
  cents INTEGER NOT NULL CHECK (cents >= 0),
  PRIMARY KEY (id, day)
);
CREATE UNIQUE INDEX idx_access_token_hash ON access_token(hash);
CREATE INDEX idx_account_balances_ref ON account_balances(account_key, type, reference_date);
CREATE INDEX idx_account_fetch_key_at ON account_fetch(account_key, at);
CREATE UNIQUE INDEX idx_account_use_member ON account_use(account_key, COALESCE(user_id, ''));
CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_connections_user ON connections(user_id);
CREATE INDEX idx_expected_bills_user ON expected_bills(user_id);
CREATE INDEX idx_foreign_rows_day ON foreign_rows(account_key, booking_date);
CREATE UNIQUE INDEX idx_household_member_name ON household_member(name);
CREATE INDEX idx_loans_account ON loans(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX idx_loans_user ON loans(user_id);
CREATE UNIQUE INDEX idx_ops_one_active ON ops_requests((1)) WHERE status IN ('queued','running') AND action NOT IN ('doctor','check-update','logs');
CREATE INDEX idx_ops_status ON ops_requests(status, requested_at);
CREATE INDEX idx_payer_role_counterparty ON payer_role(counterparty_key);
CREATE UNIQUE INDEX idx_payer_role_payer ON payer_role(scope, COALESCE(user_id, ''), counterparty_key);
CREATE INDEX idx_rules_user ON category_rules(user_id);
CREATE INDEX idx_security_events_at ON security_events(at);
CREATE INDEX idx_security_events_user ON security_events(user_id, at);
CREATE INDEX idx_service_tokens_user ON service_tokens(user_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_shares_user ON account_shares(user_id);
CREATE INDEX idx_statement_bill_user ON statement_bill(user_id);
CREATE INDEX idx_statement_rows_key ON statement_rows(account_key, row_key);
CREATE INDEX idx_statement_rows_user ON statement_rows(user_id);
CREATE INDEX idx_sync_runs_user ON sync_runs(user_id, id);
CREATE INDEX idx_tx_account_date ON transactions(account_id, booking_date);
CREATE INDEX idx_tx_account_pending ON transactions(account_id) WHERE status = 'pending';
CREATE INDEX idx_tx_user_category_date ON transactions(user_id, category, booking_date DESC, id);
CREATE INDEX idx_tx_user_date ON transactions(user_id, booking_date);
CREATE INDEX idx_tx_user_date_amount ON transactions(user_id, booking_date, amount_cents);
CREATE INDEX idx_tx_user_merchant ON transactions(user_id, merchant);
CREATE INDEX idx_tx_user_merchant_date ON transactions(user_id, merchant, booking_date DESC, id);
CREATE INDEX idx_tx_user_uncategorised ON transactions(user_id) WHERE category_source = 'default';
CREATE INDEX idx_user_factor_user ON user_factor(user_id, kind);
