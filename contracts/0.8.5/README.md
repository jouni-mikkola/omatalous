# Contracts of 0.8.5

Frozen when 0.8.5 ships. Until then a later task may update these files (see `../README.md`). While 0.8.5 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 0.8.0 the schema adds the columns `accounts.custom_name`, `accounts.holder`, `accounts.card_mask` and
`accounts.credit_limit_cents` (0013). The migration carries the compat floor 0.8.0: 0.8.0 opens a database that has
them and a rollback keeps their values. The three `ops-*.json` files are copies of 0.8.0's; the helper CLI's output did
not change.
