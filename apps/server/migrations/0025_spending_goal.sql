-- migrate: compat 0.64.0
-- The monthly spending goal a user set (Yhteenveto, Menot tässä kuussa): one amount per user, replaced when changed and
-- deleted when removed. Only adds a table, which older code neither reads nor writes: 0.64.0 opens a database that has it
-- and a rollback keeps the goal.
-- monthly_cents: the goal for a month's consumption and debt payments, in cents, as the pace chart counts them.
-- updated_at: ISO text in UTC.
CREATE TABLE spending_goal (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  monthly_cents INTEGER NOT NULL CHECK (monthly_cents > 0),
  updated_at TEXT NOT NULL
);
