# Contracts of 0.7.0

Frozen when 0.7.0 ships. Until then a later task may update these files (see `../README.md`). While 0.7.0 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 0.6.0 the schema adds the tables `user_marks` (0010) and `expected_bills` (0011) with `idx_expected_bills_user`.
Both migrations carry the compat floor 0.6.0: 0.6.0 opens a database that has them and a rollback keeps their rows.
The three `ops-*.json` files are copies of 0.6.0's. The helper CLI (`cli-ops.ts`, `services/ops.ts`,
`services/ops-validate.ts`, `scripts/ops-helper.sh`) did not change after 0.6.0.
