-- migrate: compat 0.6.0
-- Each applied migration stores the oldest app version that may run on the schema it leaves behind (`compat`).
-- A migration declares it with a header line `-- migrate: compat 0.6.0` in its leading comment block. Without one no
-- floor is stored, and every build that lacks the migration refuses the database, as before.
-- From this release on, a build that does not know a migration still opens the database when its own version is at
-- or above that migration's floor, so a rollback after an additive change keeps the data written since the update.
-- Rows applied before this column existed stay NULL: every later release knows them.
-- Releases up to 0.5.x do not read the column and keep refusing a database with a migration they do not know.
ALTER TABLE _migrations ADD COLUMN compat TEXT;
