# Contracts of 1.0.0

Frozen when 1.0.0 ships. Until then a later task may update these files (see `../README.md`). While 1.0.0 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 0.70.0 the schema adds the table `category_goal` (0026), the column `users.language` (0028), the table
`view_opens` (0030), and the columns `user_factor.credential_id`, `user_factor.transports` and `user_factor.rp_id` with
the index `idx_user_factor_credential` (0029). Migration 0027 changes how passwords are hashed and adds nothing to the
schema. The migrations 0026, 0028 and 0030 carry the compat floor 0.64.0, so 0.64.0 opens a database that has them and a
rollback keeps what they add; 0027 and 0029 carry none, so an older version refuses a database that has them.

The helper changed since 0.70.0: version 6 adds the action `offsite` and the CLI command `ops offsite --helper <version>`,
which an older helper never calls, and the state payload may carry `doctor_en`, a twin of `doctor` in English. Both are
additions: `ops poll`, `ops report` and `ops state` print the same keys as before. The three `ops-*.json` files are
copies of 0.70.0's.
