# Audit: what to simplify

Date: 9 November 2026, at commit 593448c (Omatalous 1.0.0 and the roadmap). This page lists facts and options. It
decides no feature: every move that removes something a user sees is marked "owner decides".

Each figure has the command that made it, run from the repo root. Tools that are not in the repo were installed in a
scratch folder (`npm i jscpd@4 knip@5 @biomejs/biome@2`) and are called as `$T/jscpd` and so on. knip, jscpd and biome
need about 1 GB of heap: `NODE_OPTIONS=--max-old-space-size=4096`.

## 1. Size

### Lines per app, package and top folder

Non-test is every tracked `.ts .tsx .mjs .js .sh .css .sql` file outside `test/`, `*.test.*`, `*.spec.*` and `e2e/`.

```sh
for d in apps/server apps/web packages/core tools scripts e2e relay contracts; do
  n=$(git ls-files "$d" | grep -E '\.(ts|tsx|mjs|js|sh|css|sql)$' | grep -vE '(/test/|\.test\.|\.spec\.|^e2e/)' | xargs -r cat | wc -l)
  t=$(git ls-files "$d" | grep -E '\.(ts|tsx|mjs|js|sh|css|sql)$' | grep -E '(/test/|\.test\.|\.spec\.|^e2e/)' | xargs -r cat | wc -l)
  echo "$d $n $t"; done
```

| Folder | Non-test | Test | Inside it (non-test) |
|---|---:|---:|---|
| packages/core | 44 816 | 43 433 | 159 top-level files 18 189, analysis 10 552, optimise 5 060, reports 4 094, english 3 745, behaviour 1 048, loan-intake 1 015, explain 1 003 |
| apps/web | 35 938 | 12 176 | pages 14 895, components 11 163, styles 3 037, charts 2 829 |
| apps/server | 28 001 | 42 291 | services 10 896, db 6 061, connectors 3 039, routes 2 247, security 1 098, platform 1 081, providers 979 |
| tools | 14 182 | 18 492 | repo-rules 3 627, ci 3 450, check 1 366, release 1 069, audit 489, findings 445; tools/test (shell suites) 13 988 |
| scripts | 6 763 | 0 | install.sh 882, ops-helper.sh 580, update.sh 500 |
| e2e | 0 | 14 488 | app.spec 709, loans.spec 690, settings.spec 535 |
| contracts | 4 290 | 0 | 15 frozen versions, 76 files |
| relay | 207 | 0 | |

The product is about 109 000 lines; its unit and integration tests about 98 000, and e2e 14 500 more; the tooling around it (tools, scripts, CI, contracts) about
25 000 lines plus 18 500 lines of tests. The tooling alone is the size of the server.

### The 25 largest files

All tracked text files (`git ls-files | grep -vE '\.(png|jpg|webp|gif|pdf|json)$|lock\.yaml' | xargs wc -l | sort -rn | head -26`):
the first eleven are golden answer files and notices. `apps/server/test/fixtures/answers/{demo,kit}/{own,household}-reports.txt`
(6 083, 6 083, 5 984, 5 984), `THIRD_PARTY_NOTICES` 3 995, `CHANGELOG.md` 2 454, the four `*-dashboard.txt` (1 332, 1 332,
906, 906), `docs/MONEY_FLOWS.md` 1 006. The own and household reports and dashboard files are byte for byte the same
(the `*-optimise.txt` pair differs)
(`cmp apps/server/test/fixtures/answers/demo/own-reports.txt apps/server/test/fixtures/answers/demo/household-reports.txt`).

Source only (same command with the test filter of the table above):

| Lines | File | Lines | File |
|---:|---|---:|---|
| 882 | scripts/install.sh | 478 | packages/core/src/merchant.ts |
| 580 | scripts/ops-helper.sh | 478 | packages/core/src/analysis/change.ts |
| 555 | tools/check/scope.mjs | 476 | packages/core/src/wording.ts |
| 545 | packages/core/src/categorize.ts | 473 | apps/server/src/services/analysis.ts |
| 514 | tools/release/prepare.mjs | 469 | packages/core/src/pipeline.ts |
| 500 | tools/ci/local-proof.sh | 452 | apps/web/src/pages/settings/BankConnections.tsx |
| 500 | tools/check.sh | 450 | apps/web/src/pages/settings/BankAppSetup.tsx |
| 500 | scripts/update.sh | 448 | tools/repo-rules/code-rules.ts |
| 499 | apps/server/src/services/ops.ts | 448 | packages/core/src/loan-detect.ts |
| 499 | apps/server/src/services/money-trace.ts | 444 | apps/web/src/Shell.tsx |
| 498 | apps/web/src/components/table/Table.tsx | 443 | tools/ci/drills.sh |
| 495 | packages/core/src/analysis/alerts.ts | 443 | packages/core/src/optimise/types.ts |
| 492 | apps/server/src/services/settlement.ts | | |

