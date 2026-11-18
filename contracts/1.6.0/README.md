# Contracts of 1.6.0

Frozen when 1.6.0 ships. Until then a later task may update these files (see `../README.md`). While 1.6.0 is unreleased
the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change cannot pass
without its dump.

Over 1.5.0 the schema adds the table `reference_rates` (0032) and the table `loan_payment_parts` (0033). Both migrations
carry the compat floor 0.64.0, so 0.64.0 opens a database that has them and a rollback keeps what they add. The three
`ops-*.json` files are copies of 1.5.1's. The helper CLI (`cli-ops.ts`, `services/ops.ts`, `services/ops-validate.ts`,
`scripts/ops-helper.sh`) did not change since 1.5.4.
