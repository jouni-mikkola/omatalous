# CLAUDE.md

Omatalous is a personal finance app for a Finnish household. Bank transactions come in via PSD2 (Enable Banking: Nordea
and the other Finnish banks it offers), are sorted into money flows and shown as a dashboard and reports. Multi-user (household members, per-user isolation,
optional read-only account sharing). Runs in Docker on Linux.

## Commands

```bash
pnpm install          # pnpm workspaces (npm 10 cannot resolve vitest 4's peers)
pnpm check            # what a change must pass: types, vitest (repo rules too), shell lint and suites; --changed while working
pnpm test             # vitest alone
pnpm where <name>     # definition, importers and tests of a symbol, file or text
pnpm build            # web (Vite) + server bundle (esbuild)
pnpm dev              # API :8080 + Vite :5173
pnpm seed:demo        # demo user + data in ./data
pnpm strings          # every text the browser can show, one line each (--file, --count, --also): start a change of Finnish text there
pnpm findings --golden  # writes the golden files again after a change of a detector or its wording; never merged by hand
```

## Layout

The entry points; `pnpm where` finds the rest and `docs/ARCHITECTURE.md` has the design.

- `packages/core`: pure domain logic, no I/O. Rules: `categorize.ts` (with `categorize-people.ts`,
  `categorize-bank-rows.ts`), the bank dialect in `wording.ts` (word lists, ADR 0008), `industry.ts` (trade register
  matching). One definition per figure (ADR 0004): `analysis/usual.ts`, `commitments.ts`, `analysis/fees.ts`, in prose in `docs/MONEY_FLOWS.md`.
  `loans.ts` (ADR 0012), `reports/index.ts` (the registry), `analysis/insights/` (one source per file).
