# Contracts of 0.70.0

Frozen when 0.70.0 ships. Until then a later task may update these files (see `../README.md`). While 0.70.0 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 0.66.0 the schema adds the table `service_tokens` and the index `idx_service_tokens_user` (0024) and the table
`spending_goal` (0025). Both migrations carry the compat floor 0.64.0, so 0.64.0 opens a database that has them and a
rollback keeps what they add. The three `ops-*.json` files are copies of 0.66.0's. Since 0.69.0 the helper
(`scripts/ops-helper.sh`) changed only in how the heartbeat reads its tick counter, which alters no output of
`ops poll|report|state` and no payload.
