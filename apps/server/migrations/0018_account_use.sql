-- migrate: compat 0.10.0
-- Who of the household uses an account, when the household has said so. An account with no rows here has its use
-- worked out from the bank's holder names on every read, and that is stored nowhere.
-- Only adds a table, which older code neither reads nor writes, so 0.10.0 opens a database that has it and a rollback
-- keeps what was said. The unique index is on this new table alone, so it holds no row older code writes.
-- account_key: the real account, `accounts.identity`, or the account's id when it has none (an imported or a demo
--   account). A joint account both partners linked is two rows of `accounts` and one key, so it has one statement.
-- user_id: a user of the account. NULL: the holders who are no user of this instance, together. Removing a user
--   removes their rows and leaves the others'.
-- weight: the user's part against the others': euros a month in cents as typed, or 1 each. Only the ratio counts.
-- said_by, said_at: who said it and when.
CREATE TABLE account_use (
  account_key TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  weight INTEGER NOT NULL CHECK (weight >= 0),
  said_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  said_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_account_use_member ON account_use(account_key, COALESCE(user_id, ''));