Many files stop at exactly 500 lines: a size rule (`tools/repo-rules/size.ts`) caps them, so file size says little here.

### Dependencies

`node -e 'for (const p of ["apps/server","apps/web","packages/core"]) { const j=require("./"+p+"/package.json"); console.log(p, Object.keys(j.dependencies||{}).length, Object.keys(j.devDependencies||{}).length) }'`

- packages/core: 0 runtime, 0 dev.
- apps/server: 5 runtime (`@banking/core`, `@hono/node-server`, `@simplewebauthn/server`, `croner`, `hono`), 2 dev.
- apps/web: 12 runtime (react, react-dom, react-aria-components, three TanStack packages, pdfjs-dist, tesseract.js and its
  two language packs, the IBM Plex font), 8 dev.
- root: 10 dev (playwright, vitest, two TypeScript versions, happy-dom, axe-core and testing-library).

Unused (`$T/knip --reporter json`): knip names `@fontsource-variable/ibm-plex-sans`, `@tesseract.js-data/eng`,
`@tesseract.js-data/fin` and `axe-core`. All four are used, through a CSS `url()` (`styles/fonts.css`), `apps/web/ocr-build.ts`
and `e2e/a11y.spec.ts`. No dependency is unused. The list is already short; the weight is in tesseract.js and pdfjs-dist,
which serve one feature (reading a loan or statement from a picture or PDF).

### Duplicated blocks

`$T/jscpd --min-lines 20 --reporters json --ignore "**/node_modules/**,**/dist/**,**/*.txt,**/*.json,**/fixtures/**,**/contracts/**,**/golden/**" --format "typescript,tsx,javascript,css,bash" apps packages tools scripts e2e`

263 002 lines scanned, 10 clones, 235 lines (0.09 %). The code is not copy-paste; its size comes from volume.

| Lines | First | Second |
|---:|---|---|
| 31 + 28 | apps/web/src/pages/transactions/FilterChips.tsx:155, :170 | same file :60, :73 |
| 24 | apps/web/src/pages/settings/BankFile.tsx:159 | apps/web/src/pages/settings/CardFile.tsx:65 |
| 23 | apps/web/src/pages/settings/Passkeys.tsx:16 | apps/web/src/pages/settings/SecondFactor.tsx:60 |
| 21 | apps/web/src/styles/calendar-heat.css:4 | apps/web/src/styles/charts.css:52 |
| 30, 24 + 21, 21 | core pipeline.ts:440, analysis/money-in.ts, transfers.ts:206 | core test `*-reference.ts` (intended: slow oracles for property tests) |
| 22 | apps/web/test/bank-picker.test.ts:12 | e2e/bank-picker.spec.ts:8 |

### Dead exports and files

`$T/knip --reporter json` (no knip config in the repo, so entry points are guessed; the e2e config and fake bank are false
positives).

- Unused files that are dead (checked with `git grep`): `apps/web/src/charts/PriceLine.tsx` (108), `components/BasisSheet.tsx`
  (45) with `styles/basis.css` (14), `components/ui/Tabs.tsx` (51, named only in a comment of `Segmented.tsx`),
  `components/ui/Chip.tsx` (13, no import). 231 lines.
- `tools/shots-examples/`: 29 files, 216 lines; docs name only `answers.mjs` and `steps.mjs`.
- `packages/core/src/features/*/registry.gen.ts`: six files of `export {}` (see 2).
- 150 unused exports (web 111, server about 30, core about 10, tools the rest) and 196 unused exported types. The repo keeps
  its own list of the same kind, `tools/repo-rules/unread-exports.txt` (241 lines), checked by `tools/repo-rules/exports.ts`.

### Most complex functions

biome's cognitive complexity rule, threshold 25, with a scratch config
(`{"linter":{"rules":{"recommended":false,"complexity":{"noExcessiveCognitiveComplexity":{"level":"error","options":{"maxAllowedComplexity":25}}}}}}`):
`$T/biome lint --config-path=<that> --reporter=json --max-diagnostics=1000 apps/server/src apps/web/src packages/core/src`.

