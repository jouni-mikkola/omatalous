# Contracts of 0.8.7

Frozen when 0.8.7 ships. Until then a later task may update these files (see `../README.md`). While 0.8.7 is
unreleased the test also demands that `schema.sql` equals the schema of a fresh database exactly, so a schema change
cannot pass without its dump.

Over 0.8.5 the schema adds the table `loans` with its index `idx_loans_user` (0014) and the column
`transactions.bank_txn_code` (0015). Both migrations carry the compat floor 0.8.0: 0.8.0 opens a database that has
them and a rollback keeps the rows and the codes. The `access` action needed no migration: the `CHECK` on
`ops_requests.action` has allowed the name since 0007.

The helper CLI changed. The host helper is version 3 and passes `--helper 3`. It knows a tenth action, `access`:
apply the way of reaching this copy that the app has prepared. The action takes no parameters, and `ops poll` hands
its row, in the shape it always had, only to a helper of version 3 or newer. An older helper that polls gets
`{"request":null}` and the row fails with a summary that says the helper does not know the action.

What to apply is read with a new command, `node dist/node.js ops access --helper <version>`. It prints one line, which
the helper matches as text, with the keys in this order and nothing added:

- `{"want":null}` when nothing is prepared, and always for a helper older than version 3
- `{"want":"lan"}`
- `{"want":"tunnel","hostname":"…","tunnelToken":"…","accessAud":"…","teamDomain":"…"}`

`ops-poll.json` holds the first line as a case. The other two need the request file in the data folder and are
checked in `apps/server/test/ops.test.ts`. The forms of the four values are in
`apps/server/src/services/access-request.ts`, and the helper checks them again before it writes anything
(`scripts/lib/ops-access.sh`). A later release may not widen a form: an installed version 3 helper would refuse the
value.

`ops report` and `ops state` print what they did before. The payloads in `ops-report.json` and `ops-state.json` are
the ones the 0.8.7 helper sends: over the copies of 0.8.5 they add `schema_changed` (sent since 0.8.0 and kept by the
app) and show the mode `tunnel` with its address.