- `apps/server`: Hono. `app.ts` (middleware), `routes/*` (thin), `services/*` (use cases), `db/*-repo.ts` and
  `db/finance/` (all SQL), `connectors/` (`registry.ts`, `sync.ts`, `enable-banking/`), `platform/`, `entry/node.ts`,
  `services/review.ts` (`GET /api/review`: every question the app cannot settle itself, in one queue; each answer keeps
  its source's own route).
- `apps/web`: React + Vite, custom SVG charts, Finnish UI. `api.ts`, `nav.ts` (a gated entry names its flag),
  `pages/reports/registry.ts`, `pages/Review.tsx` (Tarkistettavat: the one page that asks, one item at a time, its
  count in the header; no other page shows a question card), `pages/reports/holdings/`, `styles/` (`tokens.css` and `base.css` first, then one file per
  page area, imported by its page).
- `scripts/`: what runs on the host (`install.sh`, `update.sh`, `ops-helper.sh` the helper of Asetukset > Ylläpito)
  and `lib/`. `update.sh` exit 3 = the migration check failed and nothing changed. `tools/`: what only developers and CI
  use, kept out of the image.
- `relay/`: the static bank return page, privacy and terms pages and the one-line `install.sh` (its sha256 is in
  README.md and docs/INSTALL.md), published by `.github/workflows/pages.yml`.
- Each instance is a clone directory and a Compose project. `INSTANCE_NAME` names the container, image and session
  cookie, `COMPOSE_PROJECT_NAME` the volumes, `HOST_PORT`/`BIND_ADDRESS` the port (docs/ADVANCED.md).
- `contracts/<version>/`: what older installs rely on (schema, helper CLI output), frozen when that version ships,
  checked by `apps/server/test/contracts.test.ts`.
- `docs/` (English): INSTALL, ADVANCED, TROUBLESHOOTING, ENABLE_BANKING, MONEY_FLOWS, SECURITY, RELEASING, DEVELOPMENT,
  ARCHITECTURE. `SECURITY.md` at the root is the reporting route.

## Invariants (do not break)

- Existing installs keep their project, container and image names (`banking-app` unless `.env` says otherwise),
  port and volumes. Never interpolate `${COMPOSE_PROJECT_NAME}` in `docker-compose.yml` (Compose fills it from the
  directory name) and never write `INSTANCE_NAME` into the `.env` of an install that has none.
- Money is integer cents, negative = out. Dates are `YYYY-MM-DD` strings.
- Financial rows are reached only through `FinanceRepo` (always `WHERE user_id = ?`). Cross-user reads only via
  `HouseholdRepo` for explicitly shared accounts, read-only.
- After any change to transactions/accounts/rules call `reprocess(repo, settings)` (bumps the user's data version,
  `data_version:<user id>`, which keys the analysis cache). A change that touches only the account list, such as a
  balance, calls `settings.bumpUserDataVersion(userId)`, and sharing changes bump the owner and the viewer.
  `settings.bumpDataVersion()` is for changes that touch everyone. A sync that changed no row does neither. The user's
  marks (`user_marks`, `db/finance/marks.ts`, `PUT /api/marks`; the subject is `series:<key>`, whose key names the
  account, so a service that moves to another account is a new series, `alert:<id>`, `loan-proposal:<key>`, or
  `merchant:<name>` from before 0.8.7), expected bills (`expected_bills`, `/api/expected-bills`) and loans (`loans`,
  `db/finance/loans.ts`, `/api/loans`, whose values `routes/loans.ts` bounds because core trusts them) are read per
  request (`requestInputs`) and are not part of the cached context.
- `category_source = 'user'` is never overwritten by automation. Likewise `accounts.custom_name` (the user's name for an
  account) is written only by `PATCH /accounts/:id` and by an import of the user's own export into an account it creates; `accounts.name` is the bank's and every link rewrites it.
  `StoredAccount.name` is the display name (the user's, else the bank's); matching reads the bank's (`bankName`).
- Every money movement lands in exactly one flow (consumption, debt, saved, income, borrowed) or is a
  transfer. A card bill is a transfer when that card's account is connected. See `docs/MONEY_FLOWS.md`.
- The app secret is a file (`APP_SECRET_FILE`, created on first start by `entry/app-secret.ts`, Docker volume
  `banking-secrets`). Bank keys live in the DB AES-GCM sealed: users' with the user id as AAD, the shared app's with
  `instance:enablebanking`, and the Cloudflare API token of the Etäkäyttö page (settings key `instance_cloudflare`) with
  `instance:cloudflare`, and the address and token of the notices outside the browser (settings key `instance_notices`) with `instance:notices`. Never log or return secrets, private keys, those tokens, that address or `raw` bank payloads (only the certificate).
- Only merchant names of business rows (core `isBusinessRow`) are sent to the trade register, and only if core
  `isLookupName` accepts them (never a name shaped like a person's) and `mayBePerson` does not refuse them (a word of a
  name the household has, an invoice alone as the only evidence of a business); `askRegister` is the one door and checks
  the household's names again; never amounts, dates, account numbers or names of people.
- The bank logo fetch (`connectors/enable-banking/logos.ts`) calls only an https address on `enablebanking.com` taken from
  the cached bank list, follows no redirect, reads at most 300 kB and serves the picture with its own CSP; the request
  names a registry bank id and nothing else.
- Admin-editable settings (address, time zone, sync hours, register lookup, shared bank app) live in the DB via
  `services/instance.ts` and `connectors/enable-banking/app-setup.ts`; env only seeds defaults. Browser input is validated against
  allowlists (`strictObject` + `parse*` in `platform/validate.ts`), never reaches the filesystem or a command, with one exception: the
  Etäkäyttö address reaches `.env` through `ops/access-request.json` and the helper, form-checked on both sides; uploaded keys are re-encoded
  (`security/private-key.ts`). Banks can only be started by id from `connectors/enable-banking/banks.ts`.
- Security-relevant events (logins, lockouts, key changes, `ops_*` requests) are written with `recordEvent` in
  `services/security.ts` to `security_events` (90 days, with IP and user agent); never log them elsewhere. Password
  hashes run behind the concurrency gate and the per-key limiters in `security/rate-limit.ts`, and a login attempt is
  counted before the hash runs.
- The app secret changes only through secret rotation (`entry/secret-rotate.ts`, `services/secret-rotation.ts`), which
  re-seals every stored key and keeps the old file as `.prev-<stamp>`. Replacing the file by hand loses the bank keys.
- A web maintenance request names only an allowlisted action (`services/ops.ts`, `services/ops-validate.ts`) and takes
  no free parameters. `access` is queued only by `services/remote-access.ts`, after the admin's password and with its values
  in `ops/access-request.json` (`services/access-request.ts`), never by `POST /api/ops/request`; the one change with no
  password is the server's own return to the home network (`revertUnconfirmed`). The host helper (`scripts/ops-helper.sh`) never runs text from the DB, picks the commit itself
  and hands update.sh only that commit (`TALOUS_TARGET`).
- Database copies: the three newest intact copies are never deleted and nothing is pruned while the live database fails
  its check (`db/backup-keep.ts`; `scripts/lib/dbcopy.sh` follows the rule of the three newest inline, so a change is a
  change in both, and deletes only the kinds its caller names, so no host script deletes a `pre-reset-` copy, which the
  app keeps 14 days). A copy needs twice the database and its WAL free. The startup gate moves a damaged database to
  `<data>/damaged` and deletes nothing of the household's; the app never empties that folder.
- One lock for the install: `installer_lock` in `scripts/lib/release.sh`, the clone folder itself, so an update that
  replaces `scripts/install.sh` does not end it. `install.sh`, `update.sh`, `restore.sh`, `reset.sh` and the helper's
  address change, cleaning and watchdog take it; a new script that changes the install takes it too. The scripts run as
  the user who owns the folder (another user's run is not seen by the look at old holders).
- State-changing API calls need `X-Requested-With: fetch` (CSRF); the web client sends it in `api.ts`.
- A service token (`Authorization: Bearer omt_…`, `services/service-tokens.ts`) is made only by the CLI, stored as its
  SHA-256, reads as its user with a member's role and reaches only the GET routes `READABLE` names and the GETs of an
  extension that sets `tokenReads`. A new route is shut to tokens until it is added there, and only a route that writes
  nothing may be.
- `UserError` = safe 400 message, `UpstreamError` = 502 for a failing outside service; other errors become a generic 500.
- Core stays pure (no `Date.now()`, env or I/O) so it runs on Node and in the browser (the web app imports it).

- Schema changes = new `apps/server/migrations/NNNN_name.sql`; never edit an applied one (checksummed, startup
  refuses). Prefer additive changes; table rebuilds start with `-- migrate: foreign_keys=off`. Old code refuses a DB
  migrated by a newer version (`db/migrate.ts`) unless each unknown migration stored a compat floor at or below its
  version (`-- migrate: compat X.Y.Z`, allowed only on additive files); `migrate-check <db>` tries pending migrations on a copy; `openDatabase` snapshots before migrating; `scripts/update.sh`
  has `--rollback`, which keeps the live DB only when the previous image's `migrate-check` reports nothing to apply. Derived fields are recomputed after every version change (`services/upgrade.ts`), so rule
  changes need no migration.
- A card's payment channel is derived from the rows on every run and stored nowhere, so a change of rule is felt by the
  next run with no migration (ADR 0015).
- The accounts, cards and loans of the first page show the fields of `holdings` in the dashboard answer. The web adds up
  and compares no money of its own there. The share a card's arc fills (`CreditArc`) is the one figure it draws.

## The public repository

This repository is public, and so is everything that reaches it: commits and their author address, branch names, pull
request titles and bodies, documents, pictures and the logs of the checks. The required check `privacy`
(`tools/privacy/scan.mjs`, `.github/workflows/privacy.yml`) reads what a pull request adds and its title, body and
branch name, and refuses:

- Real personal data: account numbers, personal ids, e-mail addresses, phone and card numbers. Tests use the examples
  in `tools/privacy/lists.json` or make a value up at run time.
- The maintainer's machines: host names, account names, home paths and addresses. Write `~`, `$HOME`, `localhost` or
  `<host>`.
- Secrets: keys, tokens, add-on codes, `.env` files and databases.
- The add-on module: files under any `private/` folder or `extension/`, and the words of what it does. It is "the
  add-on module" (*lisäosa*) here. Its words are SHA-256 hashes in `lists.json`; a file that used one as bank payee
  text before keeps that use (`baseline`).
- A commit whose author or committer address is not GitHub's no-reply address. Set
  `git config user.email <id>+<login>@users.noreply.github.com` in the clone before the first commit.
- A picture that `pnpm shots` did not take. Shots starts its own app on an empty data folder, shows only made-up
  households and stamps each picture. A screenshot of a browser session is never committed.

A pull request's title and body say what changed in neutral words. They never hold a pasted log, a path or host of a
machine, or a real row; quote an error by its message alone. A branch is named `work/<task>`.

`pnpm check` runs the same scan on the branch before the push (`node tools/privacy/scan.mjs --local`), as a run on
GitHub comes when the commits are public already. A finding names the file and line and never the value, since the log
is public. Fix the line. A hit that is wrong gets a near miss in `tools/privacy/privacy.test.ts` and a fix of the
detector, never an entry in `lists.json` to let it pass. A new word to refuse is added as its hash (`sha256` of the word in lower case) by the maintainer.

## Conventions

- Writing (docs, UI text, comments, commits, script output): short and plain. No em dashes, no "not X but Y",
  no padded lists of three, no bold lead-ins, no filler words or trailing filler phrases. Docs, script output, logs and
  CLI output in English. Everything the browser shows in Finnish, including the maintenance helper's report summaries
  and the `doctor.sh --json` items. UI paths are written `Asetukset > Palvelin`.

- The Finnish of the UI (glossary, tone, dates, sums, plurals): `docs/UI_STYLE.md`; rule 35 refuses the words it removed.
- Code, identifiers and comments in English. Comments explain why.
- New report: `packages/core/src/reports/<name>.ts` + register in `reports/index.ts` + a section file in
  `apps/web/src/pages/reports/sections/` that names the reports it reads, listed by the question page that shows it
  (`pages/reports/pages/<Page>.tsx`) + invariant test in `packages/core/test/reports.test.ts`. A question page has its
  styles in `styles/report-<page>.css`. Each report and section starts with a `Decision:` comment naming what the household
  decides with it (repo rule 11). A view with no decision is not built.
- New module behind a flag: a server extension whose routes are mounted behind its flag.
  Core has no flag. A finished module loses its flag, and no setting switches a page off.
- New rule/category: `categories.ts` / `categorize.ts` + scenario in `packages/core/test/flows.test.ts`. A payee or
  payment word list goes in `packages/core/src/wordlists.json` (repo rule 21), read through `wordlists.ts` and shared with `categorize.ts` through one constant of `wording.ts`.
- New connector: a folder in `apps/server/src/connectors/` listed in its `registry.ts` (recipe in
  `docs/DEVELOPMENT.md`). A `Connector` (`connectors/types.ts`) is an `id`, an optional `sync` and an optional
  `revokeAll`, and the id is stored and never renamed. The app reads no files on the server and has no import format. The one exception is a statement, a card's or a bank's CSV export or camt.053 file, read in the browser, of which only the rows go to the install (`connectors/card-file/`, `connectors/bank-file/`, ADR 0025).
- Tables: every list of rows is `components/table/Table.tsx` (columns, groups, a total, a drill; `KeyValue` for the facts of
  one subject). A page writes cells and never a `<table>`, a column sorts only in a complete list read by size, and under
  600 px of room a row becomes a block, never a sideways scroll. A view nobody needs is deleted with its code, styles, tests
  and texts, never hidden behind a switch or a fold. `e2e/table-views.spec.ts` checks every view at 390 and 1440 px.
- Table toolbar: `Toolbar.tsx` is the one toolbar of a table. A column opts in with `search`, `chips`, `group` or `csv`.
  `model.ts` runs the sorting on TanStack Table v9. A page never writes a toolbar.
- Table view: `view` and `onView` of `Table` keep the reader's view in the address (`view.ts`). Without them the view
  is local state. CSV text is `csv` of `@banking/core`, which the server uses too.
- Charts follow the dataviz conventions already in `apps/web/src/charts`: one axis, a legend and a table view, and the
  category colour order from the server. There is one look, a light bank-like one, in `:root` of the generated `styles/tokens.css`.
  Its source is `apps/web/design/tokens.json` (`pnpm tokens`). Stylesheets read tokens. Charts read them from
  `src/design/tokens.ts`. The drawn card face of `holdings.css` is the one place with colours of its own.
- `apps/web/test/contrast.test.ts` measures the colours of `src/design/tokens.ts` against the page
  and the surfaces and holds the theme colour in `index.html` equal to the header band (`--ink`). A token that fails is moved, never the test.
- Repo rules (`tools/repo-rules`, listed in the header of `repo-rules.test.ts`) read tracked files and untracked files
  git does not ignore, so a new file meets them before `git add`. A failing rule names itself and the fix.
