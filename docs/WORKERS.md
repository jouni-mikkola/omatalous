# Working on a task

For developers and agents who take one task from a brief. [DEVELOPMENT.md](DEVELOPMENT.md) has the recipes,
[ARCHITECTURE.md](ARCHITECTURE.md) the design.

## Running tests

Run vitest from the repository root. A package directory has no config of its own, so `cd packages/core && pnpm exec vitest run` finds no files.

| Command | Runs |
|---|---|
| `pnpm test packages/core/test/reports.test.ts` | one file (any path or name fragment works as a filter) |
| `pnpm test -t "part of a test name"` | tests by name |
| `pnpm test:core`, `pnpm test:server` | one package. `pnpm --filter @banking/core test` does the same. |
| `bash tools/test/ops-helper.test.sh t_prune` | one scenario of the maintenance helper suite |
| `pnpm test:sh:fast` | all shell suites, helper scenarios four at a time (about 20 s instead of 65 s) |
| `pnpm check` | the CI test job without the build: typecheck, vitest, shell lint, shell suites. Prints one line per step and the failures only. |

Extra arguments to `test:core` and `test:server` add filters. They do not narrow the package, so use `pnpm test <path>`
for one file. `pnpm check types tests` runs only those steps. `ISLAND_SEEDS` and `INCREMENTAL_SEEDS` raise the number of random histories.

The shell steps need `shellcheck` and `ssh-keygen` (package `openssh-client`). `tools/ci/check-migrations.sh` and
`compose-compat.sh` need the full history and tags: `git fetch --unshallow --tags`. In the private repository a cloud
session gets all of this from its session start hook. The dev servers use ports 8080 and 5173. `pnpm e2e` needs
`pnpm build` first and a Playwright Chromium (`PLAYWRIGHT_BROWSERS_PATH`).

## Test helpers

- `apps/server/test/helpers.ts`: `setupApp()` gives an app with a signed-in admin, `member(name)` adds a signed-in household member, `NOW` is the fixed clock, `waitFor` polls.
- `apps/server/test/mock-bank.ts`: a fake Enable Banking API with a checking account and a card. Use it for bank flows, never the network.
- `packages/core/test/helpers.ts`: `tx()` builds a transaction from the fields a test cares about, `series()` a run of charges every N days.
- `packages/core/test/gen.ts`: seeded households (`rng`, `randomHistory`) for the property tests.
- `packages/core/test/pipeline-reference.ts` and `transfers-reference.ts`: frozen copies of the older, simpler algorithms. The differential tests compare the live code with them. A difference is a behaviour change to explain, or a reference to update on purpose.
- `apps/server/test/fixtures/db/*.sql`: database dumps of released versions. `migration-chain.test.ts` loads them (`fromFixture`) and migrates forward. A release adds one.
- `contracts/<version>/`: the schema and helper CLI output older installs rely on. A schema change before release regenerates the unreleased folder (`UPDATE_CONTRACT=<version> pnpm test apps/server/test/contracts.test.ts`).

## Pieces that change together

- `pipeline.ts` with `enrichIsland` and `pipeline-reference.ts` (see the rule in DEVELOPMENT.md).
- A new `FinanceRepo` query: a method in its `db/finance/` module and a one-line method in the `db/finance-repo.ts` facade.
- Rule order in `categorize.ts`: the first matching rule wins, so a new rule goes before any broader rule it must beat.
- `packages/core/src/reports/index.ts` with its section file in `apps/web/src/pages/reports/sections/` (a repo rule checks the pair).
- `apps/server/src/version.ts` with the three `package.json` versions and the top heading of `CHANGELOG.md`.
- `x-talous-compat` in `docker-compose.yml` with `ARG COMPOSE_COMPAT` in the `Dockerfile` and the check in `release.yml`.
- `SIGN_IDENTITY_REGEXP` in `scripts/lib/release.sh` and in `.github/workflows/release.yml`.
- A new maintenance action: `ACTION_SINCE` in `apps/server/src/services/ops-validate.ts` with `OPS_HELPER_VERSION`, the action list and its `case` in `scripts/ops-helper.sh`, and a migration that widens the CHECK on `ops_requests.action`.

## Done means

1. `pnpm check` passes. The repo rules read tracked files only, so `git add` a new file before checking. Also `pnpm build` after a web or server change, and `pnpm e2e` after a change to what the browser shows.
2. A bug fix starts with a test that fails first. New behaviour has a test.
3. A fragment `changelog.d/<task>.md`: first line `section: <Money and reports | Fetching and importing | Look | Reliability | Maintenance | For developers>`, then plain lines for users. Add `upgrade: <line>` for anything an installer must know. Do not edit `CHANGELOG.md`.
4. Edits stay inside the files the brief names. `CLAUDE.md`, `CHANGELOG.md`, `README.md`, `docs/SECURITY.md`, `docs/INSTALL.md` and `pnpm-lock.yaml` belong to the lead: put the change you need in the hand-back instead.
5. Commit on your branch. The commit message ends with the attribution lines the brief gives. Do not push.

## Hand-back

At most 200 words: what changed, test results, what is not done, docs the lead must update. Longer details go to the file the brief names. Include the branch and the commit hashes.
