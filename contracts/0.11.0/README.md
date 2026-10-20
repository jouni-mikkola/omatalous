# Contracts of 0.11.0

Frozen when 0.11.0 ships. Until then a later task may update these files (see `../README.md`). While 0.11.0 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 0.10.0 the schema adds one table and one index and changes nothing that was there. Migration 0018 adds
`account_use`, which holds who uses an account and at what weight (`account_key`, `user_id`, `weight`, `said_by`,
`said_at`), and the unique index `idx_account_use_member` on the account and the member. The migration changes no row
and carries the compat floor 0.10.0: a build of 0.10.0 opens the database and does not read the table.

The helper CLI has no new output: `cli-ops.ts`, `services/ops.ts` and `services/ops-validate.ts` did not change since
0.10.0. The host helper is still version 4 and passes `--helper 4`. `scripts/ops-helper.sh` and its libraries were
rearranged, so that code they had several times is there once and the helper changes `.env` through one library. The
actions, the pattern of a line of `ops poll` and the keys of the state are the same.

`ops-poll.json`, `ops-report.json` and `ops-state.json` are plain copies of the files of 0.10.0: what `ops poll`,
`ops report`, `ops state` and `ops access` print and accept is as in 0.10.0, and the versions named in their payloads
are those of 0.10.0.
