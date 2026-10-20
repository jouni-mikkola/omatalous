-- migrate: compat 0.7.0
-- Optimoi: what the user typed in, what they decided about a finding, and a monthly snapshot for the follow-up. Only
-- adds tables, so 0.7.0 opens a database that has them and a rollback keeps the rows.
-- value is JSON checked against the input definitions in core when it is saved; key has no CHECK, so a new input needs
-- no migration. A key is `loan_rate` or `insurance_quote:<series id>`.
CREATE TABLE optimise_inputs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,
  as_of   TEXT NOT NULL,                 -- the day it was saved, YYYY-MM-DD; a stale input counts as missing
  PRIMARY KEY (user_id, key)
);

-- finding_id is `<area>:<kind>` or `<area>:<kind>:<subject>`. mid_cents is the finding's mid when the user decided, what
-- a dismissed finding is compared with before it returns; baseline is the monthly sums stored with a done decision.
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

-- One row per user and month, written by the follow-up.
CREATE TABLE optimise_snapshots (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, month)
);
