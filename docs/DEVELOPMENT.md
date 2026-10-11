# Development

```bash
corepack enable
pnpm install
pnpm seed:demo     # user "demo" / "demo-salasana-123" with 14 months of sample data
pnpm dev           # API on :8080, Vite on :5173 with hot reload
```

| Command | |
|---|---|
| `pnpm check` | typecheck, tests, shell lint and shell suites, short output ([WORKERS.md](WORKERS.md)) |
| `pnpm test` | all tests (Vitest), including `tools/repo-rules`, the invariants of CLAUDE.md as tests |
| `pnpm test:sh` | the shell suites in `tools/test/` |
| `pnpm typecheck` | TypeScript for every package, then `e2e`, `tools` and the root config files (`tsconfig.json`) |
| `pnpm release:prepare X.Y.Z` | bump the version and build the CHANGELOG section from `changelog.d/` ([RELEASING.md](RELEASING.md)) |
| `pnpm release X.Y.Z` | `tools/release/release.sh`: the whole release, step by step, resumable ([RELEASING.md](RELEASING.md)) |
| `pnpm release:ship` | `tools/release/ship.sh`: read CI, move private `main`, publish, print the baseline line |
| `pnpm release:fixture X.Y.Z` | `tools/release/fixture.mjs`: write the frozen database fixture of a release ([RELEASING.md](RELEASING.md)) |
| `pnpm build` | web (Vite) and server (esbuild, one file `apps/server/dist/node.js`) |
| `pnpm start` | runs the built server, data in `./data` |

## Layout

```
packages/core/src            pure logic, no I/O (runs on Node and in the browser)
  categories.ts              categories: id, label, flow kind, report group
  merchant.ts                merchant name cleanup
  categorize.ts              rules engine, Finnish rules, MCC codes
  transfers.ts               transfers between own accounts, card payments
  industry.ts                trade register match, TOL code to category, which rows are businesses
  pipeline.ts                categorize, transfers, merchant memory, industry; run after every change
  recurring.ts               subscriptions, bills, habits, income, price changes
  analysis/                  flows, analysis context (cached on the server), dashboard, insights
  reports/                   one file per report, registered in reports/index.ts
  sources/                   import parsers, one folder each, registered in sources/registry.ts

apps/server/src
  app.ts                     middleware and routes
  routes/                    thin HTTP handlers; admin.ts is the setup wizard API
  connectors/                where rows come from: registry.ts, sync.ts (the generic fetch loop), enable-banking/,
                             csv-import/ (importCsv)
  services/                  use cases: instance, users, ingest, enrich, analysis, upgrade,
                             industry (trade register lookup), schedule (the hourly tick)
  db/finance-repo.ts         FinanceRepo: financial data, always scoped to one user; passes each call on
  db/finance/                the SQL by concern (accounts, connections, transactions, transaction-list, merchants,
                             rules, sync-runs) over one { db, userId }
  db/migrate.ts, open.ts     migrations and the pre-migration copy; migrate-check.ts tries them on a copy
  auth/, security/           sessions, CSRF, password hashing, AES-GCM, X.509, key checks
  providers/                 prh (trade register search)
  entry/node.ts              server entry point: HTTP, static UI, hourly scheduler
  cli.ts, cli-ops.ts         setup-code, version, user management, sessions revoke-all, secret rotate, ops poll/report/state
  services/security.ts       security events (90 days), services/ops.ts maintenance requests
  entry/secret-rotate.ts     the secret rotation command

apps/web/src
  App.tsx                    login gate, header, routing
  pages/                     pages; pages/settings/ for the settings sections; Wizard.tsx
  charts/                    own SVG charts
  banks.ts                   bank logos (files in public/banks/)
```

How a release is made: [RELEASING.md](RELEASING.md).

## Rules the code follows

1. Money is integer cents, negative is money out. Dates are `YYYY-MM-DD` strings.
2. Core is pure: no database, HTTP, `Date.now()` or environment.
3. Financial data only through `FinanceRepo`. No SQL on financial tables anywhere else. A new query is a method of
   its module in `db/finance/` (with `user_id` in the statement, which a repo rule checks in every module) and a
   one-line method in `db/finance-repo.ts`.
4. After any change to transactions, accounts or rules, call `reprocess(repo, settings)`.
5. A category the user set (`category_source = 'user'`) is never changed by automation.
6. Secrets come from files. Values from the browser are checked against an allowlist and never reach a
   file name, a command or the filesystem.
7. A message the user should see is a `UserError` (400). A failing outside service throws an `UpstreamError` (502).
   Anything else becomes a plain 500.
8. UI text in Finnish; code, comments and docs in English. Comments explain why.

## Recipes

### New category or rule

1. `packages/core/src/categories.ts`: add `{ id, label, kind, group }`. Ids never change later.
2. `packages/core/src/categorize.ts`: add the rule to `BUILTIN_RULES` in the right place. The first match
   wins: purpose of payment before merchants, generic fallbacks last. Finnish compounds need `WORD[A-Z]*`.
