-- migrate: compat 0.6.0
-- What a user said about a subscription or an alert: still in use, cancelled, or not to be shown again.
-- Only a table is added, so 0.6.0 opens a database that has it and a rollback keeps the rows.
-- subject is `merchant:<name>` or `alert:<id>`; one mark per subject, the latest replacing an earlier one.
CREATE TABLE user_marks (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject   TEXT NOT NULL,
  mark      TEXT NOT NULL CHECK (mark IN ('in_use','cancelled','dismissed')),
  marked_at TEXT NOT NULL,
  PRIMARY KEY (user_id, subject)
);
