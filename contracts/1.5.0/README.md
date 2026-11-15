# Contracts of 1.5.0

Frozen when 1.5.0 ships. Until then a later task may update these files (see `../README.md`). While 1.5.0 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 1.0.0 the schema drops the table `view_opens` (0030) and the indexes `idx_tx_user_date` and `idx_tx_user_merchant`
of `transactions`, which `idx_tx_user_date_amount` and `idx_tx_user_merchant_date` cover. It adds nothing. Migration 0031
carries no compat floor, so an older version refuses a database that has it and a rollback restores the copy taken
before the update. The test lists `view_opens` in `RETIRED_TABLES`.

The helper changed since 1.0.0: the state payload may carry `doctor_version`, the version that ran when the system check
was made, and the app serves `doctor_stale` beside the check. Both are additions: `ops poll`, `ops report` and
`ops state` print the same keys as before. The three `ops-*.json` files are copies of 1.0.0's.
