-- migrate: compat 0.45.0
-- The tables the next releases fill, made once so that none of them needs a migration of its own. Only adds tables, two
-- nullable columns and indexes, which older code neither reads nor writes: 0.45.0 opens a database that has them, and a
-- rollback keeps what was recorded. What older code does reach is the foreign keys: deleting a user, a bill or an
-- account there removes the rows of these tables that hang on it (the cascades below), and nothing else.
-- Seeds and copies are not here: a file with the compat header holds no INSERT, so they are start-up data steps.
-- Words of an open set (a balance type, a source, a trigger, a role, a kind, a scope) are plain TEXT with no CHECK: a new
-- word could not be added later without rebuilding the table. The code checks them. Days are YYYY-MM-DD, instants ISO
-- text in UTC, money integer cents.
-- account_key: the real account, `accounts.identity`, or the account's id when it has none, as in account_use. No
--   foreign key and no user column on a table keyed by it: a joint account is two `accounts` rows and one key, so removing
--   one member leaves what the key holds.

-- What the bank said an account held, one row per account key, day fetched and kind of balance (the last fetch of the
-- day wins). type: the bank's four capital letters (CLBD, ITBD ...), else OTHR. reference_date: the day the bank says the
-- balance stands for, NULL when it sent none. source: bank, seed or demo. Only euros are recorded, so no currency.
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
CREATE INDEX idx_account_balances_ref ON account_balances(account_key, type, reference_date);

-- How far back the app has asked the bank for the rows of one `accounts` row (a member's copy may start later than the
-- other member's). account_id has no foreign key: merging two accounts renames and removes `accounts` rows.
-- asked_from: the first day asked for, only moved earlier. first_row_day: the oldest booked row stored, only earlier.
-- source: default, longest or csv.
CREATE TABLE account_history (
  account_id TEXT PRIMARY KEY,
  asked_from TEXT NOT NULL,
  first_row_day TEXT,
  source TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

-- Every call the app made to the bank for an account, to see how many a day a key has had. trigger: schedule, manual,
-- connect or open. user_id: whose consent made the call; the row stays when the member goes.
CREATE TABLE account_fetch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_key TEXT NOT NULL,
  at TEXT NOT NULL,
  trigger TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_account_fetch_key_at ON account_fetch(account_key, at);

-- A card bill a member keeps the purchases of. The bill is one row of `transactions`; the key follows the row when
-- merging accounts renames its id. The rows of a member's own bill go with the member.
-- detached_at, detached_reason: set when the bill no longer matches its row; the rows are never deleted by the app.
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
CREATE INDEX idx_statement_bill_user ON statement_bill(user_id);

-- The purchases a member typed or imported for one bill. row_key tells a row from the same row typed again.
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
CREATE INDEX idx_statement_rows_key ON statement_rows(account_key, row_key);
CREATE INDEX idx_statement_rows_user ON statement_rows(user_id);

-- Booked rows of another currency than the euro, kept as the bank sent them: amount_minor in the currency's own minor
-- unit, scale its decimals. currency: three upper-case letters, never EUR, XXX when unknown. raw_key: the row's own key.
-- text: counterparty and description, at most 200 characters. No user column: the key spans members.
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
CREATE INDEX idx_foreign_rows_day ON foreign_rows(account_key, booking_date);

-- What money from a steady payer is: scope 'member' is one member's own answer (user_id set), 'household' the default for
-- all (user_id NULL). counterparty_key: `iban:` or `name:` form. role: cost_share, sales, own_money, gift or pay.
-- A member's rows go with the member; answered_by only loses its name.
CREATE TABLE payer_role (
  scope TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  counterparty_key TEXT NOT NULL,
  role TEXT NOT NULL,
  answered_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  answered_at TEXT NOT NULL,
  CHECK ((scope = 'member') = (user_id IS NOT NULL))
);
CREATE UNIQUE INDEX idx_payer_role_payer ON payer_role(scope, COALESCE(user_id, ''), counterparty_key);
CREATE INDEX idx_payer_role_counterparty ON payer_role(counterparty_key);

-- A person of the household who has no login. name: as the bank writes the holder. weight: unused for now.
CREATE TABLE household_member (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE,
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 0),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_household_member_name ON household_member(name);

-- How the cost of an account is shared between its members, from a day on. kind: equal, share, income or fixed.
-- value: JSON the kind reads. set_by only loses its name when the member goes.
CREATE TABLE account_agreement (
  account_key TEXT NOT NULL,
  valid_from TEXT NOT NULL CHECK (length(valid_from) = 10),
  kind TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(value)),
  set_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (account_key, valid_from)
) WITHOUT ROWID;

-- A second way to sign in. kind: totp, recovery or passkey. secret: sealed with the server's key, a recovery code as a
-- hash. last_step: the last TOTP step or passkey counter used, so a code is not taken twice.
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
CREATE INDEX idx_user_factor_user ON user_factor(user_id, kind);

-- What an asset was worth on a day; the latest day of an id is its value.
CREATE TABLE valued_asset (
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  day TEXT NOT NULL,
  cents INTEGER NOT NULL CHECK (cents >= 0),
  PRIMARY KEY (id, day)
);

-- The notice period of a contract a member answered for. notice_days: a period, not a date. renews_on: the next renewal.
CREATE TABLE contract_terms (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_key TEXT NOT NULL,
  notice_days INTEGER,
  renews_on TEXT,
  answered_at TEXT NOT NULL,
  PRIMARY KEY (user_id, series_key)
);

-- A key for reading a summary from outside the app. scope: ha_summary or mcp_read. hash: SHA-256 hex of the key, which
-- is never stored.
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
CREATE UNIQUE INDEX idx_access_token_hash ON access_token(hash);

-- What a bill's barcode says, to match the payment that comes later on its reference and the payee's IBAN.
ALTER TABLE expected_bills ADD COLUMN reference TEXT;
ALTER TABLE expected_bills ADD COLUMN payee_iban TEXT;