118 functions are over 25 (core 72, web 27, server 19). The worst ten:

| Score | Function at |
|---:|---|
| 231 | apps/server/src/services/data-import.ts:101 |
| 122 | packages/core/src/returns.ts:151 |
| 97 | apps/server/src/connectors/sync.ts:185 |
| 91 | apps/server/src/demo-data.ts:42 |
| 86 | packages/core/src/analysis/ahead-moves.ts:128 |
| 77 | packages/core/src/money-trace-rows.ts:152 |
| 72 | apps/web/src/pages/settings/BankAppSetup.tsx:50 |
| 71 | packages/core/src/transfers.ts:189 |
| 69 | apps/server/src/services/ingest.ts:67, packages/core/src/loan-intake/parse.ts:365 |

## 2. Over-engineering

- Feature flags with no flag. Core declares `FeatureId = never` (`packages/core/src/features.ts`, 21 lines). The
  server's `EXTENSIONS` is `[]` (`apps/server/src/extensions.ts:82`, 124 lines). The web side has `extensions.ts` (25),
  `views/ExtensionView.tsx` (9), `components/ExtensionRowParts.tsx` (13), the flag overrides in `services/instance.ts`
  and `routes/admin.ts`, and 260 lines of tests (`extensions.test.ts`, `extension-demo.test.ts`, `features.test.ts`). About
  20 other source files import it. Every hook (row parts, demo rows, hourly tick, service-token reads) loops over an empty list.
- Feature module scaffold with no module. `packages/core/src/features/` (`contract.ts` 92 and six empty
  `registry.gen.ts`), `tools/gen/registry.mjs` (113, `pnpm gen`), repo rules 29 to 33 in `tools/repo-rules/modules.ts`
  (349), a `.gitattributes` merge rule and a paragraph of `docs/ARCHITECTURE.md`, which says "no module exists yet".
  About 570 lines guard a folder that holds nothing.
- Golden answers stored twice. The `own` and `household` reports and dashboard files of the demo and the kit are
  identical, 14 305 lines in four copies (`apps/server/test/answers-golden.test.ts:73` writes both scopes).
- Local test scheduling. `tools/check.sh` (500), `tools/check/` (1 366 lines: `scope.mjs` picks the tests a change
  reaches, `rerun.mjs`, `stamps.sh`, `weights.sh`), and the slot, core-share, quiet-machine and commit scripts under `tools/` (110, 81, 139 and
  125 lines, with two helpers in `tools/lib/`). These manage CPU slots and machine load for
  agents running on one host. The machine-wide rules say such wait and lock scripts belong outside product repos.
  vitest has `--changed` and `--shard`; GitHub runs the full suite anyway.
- Repo rules. `tools/repo-rules/` is 3 627 lines with 931 lines of tests, some 35 rules. Several overlap with off-the-shelf
  linters: unread exports (`exports.ts`, `unread-exports.txt`) is what knip does; file size, shell rules and timeouts are
  biome, shellcheck or eslint rules. The Finnish text rules (`finnish.ts`, `glossary.ts`, `dialect.ts`) have no library
  replacement.
- CI shell. `tools/ci/` is 23 scripts, 3 450 lines (local proof, drills, a build farm, release promotion), and
  `.github/workflows/release.yml` is 410 lines. `tools/ci/farm-lib.sh` (115) has one caller.
- Legacy addresses. `apps/web/src/routes.ts:157-198` rewrites old report tabs, `#/rules`, `#/categories` and old settings
  sections. Needed while bookmarks from before 0.6x exist.
- Layers. Routes are thin by rule (ADR 0006) and services hold the logic; no pass-through layer worth cutting was found
  in a sample of `routes/*`. The extension hooks above are the pass-through layer.
- Generated or vendored code. `apps/web/src/styles/tokens.css` is generated from `design/tokens.json` (`pnpm tokens`,
  328 lines of builder for one light theme). `contracts/` (4 290 lines) is frozen on purpose for old installs.

## 3. Features

Lines are non-test, counted with `git ls-files <paths> | grep -vE '\.test\.|/test/' | xargs cat | wc -l`. Reached means
a link in the main menu, the header or the settings tabs leads there.

