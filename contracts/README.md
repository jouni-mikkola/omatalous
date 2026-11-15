# Contracts

What an older installation depends on in a newer release. Each folder `contracts/<version>/` is frozen when that
version ships and describes interfaces that older code, scripts and helpers read:

- `schema.sql`: the schema of a fresh database of that version. A later version may add tables, columns, indexes and
  wider `CHECK` lists. It must keep every table, column, type, default and index that is listed, and a column it adds
  must be nullable or have a default, so the older code can still write rows. Two exceptions: a plain index that a wider
  plain index starting with the same columns covers may go, and a table that no build reads or writes any more may go
  with a `-- migrate: breaking` migration, which an older build refuses. The test lists such tables in `RETIRED_TABLES`.
- `ops-poll.json`, `ops-report.json`, `ops-state.json`: what `node dist/node.js ops poll|report|state` prints for the
  host helper, and the payloads the helper sends. Shapes are key sets and types, not values.

- `module-host.json`: the keys and export names of the shared files an add-on module imports (`MODULES` in
  `apps/web/src/module-host.ts`), for one `apiVersion`. A later version may add keys and exports. It keeps every listed
  one, or raises `apiVersion`. `apps/web/test/module-host-contract.dom.test.ts` checks it. Names of React and React DOM that
  are internal, experimental or only in some builds are not listed.

`apps/server/test/contracts.test.ts` checks that the current code satisfies every folder here. A change that breaks a
frozen contract is a breaking change: it needs a migration plan and a new contract folder, never an edit of an old one.

Until a version ships, a later task may update the files in its folder (the one above the version in `version.ts`).
Regenerate the schema with `UPDATE_CONTRACT=<version> pnpm test apps/server/test/contracts.test.ts` and edit the JSON
files by hand. A released folder is never touched: the test keeps checking that the current code satisfies it. A new
version starts with a copy of the previous JSON files, changed only where the helper CLI output changed.

A release that adds migrations needs a folder, and `tools/release/prepare.mjs` writes it
([docs/RELEASING.md](../docs/RELEASING.md)): the copy of the previous JSON files, a `README.md` worded from the columns,
tables and indexes the migrations add and the compat floors they carry, and `schema.sql` from the command above. It
writes nothing where the helper files (`cli-ops.ts`, `services/ops.ts`, `services/ops-validate.ts`,
`scripts/ops-helper.sh`) changed since the last release. Then a person checks whether what `ops poll|report|state` print changed, copies the previous JSON files, edits them where
it did, writes `schema.sql` with the command above and a `README.md` like the earlier ones (it names what changed in the
helper CLI, and says the JSON files are copies only when they are), and runs the release again.
