# Contracts

What an older installation depends on in a newer release. Each folder `contracts/<version>/` is frozen when that
version ships and describes interfaces that older code, scripts and helpers read:

- `schema.sql`: the schema of a fresh database of that version. A later version may add tables, columns, indexes and
  wider `CHECK` lists. It must keep every table, column, type, default and index that is listed, and a column it adds
  must be nullable or have a default, so the older code can still write rows.
- `ops-poll.json`, `ops-report.json`, `ops-state.json`: what `node dist/node.js ops poll|report|state` prints for the
  host helper, and the payloads the helper sends. Shapes are key sets and types, not values.

`apps/server/test/contracts.test.ts` checks that the current code satisfies every folder here. A change that breaks a
frozen contract is a breaking change: it needs a migration plan and a new contract folder, never an edit of an old one.

Until 0.6.0 ships, a later task may update the files in `0.6.0/`. Regenerate the schema with
`UPDATE_CONTRACT=0.6.0 pnpm test apps/server/test/contracts.test.ts` and edit the JSON files by hand.
