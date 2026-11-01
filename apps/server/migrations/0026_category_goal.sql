-- migrate: compat 0.64.0
-- The monthly spending goal a user set for one category (Kategoriat, Menot tässä kuussa): one amount per user and
-- category, replaced when changed and deleted when removed. Only adds a table, which older code neither reads nor
-- writes: 0.64.0 opens a database that has it and a rollback keeps the goals.
-- category: a category id of core's GOAL_CATEGORIES; the route checks it, the table keeps any text so a later release can add categories.
-- monthly_cents: the goal for a month, in cents, as Kategoriat counts the category's spending.
-- updated_at: ISO text in UTC.
CREATE TABLE category_goal (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  monthly_cents INTEGER NOT NULL CHECK (monthly_cents > 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, category)
);
