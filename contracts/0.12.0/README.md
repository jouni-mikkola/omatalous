# Contracts of 0.12.0

Frozen when 0.12.0 ships. Until then a later task may update these files (see `../README.md`). While 0.12.0 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 0.11.0 the schema adds the column `loans.rate_review_date` (0019). The migration carries the compat floor 0.11.0,
so 0.11.0 opens a database that has it and a rollback keeps what it adds. The three `ops-*.json` files are copies of
0.11.0's. The helper CLI (`cli-ops.ts`, `services/ops.ts`, `services/ops-validate.ts`, `scripts/ops-helper.sh`) did not
change since 0.11.0.