| Feature (Finnish name) | Code | Lines | Reached |
|---|---|---:|---|
| Overview (Yhteenveto) | pages/Overview.tsx, components/overview, holdings | 546 web | menu |
| Bills (Laskut) | pages/Bills.tsx, components/bills | 846 web | menu |
| Transactions, merchants, rules (Tapahtumat) | pages/Transactions, TransactionRows, transactions/, Merchants, Rules | 2 063 web | menu; merchants and rules are a view and an anchor of it |
| Reports, 7 question pages (Raportit) | web pages/reports, core reports/ | 3 787 web, 4 094 core | menu; Yhteiset only with a shared account |
| Saving tips (Säästövinkit) | web Optimise.tsx, components/optimise; core optimise/ | 1 807 web, 5 060 core | menu |
| Alerts on the overview (Huomioitavaa) | core analysis/alerts.ts and insights/ | part of analysis 10 552 | overview |
| To check (Tarkistettavat) | Review.tsx, ReviewChoices.tsx, review-items.ts, services/review.ts | 1 123 | header count |
| Settings, 6 tabs | pages/settings (44 files) | 7 314 web | user menu |
| Remote access (Etäkäyttö) | settings/RemoteAccess* (7 files), remote-access-*, services/remote-access, access-request, providers/cloudflare, security/cf-access | 2 557 | settings > server |
| Maintenance from the browser (Ylläpito) | services/ops*, scripts/ops-helper.sh, lib/ops-actions.sh, Maintenance.tsx | 1 779 | settings > server, needs the host helper |
| Loan read from picture or PDF | core loan-intake/, tesseract.js, pdfjs-dist | 1 015 core + web | settings > loans |
| Statement and bank files (CSV, camt.053, card PDF) | connectors/card-file, bank-file, settings/BankFile, CardFile, StatementFile | about 1 000 | settings > banks |
| English UI | core english/ (3 745) next to 72 Finnish `messages-*.ts` (4 264) | 3 745 | device language |
| First-run wizard (Käyttöönotto) | pages/Wizard.tsx | 243 | after sign-in until done |
| Extension pages | views/ExtensionView.tsx | 9 | dead: no extension exists |
| Price line chart | charts/PriceLine.tsx | 108 | dead |
| Basis sheet | components/BasisSheet.tsx, basis.css | 59 | dead |

Every main screen is reachable. Dead code is limited to the four files of section 1 and the extension frame.

## 4. The UI

Run as `docs/DEVELOPMENT.md` says, with a scratch data folder: `DATA_DIR=<tmp> pnpm seed:demo`, then the API
(`tsx apps/server/src/entry/node.ts`, `PORT=8187`) and Vite (`vite apps/web --port 5187`, `API_PORT=8187`). Node 24 is
required (`node:crypto` argon2); the `.npmrc` pin gives it to `pnpm exec`. Signed in as the seeded demo user, skipped the
wizard, and shot each screen with `playwright-cli -s=omat-audit` at 1440×900 and 390×844 into `docs/audit/shots/`
(`<screen>-1440.png`, `<screen>-390.png`, and `wizard-1440.png`). Shot at both widths: Yhteenveto, Laskut, Tapahtumat
(list and merchants), Raportit (Kuukausi, Rahankäyttö, Tulot), Säästövinkit, Tarkistettavat, Asetukset (Pankit ja tilit,
Palvelin ja ylläpito). Not shot: the other four report pages, the other four settings tabs, the wizard at 390 px.

What looks generic:

- No gradients, no emoji, no glass. One light theme, one font, a navy header. The base is plain and bank-like.
- Initials avatars everywhere: every row of Tapahtumat and Laskut has a two-letter badge (KM, PR, SP), a bank logo and a
  coloured category chip with an icon, and the amount has a coloured bar under it (`transactions-1440.png`). Four marks
  per row tell the reader what the text already says.
- Three KPI tiles on Tapahtumat ("Rahaa ulos", "Rahaa sisään", "Erotus") over the whole history, with no comparison and
  no period choice in sight. A total of 13 months answers no question.
- The weekly bar chart on Tapahtumat names its highest week and nothing else.
- Säästövinkit is a card grid with icons and one button per card (`optimise-1440.png`), the most "app template" screen.
- The same finding is shown twice: "Uusi toistuva maksu: OpenAI" is on Yhteenveto (Huomioitavaa) and on Säästövinkit
  (Muut havainnot), with different counts (3 and 2 charges).

What shows data that answers no question:

