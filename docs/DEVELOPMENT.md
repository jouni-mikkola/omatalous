# Development

```bash
corepack enable
pnpm install
pnpm seed:demo     # user "demo" / "demo-salasana-123" with 14 months of sample data
pnpm dev           # API on :8080, Vite on :5173 with hot reload
```

| Command | |
|---|---|
| `pnpm check` | typecheck, tests, shell lint and shell suites, short output |
| `pnpm test` | all tests (Vitest), including `tools/repo-rules`, the invariants of CLAUDE.md as tests |
| `pnpm coverage` | the web tests with line coverage by area (App, Auth, the loan intake, pages, components) against the floor in `apps/web/coverage-floor.json`; exit 1 when an area is under it. About 30 s. `--raise` writes the floor up to what the run reached (a tenth of a percent, rounded down), and a run refuses a floor lower than on `origin/main`. Run it with `pnpm check` before a change to the web app is handed back; it is not part of CI |
| `pnpm test:sh` | the shell suites in `tools/test/` |
| `pnpm lint:sh` | lint of every shell file (`tools/ci/shell-lint.sh`) |
| `pnpm typecheck` | TypeScript for every package, then `e2e`, `tools` and the root config files (`tsconfig.json`) |
| `pnpm strings` | every text the browser can show, one line each: `file:line`, tab, kind (`jsx`, `attr`, `literal`, `error`), tab, the text. Narrow it with `grep` on the first column, `--file <path>`, or `--count`; `pnpm -s strings` leaves out pnpm's own lines. For reading the Finnish of the whole app in one place |
| `pnpm findings` | every statement the product makes about money, for the demo and the seeded households. `--golden` rewrites the golden files (see *Golden files* below) |
| `pnpm release:prepare X.Y.Z` | bump the version and build the CHANGELOG section from `changelog.d/` ([RELEASING.md](RELEASING.md)) |
| `pnpm release:fixture X.Y.Z` | `tools/release/fixture.mjs`: write the frozen database fixture of a release ([RELEASING.md](RELEASING.md)) |
| `pnpm shots <route>...` | full-page PNGs of pages of the built app at several widths, with the demo household, the fake bank, changed API answers or a step of your own ([Pictures of a page](#pictures-of-a-page)) |
| `pnpm first-evening` | the First evening check (`e2e/first-evening/`): an empty install, the setup form, the fake bank's made-up household linked, and the share of the rows' value (at least 95 %) that lands in the category the data expects, in at most 30 minutes of scripted steps. Needs `pnpm build` first. Local only: not in `pnpm e2e`, not in CI |
| `bash tools/install-hour.sh` | the Install hour check: the one-line install in a clean Ubuntu container, then the First evening steps against that install with the fake bank, the second of each step in a log (`$TMPDIR/install-hour/install-hour.log`) and a failure over 60 minutes (`--budget`). Needs Docker, `pnpm build` and a Playwright Chromium. Local only |
| `pnpm build` | web (Vite) and server (esbuild, one file `apps/server/dist/node.js`) |
| `pnpm start` | runs the built server, data in `./data` |

Node: `.npmrc` sets `use-node-version=24.22.2`, so `pnpm <script>` and `pnpm exec` fetch that node once (the first run needs the network) and run on it, whatever the system has. Scripts such as `pnpm shots` read `.ts` files with plain node, which Ubuntu's `nodejs` package cannot (`process.features.typescript` is false). Run things through pnpm, and `tools/check.sh` started by hand goes through it once. CI (`setup-node`) and the image (`Dockerfile`) name the same version, and `tools/node-pin.test.ts` keeps the three together. pnpm does not switch when the system node already has the pinned version, so pin a version your system package does not ship.

In the private repository a push runs no CI, because Actions minutes are billed there. `pnpm check`, `pnpm build` and
`pnpm e2e` are the check: they run before a change lands and before a release is pushed, and the release then starts
CI and the upgrade rehearsal itself. Otherwise CI runs there only by hand (`gh workflow run ci.yml --ref <branch>`): a
pull request skips every job. The public repository runs it on every push and pull request that touches more than documents. It is the light tier: lint, types and the tests of what the change reaches, with the pnpm store cached. The whole of `pnpm check`, the build, `pnpm e2e` and the image checks run locally, in the release gate and proof; none of them is deleted. The table is in
[RELEASING.md](RELEASING.md#when-ci-runs).

The release machine runs `tools/ci/smoke-image.sh IMAGE VERSION COMMIT` on every image it builds, and the release run on GitHub runs it on both processors: the labels match, a
new install answers `/api/health` within 120 seconds and prints its version, and a database of 0.5.0 migrates and
keeps its users. By hand, on a machine with Docker: `docker build -t x .`, then `tools/ci/smoke-image.sh x unknown unknown`.

## Layout

```
packages/core/src            pure logic, no I/O (runs on Node and in the browser)
  categories.ts              categories: id, label, flow kind, report group
  merchant.ts                merchant name cleanup
  categorize.ts              rules engine, Finnish rules, MCC codes
  categorize-people.ts       the rules about people: holders of the accounts, MobilePay, the bank's words for a payment between people
  categorize-bank-rows.ts    lenders by the shape of their name, by their own payout and by the register; the bank's own rows
  transfers.ts               transfers between own accounts, card payments
  card-channel.ts            a card's payment channel, learned from paired rows on every run and stored nowhere
  industry.ts                trade register match, TOL code to category, which rows are businesses
  pipeline.ts                categorize, transfers, merchant memory, industry; run after every change
  recurring.ts               subscriptions, bills, habits, income, price changes
  recurring-cadence.ts       the cadence table and fitting; recurring-cost.ts a series' cost
  analysis/                  flows, analysis context (cached on the server), dashboard, insights
  reports/                   one file per report, registered in reports/index.ts
  loans.ts                   every figure of a loan; household-debts.ts the list of debts behind each debt total
  holdings.ts                accounts, cards and loans as the first page shows them, with the total of the accounts

apps/server/src
  app.ts                     middleware and routes
  routes/                    thin HTTP handlers; admin.ts is the setup wizard API
  connectors/                where rows come from: registry.ts, sync.ts (the generic fetch loop), enable-banking/,
                             fold-accounts.ts; csv-import/ is only the provider entry `csv` of the accounts that
                             earlier versions imported
  services/                  use cases: instance, users, ingest, enrich, analysis, upgrade,
                             industry (trade register lookup), schedule (the hourly tick)
  db/finance-repo.ts         FinanceRepo: financial data, always scoped to one user; passes each call on
  db/finance/                the SQL by concern (accounts, connections, transactions, transaction-list, merchants,
                             rules, sync-runs) over one { db, userId }
  db/migrate.ts, open.ts     migrations and the pre-migration copy; migrate-check.ts tries them on a copy
  auth/, security/           sessions, CSRF, password hashing, AES-GCM, X.509, key checks
  providers/                 prh (trade register search), cloudflare (Tunnel, DNS and Access client)
  entry/node.ts              server entry point: HTTP, static UI, hourly scheduler
  cli.ts, cli-ops.ts         setup-code, version, user management, sessions revoke-all, secret rotate, secret check <file>
                             (0 opens the stored keys, 4 does not, 1 could not be tried), ops poll/report/state/access
  services/security.ts       security events (90 days), services/ops.ts maintenance requests
  services/remote-access*.ts the Etäkäyttö page: token, address, emails, the 15 minute trial; access-request.ts the file the helper reads
  security/cf-access.ts      the check of Cloudflare Access's token (CF_ACCESS_AUD, CF_ACCESS_TEAM_DOMAIN)
  entry/secret-rotate.ts     the secret rotation command
  db/startup-gate.ts         the check before the database opens; backup-keep.ts, backup-check.ts which copies pruning
                             keeps and the deep check of a copy (ARCHITECTURE.md, "Keeping the data safe")
  services/db-restore.ts     the restore of the newest copy; reset.ts Tyhjennä kaikki tiedot; disk.ts the reserve file;
                             db-health.ts the notices about the safety net

apps/web/src
  App.tsx                    login gate, header, routing
  pages/                     pages; pages/settings/ for the settings sections; Wizard.tsx
  charts/                    own SVG charts; kit/ the shared parts, forms/ one file per form (ADR 0019)
  banks.ts                   bank logos (files in public/banks/)

scripts/                     what runs on the host: install.sh, update.sh, backup.sh, restore.sh, doctor.sh, reset.sh,
                             ops-helper.sh and ops-launcher.sh (the maintenance helper), lib/ (ARCHITECTURE.md,
                             "Maintenance from the browser")
tools/                       what only developers and CI use: repo-rules/ (the invariants as tests), test/*.test.sh
                             (shell suites; the helper's share a fake host in ops-world.sh), ci/ (smoke-image.sh, ...)
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

### A list of rows

Use `components/table/Table.tsx`, never page-owned `<table>` markup or a horizontal scroll frame.
Give it a Finnish `caption`, stable `rowKey` and `columns`. Mark the identifying column `rowHead` and the
principal figure `main`; use `kind: "money"` with `cents` for amounts. Pass totals from the server through
`total`; the component only formats them. Use `KeyValue` for one subject's facts and a sentence for no rows.

- Add `sort` only to a complete list that is read by size, never a time series or a loaded subset.
- Use `groups` for sections, `drill` for row details and `page` for a long ungrouped list.
- Mark month columns `series`: they fold into a labelled list when the container cannot fit them. The shared
  layout handles narrow cards as well as phones; do not add a page-specific mobile table.
- A chart has no Kaavio / Taulukko switch: its table stands under it in `ChartWithTable`, and the chart passes `keys`
  (the `rowKey` of each mark's row) to `ReadoutLayer` so a click filters the table ([ADR 0023](adr/0023-chart-and-table-together.md)).
  Delete a view nobody needs, with its code and everything that belongs to it. Keep no hidden copy and no setting to restore it.

`apps/web/test/table.test.ts` guards the single table implementation. `e2e/table-views.spec.ts` checks visibility,
sideways scrolling and axe at 390 and 1440 px, and `e2e/table-sort.spec.ts` the toolbar, the sort and the opened row. Add a new view to that coverage and inspect screenshots
at both widths. The decision is [ADR 0018](adr/0018-one-table-delete-redundant-views.md).

### The repo rules

`tools/repo-rules` holds these and more as tests. `pnpm test tools/repo-rules` runs them, the header of
`repo-rules.test.ts` lists each rule with its file, and a failure names the rule, `file:line` and what to do. A rule reads
the tracked files and the new files that git does not ignore, so a new file meets the rules before its commit. Some that
a change meets:

- The `privacy` check is not a repo rule: it reads what a change adds, its commits and its pull request. `pnpm check`
  runs it first (`node tools/privacy/scan.mjs --local`: the commits since `origin/main`, the changes not committed, the
  new files and the address git commits with), since the run on GitHub comes after the push, when the commits are public
  already. The run on GitHub takes `tools/privacy` from the base commit, so a change to the scanner or its lists is
  judged by main's copy. The rules are in CLAUDE.md, "The public repository".
- Rule 6: import boundaries and no import cycle. Nothing under `apps/*/src` or `packages/*/src` imports from a `test` or
  `fixtures` folder.
- Rule 12: Finnish style (no te-form, no "!", banned words) in the web's texts and in the sentences the server sends.
  SQL strings in the server are skipped, and `!=` is no exclamation mark.
- Rule 23: every workflow job names a fixed runner image (`ubuntu-24.04` or `ubuntu-24.04-arm`), never a `-latest` label.
  Moving to a newer image is `RUNNERS` in `tools/repo-rules/runners.ts` and the `runs-on` lines together, then a dry run
  of the release workflow.
- Rule 24: an export of `packages/core/src` or `apps/server/src` has a reader in another source file (core, the server,
  the web app or `tools/findings`), or stands on a list in `tools/repo-rules` that only shrinks: a line
  goes when its export goes. A test is no reader, and neither is a line that only passes the name on (`export … from`,
  `export *`). Names are matched by spelling, so the rule can miss an unread export but never refuses one that is read.
- Rule 25: no shell file and no workflow pipes into `grep -q` (any `q` flag group, `--quiet`, `--silent`), also inside a
  `bash -c` string. Under `pipefail` the writer dies of the closed pipe and a match reads as a miss. Write
  `grep … >/dev/null`. `grep -q` on a file is allowed.
- Rule 26: a function defined under `scripts/` is named a second time, outside comments, somewhere under `scripts/`. A
  name that only `tools/test` uses does not count: a function that only a test calls is dead.
- Rule 27: `git check-ignore` holds for `.env.new`, `ops/env.prev` and `.env.bak.1`, so a copy of `.env` is never
  committed.
- Rule 28: Finnish that reads as translated or machine written (`tools/repo-rules/finnish.ts`, its patterns in
  `finnish-patterns.ts`). It reads the files whose strings reach the browser, the same folders `pnpm strings` lists.
  It refuses a calque (*pois lukien*), a word the glossary rejects (*löydös*, *syötetty*, *keskiostos*), a past-tense te-form and the marks of machine-written prose: an
  em dash in a Finnish string, "ei ... vaan" as a contrast and an exclamation mark at the end of a sentence. A failure prints the file and line,
  the name of the pattern and one line on how to write it instead. Write the sentence again in plain Finnish, as a person
  would say it to a friend. Do not add the string to a list to make the rule pass: a pattern that catches a good
  sentence gets a near miss in `tools/repo-rules/finnish.test.ts` first.
- Rule 35: the words the glossary of [UI_STYLE.md](UI_STYLE.md) removed (*optimoi*, *Yli jäi*, *Tileillä* as the name of a
  figure, *linkitä*) stay out of the texts `pnpm strings` lists, except between double quotes. A word is added in
  `tools/repo-rules/glossary.ts` with a case in `glossary.test.ts`.

Rules 12, 28 and 35 together are the Finnish of the app, with the glossary and style sheet in [UI_STYLE.md](UI_STYLE.md): everything the browser shows is Finnish, in the words of the glossary
(*tapahtuma*, never *tilitapahtuma*). `pnpm strings` lists every such text with its file and line, so a copy pass reads the
whole app in one list. A text you change or remove is searched in `tools/`, `apps/web/test` and `e2e` before the
commit, and `pnpm test tools/ui-strings.test.ts` runs: that test pins some sentences of the app's pages, and a copy
pass that rewrites one changes its part there too.

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
3. A section file in `apps/web/src/pages/reports/sections/` (copy an existing one). Its `reports` list names the core
   reports it reads and its `page` names the page that shows it (`reports` for Raportit). A repo rule checks that every
   report has a section and every section a page.
4. Add the section to the question page that asks the question it answers: `pages/reports/pages/<Page>.tsx` lists its
   sections, and the page's own styles go in `styles/report-<page>.css`. `registry.ts` reads only those files.
5. A test in `packages/core/test/reports.test.ts` that checks its totals against the other reports.

### Module behind a feature flag

A module that ships finished has no flag: Säästövinkit had one and lost it. The shared build has no flag today, and a
module that needs one is added as an extension (the extension files of the server and the web app).

1. The extension declares its flag: the id, a Finnish label, the stage and whether it starts on.
2. The module's routes in their own `Hono` app, mounted at `/api/<id>` behind the flag. While the flag is off they
   answer 404 like an unknown path.
3. Its page is listed by `extensionPages` in `apps/web/src/extensions.ts` only while the flag is on. `/api/meta` carries
   the resolved flags. On a wide screen it follows the tabs; on a phone it is in the user menu and takes no place in
   the tab bar.

### New bank

Add it to `BANKS` in `apps/server/src/connectors/enable-banking/banks.ts` (with `aspspName` exactly as Enable Banking
lists it), and its logo to `apps/web/public/banks/` and `apps/web/src/banks.ts`. Only banks on that list can be
started.

### New connector

A new place rows come from is a folder in `apps/server/src/connectors/` with an `index.ts` that exports a `Connector`
(`connectors/types.ts`), listed in `connectors/registry.ts`. A `Connector` is its `id`, an optional `sync` and an optional
`revokeAll`. The `id` is stored in `accounts.provider`, `connections.provider` and `transactions.source`, so it never
changes. A connector that fetches by itself gives a `sync` (open a puller, classify errors) and the loop in
`connectors/sync.ts` does the rest. `connectors.test.ts` fails when the folder and the registry disagree.

There is no recipe for an import format: the CSV import was removed in 0.9.0 and the server reads no files. The one reader is the card statement, read in the browser (ADR 0025): a new layout is a reader in `packages/core/src/card-file.ts` and a made-up statement in its test. A bank's CSV export needs no reader of its own: `packages/core/src/bank-csv.ts` guesses the columns from the header and the household settles them once; a header word it does not know is added to its word lists, with a made-up export in `bank-csv.test.ts`. A camt.053 statement is read by `packages/core/src/bank-camt.ts`, which refuses a file whose closing balance is not its opening balance plus the rows.

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
   A test allows the header only on a file made of `CREATE TABLE`, `CREATE INDEX` and `ALTER TABLE ... ADD COLUMN`
   (nullable or with a default) statements, and requires it on such a file. A `CREATE INDEX` must be non-unique, except
   on a table the same file creates with a plain `CREATE TABLE` (one without `IF NOT EXISTS`, which stops when the table
   is already there): older code writes no row of that table, so a unique index on it keeps no promise to rows that
   older code writes. A unique index on any other table is refused. Releases up to 0.5.x do not read
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
8. Add a fragment `changelog.d/<task>.md` with an `upgrade:` line for the migration
   ([changelog.d/README.md](../changelog.d/README.md)). The release script refuses a release that adds a migration
   without one. Do not bump versions or edit `CHANGELOG.md`: `pnpm release:prepare` does both at release.

### The loan link and a debt figure

A saved loan can name the connected card or loan account that is the same debt (`loans.account_id`, migration 0016: a
nullable column, `ON DELETE SET NULL`, additive with a compat floor of 0.8.0). A linked pair is one debt. Every debt total
reads the list in `householdDebts`, and no view adds loans and accounts up itself.

1. A figure of one loan (owed on a day, interest, next payment, payoff date) is a function in `loans.ts`. Which debts
   count, and that a linked pair counts once, is decided in `household-debts.ts` alone (ADR 0004, 0012). A new debt
   figure goes in one of the two, never in a report or a component.
2. The link itself is made on the server: `routes/loans.ts` takes `accountId` through `parseAccountId`, which accepts only
   the owner's own card or loan account, and the statement in `db/finance/loans.ts` (`ACCOUNT_FREE`) allows one loan to
   an account. A new way to save a loan goes through both.
3. In core a linked pair is one entry of `HouseholdDebts.connected` whose `sources` entry says `linked`. It holds the
   bank's balance with the saved loan's rate and payments while the account's balance is at or below zero and is not
   older than the balance typed for the loan (`balanceDayOf`); otherwise it counts as typed, still once. The readers are
   the Lainat report, the accounts less the debts in Saldot, the loan area of Säästövinkit and `buildHoldings` for the
   first page. A debt that may still be counted twice is named by `maybeTwice` in `reports/loans.ts`.
4. In the web, `LoanLinks` (`components/loans/LoanEditor.tsx`) gives the form the household's accounts and loans, and the
   Lainat report links to a loan's form with an account chosen by `#/settings?linkLoan=<loan id>&linkAccount=<account id>`
   (`LOAN_LINK_PARAM` in `components/loans/form.ts`).
5. Tests to extend: `packages/core/test/household-debts.test.ts` (the list and its three readers, with and without a
   link), `owners.test.ts` (the readers agree), `balances-holdings.test.ts` (cards' use and loans' balance add up to the
   debt total), `apps/server/test/loan-link.test.ts` (own account only, one loan to an account, the link goes with the
   account), `apps/web/test/loan-link.test.ts` and `e2e/loans.spec.ts`. A figure that changes for a linked pair needs a
   case with the link and one without.

### New API route

Add it to the right `routes/*.ts`. Everything under `/api/*` after `requireUser` needs a login and the
CSRF header. Validate input (`strictObject`, `optionalString`, the `parse*` helpers) and throw `UserError`
for bad input. Test with `setupApp()` from `apps/server/test/helpers.ts`. `apps/server/test/contract.qa.test.ts`
reads the route list of the app, so a new route is checked for the login requirement, the CSRF header, other
members' data and secrets in the response without any change to that file. A route that must be reachable
without a login goes into its `PUBLIC` list.

### New dependency

A new package in a `dependencies` list is decided in a record in `docs/adr/` before the commit that adds it. The
record gives the reason, the measured size, a review date and what makes it review earlier.

The web stack is decided in [ADR 0019](adr/0019-ui-stack.md). A library on its chosen list needs no new record. The
task that first uses it adds it, loads it through route splitting so it lands only on its pages, and checks that the
size is close to the one in the record. A library from its rejected list, or one it does not name, needs a new record
that names 0019.

Measure as the record does. Write a test entry that imports what the app uses and bundle it with
`esbuild --bundle --minify`. Run `gzip -9` on the result and subtract React and ReactDOM. Do it in a temporary
folder outside the repo. A devDependency used only by tests or tooling needs
no record. One that changes what is built, such as a compiler or a bundler plugin, does.

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

### Budgets

The figures are held by tests on invented data; no big file is in the repo.

- Data: `apps/server/scripts/history-gen.ts` makes five years of rows (the demo household topped up with everyday purchases to 100 000 or more); `pnpm seed:years` loads them into `./data`.
- Dashboard: `pnpm test:perf apps/server/test/dashboard.perf.test.ts`. A repeated request is served from `services/dashboard-memo.ts`, one answer per period and inputs for a cached context. The budget is 1 s of CPU warm. A period asked for the first time builds the whole answer (about 1 s on an idle machine, spread over many small analyses) and has 1.5 s.
- Transaction list: `pnpm e2e:years` starts a server of its own, loads the history and times the first rows of Tapahtumat under a 4x CPU slowdown (1 s). A local check, not part of `pnpm e2e` or CI.
- Entry bundle: `pnpm budgets` after `pnpm build` adds up the gzip size of the files `index.html` names and holds it within 10 % of `apps/web/bundle-budget.json`, and holds the script of Yhteenveto (entry, page chunk, page texts and what they import statically, before gzip) within 5 % of `firstPageScriptBytes`; run it before a release. A bigger entry is fixed with route splitting; the base changes only by a decision, with the measurement in the pull request.
- Fetched rows: `apps/server/test/ingest.test.ts` ("every fetched row is accounted for"). Each row ends stored, counted as skipped, replaced or pending, or refused and listed in Tietojen laatu.

## Tests

- Core: money flow scenarios, recurring detection, reports checked against each other.
- Server: login, rate limiting, CSRF, headers, isolation between users, sharing, setup wizard input,
  migrations and upgrades, a mocked Enable Banking and trade register.
- Property tests: `packages/core/test/invariants.qa.test.ts` builds random households from a seed and checks
  that every row lands in one flow, flows add up to the amounts, report totals match the dashboard and no
  number is NaN, also around leap days and DST changes. A failure names the seed. A known bug is an `it.fails`
  with a comment, so the suite stays green and starts complaining when the bug is fixed.
- Bug hunt tests: `apps/server/test/bughunt.qa.test.ts` (rows of the old CSV kind put through the ingest twice, sync
  and import at the same time, expired sessions, the hourly tick on DST days).
- Rows of the old CSV kind: installs keep the accounts the import made, so tests that need such rows put them through
  `ingestTransactions` with `apps/server/test/csv-seed.ts` and `csv-import-service.ts`. The reader of the files the tests
  hold (`test/fixtures/nordea-csv.ts`) is strict and no parser of bank exports. Seed into an account without pending
  rows. `csv-legacy.test.ts` pins that such rows are categorised, counted in the reports, paired with bank accounts,
  not counted twice after a bank sync, exported and removable.
- The shell suites (`tools/test/*.test.sh`) of the maintenance helper share one fake host, clone and set of ticks,
  `tools/test/ops-world.sh`, and `ops-helper.test.sh` has a scenario for each place the helper calls one of its libraries.
- A new feature gets a test. A bug fix starts with a test that shows the bug.

### Timing tests and the vitest projects

`vitest.config.ts` splits the suite into projects, so a test that depends on the clock never runs beside the rest:

- `core`: `packages/*` tests, run with `isolate: false`, so the files of a worker share one module cache.
- `rules`: the three files of the repo rules (`tools/repo-rules/repo-rules*.test.ts`), without isolation, so they parse
  each source once between them (`warm.ts`). A new rule module goes into the file of its group (the header of
  `repo-rules.test.ts` names the groups).
- `main`: the other tests, also without isolation.
- `isolated`: every `*.isolated.test.ts`, a fresh module cache per file. A test that mocks a module of the code it tests
  (`vi.mock`) is named so, because with a shared cache the mock misses code another file loaded first.
- `perf`: every `*.perf.test.ts`, one file at a time, after the others.

Where files share modules, a kit a test imports loads once per worker. A hook written at the top of a kit
(`beforeEach`, `afterAll`) then reaches the first file only: put it in `tools/lib/test-setup.ts`, or export a function
the test files call (`useWorlds()` in `remote-access-kit.ts`). Make temporary folders with `tempDir()`.

A test that compares elapsed time with a limit is a `*.perf.test.ts`. It calls `performance.now` or `Date.now() -`.
It may also call `bestOf` or `budgetRatio` of `tools/lib/timing.ts`.

Its other half stays in the ordinary file as a check of the work. That check counts the rows read, the size of the
answer or the result. The shared setup goes in a `*-kit.ts` file beside them.

`pnpm test` and `pnpm check` leave the `perf` project out. A loaded machine, or several runs at once, is no place to
measure seconds. `pnpm test:perf [files]` runs them: start it when the machine is quiet. A change that touches a perf test file
gets it in its `pnpm check --changed`.

`--sequence.shuffle` runs the files and the tests of each in a random order: `pnpm test --sequence.shuffle` is how to
find a test that leans on another's leftovers, and it is worth running twice on a change of a project's setup.

### Tests that click and type

`apps/web/test/*.dom.test.ts` run in the `dom` project (happy-dom, `tools/lib/dom-environment.ts`). `dom-kit.ts` has
`startServer()`, which puts the real server with the demo household behind `fetch`, and `openApp(hash, heading)`, which
renders the app at a page. Write what the household does and what it sees, and check the request that went out
(`server.seen`). `stubApi(table)` answers from a table where the real server cannot be used. A test that only renders
a page does not belong here.

### How to test a change

1. While you work, run the one test file you are changing: `pnpm test path/to/file.test.ts`.
2. Before you commit, run `pnpm check --changed <base>` once, with the commit your work started from (without a base it
   is `origin/main`). It runs the type check everywhere, the test files that import a changed file (the tests of its
   package where the import graph cannot say) and the shell suites only if shell changed, and ends in a few lines. A
   plain `pnpm check` runs everything, with the four steps side by side (`CHECK_SERIAL=1` runs them one after the
   other), except the self-tests of the developer and release tools (`tools/check/tooling.txt`) when nothing under
   `tools/`, `.github/` or `scripts/` changed. CI and the release gate run those too, and so does `CHECK_TOOLING=1`.
3. Run `pnpm build` and `pnpm e2e` once, and only when the change touches the web app or a route. A task that works beside
   others runs the specs of its own pages (`pnpm e2e <spec files>`); the release gate runs every spec on the merged
   tree, since a page that breaks shows in another page's spec.
4. Stage your files first (`git add -A`): the repo rules read the index and the new files that git does not ignore.

### Pictures of a page

`pnpm shots <route>...` saves a full-page PNG of every route at every width (default 1280, 1000, 700 and 390 px) to
`$SHOTS_DIR` (default `shots` in `$TMPDIR`, else `/tmp`). It builds first when the build is old, starts the app once, signs in once,
and fails when a picture scrolls sideways or has a table wider than the screen. `pnpm shots --help` lists the options.
Write no spec to take pictures: the options show what a spec would.

Each picture carries a stamp (a PNG text chunk `omatalous-shot` naming the made-up household, `tools/privacy/png-stamp.mjs`),
and a run stops when a step leaves the address of the app it started. The `privacy` check lets into the repository only
pictures with the stamp, so a picture of a real household's app cannot land (CLAUDE.md, "The public repository").

`tools/visual-check.sh <base-ref> [--threshold share] -- <pnpm shots arguments>` is the visual regression check: it takes
the pictures on the base commit (in a throwaway worktree) and on the working tree, both with `SHOTS_STILL=1` (reduced
motion, so no animation is caught half way), and compares them with `pnpm shots:diff <before> <after>`. A picture fails
when more than 0.2 % of its pixels changed (a pixel changes when a channel moves by more than a tenth of its range, so
antialiasing passes), when its size changed or when it is missing. The diff pictures (changed pixels red) and both sets
stay in `visual/` in `$TMPDIR` (else `/tmp`). A branch that is not meant to change a page's look runs it on the pages it touches,
for example `tools/visual-check.sh origin/main -- reports --demo --widths 1280,390`.

`pnpm docs:shots` remakes the pictures of the README in `docs/images/`. They are one set: the example household, the
Finnish page, a window of 1440 x 900 from the top of the page, and one phone picture at 390 x 844. A page shorter than
the window ends under its last row, without the footer. The files are named
by page id (`overview.png`, `bills.png`, `transactions.png`, `reports.png`, `review.png`, `overview-phone.png`) and each
is under 300 kB. Run it before a release when a page changed, and read the pictures. A picture a document names that
the script does not make turns `pnpm test` red, and so does any other file in `docs/images/`.

- `--demo` loads the demo household; `--fake-bank` links the fake bank (a joint account, a card with a limit and a
  possible loan from the payments, see [the fake bank](#the-fake-bank)). With both, the household holds both.
- `--answers file.mjs` changes what the API answers: the default export maps a path (`/api/dashboard`) to a function from
  the answer to the answer to show. It shows a state no household has, and fails when no page asked for a path.
- `--steps file.mjs` runs `async (page, route) => {}` for every picture, after the page has loaded: open a row, pick a month.
- `--member` (with `--fake-bank`) makes a second member, Eero, who links the fake bank too, so the joint account has two
  users and the view switch shows. `--parts 60:40` says the use of the joint account as the first member would in
  Asetukset > Tilit; without it the bank's own answer stands (both members and the other holder, a third each). `--loan`
  has the second member save the mortgage the joint account's payments propose, which the first member's pages then mark
  as typed in by another member. The pictures are the first member's.
- `--scope own|household` sets the view switch, which shows when the household has a shared account. `--name label` adds
  the label to the file names, so that two states do not overwrite each other.
- `--only "<css selector or heading text>"` takes one part of the page at full size, with 16 px around it, besides the
  whole page (a tall page read whole is scaled down): `pnpm shots transactions --demo --only "Säännöt" --widths 1000`
  writes `transactions-1000.png` and `transactions-säännöt-1000.png` (with `--name x`: `transactions-x-1000.png` and
  `transactions-x-säännöt-1000.png`). The part is looked for on the page the steps end on, its box holds what stands outside
  the element (an opened menu), and the bars that stick to the screen are not drawn over it. The browser runs in a Finnish
  locale and time zone, as a household's does. It exits 1 when nothing matches. Whole-page pictures are taken from the top of
  the page, and the phone's tab bar gets room under the page. Two routes the app sends to one address (the old
  `categories?tab=rules` and `categories?tab=merchants`) give the same picture, and the tool says so.

```bash
pnpm shots overview "reports?q=tulot" --demo --widths 1280,390
pnpm shots settings --fake-bank --name bank
pnpm shots overview transactions --fake-bank --member --parts 60:40 --scope household --widths 1280,390 --name joint
pnpm shots overview --demo --answers tools/shots-examples/answers.mjs --steps tools/shots-examples/steps.mjs --name overspent
```

### Golden files

`packages/core/test/golden/` holds every statement the product makes about money (alerts, insights, Säästövinkit, the
income and change reports and their outcomes, and the purchases and income set apart as large) for the demo, the kit's base household and seeds 1 to 5, one file per
source. They are output and never edited by hand. `golden.test.ts` fails when the code says something else, and
`pnpm findings --golden` writes the files again.

- Commit the diff with the code that moved it, and explain each moved statement: a moved line must have a cause in the
  change, and a line nobody can explain stops the change.
- When two branches both move them, the first lands with its diff. Each later one is rebased, takes the golden
  files of the new head, runs `pnpm findings --golden`, and its diff must be the lines its own change explains. Never
  merge a golden file by hand.
- `kit/known.ts` lists the false statements that the tests know of. It may only shrink.

### The contrast test

`apps/web/test/contrast.test.ts` measures the colours of the one look with the WCAG 2 formulas. It takes the `#rrggbb`
values from `apps/web/src/design/tokens.ts`. `pnpm tokens` writes that file from `apps/web/design/tokens.json`.

- Text, second text and muted text read at 7 to 1 on the page and on both surfaces.
- Text reads at 7 to 1 on the four tinted backgrounds.
- The header band text (`--on-ink` and `--on-ink-2` on `--ink`) reads at 7 to 1.
- The series colours show at 3 to 1 on the page and on both surfaces. So do the colours for saved and earned money and for rise and fall.
- The parts of the interface show at 3 to 1: the edge of a control, the axis, the edge of a popup and the accent.
- The heat ladder gets darker by 1.3 to 1 per step from the surface, and the ink of each step reads at 7 to 1.
- The border is 1.5 to 1 off the surface and the grid is 1.3 to 1.
- Neighbouring series are 1.2 to 1 apart in luminance or 60 degrees apart in hue.
- The status colours stay apart for a reader with a colour vision deficiency (an OKLab distance of 0.08).
- The surface stands at least 1.08 to 1 off the page, the second surface is darker than the surface and the tints are no brighter than the well.
- `theme-color` and `color-scheme` in `apps/web/index.html` equal the band colour (`--ink`) and `light`.

A failure names the pair and its figure (`muted on surface-2: 4.31 < 4.5`). When a token fails, move the colour and
leave the test. Darken or lighten it in linear light by the smallest step that passes, plus a little margin, so its hue
stays. A new text or series token goes on its list in the test. There is one look and no second set to test.

### End-to-end tests

`pnpm build` first, then `pnpm e2e`. `e2e/run.mjs` starts `E2E_WORKERS` servers (default a third of the CPUs, from 3 to 8). Each is a copy of the
build in a temp directory, on a free port, with a data directory and a fake bank of its own (see below), and the
Playwright specs in `e2e/` run with one worker for each server. The data directories are deleted at the end.
`E2E_WORKERS=1` runs the specs one after the other. A failed test leaves its trace as `test-results/e2e/<test>/trace.zip` (`trace: "retain-on-failure"`).
Open it with `pnpm exec playwright show-trace`. `E2E_RETRY=1` runs a failed test once more. The runner lists by name the
tests that passed only on the rerun, so a flaky test is seen and not hidden.

A spec never waits for a fixed time. It waits for a condition with `expect(locator)`, `expect.poll`,
`page.waitForResponse` or `waitForLoadState`.

The one `waitForTimeout` left says why in a comment. It proves that something does not happen.

As root with `unshare` on the PATH the runner starts itself again in
a network of its own with only the loopback up, so a container or VPN changing the machine's interfaces cannot drop a
request of the browser; `E2E_NETNS=0` keeps the machine's network.

Every one of these servers starts with the administrator made and the demo household loaded, and the specs sign in as
that administrator. `app.spec.ts` runs the setup form and the demo through the page, on a server of its own. The specs
open every page on a desktop and a phone screen, and change a transaction's category and check that it is still there
after a reload. A console error, an uncaught error, a failed request or any 4xx or 5xx response fails the run, and so
does a page that scrolls sideways on the phone.

A spec file runs in one worker, in order. Two files may run at the same moment, each on its own server, so a spec must
not depend on what another file left behind. A new spec reads its server from the environment, as the others do:
`E2E_BASE_URL`, `E2E_DIR` (the data directory) and `E2E_FAKE_BANK`. Set the number of workers with `E2E_WORKERS`, not
with Playwright's `--workers`: a worker without a server of its own stops the run.

Playwright needs a Chromium. Where one is preinstalled, point `PLAYWRIGHT_BROWSERS_PATH` at it. Otherwise run
`pnpm exec playwright install chromium` once. `E2E_CHROMIUM=/path/to/chrome` uses a specific binary. Extra
arguments go to Playwright, for example `pnpm e2e --headed -g "kept after a reload"`. CI runs the suite in its
own job after the build.

#### The fake bank

`e2e/fake-bank/` stands in for Enable Banking's API in the browser specs: plain Node, no dependency, on 127.0.0.1 only.
It answers the calls of `apps/server/src/connectors/enable-banking/client.ts` about a made-up household and checks only
that a request carries a bearer token. `pnpm e2e` starts one for each server, and `linkFakeBank(page)` in `e2e/helpers.ts`
links it, so a spec that needs a connected bank asks for nothing more.

To click through a bank connection in a dev server by hand:

1. `node e2e/fake-bank/server.mjs` prints one line, `{"base":"http://127.0.0.1:PORT","consentHost":"consent.esimerkkipankki.example"}`.
   `FAKE_BANK_PORT` picks the port, otherwise it is a free one.
2. Start the app with `EB_API_URL=<base> EB_AUTH_HOSTS=<consentHost>`. `EB_API_URL` takes only a loopback address
   (`127.0.0.1`, `localhost` or `[::1]`), because the requests signed with the bank key go wherever it points: with any
   other address the app stops at start. `EB_API_URL` is a developer setting and no other doc names it.
3. Save any Application ID in UUID form and any RSA private key in PEM form as your own: on *Asetukset > Pankit ja tilit* open *Pankkisovellus* and choose *Oma sovellus* (see
   [A member's own app](ADVANCED.md#a-members-own-app)) and press *Tallenna ja testaa*. The fake bank accepts any pair.
4. Open *Asetukset > Pankkiyhteydet > Yhdistä pankki* and choose *Yhdistä Nordea*, the only bank it lists. The consent
   page is on a host that does not exist, so take the path of the address you are sent to (`/consent/<id>`) and open it
   on the fake bank's own address, `<base>/consent/<id>`. It sends the browser back to the redirect address the app gave,
   with a code, and the connection is made.

The household is made up and built from a fixed seed, so one day always gives the same rows: 14 months, up to today.
MEIKALAINEN MATTI has a checking account (pay of 3 150,00 from ESIMERKKI OY on the 25th) and a savings account. The joint
account of MEIKALAINEN MATTI;KORHONEN ELISA gets 600,00 from him on the 1st and 400,00 from her on the 2nd, pays a
LAINAN LYHENNYS of 650,00 to ESIMERKKIPANKKI OYJ and the groceries. The ESIMERKKIPANKKI Luottokortti has a limit of
3 000,00 and a debt, and its bill is paid from his checking account on the 5th. `e2e/fake-bank/household.mjs` holds the
rows; every row is booked, so there is no pending transaction to test.

## Manual test: an existing install through the update

Run in Docker, after a change to `docker-compose.yml` or the scripts. An install made
before `INSTANCE_NAME` existed must keep its names whatever its directory is called.

1. Clone a commit from before `INSTANCE_NAME` existed into a directory not named
   `banking-app`, for example
   `~/Talous_X.y`, and run `./scripts/install.sh`. Note `docker ps` (container `banking-app`), the image
   `banking-app:latest` and `docker volume ls` (`talous_xy_banking-data`). Create the admin account.
2. Check out the new commit's branch and run the old `scripts/update.sh` from step 1 (it pulls the new
   scripts and compose file while it runs). The app must come back as container `banking-app` from
   `banking-app:latest` on port 8080, with the same volumes and data.
3. Run the new `./scripts/update.sh` after another change, and then `./scripts/update.sh --rollback`.
   `banking-app:previous` must exist and be what runs afterwards.
4. Run `./scripts/install.sh` again. `.env` must not get an `INSTANCE_NAME` line, and the volumes stay the same.
5. Add a second instance with `./scripts/install.sh --new-instance second`. Both log in at once in one browser. A
   clone at a release tag that is on `origin/main` starts the copy on that release's signed image. A clone at a branch
   head with no release tag, or at a release that is not on `origin/main`, builds the copy from source and says so in
   one line. It never takes a newer tag.
