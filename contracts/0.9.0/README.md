# Contracts of 0.9.0

Frozen when 0.9.0 ships. Until then a later task may update these files (see `../README.md`). While 0.9.0 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 0.8.7 the schema adds the column `loans.account_id` and its index `idx_loans_account` (0016). The migration
carries the compat floor 0.8.0: 0.8.0 opens a database that has them and a rollback keeps the links. The column is
nullable and references `accounts(id)` with `ON DELETE SET NULL`. Older code neither reads nor writes it and counts a
linked pair as two debts, as before.

The helper CLI changed in three small ways and has no new action. The host helper is still version 3 and passes
`--helper 3`. Every action, the keys of what `ops poll`, `ops report`, `ops state` and `ops access` print, and the keys
`ops report` and `ops state` accept are as in 0.8.7. What is new:

- `ops poll --dry --helper <version>` is the question of the helper's self-test after an update
  (`scripts/lib/ops-selftest.sh`). It always prints `{"request":null}` and writes nothing: no request is handed out and
  the helper does not count as seen. An app from before 0.9.0 ignores the flag and polls for real, so the helper asks
  only an app of 0.9.0 or newer.
- The state the helper sends, alone with `ops state` or inside `ops report`, carries a key `watchdog` with the four
  fields `at`, `from`, `to` and `reason` (`unhealthy` or `self_test`) after the helper took an update back by itself
  (`scripts/lib/ops-watchdog.sh`, `state_json` in `scripts/ops-helper.sh`). The app turns it into one event and a notice
  to every admin and does not keep it in the stored state (`apps/server/src/services/ops-watchdog.ts`). Keys beside the
  four are not read, so a later helper may say more. An older app drops the key like any unknown one.
- The doctor result the helper stores gets a first item with the id `watchdog` and the five keys every item has, so a
  page of 0.8.x lists the rollback as an error.

`ops-poll.json`, `ops-report.json` and `ops-state.json` are the files of 0.8.7 with the version in the texts and in the
payloads changed to 0.9.0 and one new case in each: the dry poll, a failed update taken back, and a snapshot after the
watchdog. The two cases with a `watchdog` key do not set `keepsStateKeys`, since the app reads that key and keeps
nothing of it.