3. A test in `packages/core/test/flows.test.ts` or `categorize.test.ts`.
4. If an industry should map to it, add the TOL prefix in `packages/core/src/industry.ts`.

No migration is needed. After the next update every member's history is categorised again.

### New report

1. `packages/core/src/reports/<name>.ts`: a pure function `(ctx, range) => data`, starting with a `Decision:` comment
   that names what the household decides with it. A repo rule checks it, also in the section file.
2. Register it in `reports/index.ts`. The API and types follow.
3. A section file in `apps/web/src/pages/reports/sections/` (copy an existing one). `registry.ts` finds it; its
   `reports` list names the core reports it reads, its `page` names the page that shows it (`reports` for Raportit),
   and a repo rule checks that every report has a section and every section a page.
4. A test in `packages/core/test/reports.test.ts` that checks its totals against the other reports.

### Module behind a feature flag

1. An entry in `FEATURES` in `packages/core/src/features.ts`: id, Finnish label, stage and default.
2. The module's routes in their own `Hono` app, mounted with `gated(s, id, routes)` from `auth/middleware.ts` at the
   module's prefix. While the flag is off they answer 404 like an unknown path.
3. Its nav entry in `apps/web/src/nav.ts` names the flag, so it is hidden while the flag is off. `/api/meta` carries
   the resolved flags; admins switch them in Asetukset > Palvelin.

### New bank

Add it to `BANKS` in `apps/server/src/connectors/enable-banking/banks.ts` (with `aspspName` exactly as Enable Banking
lists it), and its logo to `apps/web/public/banks/` and `apps/web/src/banks.ts`. Only banks on that list can be
started.

### New connector

A new place rows come from is a folder in `apps/server/src/connectors/` with an `index.ts` that exports a `Connector`
(`connectors/types.ts`), listed in `connectors/registry.ts`. Its `id` is stored in `accounts.provider`,
`connections.provider` and `transactions.source`, so it never changes. A connector that fetches by itself gives a
`sync` (open a puller, classify errors) and the loop in `connectors/sync.ts` does the rest. `connectors.test.ts` fails
when the folder and the registry disagree.

### New import format

A folder in `packages/core/src/sources/` with an `index.ts` that exports an `ImportParser` (`sources/types.ts`),
listed in `sources/registry.ts`. The parser is pure: text in, `ImportResult` out. `sniff` returns 0 to 1 from the
start of the file, and `parserFor` takes the best one.

### Database change

1. A new file `apps/server/migrations/NNNN_name.sql`. Never edit one that has run. Its SHA-256 is stored
   and a changed file stops the app.
2. Prefer adding: `ALTER TABLE ... ADD COLUMN` with a default, new tables, new indexes. Old code must still
   work with the new column.
3. An additive file starts with `-- migrate: compat <version>`, the oldest app version that may keep running on the
   schema it leaves. The floor is stored with the applied row. A build that does not know the migration still opens
   the database when its own version is at or above the floor, so a rollback keeps the data written since the update
   (`scripts/update.sh --rollback` asks the previous image to run its own `migrate-check` on the live database).
   Pick the floor by reading the new schema as that old version would: the new column is null or has a default, the
   new table and index are unused. Without the line no floor is stored and every build that lacks the file refuses the
   database, so a rollback restores the copy taken before the update. The line goes in the leading comment block.
   A test allows the header only on a file made of `CREATE TABLE`, non-unique `CREATE INDEX` and `ALTER TABLE ... ADD
   COLUMN` (nullable or with a default) statements, and requires it on such a file. Releases up to 0.5.x do not read
   the floor and refuse a database with a migration they do not know.
4. Rebuilding a table (dropping a column, changing a type): start the file with
   `-- migrate: foreign_keys=off` and a `-- migrate: breaking <reason>` line, and no compat floor.
   Foreign keys are off only for that file and checked before commit.
   Otherwise dropping a parent table would delete its child rows.
5. No `BEGIN` or `COMMIT` in the file. Each file runs as one transaction.
6. `apps/server/test/upgrade.test.ts` shows how to test a migration on an old database,
   `compat-floor.test.ts` how to test one as an older build would meet it. To try the pending migrations on a copy of
   a real database file: `node apps/server/dist/node.js migrate-check <file>` (after `pnpm build`). It never writes the
   file, prints one JSON line with the time and the row counts, and exits 1 when anything fails.
7. `contracts/<version>/` freezes what older installations read from a release: the schema of a fresh database and the
   shapes the host helper reads from `ops poll|report|state`. `apps/server/test/contracts.test.ts` fails when the code
   stops satisfying one. While a version is unreleased its schema dump must equal a fresh database, and the test
   names the command that regenerates it. Details in `contracts/README.md`.
8. Bump the version in `apps/server/src/version.ts` and the `package.json` files, and add a line to
   `CHANGELOG.md`.

### New API route

