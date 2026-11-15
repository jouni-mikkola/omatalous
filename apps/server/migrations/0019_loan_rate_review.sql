-- migrate: compat 0.11.0
-- The day the bank sets a loan's rate again, as the user typed it. The bank connection shows payment accounts only, so no
-- row of the bank tells it. NULL: no day typed, for every loan there is. A day in the past is kept: the rate has been
-- reviewed since.
-- Only adds a nullable column, which older code neither reads nor writes, so 0.11.0 opens a database that has it and a
-- rollback keeps the days. A date is YYYY-MM-DD as in the other date columns of this table, and the routes check it.
ALTER TABLE loans ADD COLUMN rate_review_date TEXT;
