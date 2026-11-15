# Contracts of 0.10.0

Frozen when 0.10.0 ships. Until then a later task may update these files (see `../README.md`). While 0.10.0 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 0.9.0 the schema adds no table, column or index. Migration 0017 rebuilds `ops_requests` without the `CHECK` that
listed the actions of the column `action`: every row, its rowid and both indexes are kept, and the `CHECK` on `status`
stays. The gates are elsewhere: the server stores a row only for a name in `OPS_ACTIONS` (`services/ops-validate.ts`)
and the host helper runs only a name in its own `ACTIONS` (`scripts/ops-helper.sh`), so a later action needs no
migration. A `CHECK` that is gone is the widest list, which this folder's rules allow, and `schema.sql` shows it. 0017
carries no compat floor (it is marked breaking). A migration without a floor makes every build that lacks its file
refuse the database.

The helper CLI has no new output: `cli-ops.ts` did not change since 0.9.0. The host helper is now version 4 and passes
`--helper 4`, and it has two new actions and two new keys in its state:

- `prerelease-on` and `prerelease-off` are the two positions of the switch for new versions, as two names without
  parameters (`OPS_ACTIONS` and `ACTION_SINCE` in `services/ops-validate.ts`, `act_prerelease` in
  `scripts/lib/ops-release.sh`). `ops poll` hands them only to a helper of version 4 or newer, in the line of any other
  action, which the `action` pattern `[a-z-]{1,20}` of `ops-poll.json` already matches. A request queued for a newer
  helper than the one that polls ends as failed. An app of 0.9.0 or older has neither name in its list.
- The state the helper sends, alone with `ops state` or inside `ops report`, carries the key `prerelease` (`yes` or
  `no`: the switch as the host's `.env` has it, left out when the install has no `.env`) and the key `channel` (`source`
  when the install follows a branch, else `release`), both added by `state_json` in `scripts/ops-helper.sh`. The app
  keeps both and drops any other value (`normaliseState` in `services/ops-validate.ts`). An app of 0.9.0 or older drops
  the keys like any unknown one.
- The helper's version is part of its boot mark, so that the first tick of a renewed helper sends its snapshot with the
  new fields. What `ops poll`, `ops report`, `ops state` and `ops access` print and accept is otherwise as in 0.9.0.

`ops-poll.json`, `ops-report.json` and `ops-state.json` are not plain copies of the files of 0.9.0. The version in the
texts and in the payloads is 0.10.0 and the helper passes `--helper 4`. The first snapshot of `ops-report.json` and of
`ops-state.json` carries `prerelease` (`no` in the report, `yes` in the state) and `channel`, and both set
`keepsStateKeys`, so the test checks that the app keeps every key. The two cases with a `watchdog` key stay payloads of
the helper of the version taken back to, 0.9.0 (`--helper 3`), and carry neither key: they show that the app still takes
a state from an older helper.
