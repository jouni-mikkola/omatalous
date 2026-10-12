# CLAUDE.md

Omatalous is a personal finance app for a Finnish household. Bank transactions come in via PSD2 (Enable Banking: Nordea
and the other Finnish banks it offers) or Nordea CSV, are sorted into money flows and shown as a dashboard and reports. Multi-user (household members, per-user isolation,
optional read-only account sharing). Runs in Docker on Linux.

## Commands

```bash
pnpm install          # pnpm workspaces (npm 10 cannot resolve vitest 4's peers)
pnpm check            # what a change must pass before handing back: types, tests, shell lint, shell suites
pnpm test             # vitest, all packages and tools/repo-rules (invariants as tests), must stay green
pnpm typecheck        # tsc for core, server, web, plus e2e, tools and root config
pnpm build            # web (Vite) + server bundle (esbuild, apps/server/dist/node.js)
pnpm dev              # API :8080 + Vite :5173
pnpm seed:demo        # demo user + data in ./data
```

## Layout

- `packages/core`: pure domain logic, no I/O. Categories (`kind` + `group`), merchant normalisation,
  rules (`categorize.ts`), the bank dialect (`wording.ts` and, for what a loan page prints, `wording-loan-pages.ts`: word lists behind named predicates, ADR 0008), trade register
  matching and TOL and MCC codes (`industry.ts`), import parsers (`sources/*`), transfers, returns (`returns.ts`: refunds and money paid back), enrichment pipeline,
  recurring detection, money flows, analysis context, dashboard, insights, `reports/*` with a registry in
  `reports/index.ts`. One definition per figure (ADR 0004): `analysis/usual.ts` (complete months, the usual level, usual
  spending and usual income, the gate `gateFor`) and `commitments.ts` (fixed costs, subscriptions, expected bill dates,
  expected charges, cancelled subscriptions); `analysis/fees.ts` (late fees, bank fees); a series' cost is its own
  `perMonth`, `monthlyCents`, `yearlyCents`; `docs/MONEY_FLOWS.md` says them in prose.
  `forecast.ts` (month forecast and its range), `ahead.ts` (next 30 days),
  `subscription-alerts.ts` (alerts that read the user's marks), `bridge.ts` (where the income went, from complete months),
  `change.ts` (what moved spending, split into causes that add up, the rises the spike alert tells included; wording in
  `change-text.ts`), `loans.ts` (the `Loan` type and every loan figure, a connected card or loan account read as a loan included, ADR 0012), `loan-intake/` (a draft from pasted
  text or OCR, each field `sure` or `check`), `loan-detect.ts` (payments that look like an unsaved loan),
  `analysis/credit.ts` (what a connected card costs), `income.ts` (income by
  type, derived on read) with `income-changes.ts`, `income-events.ts`, `income-series.ts`. `analysis/insights/` has one
  source per file with its own gate and history rule (`shared.ts` holds the shared gates); `index.ts` only ranks them by
  `yearlyCents`, and a dismissed insight returns when its figure moves 25 %. `optimise/` is the Optimoi page: `index.ts`
  applies the rules every finding follows (complete months, the 120 € gate, certainty, three per area, a headline
  without overlaps), `areas/` has one file per area, `facts/` dated outside figures that expire, `inputs.ts` what the
  user types in, `outcome.ts` and `snapshot.ts` the follow-up, `others.ts` the insights it shows as Muut havainnot (minus
  any a finding already tells).
- `apps/server`: Hono. `app.ts` (middleware), `routes/*` (thin; `admin.ts` = setup wizard API), `services/*` (use cases;
  `industry.ts` = trade register lookup, `schedule.ts` = hourly tick, `security.ts` = security events and notices,
  `secret-rotation.ts` = re-sealing bank keys and the Cloudflare token, `ops.ts` = web maintenance requests,
  `remote-access*.ts` = the Etäkäyttö page's use cases with `access-request.ts` the file the helper reads), `db/*-repo.ts` and
  `db/finance/` (all SQL, loans included), `routes/loans.ts` (bounds every loan value), `auth/*`, `security/*` (`cf-access.ts` checks the
  Access token), `platform/*` (config, errors, ids, input validators, `outbound.ts` what outgoing calls share), `connectors/*` (where
  rows come from: registry, `sync.ts` loop, `enable-banking/` with `logos.ts`, `csv-import/`), `providers/prh/` (trade register
  search), `providers/cloudflare/` (Tunnel, DNS and Access client),
  `entry/node.ts`, `entry/secret-rotate.ts`, `cli.ts`, `cli-ops.ts` (the helper's poll, report and state commands),
  `cli-cloudflare.ts` (`cloudflare up/down`, run by the installer).
- `scripts/`: `install.sh`, `update.sh`, `backup.sh`, `restore.sh`, `doctor.sh`, `reset.sh`, `cloudflare-setup.sh` (writes
  `~/.config/omatalous/cloudflare.env`), `ops-helper.sh` (host helper for Asetukset > Ylläpito), `lib/` (`release.sh` signatures, `dbcopy.sh` copies, `preflight.sh` the migration check of
  the new image before the switch, `ops-access.sh` the helper's `access` action, `install-host.sh` the Docker, re-exec and Cloudflare-file steps of install.sh; update.sh exit 3 = that check failed and nothing changed). `tools/` holds what only developers and CI use (`relay-hash.mjs`,
  `test/*.test.sh` shell suites, `ci/*`) and stays out of the image. `relay/` is the static bank return page with the privacy and terms pages Enable Banking asks for, and `install.sh`, the script of the one-line install (its sha256 is in README.md and docs/INSTALL.md, see relay/README.md), published to GitHub Pages by
  `.github/workflows/pages.yml`. `.github/workflows/release.yml` builds and signs the image when `main` gets a new version, on a `v*` tag or by hand.
- `apps/web`: React + Vite, custom SVG charts, Finnish UI. First-run wizard `pages/Wizard.tsx`; `components/BankPicker.tsx`; bank logos on a white plate: Nordea's in `public/banks/`, the others served by
  the server (`bankLogo` in `src/banks.ts`); `consent-notices.ts` (when a consent ends, unlinked accounts, the calendar file); loans: `components/loans/`, `pages/settings/Loans.tsx`, `pages/settings/LoanIntake.tsx`. `styles/` (tokens.css and base.css
  first, then one file per page area, imported by its page), `nav.ts` (nav entries, a gated one names its flag),
  `pages/reports/` (one section file each, found by `registry.ts`).
- Each instance is a clone directory and a Compose project. `INSTANCE_NAME` names the container, image and
  session cookie, `COMPOSE_PROJECT_NAME` the volumes, `HOST_PORT`/`BIND_ADDRESS` the port. See `docs/ADVANCED.md` (second copies).
- `contracts/<version>/`: what older installs rely on (schema, helper CLI output), frozen when that version ships and
  checked by `apps/server/test/contracts.test.ts`.
- `docs/` (English): INSTALL, ADVANCED, TROUBLESHOOTING, ENABLE_BANKING, MONEY_FLOWS, SECURITY, RELEASING, DEVELOPMENT, ARCHITECTURE.
  `SECURITY.md` at the root is the reporting route.

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
  `settings.bumpDataVersion()` is for changes that touch everyone. A sync or import that changed no row does neither.
  The user's marks (`user_marks`, `db/finance/marks.ts`, `PUT /api/marks`; the subject is `series:<key>`, whose key names the
  account, so a service that moves to another account is a new series, `alert:<id>`, `loan-proposal:<key>`, or `merchant:<name>` from before 0.8.7), expected bills
  (`expected_bills`, `/api/expected-bills`) and loans (`loans`, `db/finance/loans.ts`, `/api/loans`, whose values
  `routes/loans.ts` bounds because core trusts them) are read per request (`requestInputs`) and are not part of the cached context. So are the
  Optimoi inputs, decisions and snapshots (`optimise_*`, `db/finance/optimise.ts`, `/api/optimise`); saving them never
  reprocesses.
- `category_source = 'user'` is never overwritten by automation. Likewise `accounts.custom_name` (the user's name for an
  account) is written only by `PATCH /accounts/:id`; `accounts.name` is the bank's and every link rewrites it.
  `StoredAccount.name` is the display name (the user's, else the bank's); matching reads the bank's (`bankName`).
- Every money movement lands in exactly one flow (consumption, debt, saved, income, borrowed) or is a
  transfer. A card bill is a transfer when that card's account is connected. See `docs/MONEY_FLOWS.md`.
- The app secret is a file (`APP_SECRET_FILE`, created on first start by `entry/app-secret.ts`, Docker volume
  `banking-secrets`). Bank keys live in the DB AES-GCM sealed: users' with the user id as AAD, the shared app's with
  `instance:enablebanking`, and the Cloudflare API token of the Etäkäyttö page (settings key `instance_cloudflare`) with
  `instance:cloudflare`. Never log or return secrets, private keys, that token or `raw` bank payloads (only the certificate).
- Only merchant names of business rows (core `isBusinessRow`) are sent to the trade register, and only if core
  `isLookupName` accepts them (never a name shaped like a person's); never amounts, dates, account numbers or names of
  people.
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
- State-changing API calls need `X-Requested-With: fetch` (CSRF); the web client sends it in `api.ts`.
- `UserError` = safe 400 message, `UpstreamError` = 502 for a failing outside service; other errors become a generic 500.
- Core stays pure (no `Date.now()`, env or I/O) so it runs on Node and in the browser (the web app imports it).

- Schema changes = new `apps/server/migrations/NNNN_name.sql`; never edit an applied one (checksummed, startup
  refuses). Prefer additive changes; table rebuilds start with `-- migrate: foreign_keys=off`. Old code refuses a DB
  migrated by a newer version (`db/migrate.ts`) unless each unknown migration stored a compat floor at or below its
  version (`-- migrate: compat X.Y.Z`, allowed only on additive files); `migrate-check <db>` tries pending migrations on a copy; `openDatabase` snapshots before migrating; `scripts/update.sh`
  has `--rollback`, which keeps the live DB only when the previous image's `migrate-check` reports nothing to apply. Derived fields are recomputed after every version change (`services/upgrade.ts`), so rule
  changes need no migration.

## Conventions

- Writing (docs, UI text, comments, commits, script output): short and plain. No em dashes, no "not X but Y",
  no padded lists of three, no bold lead-ins, no filler words or trailing filler phrases. Docs, script output, logs and
  CLI output in English. Everything the browser shows in Finnish, including the maintenance helper's report summaries
  and the `doctor.sh --json` items. UI paths are written `Asetukset > Palvelin`.

- UI text Finnish; code, identifiers and comments English. Comments explain why.
- New report: `packages/core/src/reports/<name>.ts` + register in `reports/index.ts` + a section file in
  `apps/web/src/pages/reports/sections/` that names the reports it reads + invariant test in
  `packages/core/test/reports.test.ts`. Each report and section starts with a `Decision:` comment naming what the
  household decides with it (repo rule 11); a view with no decision is not built.
- New module behind a flag: an entry in `FEATURES` (`packages/core/src/features.ts`), its routes mounted through
  `gated(s, id, routes)` (`auth/middleware.ts`), and its `nav.ts` entry names the flag. Admins switch flags in
  Asetukset > Palvelin.
- New rule/category: `categories.ts` / `categorize.ts` + scenario in `packages/core/test/flows.test.ts`. A payee or
  payment word list goes in `wording.ts` (repo rule 21), shared with `categorize.ts` through one constant.
- New Optimoi finding: in its area file, with a hit and near misses in `packages/core/test/optimise/parts/`, quiet on the
  random households (`quiet.test.ts`). An outside figure is a row in `optimise/facts/` only after its primary source
  was opened (`verifiedAt`); it expires and then hides its comparison. Findings never rank providers or advise a
  product, and every number in a title is a calc line.
- New connector or import format: a folder in `apps/server/src/connectors/` or `packages/core/src/sources/`, listed in
  its `registry.ts` (recipes in `docs/DEVELOPMENT.md`). A connector id is stored and never renamed.
- Server tests use `apps/server/test/helpers.ts` (`setupApp()` gives a signed-in admin, `member()` more users).
- Charts follow the dataviz conventions already in `apps/web/src/charts` (one axis, legend + table view,
  fixed category colour order from the server, tokens in `styles/tokens.css`, one theme only).
