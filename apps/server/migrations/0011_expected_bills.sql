-- migrate: compat 0.6.0
-- Bills the user typed in because the bank history cannot know them yet (a yearly tax, an insurance that was paid
-- once). Only adds a table, so 0.6.0 opens the database and a rollback keeps the rows.
CREATE TABLE expected_bills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  due_date TEXT NOT NULL,                -- the first due date, YYYY-MM-DD; later ones follow the cadence
  cadence TEXT NOT NULL CHECK (cadence IN ('once', 'quarterly', 'semiannual', 'yearly')),
  category TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_expected_bills_user ON expected_bills(user_id);