- Yhteenveto shows the month chart and then a table of the last three days with four columns (`overview-1440.png`); the
  chart already answers "am I above a usual month".
- The right column of Yhteenveto repeats the headline: 7 198,65 − 2 774,52 = 4 424,13 is the sentence on the left.
- Laskut: a 16-day dot timeline above four sum lines and then a table of the same bills (`bills-1440.png`).
- Rahankäyttö: five folds closed by default; Kategoriatavoitteet shows no figure in its row (`reports-menot-1440.png`).
- Settings > Pankit ja tilit: each account has a status line about whether its balance can be checked, in bold, as loud
  as the balance (`settings-banks-1440.png`).
- Good: Raportit > Kuukausi (`reports-kuukausi-1440.png`) states the figure, compares it ("102 € tavallista enemmän") and
  lists the days that explain the gap with a total. Tarkistettavat (`review-1440.png`) asks one question with the evidence.

Phone (390 px): pages stack without sideways scroll. Tapahtumat puts the three tiles, the bar chart and three filter rows
above the first transaction, so the list starts below the first screen (`transactions-390.png`).

## 5. Stale docs and process files

- `docs/ARCHITECTURE.md:3` says the app fetches "Nordea transactions"; the README says Nordea and the other Finnish banks.
- `docs/ARCHITECTURE.md:210-263` "Target architecture: this is the target and it is not built yet", next to the
  roadmap that plans the same steps.
- `docs/ARCHITECTURE.md:168` describes the empty feature module scaffold.
- `docs/ROADMAP.md:76-187` "Done" is 110 lines that repeat `CHANGELOG.md`.
- `docs/adr/` has three ADRs numbered 0023 (chart and table, React compiler, toolbar look).
- `docs/security-audit-2026-10.md` is a dated report of 1.0; it fits a release note or `docs/audit/` better than the
  docs a user reads.
- `CHANGELOG.md` is 2 454 lines for 76 versions; most of it describes versions no install runs any longer.
- `tools/shots-examples/` (27 of 29 files never named).
- CLAUDE.md and the machine rules disagree on one point: workflow and wait scripts (slots, quiet machine,
  core shares, commit) sit in the repo.

## 6. Browsers and logins

### Scripts that drive a browser

`git grep -n -E "chromium\.launch|launchPersistentContext|connectOverCDP|puppeteer"`:

| Where | What | Verdict |
|---|---|---|
| e2e/browser-hosts.ts:34 | wraps `chromium.launch` so the e2e suite records every host a page calls | stays: test tooling |
| e2e/no-sideways.spec.ts:14 | launches Chromium with scrollbars shown for the sideways-scroll test | stays: test |
| tools/shots.mjs:306 | `pnpm shots`: full-page PNGs of the built app | stays: repo screenshot tool |
| tools/shots-diff.mjs:115, shots-diff.test.ts:61 | compares two shot folders | stays |

No script logs in to a portal, a bank or Cloudflare, and none opens a persistent profile. One change: `docs/DEVELOPMENT.md`
(around line 442) tells a developer to look at a page with `pnpm shots`. An agent that only needs to look at a page or
check a fix should use a `playwright-cli` session named after its task instead, which the owner can watch; `pnpm shots`
stays for pictures a change ships or compares.

### Credentials

`git grep -h -o -E "process\.env\.[A-Z_0-9]+|env\.[A-Z][A-Z_0-9]+" -- apps/server/src apps/web tools e2e | sort -u`, plus
`.env.example` and `git grep` for hardcoded passwords and keys. The developer machine's secret store (`agent-secrets`)
holds the ones below. An id or key that is not a login is stored as `_USER` and `_PASSWORD` of one name, so every name fits
`NAME_USER`, `NAME_PASSWORD`, `NAME_URL`, `NAME_TOTP`.

