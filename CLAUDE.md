# CLAUDE.md

Omatalous is a personal finance app for a Finnish household. Nordea transactions come in via PSD2 (Enable Banking) or CSV,
are sorted into money flows and shown as a dashboard and reports. Multi-user (household members, per-user isolation,
optional read-only account sharing). Runs in Docker on Linux.

## Commands

```bash
pnpm install          # pnpm workspaces (npm 10 cannot resolve vitest 4's peers)
pnpm test             # vitest, all packages, must stay green
pnpm typecheck        # tsc for core, server, web
pnpm build            # web (Vite) + server bundle (esbuild, apps/server/dist/node.js)
pnpm dev              # API :8080 + Vite :5173
pnpm seed:demo        # demo user + data in ./data
```

## Layout

- `packages/core`: pure domain logic, no I/O. Categories (`kind` + `group`), merchant normalisation,
  rules (`categorize.ts`), trade register matching (`industry.ts`), transfers, enrichment pipeline,
  recurring detection, money flows, analysis context, dashboard, insights, `reports/*` with a registry in
  `reports/index.ts`.
- `apps/server`: Hono. `app.ts` (middleware), `routes/*` (thin; `admin.ts` = setup wizard API), `services/*` (use cases;
  `industry.ts` = trade register lookup, `schedule.ts` = hourly tick, `security.ts` = security events and notices,
  `secret-rotation.ts` = re-sealing bank keys, `ops.ts` = web maintenance requests), `db/*-repo.ts` (all SQL),
  `auth/*`, `security/*`, `providers/*` (`prh/` = trade register search), `entry/node.ts`, `entry/secret-rotate.ts`,
  `cli.ts`, `cli-ops.ts` (the helper's poll, report and state commands).
- `scripts/`: `install.sh`, `update.sh`, `backup.sh`, `doctor.sh`, `reset.sh`, `ops-helper.sh` (host helper for
  Asetukset > Ylläpito). `relay/` is the static bank return page, published to GitHub Pages by
  `.github/workflows/pages.yml`. `.github/workflows/release.yml` builds and signs the image on a `v*` tag or when run by hand on `main`.
- `apps/web`: React + Vite, custom SVG charts, Finnish UI. First-run wizard `pages/Wizard.tsx`; bank logos
  (official artwork, white plate) in `public/banks/` mapped in `src/banks.ts`.
- Each instance is a clone directory and a Compose project. `INSTANCE_NAME` names the container, image and
  session cookie, `COMPOSE_PROJECT_NAME` the volumes, `HOST_PORT`/`BIND_ADDRESS` the port. See `docs/ADVANCED.md` (second copies).
- `docs/` (English): INSTALL, ADVANCED, TROUBLESHOOTING, ENABLE_BANKING, MONEY_FLOWS, SECURITY, RELEASING, DEVELOPMENT, ARCHITECTURE.
  `SECURITY.md` at the root is the reporting route.

## Invariants (do not break)

- Existing installs keep their project, container and image names (`banking-app` unless `.env` says otherwise),
  port and volumes. Never interpolate `${COMPOSE_PROJECT_NAME}` in `docker-compose.yml` (Compose fills it from the
  directory name) and never write `INSTANCE_NAME` into the `.env` of an install that has none.
- Money is integer cents, negative = out. Dates are `YYYY-MM-DD` strings.
- Financial rows are reached only through `FinanceRepo` (always `WHERE user_id = ?`). Cross-user reads only via
  `HouseholdRepo` for explicitly shared accounts, read-only.
- After any change to transactions/accounts/rules call `reprocess(repo, settings)` (bumps the data version that
  keys the analysis cache). Sharing changes call `settings.bumpDataVersion()`.
- `category_source = 'user'` is never overwritten by automation.
- Every money movement lands in exactly one flow (consumption, debt, saved, income, borrowed) or is a
  transfer. Card bills are transfers when the card account is connected. See `docs/MONEY_FLOWS.md`.
- The app secret is a file (`APP_SECRET_FILE`, created on first start by `entry/app-secret.ts`, Docker volume
  `banking-secrets`). Bank keys live in the DB AES-GCM sealed: users' with the user id as AAD, the shared app's with
  `instance:enablebanking`. Never log or return secrets, private keys or `raw` bank payloads (only the certificate).
- Only merchant names of business rows (core `isBusinessRow`) are sent to the trade register; never amounts, dates,
  account numbers or names of people.
- Admin-editable settings (address, time zone, sync hours, register lookup, shared bank app) live in the DB via
  `services/instance.ts` and `services/bank-app.ts`; env only seeds defaults. Browser input is validated against
  allowlists (`strictObject` + `parse*`), never reaches the filesystem or a command; uploaded keys are re-encoded
  (`security/private-key.ts`). Banks can only be started by id from `services/banks.ts`.
- Security-relevant events (logins, lockouts, key changes, `ops_*` requests) are written with `recordEvent` in
  `services/security.ts` to `security_events` (90 days, with IP and user agent); never log them elsewhere. Password
  hashes run behind the concurrency gate and the per-key limiters in `security/rate-limit.ts`, and a login attempt is
  counted before the hash runs.
- The app secret changes only through secret rotation (`entry/secret-rotate.ts`, `services/secret-rotation.ts`), which
  re-seals every stored key and keeps the old file as `.prev-<stamp>`. Replacing the file by hand loses the bank keys.
- A web maintenance request names only an allowlisted action (`services/ops.ts`, `services/ops-validate.ts`) and takes
  no free parameters. The host helper (`scripts/ops-helper.sh`) never runs text from the DB, picks the commit itself
  and hands update.sh only that commit (`TALOUS_TARGET`).
- State-changing API calls need `X-Requested-With: fetch` (CSRF); the web client sends it in `api.ts`.
- `UserError` = safe 400 message; other errors become a generic 500.
- Core stays pure (no `Date.now()`, env or I/O) so it runs on Node and in the browser (the web app imports it).

- Schema changes = new `apps/server/migrations/NNNN_name.sql`; never edit an applied one (checksummed, startup
  refuses). Prefer additive changes; table rebuilds start with `-- migrate: foreign_keys=off`. Old code refuses a DB
  migrated by a newer version (`db/migrate.ts`); `openDatabase` snapshots before migrating; `scripts/update.sh`
  has `--rollback`. Derived fields are recomputed after every version change (`services/upgrade.ts`), so rule
  changes need no migration. Release = bump `src/version.ts` + package.json versions + `CHANGELOG.md`.

## Conventions

- Writing (docs, UI text, comments, commits, script output): short and plain. No em dashes, no "not X but Y",
  no padded lists of three, no bold lead-ins, no filler words or trailing filler phrases. Docs, script output, logs and
  CLI output in English. Everything the browser shows in Finnish, including the maintenance helper's report summaries
  and the `doctor.sh --json` items. UI paths are written `Asetukset > Palvelin`.

- UI text Finnish; code, identifiers and comments English. Comments explain why.
- New report: `packages/core/src/reports/<name>.ts` + register in `reports/index.ts` + section in
  `apps/web/src/pages/Reports.tsx` + invariant test in `packages/core/test/reports.test.ts`.
- New rule/category: `categories.ts` / `categorize.ts` + scenario in `packages/core/test/flows.test.ts`.
- Server tests use `apps/server/test/helpers.ts` (`setupApp()` gives a signed-in admin, `member()` more users).
- Charts follow the dataviz conventions already in `apps/web/src/charts` (one axis, legend + table view,
  fixed category colour order from the server, tokens in `styles.css` for light/dark).
