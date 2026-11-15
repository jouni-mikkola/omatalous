# Contracts of 0.39.0

Frozen when 0.39.0 ships. Until then a later task may update these files (see `../README.md`). While 0.39.0 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 0.12.0 the schema adds the tables `account_split`, `owner_answer`, `tx_part` and `tx_part_state` (0020). 0020
carries no compat floor. A migration without a floor makes every build that lacks its file refuse the database. The
three `ops-*.json` files are copies of 0.12.0's. The helper CLI (`cli-ops.ts`, `services/ops.ts`,
`services/ops-validate.ts`, `scripts/ops-helper.sh`) did not change since 0.38.0.