| Proposed secret name | Read at | Needed by | How the code gets it |
|---|---|---|---|
| `OMAT_EBAPP_USER` (app id), `OMAT_EBAPP_PASSWORD` (the private key PEM) | `EB_APP_ID`, `EB_PRIVATE_KEY` / `EB_PRIVATE_KEY_FILE` in `apps/server/src/platform/config.ts:182` | a dev server that syncs a real bank (optional; the browser form wins) | `eval "$(agent-secrets env)" && EB_APP_ID=$OMAT_EBAPP_USER EB_PRIVATE_KEY="$OMAT_EBAPP_PASSWORD" pnpm dev` |
| `OMAT_ENABLEBANKING_USER`, `_PASSWORD`, `_TOTP`, `_URL` | none: the Enable Banking control panel login | an agent who sets up or checks the app in the portal | in a `playwright-cli` session: `playwright-cli fill <ref> "$OMAT_ENABLEBANKING_PASSWORD"` |
| `OMAT_BANK_USER`, `_PASSWORD` | none: the bank's own login during linking | linking a real account | the bank asks for app approval: always the owner |
| `OMAT_CLOUDFLARE_PASSWORD` (the API token) | `CLOUDFLARE_API_TOKEN`, `apps/server/src/cli-cloudflare.ts:91` | `node dist/node.js cloudflare up/down` | `eval "$(agent-secrets env)" && CLOUDFLARE_API_TOKEN=$OMAT_CLOUDFLARE_PASSWORD node dist/node.js cloudflare up …` |
| `OMAT_CLOUDFLARE_TUNNEL_PASSWORD` | `CLOUDFLARE_TUNNEL_TOKEN` in `.env` (`.env.example`, empty) | Compose profile `tunnel` on a real install | written into `.env` on the host only, never from the secret store into the repo |
| `OMAT_ADMIN_USER`, `_PASSWORD`, `_URL`, `_TOTP` | none in code: an install's admin login | an agent checking a live install in a browser | `playwright-cli` session, values from `agent-secrets env` |
| `OMAT_SETUP_PASSWORD` (the setup code) | `SETUP_CODE`, `platform/config.ts:180` | first start of an install | `.env` of the install; tests make their own (`E2E_SETUP_CODE` is set by `e2e/playwright.config.ts:12`) |

Not secrets to store: `APP_SECRET_FILE` is created by the app (`entry/app-secret.ts`), `CLOUDFLARE_ACCESS_EMAILS` is
a list of addresses passed on the same command line as the token, `CF_ACCESS_AUD` and
`CF_ACCESS_TEAM_DOMAIN` are public identifiers, `DOCS_SHOTS_ACCOUNT` names a demo account. No Proxmox, tenant,
`.dev.vars` or wrangler secret exists in this repo.

Values committed in the tree: no real credential was found. Hardcoded on purpose, all for throwaway local users:
`apps/server/scripts/seed-demo.ts:19` (the demo password, printed by `pnpm seed:demo` and named in DEVELOPMENT.md),
`e2e/app.spec.ts:6`, `e2e/offline.spec.ts:9`, `e2e/run.mjs:189` and other specs (e2e admin passwords), and PEM headers in
tests around fake bodies (`apps/server/test/instance.test.ts:197`, `ops.test.ts:102`). None reaches a real service.

## 7. The 25 biggest moves, ranked

Ordered by the code and machinery a move takes out of the product and its tooling, weighed against risk. Fixture and
doc lines count for less than code lines, and the two splits (13, 14) remove no lines but rank for the complexity they
remove. "Owner decides" marks a move that removes something a user sees.

