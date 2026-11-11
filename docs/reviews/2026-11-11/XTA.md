# Omatalous: architecture as a whole

## Verdict

The structure is sound. Core is pure, the server keeps every financial read behind `FinanceRepo`, errors map cleanly in one `onError` (`apps/server/src/app.ts:52`), the hourly tick is small and catches per chore (`services/schedule.ts`), and the full vitest run (540 files, 8504 tests) is green in 126 s on 6 workers. The three biggest problems are all unfinished deletions. First, the Säästövinkit engine is still in core: about 5000 lines in `packages/core/src/optimise`, 4600 lines of tests and 330 Finnish texts. No app code calls it. It is still exported from core, still imported by analysis code, still served by two server routes, and it costs about 30 s of test time. Second, three merged steps say "Partial" and left their scaffolding behind: T78 (features/, `pnpm gen`), T80 (slots.sh, cores.sh) and T84 (two knip ignore lines, one of which hides a dead component). Third, `pnpm knip` reports clean but never checks for unused files, so 12 dead files went unnoticed, and CLAUDE.md and docs/DEVELOPMENT.md send a contributor to files that no longer exist. What is good: the boundaries are enforced by repo rules and a size budget, migrations are additive and checksummed, and CI shards tests across two runners (median run 101 s).

## Findings

