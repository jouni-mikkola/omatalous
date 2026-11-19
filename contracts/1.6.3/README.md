# Contracts of 1.6.3

Frozen when 1.6.3 ships. Until then a later task may update these files (see `../README.md`). While 1.6.3 is unreleased
the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change cannot pass
without its dump.

Over 1.6.0 the schema adds the columns `loans.rate_step_date` and `loans.rate_step_bp` (0034) and the column
`loans.payment_fee_cents` (0035). Both migrations carry the compat floor 0.64.0, so 0.64.0 opens a database that has
them and a rollback keeps what they add. The three `ops-*.json` files are copies of 1.6.0's. The helper CLI
(`cli-ops.ts`, `services/ops.ts`, `services/ops-validate.ts`, `scripts/ops-helper.sh`) did not change since 1.6.2.