| # | Move | Lines | Risk | Done when |
|---:|---|---:|---|---|
| 1 | Delete the extension and flag frame (core `features.ts`, server and web `extensions.ts`, ExtensionView, ExtensionRowParts, flag overrides in instance/admin, their tests); bring it back with the first real module | about 600 | low: nothing is registered | `git grep -n "EXTENSIONS\|FeatureId"` is empty and `pnpm check` passes |
| 2 | Delete the feature module scaffold (`core/src/features/`, `tools/gen/`, `modules.ts` rules 29 to 33, `.gitattributes` line, ARCHITECTURE paragraph) | about 570 | low | `pnpm gen` is gone, `repo-rules.test.ts` lists no rule 29 to 33, `pnpm check` passes |
| 3 | Store one golden answer file per household when own and household agree, and assert the equality in `answers-golden.test.ts` | 14 305 fixture | low | the four `household-*.txt` are gone and the test fails if the scopes differ |
| 4 | Move agent and machine-load scripts out of the repo (slots, core shares, quiet machine, commit and their two helpers in `tools/lib/`) to the host tooling | about 500 + tests | medium: `check.sh` and `e2e/run.mjs` call them | a `git grep` for the three script names is empty and `pnpm check` runs on a clean clone |
| 5 | Replace `tools/check/scope.mjs` and friends with `vitest --changed` plus the shell suites by folder | about 1 300 + 800 tests | medium: slower local runs | `pnpm check --changed` runs only vitest `--changed` and the touched shell suites |
| 6 | Replace the unread-exports rule with knip in CI (`exports.ts`, `exports-rule.ts`, `unread-exports.txt`) and add a `knip.json` | about 400 | low | `pnpm knip` is in `pnpm check`, reports 0, and the rule's files are gone |
| 7 | Remove the 150 unused exports and 196 unused types knip lists (after move 6) | est. 300 to 600 | low | knip reports no unused export |
| 8 | Delete dead web files: PriceLine, BasisSheet with basis.css, ui/Tabs, ui/Chip | 231 | low | the files are gone and `pnpm --filter @banking/web typecheck` passes |
| 9 | Drop the English UI (owner decides) | 3 745 + key-parity tests | high: users on English devices | `packages/core/src/english/` is gone and `ui-strings.test.ts` checks Finnish only |
| 10 | Merge alerts (`analysis/alerts.ts`, insights) and Säästövinkit findings into one source, shown on one page (owner decides which) | est. 800 to 1 500 | medium | one finding (e.g. a new recurring payment) appears on one page, tested in `optimise/quiet.test.ts` |
| 11 | Remote access managed in the app (Cloudflare tunnel, Access, trial and revert) replaced by a guide in ADVANCED.md (owner decides) | about 2 500 + tests 1 500 | high: users who set it up in the browser | `RemoteAccess*` and `providers/cloudflare` are gone and an install with a tunnel keeps working (install.test.sh) |
| 12 | Maintenance from the browser (helper, ops requests) kept to update and rollback only (owner decides) | about 800 | high: host contract | `contracts/` helper output is unchanged for the kept actions and `ops.test.ts` passes |
| 13 | Split `data-import.ts:101` (complexity 231) into one function per store | 0 net, −200 complexity | medium | biome reports it under 25 and `data-import` tests pass |
| 14 | Split `returns.ts:151`, `sync.ts:185`, `ahead-moves.ts:128`, `money-trace-rows.ts:152` | 0 net | medium | biome lists none of them over 40 |
| 15 | Delete `tools/shots-examples/` except the two files the docs name | 190 | low | `git grep shots-examples` names only `answers.mjs` and `steps.mjs` |
| 16 | Tapahtumat rows: drop two of the four marks per row (initials badge, amount bar), keep logo and category (owner decides) | about 150 web + css | low | `e2e/table-views.spec.ts` passes at 390 and 1440 px |
| 17 | Tapahtumat: drop the three whole-history tiles and the weekly bar, or give them a period and a comparison (owner decides) | about 200 | low | the list starts on the first screen at 390 px (`pnpm shots transactions --widths 390`) |
| 18 | Yhteenveto: drop the three-day table under the chart and the right column that repeats the headline (owner decides) | about 150 | low | `dashboard-cockpit.test.ts` passes and the page holds one figure per question |
| 19 | Laskut: keep the timeline or the sum lines, not both (owner decides) | about 150 | low | the page shows the payday total once |
| 20 | Trim `docs/ARCHITECTURE.md` (target section, scaffold paragraph, "Nordea") and `docs/ROADMAP.md` Done section | about 180 doc | none | `grep -n "not built yet\|Nordea transactions" docs/ARCHITECTURE.md` is empty |
| 21 | Cut `CHANGELOG.md` to the last ten versions and a link to the git tags | about 1 500 doc | none | the changelog has ten `## ` versions and the link |
| 22 | Renumber the duplicate ADR 0023s and move `security-audit-2026-10.md` under `docs/audit/` | 0 | none | `ls docs/adr \| cut -c1-4 \| uniq -d` is empty |
| 23 | Merge the FilterChips twin blocks, BankFile/CardFile column picker, Passkeys/SecondFactor list, calendar-heat/charts CSS | about 130 | low | jscpd at 20 lines reports no clone in `apps/web/src` |
| 24 | Drop legacy address rewrites in `routes.ts` after one more release with a notice | about 40 | low: old bookmarks | `routes.test.ts` keeps only current addresses |
| 25 | Loan and statement reading from pictures (tesseract.js, pdfjs-dist, two language packs) kept to CSV and camt.053 (owner decides) | 1 015 core + web + 4 dependencies | high: users with no CSV | `apps/web/package.json` has no tesseract or pdfjs and the bundle budget drops |

Not proposed: the `*-reference.ts` oracles in core tests (they are the point of the property tests), `contracts/`
(old installs rely on it) and the Finnish text rules (no library does them).
