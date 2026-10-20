-- migrate: breaking a build before this one refuses the database; it would not know tx_part, whose rows older code leaves stale, so a rollback restores the copy taken before the update
-- Whose money paid a joint account, and how the account is cut: the one choice "by who paid", the answers to "whose
-- money was this?", the parts every row of such an account was built with, and what they were built from.
-- Adds tables only, but a rollback that kept them would let older code write rows and change amounts they do not
-- follow, so there is no compat header: the build before refuses a database that has this file.
-- account_key: the real account, as in account_use.
-- account_split: a row means the account is cut by its rows' parts. set_by NULL: the app set it, once; else the member.
-- owner_answer: kind 'in' (key: the payer of unknown money) or 'opening' (key ''). owner: 'u:<user id>', 'u:' (the
--   holders who are no user), 'all' or 'none'.
-- tx_part: the parts of a row, built on read. owner 'u:<user id>' or 'u:', or '?' (unknown money a question stands
--   for) or '-' (unknown, not asked); grp holds the payer of unknown money ('' for a user's). Cascades with the row.
-- tx_part_state: the signature a real account's parts were built from, and its lots (JSON), so a change in any of
--   them (a restored copy, a new row, an answer) builds the parts again.
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
