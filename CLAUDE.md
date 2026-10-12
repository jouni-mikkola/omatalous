# CLAUDE.md

Omatalous is a personal finance app for a Finnish household. Bank transactions come in via PSD2 (Enable Banking: Nordea
and the other Finnish banks it offers), are sorted into money flows and shown as a dashboard and reports. Multi-user (household members, per-user isolation,
optional read-only account sharing). Runs in Docker on Linux.

## Commands

```bash
pnpm install          # pnpm workspaces (npm 10 cannot resolve vitest 4's peers)
pnpm check            # what a change must pass before handing back: types, tests, shell lint, shell suites
pnpm lint:sh          # shell lint alone
pnpm test             # vitest, all packages and tools/repo-rules (invariants as tests), must stay green
pnpm typecheck        # tsc for core, server, web, plus e2e, tools and root config
pnpm build            # web (Vite) + server bundle (esbuild, apps/server/dist/node.js)
pnpm dev              # API :8080 + Vite :5173
pnpm seed:demo        # demo user + data in ./data
pnpm strings          # every text the browser can show, one line each (--file, --count, --also): start a change of Finnish text there
pnpm findings --golden  # writes the golden files again after a change of a detector or its wording; never merged by hand
```

## Layout

- `packages/core`: pure domain logic, no I/O. Categories (`kind` + `group`), merchant normalisation, rules
  (`categorize.ts`; `categorize-people.ts` holds the rules about people, read before the shops: who the user is, the other holders of the accounts, MobilePay, the bank's own words for a payment between people; `categorize-bank-rows.ts` the lenders the word lists miss, told by the shape of the name, by their own payout and by the register, and the bank's own rows of cash and interest), the bank dialect (`wording.ts`, for what a loan page prints `wording-loan-pages.ts`, for lenders by their names `wording-lenders.ts`: word
  lists behind named predicates, ADR 0008), trade register matching and TOL and MCC codes (`industry.ts`), transfers,
  returns (`returns.ts`: refunds and money paid back), enrichment pipeline, recurring detection, money flows, analysis
  context, dashboard, insights, `reports/*` with a registry in `reports/index.ts`. One definition per figure (ADR 0004):
  `analysis/usual.ts` (complete months, the usual level, usual spending and usual income, the gate `gateFor`) and
  `commitments.ts` (fixed costs, subscriptions, expected bill dates, expected charges, cancelled subscriptions);
  `analysis/fees.ts` (late fees, bank fees); a series' cost is its own `perMonth`, `monthlyCents`, `yearlyCents`;
  `docs/MONEY_FLOWS.md` says them in prose. `forecast.ts` (`monthPace`: the month's spending so far against the month before; the usual everyday spending and the typed-in bills still to pay, which `ahead.ts` reads), `ahead.ts` (what is coming until the next payday, 30 days with no regular pay; its `upcoming` is the next 30 days that Laskut > Tulossa lists),
  `subscription-alerts.ts` (alerts that read the user's marks), `bridge.ts` (where the income went, from complete
  months), `change.ts` (what moved spending, split into causes that add up, the rises the spike alert tells included;
  wording in `change-text.ts`), `loans.ts` (the `Loan` type and every loan figure, a connected card or loan account read
  as a loan included, ADR 0012), `household-debts.ts` (the list of the household's debts behind every debt total; a
  saved loan linked to its account counts once), `card-channel.ts` (a card's payment channel, the payee account and reference of the payments that paired with the card's own rows; `settleTransfers` is its entry, ADR 0015), `holdings.ts` (`buildHoldings`: the accounts, cards and loans of Yhteenveto and Saldot, from `analysis/balance-walk.ts` and `household-debts.ts`), `loan-intake/` (a draft from pasted text or OCR, each field `sure` or
  `check`), `loan-detect.ts` (payments that look like an unsaved loan), `analysis/credit.ts` (what a connected card
  costs), `income.ts` (income by type, derived on read) with `income-changes.ts`, `income-events.ts`,
  `income-series.ts`. `analysis/insights/` has one source per file with its own gate and history rule (`shared.ts` holds
  the shared gates); `index.ts` only ranks them by `yearlyCents`, and a dismissed insight returns when its figure moves
  25 %. `optimise/` is the Optimoi page: `index.ts` applies the rules every finding follows (complete months, the 120 €
  gate, certainty, three per area, a headline without overlaps), `areas/` has one file per area, `facts/` dated outside
  figures that expire, `inputs.ts` what the user types in, `outcome.ts` and `snapshot.ts` the follow-up, `others.ts` the
  insights it shows as Muut havainnot (minus any a finding already tells).
- `apps/server`: Hono. `app.ts` (middleware), `routes/*` (thin; `admin.ts` = setup wizard API), `services/*` (use cases;
  `industry.ts` = trade register lookup, `schedule.ts` = hourly tick, `security.ts` = security events and notices,
  `secret-rotation.ts` = re-sealing bank keys and the Cloudflare token, `ops.ts` = web maintenance requests,
  `ops-danger.ts` = the shared mark of a reset and a restore (neither starts while the other is under way) and the one
  way a refused request is recorded, `db-restore.ts` = Palauta viimeisin, `reset.ts` = Tyhjennä kaikki tiedot, `disk.ts`
  = the reserve file, `db-health.ts` = the four notices about the safety net and the weekly check of a copy,
  `ops-watchdog.ts` = the helper's report of an update it took back, `remote-access*.ts` = the Etäkäyttö page's use
  cases with `access-request.ts` the file the helper reads), `db/*-repo.ts` and `db/finance/` (all SQL, loans included),
  `db/startup-gate.ts` (the check before the database opens; a damaged file goes to `<data>/damaged`),
  `db/backup-keep.ts` (the three copies pruning never deletes, the room a copy needs), `db/backup-check.ts` (the full
  check of a copy), `routes/loans.ts` (bounds every loan value), `auth/*`, `security/*` (`cf-access.ts` checks the
  Access token), `platform/*` (config, errors, ids, input validators, `outbound.ts` what outgoing calls share),
  `connectors/*` (where rows come from: registry, `sync.ts` loop, `enable-banking/` with `logos.ts`, `fold-accounts.ts`
  (an old CSV account folds into the bank's account at linking), `csv-import/` (only the provider entry `csv`)),
  `providers/prh/` (trade register search), `providers/cloudflare/` (Tunnel, DNS and Access client), `entry/node.ts`,
  `entry/shutdown.ts`, `entry/secret-rotate.ts`, `cli.ts`, `cli-ops.ts` (the helper's poll, report and state commands),
  `cli-cloudflare.ts` (`cloudflare up/down`, run by the installer).
- `scripts/`: `install.sh`, `update.sh`, `backup.sh`, `restore.sh`, `doctor.sh`, `reset.sh`, `cloudflare-setup.sh` (writes
  `~/.config/omatalous/cloudflare.env`), `ops-helper.sh` (host helper for Asetukset > Ylläpito), `ops-launcher.sh` (what the helper's timer or cron line runs; installed outside the clone as `~/.local/share/omatalous/<instance>/launcher.sh`, with a `last-good/` copy of a helper that passed `--self-test`; a change to it needs a higher `LAUNCHER_VERSION`, 2 now, the self-test does not cover it, and it keeps its two calls: the helper with no argument and with `--root CLONE`), `lib/` (`release.sh` signatures, which release an install follows (`release_from_api`, `choose_release`) and `installer_lock` (the lock of every script that changes the install is the clone folder itself, fd 9, plus a look at /proc for an old update.sh whose `install.sh` was replaced; the helper loads the file too), `dbcopy.sh` copies, `preflight.sh` the migration check of
  the new image before the switch, `ops-access.sh` the helper's `access` action, `install-host.sh` the Docker, re-exec and Cloudflare-file steps of install.sh and `confirm_release` (a new install in a clone made by hand that sits at a release not out yet moves to the latest one), `ops-release.sh` the update check, `ops-selftest.sh` the self-test, `ops-watchdog.sh` the rollback of an update that stops answering, `ops-address.sh` with `host-addr.sh` the follow-up of the home network address, `ops-housekeeping.sh` the cleaning of old images, `ops-schedule.sh` the timer or cron line; update.sh exit 3 = that check failed and nothing changed). `tools/` holds what only developers and CI use (`relay-hash.mjs`,
  `test/*.test.sh` shell suites (`test/ops-world.sh` is the helper's test world), `ci/*` (`smoke-image.sh` the image smoke test, `promote-release.sh` what `promote.yml` runs, `drills.sh` ten drills in real Docker with its functions in `drills-lib.sh`, `lib.sh` the helpers `upgrade-run.sh` and `drills-lib.sh` both source, each defined there and nowhere else)) and stays out of the image. `relay/` is the static bank return page with the privacy and terms pages Enable Banking asks for, and `install.sh`, the script of the one-line install (its sha256 is in README.md and docs/INSTALL.md, see relay/README.md), published to GitHub Pages by
  `.github/workflows/pages.yml`. `.github/workflows/release.yml` runs six jobs (plan, verify, build for amd64 and arm64 on runners of their own, smoke, publish, release; a `dry-run` job for a dry run) when `main` gets a new version, on a `v*` tag or by hand, and creates the release as a pre-release; `.github/workflows/promote.yml` promotes it after 48 hours (a draft holds it and every older pre-release).
- `apps/web`: React + Vite, custom SVG charts, Finnish UI. First-run wizard `pages/Wizard.tsx`;
  `components/BankPicker.tsx`; `components/holdings/` (`Holdings`, `CardFace`, `FigureRow`, `card-tier.ts`, `holding-rows.ts`: the Tilit, Luottokortit and Lainat of the Varallisuus card on Yhteenveto, styled in `styles/holdings.css`) and `components/next-days.ts` (the heading, figures and warning of the payday card); bank logos on a white plate: Nordea's in `public/banks/`, the others served by the server
  (`bankLogo` in `src/banks.ts`); `consent-notices.ts` (when a consent ends, unlinked accounts, the calendar file);
  loans: `components/loans/`, `pages/settings/Loans.tsx`, `pages/settings/LoanIntake.tsx`, `LoanLinks` (in
  `components/loans/LoanEditor.tsx`: the accounts and loans the loan form reads). `styles/` (tokens.css and base.css
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
  `settings.bumpDataVersion()` is for changes that touch everyone. A sync that changed no row does neither. The user's
  marks (`user_marks`, `db/finance/marks.ts`, `PUT /api/marks`; the subject is `series:<key>`, whose key names the
  account, so a service that moves to another account is a new series, `alert:<id>`, `loan-proposal:<key>`, or
  `merchant:<name>` from before 0.8.7), expected bills (`expected_bills`, `/api/expected-bills`) and loans (`loans`,
  `db/finance/loans.ts`, `/api/loans`, whose values `routes/loans.ts` bounds because core trusts them) are read per
  request (`requestInputs`) and are not part of the cached context. So are the Optimoi inputs, decisions and snapshots
  (`optimise_*`, `db/finance/optimise.ts`, `/api/optimise`); saving them never reprocesses.
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
  and compares no money of its own there. The width of a card's bar (`barPercent`) is the one figure it draws.

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
- New connector: a folder in `apps/server/src/connectors/` listed in its `registry.ts` (recipe in
  `docs/DEVELOPMENT.md`). A `Connector` (`connectors/types.ts`) is an `id`, an optional `sync` and an optional
  `revokeAll`, and the id is stored and never renamed. The app reads no files: there is no import format.
- Server tests use `apps/server/test/helpers.ts` (`setupApp()` gives a signed-in admin, `member()` more users); rows of
  the old CSV kind come from `apps/server/test/csv-seed.ts` (through `ingestTransactions`, into an account without
  pending rows).
- Charts follow the dataviz conventions already in `apps/web/src/charts` (one axis, legend + table view,
  fixed category colour order from the server, tokens in `styles/tokens.css`, one theme only).
- `apps/web/test/contrast.test.ts` measures the `#rrggbb` tokens of `styles/tokens.css` against the page and the
  surfaces and holds the theme colour in `index.html` equal to the page colour. A token that fails is moved, never the
  test.
- Repo rules (`tools/repo-rules`, listed in the header of `repo-rules.test.ts`; they read tracked files and untracked
  files git does not ignore, so a new file meets them before `git add`): rule 6 also refuses an import from a `test` or
  `fixtures` folder in `src`; rule 12 reads the sentences the server sends too (SQL skipped); rule 23 refuses a
  `-latest` runner label; rule 24 an export of core or the server with no reader in another source file (a test is no
  reader) unless it stands in `tools/repo-rules/unread-exports.txt`, a list that only shrinks (a line goes with its
  export); rule 25 a pipe into `grep -q` in a shell file or a workflow (write `grep … >/dev/null`); rule 26 a function
  defined under `scripts/` that nothing else under `scripts/` names; rule 27 needs `git check-ignore` to hold for
  `.env.new`, `ops/env.prev` and `.env.bak.1`; rule 28 refuses, in the texts `pnpm strings` lists, the habits a copy pass
  took out of the Finnish (a calque or a rejected word, an em dash, "ei X vaan Y" as a contrast, an exclamation mark
  that ends a sentence; the list is `tools/repo-rules/finnish.ts`, and a pattern that catches a good sentence gets a
  near miss in `finnish.test.ts` first).