Add it to the right `routes/*.ts`. Everything under `/api/*` after `requireUser` needs a login and the
CSRF header. Validate input (`strictObject`, `optionalString`, the `parse*` helpers) and throw `UserError`
for bad input. Test with `setupApp()` from `apps/server/test/helpers.ts`. `apps/server/test/contract.qa.test.ts`
reads the route list of the app, so a new route is checked for the login requirement, the CSRF header, other
members' data and secrets in the response without any change to that file. A route that must be reachable
without a login goes into its `PUBLIC` list.

## Performance

The analysis context (enriched transactions, recurring series) is built once per data version and cached
per user and view (`services/analysis.ts`). A request filters by day number with a binary search and adds
up. Hot loops use parsed day numbers, not `Date` objects.

The data version is per user (settings key `data_version:<user id>`) plus an instance one. A cached view is keyed by
the versions of its user and of the owners of the shared accounts in it, so one member's edit does not drop the
others' views. The cache keeps one entry per user and view with the day inside it, and is capped by the number of
cached rows (about 200 MB at the default) with least recently used entries going first.

A category set by hand and a merchant rule do not process the whole history. `reprocessMerchantChange`
(`services/enrich.ts`) reads the rows of that merchant and core `enrichIsland` derives them again. Everything that
could reach beyond the merchant is checked: transfer pairing, returns (refunds, friends' shares), and that the old
inputs give the stored rows back. When any check fails, or the upgrade tasks of this build have not finished, or an
import waits for its categories, the full reprocess runs. The result is the same either way; `core/test/island.test.ts`
and `server/test/incremental.test.ts` compare both on random histories (more seeds: `ISLAND_SEEDS=200`,
`INCREMENTAL_SEEDS=40`). A change to the enrichment rules in `pipeline.ts` has to keep `enrichIsland` in step.

A sync or an import compares the bank fields of each row with the stored one and writes only what differs. When
nothing differs it marks nothing, processes nothing and leaves the version alone.

SQLite needs table statistics to pick the partial indexes (pending and uncategorised rows) over the wide ones:
`PRAGMA optimize` runs at start and in the hourly tick (`db/pragmas.ts`).

## Tests

- Core: money flow scenarios, recurring detection, reports checked against each other.
- Server: login, rate limiting, CSRF, headers, isolation between users, sharing, setup wizard input,
  migrations and upgrades, a mocked Enable Banking and trade register.
- Property tests: `packages/core/test/invariants.qa.test.ts` builds random households from a seed and checks
  that every row lands in one flow, flows add up to the amounts, report totals match the dashboard and no
  number is NaN, also around leap days and DST changes. A failure names the seed. A known bug is an `it.fails`
  with a comment, so the suite stays green and starts complaining when the bug is fixed.
- Bug hunt tests: `apps/server/test/bughunt.qa.test.ts` (CSV formats, double imports, sync and import at the
  same time, expired sessions, the hourly tick on DST days).
- A new feature gets a test. A bug fix starts with a test that shows the bug.

### End-to-end tests

`pnpm build` first, then `pnpm e2e`. `e2e/run.mjs` copies the build to a temp directory, starts it on a free
port with an empty database, and runs the Playwright specs in `e2e/` against it. The data directory is deleted
at the end. The specs create the admin through the setup form, load the demo data, open every page on a desktop and a phone
screen, and change a transaction's category and check that it
is still there after a reload. A console error, an uncaught error, a failed request or any 4xx or 5xx response
fails the run, and so does a page that scrolls sideways on the phone.

Playwright needs a Chromium. Where one is preinstalled, point `PLAYWRIGHT_BROWSERS_PATH` at it. Otherwise run
`pnpm exec playwright install chromium` once. `E2E_CHROMIUM=/path/to/chrome` uses a specific binary. Extra
arguments go to Playwright, for example `pnpm e2e --headed -g "kept after a reload"`. CI runs the suite in its
own job after the build.

## Manual test: an existing install through the update

Run in Docker, after a change to `docker-compose.yml` or the scripts. An install made
before `INSTANCE_NAME` existed must keep its names whatever its directory is called.

1. Clone the commit before the change (`39a7685`) into a directory not named `banking-app`, for example
   `~/Talous_X.y`, and run `./scripts/install.sh`. Note `docker ps` (container `banking-app`), the image
   `banking-app:latest` and `docker volume ls` (`talous_xy_banking-data`). Create the admin account.
2. Check out the new commit's branch and run the old `scripts/update.sh` from step 1 (it pulls the new
   scripts and compose file while it runs). The app must come back as container `banking-app` from
   `banking-app:latest` on port 8080, with the same volumes and data.
3. Run the new `./scripts/update.sh` after another change, and then `./scripts/update.sh --rollback`.
   `banking-app:previous` must exist and be what runs afterwards.
4. Run `./scripts/install.sh` again. `.env` must not get an `INSTANCE_NAME` line, and the volumes stay the same.
5. Add a second instance with `./scripts/install.sh --new-instance second`. Both log in at once in one browser.
