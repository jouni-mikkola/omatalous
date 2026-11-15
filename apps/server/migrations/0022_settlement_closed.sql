-- migrate: compat 0.55.0
-- The months of a joint account's settlement that have closed, each as it read the first time it was worked out as closed.
-- Only adds a table, which older code neither reads nor writes: 0.55.0 opens a database that has it, and a rollback keeps
-- what was recorded. No row is ever rewritten or deleted, not even when the account is gone: a closed month is what the
-- partners were shown, and it may not change under them. A row is the account's, so it is read by those who see the account.
-- account_key: the real account, `accounts.identity`, or the account's id when it has none, as in account_use; no foreign
--   key, so removing one member's copy of a joint account leaves what the key holds. month: YYYY-MM. closed_on: the day
--   the month closed (YYYY-MM-DD). snapshot: the month's settlement as JSON, whole. written_at: ISO text in UTC.
CREATE TABLE settlement_closed (
  account_key TEXT NOT NULL,
  month TEXT NOT NULL CHECK (length(month) = 7),
  closed_on TEXT NOT NULL CHECK (length(closed_on) = 10),
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
  written_at TEXT NOT NULL,
  PRIMARY KEY (account_key, month)
) WITHOUT ROWID;
