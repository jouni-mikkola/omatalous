-- Frozen database as written by Omatalous 0.46.0. Never edit; add a new file per release.
-- Everything in 0.39.0.sql plus what 0.46.0 adds: the _migrations rows of 0021_household_stores.sql (the checksums and floors the runner writes), the tables account_balances (5 rows), account_history (2 rows), account_fetch (3 rows), statement_bill (2 rows), statement_rows (3 rows), foreign_rows (3 rows), payer_role (3 rows), household_member (2 rows), account_agreement (3 rows), user_factor (2 rows), valued_asset (3 rows), contract_terms (2 rows), access_token (2 rows), the columns expected_bills.reference, expected_bills.payee_iban.
-- Rows of access_token: Keys of u-aino for reading a summary: one that expires and was used, one that never expires. The hashes are made up.
-- Rows of account_agreement: Dated agreements for the joint account idn-5: equal from the start of the year, then a share from October, each set by a member; and a fixed one on idn-1 set by nobody (set_by NULL, as after that member was removed).
-- Rows of account_balances: Balances the bank sent for the joint account idn-5 on two days (CLBD with its reference day, ITAV with none), a balance the bank sent in a word that is no four capitals (OTHR), and a seed row from the stored balance of idn-1 (no reference day).
-- Rows of account_fetch: Calls to the bank for the joint account idn-5: one by each member, and one by a member who is gone (user_id NULL).
-- Rows of account_history: How far back the app asked for the rows of two accounts: the joint account a-5 with an older stored row than the first fetch (source default) and a-1 asked for a longer history.
-- Rows of contract_terms: Notice periods two members answered for the same contract series: one with a period and a renewal day, one with neither.
-- Rows of foreign_rows: Rows of another currency for the joint account idn-5: a USD row with two decimals, a JPY row with none, and a row of an unknown currency (XXX) with no text.
-- Rows of household_member: Two people of the household with no login, one with the default weight and one with a typed weight.
-- Rows of payer_role: Answers about money from a payer: a member's own answer (u-aino, gift), the household's default for the same payer (cost_share) and a member's answer for a payer named by IBAN (own_money).
-- Rows of statement_bill: The card bill t-12 (a row of the joint account a-5) with the statement u-aino kept for it, and a detached one of u-eero.
-- Rows of statement_rows: Three purchases of the bill t-12, by u-aino: two shops and a refund (money back, so a plus).
-- Rows of user_factor: Second factors of u-aino: a TOTP seed (a made-up string standing for the sealed text) used once, and a recovery code (a made-up hash) never used.
-- Rows of valued_asset: A cottage valued twice (the latest day is its value) and a car valued once, both made up.
-- The schema is the 0.39.0 schema migrated by the 0.46.0 code and equals contracts/0.46.0/schema.sql.
-- Loaded by apps/server/test/migration-chain.test.ts and apps/server/test/contracts.test.ts.
PRAGMA foreign_keys = OFF;
CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT, compat TEXT);
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,          -- pbkdf2_sha256$<iterations>$<salt>$<hash>
  role TEXT NOT NULL DEFAULT 'member',  -- admin | member
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE TABLE bank_credentials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
, custom_name TEXT, holder TEXT, card_mask TEXT, credit_limit_cents INTEGER);
CREATE TABLE account_shares (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (account_id, user_id)
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
CREATE TABLE category_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field TEXT NOT NULL,                  -- merchant | description | counterparty | any
  pattern TEXT NOT NULL,
  category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL
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
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
CREATE TABLE user_marks (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject   TEXT NOT NULL,
  mark      TEXT NOT NULL CHECK (mark IN ('in_use','cancelled','dismissed')),
  marked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, subject)
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
CREATE TABLE optimise_inputs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  as_of   TEXT NOT NULL,                 -- the day it was saved, YYYY-MM-DD; a stale input counts as missing
  PRIMARY KEY (user_id, key)
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
CREATE TABLE optimise_snapshots (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, month)
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
CREATE TABLE account_use (
  account_key TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  weight INTEGER NOT NULL CHECK (weight >= 0),
  said_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  said_at TEXT NOT NULL
);
CREATE TABLE account_split (
  account_key TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('source')),
  set_by TEXT,
  set_at TEXT NOT NULL
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
CREATE TABLE account_history (
  account_id TEXT PRIMARY KEY,
  asked_from TEXT NOT NULL,
  first_row_day TEXT,
  source TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
CREATE TABLE account_fetch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL
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
CREATE TABLE payer_role (
  scope TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  counterparty_key TEXT NOT NULL,
  role TEXT NOT NULL,
  answered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  answered_at TEXT NOT NULL,
  CHECK ((scope = 'member') = (user_id IS NOT NULL))
);
CREATE TABLE household_member (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 0),
  created_at TEXT NOT NULL
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
CREATE TABLE valued_asset (
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  day TEXT NOT NULL,
  cents INTEGER NOT NULL CHECK (cents >= 0),
  PRIMARY KEY (id, day)
);
CREATE TABLE contract_terms (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_key TEXT NOT NULL,
  notice_days INTEGER,
  renews_on TEXT,
  answered_at TEXT NOT NULL,
  PRIMARY KEY (user_id, series_key)
);
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
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_connections_user ON connections(user_id);
CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_shares_user ON account_shares(user_id);
CREATE INDEX idx_tx_user_date ON transactions(user_id, booking_date);
CREATE INDEX idx_tx_account_date ON transactions(account_id, booking_date);
CREATE INDEX idx_tx_user_merchant ON transactions(user_id, merchant);
CREATE INDEX idx_rules_user ON category_rules(user_id);
CREATE INDEX idx_sync_runs_user ON sync_runs(user_id, id);
CREATE INDEX idx_tx_account_pending ON transactions(account_id) WHERE status = 'pending';
CREATE INDEX idx_tx_user_uncategorised ON transactions(user_id) WHERE category_source = 'default';
CREATE INDEX idx_security_events_at ON security_events(at);
CREATE INDEX idx_security_events_user ON security_events(user_id, at);
CREATE INDEX idx_tx_user_date_amount ON transactions(user_id, booking_date, amount_cents);
CREATE INDEX idx_tx_user_merchant_date ON transactions(user_id, merchant, booking_date DESC, id);
CREATE INDEX idx_tx_user_category_date ON transactions(user_id, category, booking_date DESC, id);
CREATE INDEX idx_expected_bills_user ON expected_bills(user_id);
CREATE INDEX idx_loans_user ON loans(user_id);
CREATE INDEX idx_loans_account ON loans(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX idx_ops_status ON ops_requests(status, requested_at);
CREATE UNIQUE INDEX idx_ops_one_active ON ops_requests((1)) WHERE status IN ('queued','running') AND action NOT IN ('doctor','check-update','logs');
CREATE UNIQUE INDEX idx_account_use_member ON account_use(account_key, COALESCE(user_id, ''));
CREATE INDEX idx_account_balances_ref ON account_balances(account_key, type, reference_date);
CREATE INDEX idx_account_fetch_key_at ON account_fetch(account_key, at);
CREATE INDEX idx_statement_bill_user ON statement_bill(user_id);
CREATE INDEX idx_statement_rows_key ON statement_rows(account_key, row_key);
CREATE INDEX idx_statement_rows_user ON statement_rows(user_id);
CREATE INDEX idx_foreign_rows_day ON foreign_rows(account_key, booking_date);
CREATE UNIQUE INDEX idx_payer_role_payer ON payer_role(scope, COALESCE(user_id, ''), counterparty_key);
CREATE INDEX idx_payer_role_counterparty ON payer_role(counterparty_key);
CREATE UNIQUE INDEX idx_household_member_name ON household_member(name);
CREATE INDEX idx_user_factor_user ON user_factor(user_id, kind);
CREATE UNIQUE INDEX idx_access_token_hash ON access_token(hash);
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0001_init.sql','2026-10-10T08:00:00.000Z','eaaa4438abe0820896de9910ed0e96b22161d9582da98693134f9ea2a016f9c2',NULL);
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0002_merchant_industry.sql','2026-10-10T08:00:00.000Z','cff4fff770c07304810c3a0d56b7827b4f59bcc8a101802432af50accac3dc1b',NULL);
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0003_search_text.sql','2026-10-10T08:00:00.000Z','a2a9eacc5f5e7cec4832c41bdbe6436be1099e94aae1ee7cbb2d97c483505ab2',NULL);
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0004_partial_indexes.sql','2026-10-10T08:00:00.000Z','ac98af7be524d4e14b2e56546980c2338d07f721dddc2a1f12e2225252e68f76',NULL);
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0005_security_events.sql','2026-10-10T08:00:00.000Z','79b354a01312f4d10ed2d4017ea53af0bab61355e8a6e5982b3aea5be0c86bf0',NULL);
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0006_ops_requests.sql','2026-10-10T08:00:00.000Z','59eb4860c33882e1355d67b1d36a331ede88972efd4f4580d719042aafdfbefd',NULL);
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0007_ops_more_actions.sql','2026-10-10T08:00:00.000Z','141631cce9618911e7aa15d89dcc1581cbd783f1399db621c9b6a9c1e75164fc',NULL);
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0008_list_indexes.sql','2026-10-10T08:00:00.000Z','f9780f0301662f17023cb91ef4ca2b8b1c422ecb2b8bf3adbf447f81eeec4a8b',NULL);
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0009_migration_compat.sql','2026-10-10T09:00:00.000Z','85a7e9e59cf908a846425a3d6bf30f30d179784f8196d2c621d7a314a8d3c82c','0.6.0');
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0010_user_marks.sql','2026-10-11T08:00:00.000Z','28dba5aba2fba1574d90b5f35f196178543c6bf940707b610b8f799e6087368e','0.6.0');
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0011_expected_bills.sql','2026-10-11T08:00:00.000Z','489b52baab95db7de03a0542f7e494e12adddd091b0d7c87d454cf5b01cd2be7','0.6.0');
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0012_optimise.sql','2026-10-12T08:00:00.000Z','b940361345e2a4cfa451da4065ee07b14bf26545423df740f3c232dbcca9b277','0.7.0');
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0013_account_names.sql','2026-10-11T08:00:00.000Z','11313eb7c65e6ccd9ad6f8b55947c5b1785c69e7ddb0eeed3200e1733ffdbc3a','0.8.0');
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0014_loans.sql','2026-10-12T08:00:00.000Z','8efebede9bb75420c0c399e1fa25f0c518294afe33063911e49df0ad804f5e45','0.8.0');
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0015_bank_txn_code.sql','2026-10-12T08:00:00.000Z','d96c882de8975cecdfd779cf517c274a2de80760cf98b9d6d9bf6ab98d50e64f','0.8.0');
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0016_loan_account.sql','2026-10-12T08:00:00.000Z','89d9879dd37ab66b6af294203e62cc302208a296c6023ff0b209c8cd192179c2','0.8.0');
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0017_ops_actions_open.sql','2026-10-12T08:00:00.000Z','0062ee58d5170d56a40b5dc4bbe61aebce2ae46700cfb28e0cfbbfd8fdb0d0ff',NULL);
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0018_account_use.sql','2026-10-12T08:00:00.000Z','b9b1dd05341a801f466f6bcf1f8a641d34e0897c15ab24d659ddeb9dea4a5987','0.10.0');
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0019_loan_rate_review.sql','2026-10-12T08:00:00.000Z','564926c172c90e46dc7d33cf97e9504f63cf544e7d0da1266c2e7e633653f4bb','0.11.0');
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0020_account_split.sql','2026-10-13T08:00:00.000Z','e69ee61102b0bb64a3564bd45af65247304f964923cfbd14bcd7b982dab95659',NULL);
INSERT INTO _migrations (name,applied_at,checksum,compat) VALUES ('0021_household_stores.sql','2026-10-15T08:00:00.000Z','b193f493b273cba2ee6e08f7f49a814150840889e3ccfacc80242dd0de38bc8c','0.45.0');
INSERT INTO users (id,username,display_name,password_hash,role,must_change_password,created_at) VALUES ('u-aino','aino','Aino','pbkdf2_sha256$600000$c2FsdA$aGFzaA','admin',0,'2026-09-01T08:00:00.000Z');
INSERT INTO users (id,username,display_name,password_hash,role,must_change_password,created_at) VALUES ('u-eero','eero','Eero','pbkdf2_sha256$600000$c2FsdA$aGFzaA','member',1,'2026-09-01T08:00:00.000Z');
INSERT INTO sessions (id,user_id,created_at,expires_at,last_seen_at,user_agent) VALUES ('s-1','u-aino','2026-09-01T08:00:00.000Z','2099-01-01T00:00:00.000Z','2026-09-01T08:00:00.000Z',NULL);
INSERT INTO bank_credentials (user_id,app_id,private_key_enc,updated_at) VALUES ('u-aino','app-1','v1.AAAAAAAAAAAAAAAA.sealed-blob-not-a-real-key','2026-09-01T08:00:00.000Z');
INSERT INTO connections (id,user_id,provider,institution,country,status,valid_until,created_at,last_synced_at) VALUES ('c-1','u-aino','enablebanking','Nordea','FI','active','2027-01-01T00:00:00Z','2026-09-01T08:00:00.000Z',NULL);
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at,custom_name,holder,card_mask,credit_limit_cents) VALUES ('a-1','u-aino','c-1','enablebanking','ext-1','idn-1','Käyttötili','FI2112345600000785','EUR','checking',123456,'2026-09-30','2026-09-01T08:00:00.000Z','2026-09-01T08:00:00.000Z',NULL,NULL,NULL,NULL);
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at,custom_name,holder,card_mask,credit_limit_cents) VALUES ('a-2','u-aino',NULL,'csv',NULL,NULL,'Visa',NULL,'EUR','credit_card',NULL,NULL,NULL,'2026-09-01T08:00:00.000Z',NULL,NULL,NULL,NULL);
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at,custom_name,holder,card_mask,credit_limit_cents) VALUES ('a-3','u-eero',NULL,'csv',NULL,NULL,'Eeron tili',NULL,'EUR','checking',NULL,NULL,NULL,'2026-09-01T08:00:00.000Z',NULL,NULL,NULL,NULL);
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at,custom_name,holder,card_mask,credit_limit_cents) VALUES ('a-4','u-aino','c-1','enablebanking','ext-4','idn-4','Autolaina','FI4250001510000023','EUR','loan',-1250000,'2026-10-01','2026-10-09T08:00:00.000Z','2026-09-01T08:00:00.000Z',NULL,NULL,NULL,NULL);
INSERT INTO accounts (id,user_id,connection_id,provider,external_id,identity,name,iban,currency,type,balance_cents,balance_at,last_synced_at,created_at,custom_name,holder,card_mask,credit_limit_cents) VALUES ('a-5','u-aino','c-1','enablebanking','ext-5','idn-5','Yhteistili','FI8757300220000019','EUR','checking',245000,'2026-10-09','2026-10-09T08:00:00.000Z','2026-09-01T08:00:00.000Z',NULL,'MEIKALAINEN MATTI, KORHONEN ELISA',NULL,NULL);
INSERT INTO account_shares (account_id,user_id,created_at) VALUES ('a-1','u-eero','2026-09-01T08:00:00.000Z');
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-01','u-aino','a-1','2026-08-03',NULL,-4590,'EUR','booked','K-MARKET HERTTONIEMI',NULL,'Korttiosto K-MARKET',NULL,'5411','K-MARKET','groceries','rule',0,'csv',NULL,'2026-09-01T08:00:00.000Z','K-MARKET
K-MARKET HERTTONIEMI
KORTTIOSTO K-MARKET',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-02','u-aino','a-1','2026-08-05',NULL,312050,'EUR','booked','TYONANTAJA OY',NULL,'PALKKA 08/2026',NULL,NULL,'TYONANTAJA OY','salary','rule',0,'csv',NULL,'2026-09-01T08:00:00.000Z','TYONANTAJA OY
TYONANTAJA OY
PALKKA 08/2026',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-03','u-aino','a-1','2026-08-07',NULL,-990,'EUR','booked',NULL,NULL,'NETFLIX.COM',NULL,NULL,'NETFLIX.COM','subscriptions','user',0,'csv',NULL,'2026-09-01T08:00:00.000Z','NETFLIX.COM
NETFLIX.COM',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-04','u-aino','a-1','2026-08-09',NULL,-2500,'EUR','booked',NULL,NULL,'WOLT HELSINKI FI',NULL,'5812','WOLT HELSINKI FI','restaurants','mcc',0,'csv',NULL,'2026-09-01T08:00:00.000Z','WOLT HELSINKI FI
WOLT HELSINKI FI',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-05','u-aino','a-1','2026-09-01',NULL,-1500,'EUR','pending',NULL,NULL,NULL,NULL,NULL,'PENDING SHOP','other','default',0,'csv',NULL,'2026-09-01T08:00:00.000Z','PENDING SHOP',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-06','u-aino','a-1','2026-09-02',NULL,-99999999999,'EUR','booked',NULL,NULL,'extreme amount',NULL,NULL,'EXTREME','other','user',0,'csv',NULL,'2026-09-01T08:00:00.000Z','EXTREME
EXTREME AMOUNT',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-07','u-aino','a-1','2026-09-03',NULL,0,'EUR','booked',NULL,NULL,NULL,NULL,NULL,'ZERO','other','default',0,'csv',NULL,'2026-09-01T08:00:00.000Z','ZERO',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-08','u-aino','a-2','2026-09-04',NULL,-35000,'EUR','booked',NULL,NULL,'VISA LASKU',NULL,NULL,'VISA LASKU','transfer','transfer',1,'csv',NULL,'2026-09-01T08:00:00.000Z','VISA LASKU
VISA LASKU',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-09','u-aino','a-1','2026-09-05',NULL,-60000,'EUR','booked',NULL,NULL,'NEWTECH TESTI 123',NULL,NULL,'NEWTECH TESTI 123','shopping','rule',0,'csv','{"kept":"as the bank sent it"}','2026-09-01T08:00:00.000Z','NEWTECH TESTI 123
NEWTECH TESTI 123',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-10','u-eero','a-3','2026-09-06',NULL,-1200,'EUR','booked',NULL,NULL,'R-KIOSKI',NULL,NULL,'R-KIOSKI','groceries','rule',0,'csv',NULL,'2026-09-01T08:00:00.000Z','R-KIOSKI
R-KIOSKI',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-11','u-aino','a-5','2026-10-02',NULL,100000,'EUR','booked','MATTI MEIKALAINEN',NULL,'Yhteistilille',NULL,NULL,'MATTI MEIKALAINEN','other','default',0,'enablebanking',NULL,'2026-10-09T08:00:00.000Z','MATTI MEIKALAINEN
YHTEISTILILLE',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-12','u-aino','a-5','2026-10-04',NULL,-20000,'EUR','booked','ESIMERKKI OY',NULL,'Lasku',NULL,NULL,'ESIMERKKI OY','other','default',0,'enablebanking',NULL,'2026-10-09T08:00:00.000Z','ESIMERKKI OY
LASKU',NULL);
INSERT INTO transactions (id,user_id,account_id,booking_date,value_date,amount_cents,currency,status,counterparty,counterparty_iban,description,reference,mcc,merchant,category,category_source,is_transfer,source,raw,imported_at,search_text,bank_txn_code) VALUES ('t-13','u-aino','a-5','2026-10-07',NULL,50000,'EUR','booked','TUNTEMATON MAKSAJA',NULL,'Talletus',NULL,NULL,'TUNTEMATON MAKSAJA','other','default',0,'enablebanking',NULL,'2026-10-09T08:00:00.000Z','TUNTEMATON MAKSAJA
TALLETUS',NULL);
INSERT INTO category_rules (id,user_id,field,pattern,category,priority,created_at) VALUES (1,'u-aino','merchant','WOLT HELSINKI FI','restaurants',10,'2026-09-01T08:00:00.000Z');
INSERT INTO category_rules (id,user_id,field,pattern,category,priority,created_at) VALUES (2,'u-aino','description','^NEWTECH .*\d+$','shopping',10,'2026-09-01T08:00:00.000Z');
INSERT INTO sync_runs (id,user_id,trigger,started_at,finished_at,status,fetched,inserted,message) VALUES (1,'u-aino','schedule','2026-09-01T08:00:00.000Z','2026-09-01T08:00:00.000Z','ok',9,9,NULL);
INSERT INTO settings (key,value,updated_at) VALUES ('data_version','7','2026-09-01T08:00:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('instance_settings','{"appBaseUrl":"http://localhost:8080","timezone":"Europe/Helsinki","syncHours":[6,18],"historyDays":730,"industryLookup":true,"setupDone":true,"redirectMode":"relay","features":{"optimise":true}}','2026-10-10T09:10:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('data_version:u-aino','12','2026-10-09T09:00:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('data_version:u-eero','3','2026-10-09T09:00:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('needs_reprocess:u-eero','7f0c2d1e-3b5a-4c8d-9e6f-1a2b3c4d5e6f','2026-10-09T09:30:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('app_build:u-aino','0.5.0+3f2a9c1','2026-10-09T08:05:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('app_build:u-eero','0.4.0+812b219','2026-10-09T08:05:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('app_build','0.4.0+812b219','2026-10-09T08:05:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('copy_check','{"at":"2026-10-10T03:05:00.000Z","file":"auto-20261010T030000.db","ok":true,"reason":null}','2026-10-10T03:05:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('setup_code_at','2026-09-01T07:55:00.000Z','2026-09-01T07:55:00.000Z');
INSERT INTO settings (key,value,updated_at) VALUES ('ops_watchdog_at','2026-10-09T09:40:00.000Z','2026-10-09T09:40:01.000Z');
INSERT INTO merchant_industry (merchant,status,business_id,company_name,industry_code,code_set,industry_label,checked_at) VALUES ('K-MARKET','found','1234567-8','Kesko Oyj','47111','TOL2008','Vähittäiskauppa, päivittäistavarat','2026-10-09T08:00:00.000Z');
INSERT INTO merchant_industry (merchant,status,business_id,company_name,industry_code,code_set,industry_label,checked_at) VALUES ('NEWTECH TESTI 123','none',NULL,NULL,NULL,NULL,NULL,'2026-10-09T08:00:00.000Z');
INSERT INTO merchant_industry (merchant,status,business_id,company_name,industry_code,code_set,industry_label,checked_at) VALUES ('WOLT HELSINKI FI','ambiguous',NULL,NULL,NULL,NULL,NULL,'2026-10-09T08:00:00.000Z');
INSERT INTO merchant_industry (merchant,status,business_id,company_name,industry_code,code_set,industry_label,checked_at) VALUES ('ZERO','error',NULL,NULL,NULL,NULL,NULL,'2026-10-09T08:00:00.000Z');
INSERT INTO merchant_industry_users (user_id,merchant) VALUES ('u-aino','K-MARKET');
INSERT INTO merchant_industry_users (user_id,merchant) VALUES ('u-aino','NEWTECH TESTI 123');
INSERT INTO merchant_industry_users (user_id,merchant) VALUES ('u-aino','WOLT HELSINKI FI');
INSERT INTO merchant_industry_users (user_id,merchant) VALUES ('u-eero','K-MARKET');
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (1,'2026-10-08T07:00:00.000Z','u-aino','login_ok','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0',NULL,0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (2,'2026-10-08T07:05:00.000Z','u-eero','login_fail','192.168.1.21','Mozilla/5.0 (iPhone) Safari/605.1',NULL,0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (3,'2026-10-08T07:06:00.000Z','u-eero','new_device','192.168.1.21','Mozilla/5.0 (iPhone) Safari/605.1','iPhone, Safari',1,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (4,'2026-10-08T07:30:00.000Z',NULL,'lockout','203.0.113.9',NULL,NULL,0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (5,'2026-10-08T08:00:00.000Z','u-aino','password_reset_by_admin','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0',NULL,1,'2026-10-08T09:00:00.000Z');
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (6,'2026-10-08T08:10:00.000Z','u-aino','ops_request','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0','Varmuuskopio: jonossa',0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (7,'2026-10-08T08:11:00.000Z','u-aino','ops_result',NULL,NULL,'Varmuuskopio: valmis',0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (8,'2026-10-08T08:20:00.000Z','u-aino','ops_denied','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0','Päivitys: salasana',0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (9,'2026-10-09T09:20:00.000Z','u-aino','ops_request','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0','Apurin uusiminen: jonossa',0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (10,'2026-10-09T09:40:00.000Z',NULL,'ops_watchdog',NULL,NULL,'päivitys: Edellinen versio palautettiin, koska sovellus ei vastannut 10 minuuttiin. Versiosta 0.9.0 palattiin versioon 0.8.7',0,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (11,'2026-10-09T09:40:00.000Z','u-aino','watchdog_notice',NULL,NULL,'Edellinen versio palautettiin, koska sovellus ei vastannut 10 minuuttiin. Versiosta 0.9.0 palattiin versioon 0.8.7',1,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (12,'2026-10-10T03:20:00.000Z','u-aino','db_restored',NULL,NULL,'Tietokanta oli vaurioitunut. Se palautettiin varmuuskopiosta auto-20261010T030000.db (10.10. klo 03.00)',1,NULL);
INSERT INTO security_events (id,at,user_id,kind,ip,user_agent,detail,notify,seen_at) VALUES (13,'2026-10-10T10:00:00.000Z','u-aino','data_reset','192.168.1.20','Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0','varmuuskopio pre-reset-20261010T100000.db, pankkiyhteyksiä lopetettu 1, lopettamatta jäi 0',0,NULL);
INSERT INTO user_marks (user_id,subject,mark,marked_at) VALUES ('u-aino','merchant:NETFLIX.COM','in_use','2026-10-02T09:15:00+03:00');
INSERT INTO user_marks (user_id,subject,mark,marked_at) VALUES ('u-aino','merchant:SPOTIFY AB','cancelled','2026-10-05T18:40:12+03:00');
INSERT INTO user_marks (user_id,subject,mark,marked_at) VALUES ('u-aino','alert:forgotten:out:a-1:NETFLIX.COM','dismissed','2026-10-06T07:30:00+03:00');
INSERT INTO user_marks (user_id,subject,mark,marked_at) VALUES ('u-aino','alert:subscriptions-added@52800','dismissed','2026-10-07T20:05:41+03:00');
INSERT INTO user_marks (user_id,subject,mark,marked_at) VALUES ('u-eero','merchant:NETFLIX.COM','cancelled','2026-10-03T12:00:00+03:00');
INSERT INTO user_marks (user_id,subject,mark,marked_at) VALUES ('u-eero','merchant:HBO MAX','in_use','2026-10-04T16:22:10+03:00');
INSERT INTO user_marks (user_id,subject,mark,marked_at) VALUES ('u-eero','alert:forgotten:out:a-3:R-KIOSKI','dismissed','2026-10-06T08:00:00+03:00');
INSERT INTO user_marks (user_id,subject,mark,marked_at) VALUES ('u-eero','alert:spending-growth@124500','dismissed','2026-10-08T21:10:00+03:00');
INSERT INTO expected_bills (id,user_id,name,amount_cents,due_date,cadence,category,created_at,reference,payee_iban) VALUES ('b1e2c3d4-0001-4a5b-8c6d-7e8f9a0b1c2d','u-aino','Hammaslääkäri',38000,'2026-11-12','once','health','2026-10-09T09:05:00.000Z',NULL,NULL);
INSERT INTO expected_bills (id,user_id,name,amount_cents,due_date,cadence,category,created_at,reference,payee_iban) VALUES ('b1e2c3d4-0002-4a5b-8c6d-7e8f9a0b1c2d','u-aino','Ennakkovero',21500,'2026-11-15','quarterly','taxes','2026-10-09T09:05:00.000Z',NULL,NULL);
INSERT INTO expected_bills (id,user_id,name,amount_cents,due_date,cadence,category,created_at,reference,payee_iban) VALUES ('b1e2c3d4-0003-4a5b-8c6d-7e8f9a0b1c2d','u-aino','Autovakuutus',24990,'2026-12-01','semiannual','insurance','2026-10-09T09:05:00.000Z',NULL,NULL);
INSERT INTO expected_bills (id,user_id,name,amount_cents,due_date,cadence,category,created_at,reference,payee_iban) VALUES ('b1e2c3d4-0004-4a5b-8c6d-7e8f9a0b1c2d','u-aino','Kiinteistövero',41275,'2027-02-28','yearly',NULL,'2026-10-09T09:05:00.000Z',NULL,NULL);
INSERT INTO expected_bills (id,user_id,name,amount_cents,due_date,cadence,category,created_at,reference,payee_iban) VALUES ('b1e2c3d4-0005-4a5b-8c6d-7e8f9a0b1c2d','u-eero','Passin uusinta',12000,'2026-11-03','once',NULL,'2026-10-09T09:05:00.000Z',NULL,NULL);
INSERT INTO expected_bills (id,user_id,name,amount_cents,due_date,cadence,category,created_at,reference,payee_iban) VALUES ('b1e2c3d4-0006-4a5b-8c6d-7e8f9a0b1c2d','u-eero','Työttömyyskassan jäsenmaksu',4500,'2026-12-31','quarterly','insurance','2026-10-09T09:05:00.000Z',NULL,NULL);
INSERT INTO expected_bills (id,user_id,name,amount_cents,due_date,cadence,category,created_at,reference,payee_iban) VALUES ('b1e2c3d4-0007-4a5b-8c6d-7e8f9a0b1c2d','u-eero','Ajoneuvovero',18630,'2026-12-15','semiannual','taxes','2026-10-09T09:05:00.000Z',NULL,NULL);
INSERT INTO expected_bills (id,user_id,name,amount_cents,due_date,cadence,category,created_at,reference,payee_iban) VALUES ('b1e2c3d4-0008-4a5b-8c6d-7e8f9a0b1c2d','u-eero','Kotivakuutus',31290,'2027-01-10','yearly','insurance','2026-10-09T09:05:00.000Z',NULL,NULL);
INSERT INTO optimise_inputs (user_id,key,value,as_of) VALUES ('u-aino','loan_rate','{"marginBp":85,"reference":"euribor_12"}','2026-10-05');
INSERT INTO optimise_inputs (user_id,key,value,as_of) VALUES ('u-aino','electricity_kwh','12500','2026-10-05');
INSERT INTO optimise_inputs (user_id,key,value,as_of) VALUES ('u-aino','electricity_contract_end','"2027-03-31"','2026-10-05');
INSERT INTO optimise_inputs (user_id,key,value,as_of) VALUES ('u-aino','housing_type','"rivitalo"','2026-10-05');
INSERT INTO optimise_inputs (user_id,key,value,as_of) VALUES ('u-aino','insurance_quote:out:a-1:IF VAKUUTUS','48000','2026-10-06');
INSERT INTO optimise_inputs (user_id,key,value,as_of) VALUES ('u-eero','moved_on','"2025-06-01"','2026-10-07');
INSERT INTO optimise_inputs (user_id,key,value,as_of) VALUES ('u-eero','parking_permit_price','6000','2026-10-07');
INSERT INTO optimise_inputs (user_id,key,value,as_of) VALUES ('u-eero','car_km','14000','2025-09-01');
INSERT INTO optimise_states (user_id,finding_id,status,reason,until,effective_date,mid_cents,baseline,decided_at) VALUES ('u-aino','subscriptions:rise:out:a-1:NETFLIX.COM','done',NULL,NULL,'2026-10-01',14400,'[{"month":"2026-04","cents":1499},{"month":"2026-05","cents":1499},{"month":"2026-06","cents":2699},{"month":"2026-07","cents":2699},{"month":"2026-08","cents":2699},{"month":"2026-09","cents":2699}]','2026-10-08T18:30:00.000Z');
INSERT INTO optimise_states (user_id,finding_id,status,reason,until,effective_date,mid_cents,baseline,decided_at) VALUES ('u-aino','bank:late_fees','dismissed','cannot',NULL,NULL,4500,NULL,'2026-10-09T07:12:00.000Z');
INSERT INTO optimise_states (user_id,finding_id,status,reason,until,effective_date,mid_cents,baseline,decided_at) VALUES ('u-aino','electricity:contract_end','snoozed',NULL,'2027-03-17',NULL,NULL,NULL,'2026-10-09T07:15:00.000Z');
INSERT INTO optimise_states (user_id,finding_id,status,reason,until,effective_date,mid_cents,baseline,decided_at) VALUES ('u-eero','food:eating_out','dismissed','need_it',NULL,NULL,62000,NULL,'2026-10-07T20:00:00.000Z');
INSERT INTO optimise_states (user_id,finding_id,status,reason,until,effective_date,mid_cents,baseline,decided_at) VALUES ('u-eero','car:parking','snoozed',NULL,'2026-11-07',NULL,24000,NULL,'2026-10-08T06:45:00.000Z');
INSERT INTO optimise_snapshots (user_id,month,data,created_at) VALUES ('u-aino','2026-10','[{"id":"subscriptions:rise:out:a-1:NETFLIX.COM","area":"subscriptions","midCents":14400,"certainty":"korkea","status":"done"},{"id":"bank:late_fees","area":"bank","midCents":4500,"certainty":"korkea","status":"dismissed"},{"id":"loans:margin:out:a-1:NORDEA LAINA","area":"loans","midCents":67500,"certainty":"keskitaso","status":"active"}]','2026-10-01T05:00:00.000Z');
INSERT INTO optimise_snapshots (user_id,month,data,created_at) VALUES ('u-eero','2026-10','[{"id":"food:eating_out","area":"food","midCents":62000,"certainty":"keskitaso","status":"dismissed"},{"id":"car:parking","area":"car","midCents":24000,"certainty":"keskitaso","status":"snoozed"}]','2026-10-02T05:00:00.000Z');
INSERT INTO loans (id,user_id,name,lender,kind,granted_cents,balance_cents,balance_date,rate_bp,reference,margin_bp,repayment,interval_months,payment_cents,end_date,limit_cents,series_key,created_at,updated_at,account_id,rate_review_date) VALUES ('c1e2c3d4-0001-4a5b-8c6d-7e8f9a0b1c2d','u-aino','Asuntolaina','Nordea','mortgage',18000000,15234055,'2026-10-01',340,'euribor_12',65,'annuity',1,81240,'2051-06-15',NULL,'out:a-1:NORDEA LAINA','2026-10-12T08:00:00.000Z','2026-10-12T08:30:00.000Z',NULL,NULL);
INSERT INTO loans (id,user_id,name,lender,kind,granted_cents,balance_cents,balance_date,rate_bp,reference,margin_bp,repayment,interval_months,payment_cents,end_date,limit_cents,series_key,created_at,updated_at,account_id,rate_review_date) VALUES ('c1e2c3d4-0002-4a5b-8c6d-7e8f9a0b1c2d','u-aino','Joustoluotto','OP','credit_line',NULL,123456,'2026-10-05',1290,'fixed',NULL,NULL,1,NULL,NULL,500000,NULL,'2026-10-12T08:05:00.000Z','2026-10-12T08:05:00.000Z',NULL,NULL);
INSERT INTO loans (id,user_id,name,lender,kind,granted_cents,balance_cents,balance_date,rate_bp,reference,margin_bp,repayment,interval_months,payment_cents,end_date,limit_cents,series_key,created_at,updated_at,account_id,rate_review_date) VALUES ('c1e2c3d4-0003-4a5b-8c6d-7e8f9a0b1c2d','u-eero','Opintolaina',NULL,'student',NULL,845000,'2026-09-30',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'2026-10-12T08:10:00.000Z','2026-10-12T08:10:00.000Z',NULL,NULL);
INSERT INTO loans (id,user_id,name,lender,kind,granted_cents,balance_cents,balance_date,rate_bp,reference,margin_bp,repayment,interval_months,payment_cents,end_date,limit_cents,series_key,created_at,updated_at,account_id,rate_review_date) VALUES ('c1e2c3d4-0004-4a5b-8c6d-7e8f9a0b1c2d','u-aino','Autolaina','Nordea','car',1800000,1250000,'2026-10-01',590,'fixed',NULL,'annuity',1,31500,'2029-08-15',NULL,NULL,'2026-10-12T09:00:00.000Z','2026-10-12T09:00:00.000Z','a-4',NULL);
INSERT INTO loans (id,user_id,name,lender,kind,granted_cents,balance_cents,balance_date,rate_bp,reference,margin_bp,repayment,interval_months,payment_cents,end_date,limit_cents,series_key,created_at,updated_at,account_id,rate_review_date) VALUES ('c1e2c3d4-0005-4a5b-8c6d-7e8f9a0b1c2d','u-aino','Visa','OP','card',NULL,42000,'2026-10-05',1790,'fixed',NULL,NULL,1,NULL,NULL,300000,NULL,'2026-10-12T09:05:00.000Z','2026-10-12T09:05:00.000Z','a-2',NULL);
INSERT INTO loans (id,user_id,name,lender,kind,granted_cents,balance_cents,balance_date,rate_bp,reference,margin_bp,repayment,interval_months,payment_cents,end_date,limit_cents,series_key,created_at,updated_at,account_id,rate_review_date) VALUES ('c1e2c3d4-0120-4a5b-8c6d-7e8f9a0b1c2d','u-eero','Mökkilaina','OP','mortgage',6000000,5234000,'2026-10-01',365,'euribor_12',90,'annuity',1,32100,'2044-03-14',NULL,NULL,'2026-10-12T12:00:00.000Z','2026-10-12T12:00:00.000Z',NULL,'2027-03-14');
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-1','backup','{}',NULL,'ok','u-aino','2026-10-08T08:10:00.000Z','2026-10-08T08:10:30.000Z','2026-10-08T08:11:00.000Z',0,'Varmuuskopio valmis','ok','["backup"]');
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-2','update','{}','115,101,97,108,101,100,45,98,108,111,98,45,110,111,116,45,97,45,114,101,97,108,45,115,101,99,114,101,116','failed','u-aino','2026-10-08T08:20:00.000Z','2026-10-08T08:20:30.000Z','2026-10-08T08:25:00.000Z',1,'Päivitys epäonnistui','build failed','["fetch","build"]');
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-3','doctor','{}',NULL,'expired','u-aino','2026-10-07T08:00:00.000Z',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-4','restart','{}',NULL,'queued','u-aino','2026-10-09T07:50:00.000Z',NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-5','logs','{}',NULL,'ok','u-aino','2026-10-09T09:00:00.000Z','2026-10-09T09:00:10.000Z','2026-10-09T09:00:12.000Z',0,'Lokit luettu','app started',NULL);
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-6','prune','{}',NULL,'failed','u-aino','2026-10-09T09:10:00.000Z','2026-10-09T09:10:10.000Z','2026-10-09T09:10:20.000Z',1,'Siivous epäonnistui','docker: permission denied',NULL);
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-7','helper-renew','{}',NULL,'ok','u-aino','2026-10-09T09:20:00.000Z','2026-10-09T09:20:10.000Z','2026-10-09T09:20:30.000Z',0,'Apuri uusittu','helper 3',NULL);
INSERT INTO ops_requests (id,action,params,secret_sealed,status,requested_by,requested_at,claimed_at,finished_at,exit_code,summary,output,steps) VALUES ('o-8','prerelease-on','{}',NULL,'ok','u-aino','2026-10-11T08:00:00.000Z','2026-10-11T08:00:10.000Z','2026-10-11T08:00:25.000Z',0,'Uudet versiot tarjotaan heti.','TALOUS_PRERELEASE=yes is the setting in .env.','["Tallennetaan asetus","Tarkistetaan uusi versio"]');
INSERT INTO account_use (account_key,user_id,weight,said_by,said_at) VALUES ('idn-5','u-aino',60000,'u-aino','2026-10-09T08:00:00.000Z');
INSERT INTO account_use (account_key,user_id,weight,said_by,said_at) VALUES ('idn-5',NULL,40000,'u-aino','2026-10-09T08:00:00.000Z');
INSERT INTO account_split (account_key,mode,set_by,set_at) VALUES ('idn-5','source','u-aino','2026-10-10T08:00:00.000Z');
INSERT INTO account_split (account_key,mode,set_by,set_at) VALUES ('idn-1','source',NULL,'2026-10-10T08:05:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','in','MATTI MEIKALAINEN','u:u-aino','u-aino','2026-10-10T08:10:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','in','ESIMERKKI OY','u:u-eero','u-eero','2026-10-10T08:11:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','in','LAHJA','u:','u-aino','2026-10-10T08:12:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','in','YHTEINEN','all','u-aino','2026-10-10T08:13:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','in','KUKAAN','none','u-eero','2026-10-10T08:14:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-5','opening','','u:u-aino','u-aino','2026-10-10T08:15:00.000Z');
INSERT INTO owner_answer (account_key,kind,key,owner,said_by,said_at) VALUES ('idn-1','opening','','all','u-aino','2026-10-10T08:16:00.000Z');
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-11','u:u-aino','own','',60000,0);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-11','u:u-eero','own','',40000,0);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-12','u:u-aino','payment','',-12000,1);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-12','u:u-eero','payment','',-8000,0);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-13','-','own','ESIMERKKI OY',15000,0);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-13','?','own','TUNTEMATON MAKSAJA',30000,0);
INSERT INTO tx_part (tx_id,owner,kind,grp,cents,passed) VALUES ('t-13','u:','pool','',5000,1);
INSERT INTO tx_part_state (account_key,signature,built_at,lots) VALUES ('idn-5','0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef','2026-10-10T08:20:00.000Z','{"lots":[],"before":[],"creditCents":0,"openingCents":0}');
INSERT INTO tx_part_state (account_key,signature,built_at,lots) VALUES ('idn-1','fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210','2026-10-10T08:21:00.000Z','null');
INSERT INTO account_balances (account_key,day,type,reference_date,cents,fetched_at,source) VALUES ('idn-1','2026-10-15','OTHR',NULL,90000,'2026-10-15T12:00:00.000Z','seed');
INSERT INTO account_balances (account_key,day,type,reference_date,cents,fetched_at,source) VALUES ('idn-5','2026-10-20','CLBD','2026-10-19',125000,'2026-10-20T08:00:00.000Z','bank');
INSERT INTO account_balances (account_key,day,type,reference_date,cents,fetched_at,source) VALUES ('idn-5','2026-10-20','ITAV',NULL,130000,'2026-10-20T08:00:00.000Z','bank');
INSERT INTO account_balances (account_key,day,type,reference_date,cents,fetched_at,source) VALUES ('idn-5','2026-10-21','CLBD','2026-10-20',121550,'2026-10-21T08:00:00.000Z','bank');
INSERT INTO account_balances (account_key,day,type,reference_date,cents,fetched_at,source) VALUES ('idn-5','2026-10-21','OTHR',NULL,110000,'2026-10-21T08:00:00.000Z','bank');
INSERT INTO account_history (account_id,asked_from,first_row_day,source,recorded_at) VALUES ('a-5','2026-09-01','2026-09-01','default','2026-10-20T08:00:00.000Z');
INSERT INTO account_history (account_id,asked_from,first_row_day,source,recorded_at) VALUES ('a-1','2026-05-01',NULL,'longest','2026-10-20T08:00:00.000Z');
INSERT INTO account_fetch (id,account_key,at,trigger,user_id) VALUES (1,'idn-5','2026-10-20T07:00:00.000Z','schedule','u-aino');
INSERT INTO account_fetch (id,account_key,at,trigger,user_id) VALUES (2,'idn-5','2026-10-20T08:00:00.000Z','open','u-eero');
INSERT INTO account_fetch (id,account_key,at,trigger,user_id) VALUES (3,'idn-5','2026-10-20T09:00:00.000Z','manual',NULL);
INSERT INTO statement_bill (bill_tx_id,user_id,account_key,period_from,period_to,statement_cents,saved_at,detached_at,detached_reason) VALUES ('t-12','u-aino','idn-5','2026-09-01','2026-09-30',20000,'2026-10-20T08:00:00.000Z',NULL,NULL);
INSERT INTO statement_bill (bill_tx_id,user_id,account_key,period_from,period_to,statement_cents,saved_at,detached_at,detached_reason) VALUES ('t-11','u-eero','idn-5','2026-09-01','2026-09-30',NULL,'2026-10-20T08:00:00.000Z','2026-10-21T08:00:00.000Z','amount changed');
INSERT INTO statement_rows (id,bill_tx_id,account_key,user_id,day,cents,text,row_key,imported_at) VALUES ('sr-1','t-12','idn-5','u-aino','2026-09-05',-12000,'KAHVILA ESIMERKKI','k1','2026-10-20T08:00:00.000Z');
INSERT INTO statement_rows (id,bill_tx_id,account_key,user_id,day,cents,text,row_key,imported_at) VALUES ('sr-2','t-12','idn-5','u-aino','2026-09-12',-9000,'KIRJAKAUPPA ESIMERKKI','k2','2026-10-20T08:00:00.000Z');
INSERT INTO statement_rows (id,bill_tx_id,account_key,user_id,day,cents,text,row_key,imported_at) VALUES ('sr-3','t-12','idn-5','u-aino','2026-09-20',1000,'PALAUTUS','k3','2026-10-20T08:00:00.000Z');
INSERT INTO foreign_rows (account_key,raw_key,booking_date,amount_minor,scale,currency,text,seen_at) VALUES ('idn-5','fr-1','2026-10-01',-5400,2,'USD','ESIMERKKI INC Subscription','2026-10-20T08:00:00.000Z');
INSERT INTO foreign_rows (account_key,raw_key,booking_date,amount_minor,scale,currency,text,seen_at) VALUES ('idn-5','fr-2','2026-10-03',-1200,0,'JPY','ESIMERKKI KK','2026-10-20T08:00:00.000Z');
INSERT INTO foreign_rows (account_key,raw_key,booking_date,amount_minor,scale,currency,text,seen_at) VALUES ('idn-5','fr-3','2026-10-04',700,2,'XXX',NULL,'2026-10-20T08:00:00.000Z');
INSERT INTO payer_role (scope,user_id,counterparty_key,role,answered_by,answered_at) VALUES ('member','u-aino','name:matti meikalainen','gift','u-aino','2026-10-20T08:00:00.000Z');
INSERT INTO payer_role (scope,user_id,counterparty_key,role,answered_by,answered_at) VALUES ('household',NULL,'name:matti meikalainen','cost_share','u-eero','2026-10-20T08:00:00.000Z');
INSERT INTO payer_role (scope,user_id,counterparty_key,role,answered_by,answered_at) VALUES ('member','u-eero','iban:FI2112345600000785','own_money','u-eero','2026-10-20T08:00:00.000Z');
INSERT INTO household_member (id,name,weight,created_at) VALUES ('hm-1','Maija Meikalainen',1,'2026-10-20T08:00:00.000Z');
INSERT INTO household_member (id,name,weight,created_at) VALUES ('hm-2','Ville Meikalainen',2,'2026-10-20T08:00:00.000Z');
INSERT INTO account_agreement (account_key,valid_from,kind,value,set_by,set_at) VALUES ('idn-1','2026-06-01','fixed','{}',NULL,'2026-10-20T08:00:00.000Z');
INSERT INTO account_agreement (account_key,valid_from,kind,value,set_by,set_at) VALUES ('idn-5','2026-01-01','equal','{"who":["u:u-aino","u:u-eero"]}','u-aino','2026-10-20T08:00:00.000Z');
INSERT INTO account_agreement (account_key,valid_from,kind,value,set_by,set_at) VALUES ('idn-5','2026-10-01','share','{"weights":{"u:u-aino":600,"u:u-eero":400}}','u-eero','2026-10-20T08:00:00.000Z');
INSERT INTO user_factor (id,user_id,kind,secret,label,last_step,created_at,last_used_at) VALUES ('uf-1','u-aino','totp','sealed-made-up-seed','Puhelin',58123456,'2026-10-20T08:00:00.000Z','2026-10-21T08:00:00.000Z');
INSERT INTO user_factor (id,user_id,kind,secret,label,last_step,created_at,last_used_at) VALUES ('uf-2','u-aino','recovery','0000made0up0hash',NULL,NULL,'2026-10-20T08:00:00.000Z',NULL);
INSERT INTO valued_asset (id,kind,name,day,cents) VALUES ('va-1','property','Mokki (esimerkki)','2026-01-01',14000000);
INSERT INTO valued_asset (id,kind,name,day,cents) VALUES ('va-1','property','Mokki (esimerkki)','2026-10-01',14500000);
INSERT INTO valued_asset (id,kind,name,day,cents) VALUES ('va-2','vehicle','Auto (esimerkki)','2026-10-01',0);
INSERT INTO contract_terms (user_id,series_key,notice_days,renews_on,answered_at) VALUES ('u-aino','esimerkki oy',30,'2027-01-01','2026-10-20T08:00:00.000Z');
INSERT INTO contract_terms (user_id,series_key,notice_days,renews_on,answered_at) VALUES ('u-eero','esimerkki oy',NULL,NULL,'2026-10-20T08:00:00.000Z');
INSERT INTO access_token (id,user_id,scope,hash,label,created_at,expires_at,last_used_at) VALUES ('at-1','u-aino','ha_summary','1111111111111111111111111111111111111111111111111111111111111111','Koti','2026-10-20T08:00:00.000Z','2027-10-20T08:00:00.000Z','2026-10-21T08:00:00.000Z');
INSERT INTO access_token (id,user_id,scope,hash,label,created_at,expires_at,last_used_at) VALUES ('at-2','u-aino','mcp_read','2222222222222222222222222222222222222222222222222222222222222222',NULL,'2026-10-20T08:00:00.000Z',NULL,NULL);