1. **Misleading: CLAUDE.md and the docs describe modules that are gone.**
   - Where: `CLAUDE.md:28-29` names `optimise/` "(the Optimoi page)" and `features.ts` (flags). `CLAUDE.md:66-67` lists the Optimoi inputs as live per-request inputs. `CLAUDE.md:139-149` gives recipes for `reports/conclusions/<page>.ts`, `apps/server/src/extensions.ts` and "New Optimoi finding". `docs/DEVELOPMENT.md:150,204,210,222` names `tools/repo-rules/unread-exports.txt`, `packages/core/src/reports/conclusion.ts`, `reports/conclusions/kinds.ts` and both `extensions.ts`. `docs/ARCHITECTURE.md:169` describes the features scaffold. `docs/DATA_EXPORT.md:5` names `apps/server/src/services/data-export-stores.ts`, but the file is in `db/`.
   - Evidence: none of these files exists (`git ls-files` is empty for each). I checked every backticked repo path in CLAUDE.md and docs/*.md against the tree.
   - Why it matters: every agent and contributor reads CLAUDE.md first. A recipe for a missing module produces either new code in the wrong shape or wasted time.

2. **Misleading: the dead optimise engine still looks live in core.**
   - Where: `packages/core/src/optimise/` (13 areas, facts, outcome, snapshot, state; about 5000 lines). It is exported at `packages/core/src/index.ts:93-94`.
   - Analysis code imports from it:
     - `CalcLine` at `analysis/income-series.ts:9`, `analysis/insights/shared.ts:15`, `analysis/insights/types.ts:2` and `messages-calc.ts`.
     - The CPI series and `Fact`/`factFrom` at `analysis/prices.ts:6-7`.
     - `AreaInput`/`AreaResult` at `features/contract.ts:12`.
     - The web reads `LOAN_REFERENCE_LABEL` from `optimise/inputs.ts` (`apps/web/src/components/loans/labels.ts:2`).
   - Evidence:
     - T55 (33d27eb) says "Partial: packages/core/src/optimise (the engine) is still there".
     - `buildOptimise` is called only by `tools/findings/statements.ts:21` and core tests.
     - Dead tip texts reach the browser. `opt.sub_rise_title` (a tip title) appears in the built `messages-en` and `messages-late` chunks, and `packages/core/src/messages-optimise*.ts` and `english/optimise*.ts` hold 690 lines (330 `opt.*` keys). Only `opt.sit_saving_one`, `opt.sit_saving_many` (`analysis/bridge.ts:50`) and `opt.hab_chk` (`FilterChips.tsx:211`, inside a dead component, see 5) are read outside the engine.
   - Why it matters: core's real rules (prices, insights, loans) depend on a folder that is meant to be deleted, so the deletion cannot happen in one move. A reader also cannot tell which money rules are live.

3. **Misleading: the server still keeps and maintains data that nothing reads.**
   - Where:
     - `apps/server/src/routes/optimise.ts`, mounted at `app.ts:146`, serves `PUT`/`DELETE /api/optimise/inputs/:key`. The service header (`services/optimise.ts:1-5`) says "No view reads them now".
     - `db/finance/optimise.ts` and `finance-repo.ts:208-218` keep 10 methods.
     - `services/upgrade.ts:156,177` still copies and renames tip decisions on every merchant rename (`copyMerchantStates`, `renameMerchantStates`).
     - The only caller of the routes is `e2e/vs1.spec.ts:32`.
   - Data model: `optimise_inputs`, `optimise_states`, `optimise_snapshots`, `spending_goal` and `category_goal` are read by no code except backup export and import (`db/data-export-stores.ts:156-160`, `services/data-import-stores.ts:167-178`). `view_opens` is not even exported (`data-export-stores.ts:189`).
   - Why it matters: the upgrade path does work for nobody, and the API surface is wider than the product. Keeping the tables for old backups is a fair choice (A3 made it for the goals), but the code that writes them is not needed for that.

4. **Slow: the dead engine is a large share of the slowest tests.**
   - Where: `packages/core/test/kit/noise.test.ts:8` imports `tools/findings/statements.ts`, which runs every source, including `optimise` and `outcome`, for 200 seeded households.
   - Evidence, measured on 11 Nov:
     - noise.test.ts takes 46.6 s, the slowest file of the run.
     - In a scratch timing of `statements()` over 20 households, the context alone took 130 ms, optimise 589 ms, outcome 562 ms and insights 504 ms, with every other source between 119 and 200 ms. Over 10 households, all sources took 571–607 ms and the same without optimise and outcome took 419–434 ms, so the two dead sources are about 28 % of the noise test.
     - `packages/core/test/optimise/` (4599 lines) takes about 24 s, of which `quiet.test.ts` is 17 s.
   - Why it matters: about 37 s of summed test time out of 475 s, and the single longest file, which bounds the wall time of a shard. A core test that reaches into `tools/` is also a boundary leak.

5. **Misleading: `pnpm knip` reports clean but does not check files.**
   - Where: `knip.json:3` sets `"include": ["exports", "types"]`. `knip.json` `ignoreIssues` also hides `FilterChips.tsx` exports.
   - Evidence: `npx knip --include files` lists 12 unused files: `apps/web/src/charts/forms/IncomeUse.tsx` (111 lines), `charts/Tooltip.tsx`, `components/housing/Housing.tsx` (195), `components/subject-name.ts`, `components/target-href.ts`, `pages/reports/rate-words.ts` and the six empty `registry.gen.ts` files. Two more files have no other reader:
     - `components/housing/housing.ts` (195 lines) is read only by `Housing.tsx` and `apps/web/test/housing.test.ts`.
     - `styles/housing.css` is imported only by `Housing.tsx`.

     The FilterChips ignore line hides `MerchantFilters` (`FilterChips.tsx:181`, about 40 lines), a component nothing renders. T84 (ad27ff3) left that line as "Partial". The `tokens.ts` ignore is fair: the file is generated and `tools/repo-rules/css-look.ts` reads it.
   - Why it matters: T85 deleted dead web files by hand, and more appeared after it. A tool in `pnpm check` would have caught them.

6. **Ugly: the T78 scaffold remains.**
   - Where:
     - `packages/core/src/features/contract.ts` plus six `registry.gen.ts` files
     - `packages/core/test/feature-contract.test.ts` and `test/fixtures/features/`
     - `tools/gen/registry.mjs` and `package.json:34` (`"gen"`)
     - feature globs at `vitest.config.ts:9-13`
     - the module rule at `tools/repo-rules/boundaries.ts:126-134`
     - `tools/repo-rules/parity.ts:3,97`, `tools/test/registry-union.test.sh` and `.gitattributes`
   - Evidence: 15ec484 says "Partial: T78 the features folder, tools/gen and pnpm gen still to delete in a second step".
   - Why it matters: it is a second, unused way to add code, with rules that guard nothing.

7. **Ugly: the T80 machine-load scripts remain in the product repo.**
   - Where:
     - `tools/slots.sh` (110 lines), `tools/cores.sh` (81) and `tools/lib/cores.mjs` (57), plus `tools/lib/owner.sh`
     - their callers at `tools/check.sh:93`, `vitest.config.ts:2` and `e2e/run.mjs:21,182`
     - their tests `tools/cores.test.ts`, `tools/test/cores.test.sh` and `tools/test/slots.test.sh`
   - Evidence: d3ae650 says "Partial: T80 slots.sh, cores.sh, lib/cores.mjs and lib/owner.sh still to remove with their readers".
   - Why it matters: agent-machine tooling sits in a household product, and `pnpm check` on a clean clone still goes through a slot lease and a core lease.

8. **Ugly: one money rule lives in the web.**
   - Where: `apps/web/src/pages/reports/sections/settlement-text.ts:39` (`transfersOf`), used at `Settlement.tsx:59`.
   - Evidence: the household's "who pays whom, how much" is computed in the browser from core's `members[].over`. Core `settlement.ts` (209 lines) has no transfer list.
   - Why it matters: ADR 0004 asks for one definition per figure in core. A CSV, a service token or the CLI cannot give the same transfers without copying the algorithm. The other web sums I checked (`bill-line.ts:121`, `next-days-line.ts:107`, `CardStatement.tsx:45`) only lay out chart geometry and are fine.

9. **Tidy: tax rules exist twice.**
   - Where: the live Verovuosi report recognises household-deduction rows by words only (`reports/tax-year.ts:96`). The dead `optimise/areas/tax.ts:32-44` also used the register's industry code and the card's MCC (`deductibleWorkOf`, `mccKind`), and `optimise/facts/tax.ts` held the deduction caps.
   - Why it matters: deleting the engine (finding 2) leaves the words-only rule as the one rule. Whether the register and MCC part should move to `tax-year.ts` is a behaviour question for XTF, not a structural step.

10. **Tidy: the report registry carries a report no view shows.**
    - Where: `reports/index.ts:42` registers `housing`. `tools/repo-rules/parity.ts:126` exempts it (and `income`) in `NO_SECTION`, while its comments explain `summary` and `conclusions`, which are not in the set.
    - Evidence: the web asks only for named reports (`sections/*.tsx` `reports: [...]`). The review queue calls `buildHousing` directly (`services/review.ts:315`).

Measured, no action needed:
- Server, against 100k transactions (82 MB database):

  | Request | Time |
  |---|---:|
  | dashboard, cold | 1.27 s |
  | dashboard, cached | 0.06 s |
  | reports (not cached, each call) | 0.40–0.52 s |
  | transactions | 0.10 s |
  | review | 0.19 s |

- `pnpm build` 8 s.
- CI: 5 of the last 30 check runs failed, and three "Fix main red" commits landed in 20 days.
- The biggest source files (`install.sh` 882 lines, `ops-helper.sh` 580, `categorize.ts` 545) are on the size rule's known list.

## Steps

The core engine can go only after its last readers move (XTA1, XTA2, XTA3), so XTA4 waits for all three. The texts go last, once the dead filter component that reads one of them is gone (XTA5). XTA7 and XTA9 follow XTA3 because they share `vitest.config.ts` and `docs/ARCHITECTURE.md`. Tables and backup stores stay in every step, so old backups still import.

The steps of this review are in [ROADMAP.md](../../ROADMAP.md) under "Review 11 Nov: architecture as a whole (XTA)".
