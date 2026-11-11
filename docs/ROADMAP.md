# Roadmap

Omatalous is a self-hosted household finance app for Finland. This file lists what is left to build: the four views of
[the design](design/README.md) first, then the moves of [the simplification audit](audit/simplify.md) it does not
already make. Done steps live in git history: a step's id is in its commit subject.

- Each step is `### <id> <title>` (at most 32 characters), a `Result:` line, then `why`, `done when`, `locks`, `after`
  and `files`. `lineclear roadmap check .` (from the Lineclear repo) checks the form.
- A step starts once every step in its `after` is merged and no running step holds one of its locks.
- A step writes or edits at most 400 lines; the lines it deletes are not counted. `pnpm check --changed` green is part of
  every step and is not repeated.
- `~/.cache/lc-bench/name-scan.sh` reads the step's branch against `origin/main` and prints a line only for words that
  never go into this repo.
- Audit moves 9 (the English UI), 11 (remote access as a guide), 12 (maintenance kept to update and rollback) and the
  statement half of 25 (reading pictures) wait for the owner's decision and are not steps.

## Coming releases

No release after 1.0.0 has a version yet: the steps below ship in the release that follows the last of them. A release
named here moves out of this section when it ships.

## Now







### N18 Plan parallel steps
Result: Plan parallel steps for tools/check and CI (speed of the checks, flaky tests): read the code, the design docs and best practice, then add up
- why: the owner (11 Nov): more Fable 5.2 workers in parallel now, no bottlenecks; each step in its own area so they never conflict
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan parallel steps for tools/check and CI (speed of the checks, flaky tests): read the code, the design docs and best practice, then add up to 6 small steps that each touch only that area, depend on no unmerged step unless needed, and finish in under an hour; done when the roadmap has them
- locks: none
- after: none

### N14 Plan parallel steps
Result: Plan parallel steps for apps/web/ pages and components (usability, look, accessibility): read the code, the design docs and best practice
- why: the owner (11 Nov): more Fable 5.2 workers in parallel now, no bottlenecks; each step in its own area so they never conflict
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan parallel steps for apps/web/ pages and components (usability, look, accessibility): read the code, the design docs and best practice, then add up to 6 small steps that each touch only that area, depend on no unmerged step unless needed, and finish in under an hour; done when the roadmap has them
- locks: none
- after: none

### N11 Plan the next steps for code
Result: Plan the next steps for code health and speed of the checks: add up to 5 small independent steps, each in its own folder, that cut check
- why: the owner wants every Fable 5.2 hour of today used on finished work, in parallel without conflicts (11 Nov)
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the next steps for code health and speed of the checks: add up to 5 small independent steps, each in its own folder, that cut check time or remove dead code; done when the roadmap has them
- locks: none
- after: none

### N10 Plan the next steps
Result: Plan the next steps for correctness of the numbers: read the reports, budgets and imports and add up to 6 small independent steps, each
- why: the owner wants every Fable 5.2 hour of today used on finished work, in parallel without conflicts (11 Nov)
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the next steps for correctness of the numbers: read the reports, budgets and imports and add up to 6 small independent steps, each in its own package or folder, that each prove or fix one figure with a test; done when the roadmap has them
- locks: none
- after: none

### N12 Foreign total, mixed decimals
Result: An account's rows in another currency show their total also when the bank wrote some sums with fewer decimals than others.
- why: `foreignTotals` gives no total when one currency's rows differ in decimals, and a sum sent as a number loses its last zero (12.10 reads as 12.1), so a USD total disappears.
- done when: a test in `packages/core/test/foreign-rows.test.ts` that fails without the change gives rows of 12.10 and 12 in one currency the total 24.10 at two decimals, and a currency's total is never added to another's (`bun test packages/core/test/foreign-rows.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: foreign-rows
- after: none
- files: packages/core/src/foreign-rows.ts, packages/core/test/foreign-rows.test.ts

### N13 Bank CSV sum, three decimals
Result: A bank file's sum such as -12,345 is no longer imported as 12 345 euros when the file's other sums use the comma for cents.
- why: `sum` in `bank-csv.ts` reads a lone comma or dot before three digits as a thousands mark, so one such cell enters a thousand times too large, and a CSV has no closing balance to catch it.
- done when: a test in `packages/core/test/bank-csv.test.ts` that fails without the change reads a file with -23,40 and -12,345 in the sum column and gets the first as a row of -2340 cents and the second in `unread`, while 1.234,56 and 1 234,56 still read as 123456 cents (`bun test packages/core/test/bank-csv.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: bank-csv
- after: none
- files: packages/core/src/bank-csv.ts, packages/core/test/bank-csv.test.ts

### N6 Main's CI is green again
Result: Main's CI is green again: the shell test 'run: the tests were done at the start, so GIVE more at once' passes in CI, and no test leaves
- why: main's CI fails on every push since about 11:09 on 11 Nov, so no PR can show green checks and 18 PRs wait
- done when: a test that fails without the change passes with it (`lineclear check`), and the pull request names that test file and what a user sees. The request in full: Main's CI is green again: the shell test 'run: the tests were done at the start, so GIVE more at once' passes in CI, and no test leaves a temporary entry behind for tools/lib/tmp-guard.ts (seen: tokens-test-*, budget-*, budget-first-*, report-*, rerun-*); done when two CI runs in a row on main pass both the js and shell jobs
- locks: none
- after: none

### N2 Plan: landing never waits
Result: Move T80 'Machine-load scripts leave' to the front of the remaining roadmap order, so pull requests that pass their checks land without
- why: The landing check waits in tools/slots.sh and tools/wait-quiet.sh behind workers' checks (CHECK_SLOTS=1, load 26 of 16), the train timed out at 02:05 and N1 PR #20, green on GitHub, could not land; T80 removes those scripts but sits after T66-T77
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan: landing never waits on workers. Move T80 'Machine-load scripts leave' to the front of the remaining roadmap order, so pull requests that pass their checks land without waiting behind the machine's other work.
- locks: none
- after: none

### N7 A broken main undoes itself
Result: Main's checks workflow carries the name the board watches, so a commit that turns main red is reverted within 30 minutes instead of stopping
- why: main red since 7f79369 (09:08) and never reverted: the board's revert watch looks for a workflow named check, this repo's is .github/workflows/ci.yml 'CI', so a red main waits on hand fixes
- done when: a test that fails without the change passes with it (`lineclear check`), and the pull request names that test file and what a user sees. The request in full: A broken main undoes itself. Main's checks workflow carries the name the board watches, so a commit that turns main red is reverted within 30 minutes instead of stopping all landing.
- locks: none
- after: none

### T80 Machine-load scripts leave
Result: The repo checks run on a clean clone with no agent slot, core count or quiet-machine script.
- why: audit move 4: about 500 lines of agent and machine tooling live in the product repo.
- done when: `git grep -n "slots.sh\|wait-quiet\|cores.sh"` is empty and `git ls-files tools/commit.sh tools/lib/cores.mjs tools/lib/owner.sh` lists nothing; `pnpm check` runs on a clean clone; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: check-tools
- after: none
- files: tools/slots.sh, tools/cores.sh, tools/wait-quiet.sh, tools/commit.sh, tools/lib/cores.mjs, tools/lib/owner.sh, tools/check.sh, e2e/run.mjs

### N8 Plan the work after the redesign
Result: A planning step reads docs/design/README.md and docs/audit/simplify.md, adds 8-12 steps for any design or audit move not yet on the roadmap
- why: 6 steps free for 10 slots: the rest wait on 20 PRs in review, and T69-T77 all hold the nav lock so the views run one at a time; no step plans past T97
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the work after the redesign. A planning step reads docs/design/README.md and docs/audit/simplify.md, adds 8-12 steps for any design or audit move not yet on the roadmap or on main, and splits view steps that share the nav lock so two views can be built at once; each step 50-150 lines a user sees or relies on, tests with the code.
- locks: none
- after: none

### N1 Main's tests pass again
Result: Every pull request's test job is green on what main already holds, so finished work can land; the six tests failing on main pass with no
- why: every PR's js job fails on the same 6 tests that main already fails (repo rule 34 wants '## Coming releases' in docs/ROADMAP.md; apps/server/test/extensions.test.ts; remote-access-recheck.test.ts; 3 in remote-access-safety.test.ts), so PR #12 and #13 cannot land
- done when: a test that fails without the change passes with it (`lineclear check`), and the pull request names that test file and what a user sees. The request in full: Main's tests pass again. Every pull request's test job is green on what main already holds, so finished work can land; the six tests failing on main pass with no test removed or skipped.
- locks: none
- after: none

### N9 Plan the next steps
Result: Plan the next steps for the household views' usability and design: walk each view in playwright-cli and add up to 6 small independent steps
- why: the owner wants every Fable 5.2 hour of today used on finished work (11 Nov)
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the next steps for the household views' usability and design: walk each view in playwright-cli and add up to 6 small independent steps that each fix one flaw a user meets; done when the roadmap has them
- locks: none
- after: none

### N3 WORKFLOW.md front matter
Result: The check line is quoted, so the board reads its state and starts steps.
- why: The board answers 400 on its state since 4edcd70: the check line holds a colon and a space unquoted.
- done when: a test that fails without the change passes with it (`lineclear check`), and the pull request names that test file and what a user sees. The request in full: WORKFLOW.md front matter is valid YAML again. The check line is quoted, so the board reads its state and starts steps.
- locks: none
- after: none

### N4 Finished work lands again
Result: Drop the quotes around WORKFLOW.md's check line and avoid ': ' inside it (match the roadmap rule test by a pattern without a colon)
- why: Every PR has been train-red since 08:21: WORKFLOW.md's check line is wrapped in single quotes (commit 9c20be4) and the board runs the text after 'check:' verbatim, so sh looks for a command named the whole line and exits 127. Reproduced locally; unquoted the same line passes in 13 s.
- done when: a test that fails without the change passes with it (`lineclear check`), and the pull request names that test file and what a user sees. The request in full: Finished work lands again. Drop the quotes around WORKFLOW.md's check line and avoid ': ' inside it (match the roadmap rule test by a pattern without a colon) so the line stays valid YAML and the board runs it as is; the waiting green PRs then merge.
- locks: none
- after: none

### N5 Main's checks pass again
Result: The three failures on main are fixed at their cause, main's CI is green and the waiting pull requests can land.
- why: main CI red since 7f79369 (T63): spend-readers.test.ts misses a reader; T81 broke tools/test/check.test.sh 'GIVE more at once'; T67 tokens test and tools tests leave temp folders (budget-, report-, rerun-, tokens-test-). Every open PR inherits these fails (#30 #49 #50), nothing can land
- done when: a test that fails without the change passes with it (`lineclear check`), and the pull request names that test file and what a user sees.
- locks: none
- after: none

### N15 Plan parallel steps
Result: Plan parallel steps for apps/server/ (API, imports, robustness): read the code, the design docs and best practice, then add up to 6 small
- why: the owner (11 Nov): more Fable 5.2 workers in parallel now, no bottlenecks; each step in its own area so they never conflict
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan parallel steps for apps/server/ (API, imports, robustness): read the code, the design docs and best practice, then add up to 6 small steps that each touch only that area, depend on no unmerged step unless needed, and finish in under an hour; done when the roadmap has them
- locks: none
- after: none

### N16 Plan parallel steps
Result: Plan parallel steps for packages/core/ (the household model and calculations): read the code, the design docs and best practice, then add up
- why: the owner (11 Nov): more Fable 5.2 workers in parallel now, no bottlenecks; each step in its own area so they never conflict
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan parallel steps for packages/core/ (the household model and calculations): read the code, the design docs and best practice, then add up to 6 small steps that each touch only that area, depend on no unmerged step unless needed, and finish in under an hour; done when the roadmap has them
- locks: none
- after: none

## The design: deletions

### T55 Säästövinkit is gone
Result: The Säästövinkit page and its findings engine are gone, and the menu has one entry fewer.
- why: design D1: a card grid that answers no question and repeats findings shown elsewhere.
- done when: `git ls-files apps/web/src/pages/Optimise.tsx apps/web/src/components/optimise packages/core/src/optimise` lists nothing; `pnpm strings` finds no "Säästövinkit"; the e2e nav spec sees four tabs; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: nav, optimise
- after: none
- files: apps/web/src/pages/Optimise.tsx, apps/web/src/components/optimise, packages/core/src/optimise, packages/core/test/optimise, apps/server/src/routes/optimise.ts, apps/server/src/db/finance/optimise.ts, apps/web/src/nav.ts, CLAUDE.md

### T56 Insights live in the queue
Result: Price rises and new recurring charges show once, as items in Tarkistettavat, and no longer on the overview.
- why: design D2: one finding was shown twice with two counts, and a problem belongs in the queue.
- done when: `git ls-files apps/web/src/components/home/Notable.tsx` lists nothing; a `services/review.ts` test gets one item per price rise and new recurring charge, none twice; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: review, insights
- after: T55
- files: apps/web/src/components/home/Notable.tsx, packages/core/src/analysis/insights, apps/server/src/services/review.ts, apps/server/test

### T57 The overview extras are gone
Result: The overview loses its right column, last-days table, direction, reliability and goals, keeping one answer and the pace line.
- why: design D3: those parts repeat the headline or compare with nothing.
- done when: `git ls-files apps/web/src/components/holdings apps/web/src/components/home/PaceTable.tsx apps/web/src/components/home/Direction.tsx apps/web/src/components/home/Reliability.tsx apps/web/src/components/home/SpendingGoal.tsx apps/web/src/components/home/CategoryGoals.tsx apps/web/src/pages/settings/SpendingGoalCard.tsx` lists nothing; `git grep -n categoryGoals packages/core/src` is empty; a 390 and 1440 px shot of the overview is in the PR; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: overview, holdings
- after: none
- files: apps/web/src/components/holdings, apps/web/src/components/home, apps/web/src/pages/Overview.tsx, apps/web/src/pages/settings/SpendingGoalCard.tsx, packages/core/src/reports, CLAUDE.md

### T58 Tapahtumat is the rows list
Result: Tapahtumat opens on its rows, with no whole-history tiles, weekly chart, avatars, logos, chip icons or amount bars.
- why: design D4: the tiles, the chart and four marks per row put the list below the first phone screen.
- done when: `git ls-files apps/web/src/components/MerchantAvatar.tsx` lists nothing and `git grep -n BankLogo apps/web/src/pages/transactions` is empty; a 390 px shot shows the first row on the first screen; `e2e/table-views.spec.ts` passes; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: transactions, table
- after: none
- files: apps/web/src/pages/Transactions.tsx, apps/web/src/pages/transactions, apps/web/src/components/MerchantAvatar.tsx, apps/web/src/components/BankLogo.tsx, apps/web/src/styles

### T59 Merchants and Rules fold in
Result: Merchants is a grouping of the rows list and the rules sit in Asetukset > Kotitalous; old addresses lead there.
- why: design D5: a merchant list is a grouping of rows, and rules are a setting.
- done when: `git ls-files apps/web/src/pages/Merchants.tsx apps/web/src/pages/Rules.tsx` lists nothing; group by merchant works in the rows toolbar; a `routes.ts` test sends the old addresses to their new places; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: transactions, settings, routes
- after: none
- files: apps/web/src/pages/Merchants.tsx, apps/web/src/pages/Rules.tsx, apps/web/src/pages/transactions, apps/web/src/pages/settings, apps/web/src/routes.ts, apps/web/src/nav.ts

### T60 The extra report sections go
Result: Fourteen report sections and fifteen core report ids that answer nothing or repeat another view are gone.
- why: design D6: they answer a question another view answers, or none.
- done when: the sections and core report ids listed in section 2 of `docs/design/README.md` are gone with their tests, and `pnpm findings --golden` wrote the golden files again; `git ls-files apps/web/src/charts/PriceLine.tsx` lists nothing; `packages/core/test/reports.test.ts` covers the nine ids that stay; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: reports, golden
- after: none
- files: apps/web/src/pages/reports/sections, packages/core/src/reports, packages/core/test/reports.test.ts, apps/web/src/charts/PriceLine.tsx

### T61 The view counter is gone
Result: Asetukset no longer lists views nobody opened, and the app stops counting view opens.
- why: design D7: the counter was the way to find what to delete, and the design now decides that.
- done when: `git ls-files apps/web/src/pages/settings/UnopenedViews.tsx apps/server/src/services/view-opens.ts apps/server/src/routes/view-opens.ts` lists nothing; the table stays and no applied migration is edited; `pnpm where view_opens` finds only the migration; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: settings, view-opens
- after: T60
- files: apps/web/src/pages/settings/UnopenedViews.tsx, apps/server/src/services/view-opens.ts, apps/server/src/routes/view-opens.ts, apps/web/src/pages/reports

### T62 A loan is a short form
Result: A loan is added with a short form; reading a loan from a picture or a PDF is gone with its two large dependencies.
- why: design D8: a loan is a few fields, and OCR and PDF reading add two large dependencies for one form.
- done when: `git ls-files packages/core/src/loan-intake apps/web/src/pages/settings/LoanIntake.tsx` lists nothing; `grep -nE "tesseract|pdfjs" apps/web/package.json` is empty; an e2e spec adds a loan by the form; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: loans, deps
- after: none
- files: packages/core/src/loan-intake, apps/web/src/pages/settings/LoanIntake.tsx, apps/web/package.json, pnpm-lock.yaml, e2e

## The design: data

### T63 The Nyt answer
Result: One core function gives the sum left before payday, the days left, the usual daily spend and the pace band.
- why: design A1: the Nyt view needs these four from one place.
- done when: a core test holds left = balance − bills before payday to the cent and the band equal to `analysis/usual.ts` to the same day; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: core-usual, dashboard
- after: none
- files: packages/core/src/analysis/usual.ts, packages/core/src/analysis, packages/core/test

### T64 Usual to the same day
Result: Each category's usual spend to the same day of the month is known, so a month can be read against it.
- why: design A2: Kuukausi compares each category with its usual to the same day.
- done when: a core test with 12 made-up months gives each category's usual to day 9 and the list sorted by the gap (`pnpm test packages/core`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: core-usual
- after: none
- files: packages/core/src/analysis/usual.ts, packages/core/test

### T65 The coming list
Result: Bills and income up to the payday after next form one list, each bill with its last amount.
- why: design A3: Tulossa needs one list grouped by payday period.
- done when: a core test merges `commitments.ts`, expected bills and income into one list grouped by payday period, its sums equal to the rows; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: commitments, expected-bills
- after: none
- files: packages/core/src/commitments.ts, packages/core/src, packages/core/test

### T66 One queue of what is wrong
Result: A balance mismatch, an ending consent, a missed bill and unsorted rows all reach the household through Tarkistettavat.
- why: design A4: each kind of problem has one door.
- done when: `services/review.ts` returns each kind beside today's items, the housing question kept; a server test makes one of each and gets one item each with its sum; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: review
- after: none
- files: apps/server/src/services/review.ts, apps/server/test

### T67 The visual tokens
Result: The look has four type sizes, five spacing steps, the neutrals, one accent and red only for problems.
- why: design A5: section 3 of the design is the visual system.
- done when: `apps/web/design/tokens.json` holds only those tokens, `pnpm tokens` writes them and `apps/web/test/contrast.test.ts` passes; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: tokens, styles
- after: none
- files: apps/web/design/tokens.json, apps/web/src/styles/tokens.css, apps/web/src/design/tokens.ts, apps/web/src/styles

### T68 Whole euros in an answer
Result: An answer or a forecast reads in whole euros while a row keeps its cents.
- why: design A6: an answer in cents is fake precision, a row in cents is exact.
- done when: `apps/web/src/format.ts` has the two forms; a test formats 4 424,13 as `4 424 €` in an answer and `4 424,13 €` in a row; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: format
- after: none
- files: apps/web/src/format.ts, apps/web/test

### U1 Everyday spend per day is real
Result: The front page's usual everyday spend per day agrees with the month's own figures, so the sum left on payday can be trusted.
- why: walked on 11 Nov with the demo household: the front page says "Arkimenoihisi kuluu viime kuukausien mukaan noin 1 € päivässä" while the same page shows 2 027 € spent in 11 days and Kuukausi shows 219,57 € of groceries alone; the "jää noin 3 000 €" on payday is built on that 1 €.
- done when: a core test on the demo household fails without the change and passes with it: the usual everyday spend per day is the usual month's everyday spending (the rows that are not bills before payday) divided by its days, and the sentence of `home.based` shows that sum; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: core-usual, dashboard
- after: none
- files: packages/core/src/analysis, packages/core/test

## The design: views

### T102 The four tabs
Result: The menu shows Nyt, Kuukausi, Tulossa and Tarkistettavat with its count, each opening the page that is there today.
- why: design section 1: T69 to T73 each edited `nav.ts` and held the nav lock, so the views were built one at a time; the menu changes once here and the views after it run side by side.
- done when: `apps/web/src/nav.ts` holds those four tabs in that order, the fourth with the count of open items, and the rows list keeps its address with no tab; `e2e/navigation.spec.ts` at 390 and 1440 px sees the four names and opens each; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: nav
- after: T55
- files: apps/web/src/nav.ts, apps/web/src/Shell.tsx, packages/core/src, e2e/navigation.spec.ts

### T69 Nyt
Result: The first view answers how much the household can still spend before payday, with the pace line under it.
- why: design V1, question 1.1.
- done when: the view of section 1.1 replaces Yhteenveto; an e2e spec at 390 and 1440 px reads the answer equal to the T63 sum and finds no other card; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: overview
- after: T63, T67, T68, T102
- files: apps/web/src/pages/Overview.tsx, apps/web/src/components/home, apps/web/src/styles, e2e

### T70 Kuukausi
Result: A tab shows where this month's money went against each category's usual to the same day.
- why: design V2, question 1.2.
- done when: the view of section 1.2 is a tab; an e2e spec opens a category and gets rows that add up to its sum; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: reports, nav
- after: T64, T67
- files: apps/web/src/pages, apps/web/src/pages/reports, apps/web/src/nav.ts, apps/web/src/styles, e2e

### T71 Tulossa
Result: Tulossa replaces Laskut with one list of what is coming up to the payday after next.
- why: design V3, question 1.3.
- done when: `git ls-files apps/web/src/components/bills/Timeline.tsx apps/web/src/components/bills/PriceSteps.tsx apps/web/src/components/bills/ContractPanel.tsx` lists nothing; an e2e spec adds a missing bill and sees it in the list and in the Nyt sum; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: bills
- after: T65, T67, T102
- files: apps/web/src/pages/Bills.tsx, apps/web/src/components/bills, e2e

### T72 Tarkistettavat answers each
Result: Every kind of item in Tarkistettavat can be answered there, and an answered item leaves the queue and the count.
- why: design V4, question 1.4.
- done when: an e2e spec answers each item kind of T66 in the tab and sees the count of T102 fall to zero; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: review
- after: T66, T67, T102
- files: apps/web/src/pages/Review.tsx, e2e

### T73 Lisää
Result: The Raportit menu is gone and Lisää lists Vuosi, Tilit ja saldot, Lainat, Verovuosi and, when shared, Yhteiset.
- why: design V5: the reports that earn a place, out of the tabs.
- done when: `git ls-files apps/web/src/pages/Reports.tsx` lists nothing; `docs/UI_STYLE.md` names the four tabs and Lisää; `e2e/table-views.spec.ts` passes; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: reports, nav
- after: T70, T102
- files: apps/web/src/pages/Reports.tsx, apps/web/src/pages/reports, apps/web/src/nav.ts, docs/UI_STYLE.md, e2e/table-views.spec.ts

### T74 Asetukset in three tabs
Result: Asetukset has three tabs, Pankit ja tilit, Kotitalous and Palvelin, in place of six.
- why: design V6: six tabs for a household that sets a bank and a payday.
- done when: the three tabs hold every setting of the six; `e2e/settings.spec.ts` passes at 390 and 1440 px; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: settings
- after: T59, T61
- files: apps/web/src/pages/settings, apps/web/src/nav.ts, e2e/settings.spec.ts

### T75 Remote access is one form
Result: Etäkäyttö is set up from one form in Asetukset > Palvelin instead of nine files of steps.
- why: design section 2: remote access spreads over nine files.
- done when: `git ls-files 'apps/web/src/pages/settings/RemoteAccess*'` lists one file; `e2e/settings.spec.ts` passes and the existing remote access server tests pass; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: settings, remote-access
- after: T74
- files: apps/web/src/pages/settings/RemoteAccess.tsx, apps/web/src/pages/settings, e2e/settings.spec.ts

### T76 First run and empty states
Result: An install with no bank, or under three months of rows, shows each view's one line and the way to Pankit ja tilit.
- why: design V7, section 4.
- done when: an e2e spec on an empty install sees each view's one line and the button to Pankit ja tilit, and the wizard has two steps; on two months of rows Kuukausi shows its sums with "tavallinen tarvitsee 3 kuukautta" in place of the usual; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: wizard, overview
- after: T69, T70, T71, T72
- files: apps/web/src/pages/Wizard.tsx, apps/web/src/pages, e2e

### T77 Every view holds up
Result: Each view loads, fails, takes long names and five years of rows and fits a 390 px phone with no sideways scroll.
- why: design V8, the rest of section 4.
- done when: an e2e spec runs each view on a made-up household of five years with a 60-character merchant at 390 px: no sideways scroll, no cut sum, the first answer under 1 s on the seeded data, and a failed fetch kept as a queue item; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: e2e
- after: T76
- files: e2e, apps/web/src/pages, apps/web/src/styles

## The design: after the views

### T105 Nyt's sum opens its parts
Result: On Nyt the sum opens the balance and the bills it is made of, and the pace line opens this month's rows.
- why: design 1.1, the action: T69 builds the answer and its comparison, and a figure that opens nothing cannot be checked.
- done when: an e2e spec clicks the sum and reads a balance and bills that give the sum to the cent, then clicks the pace line and lands on the rows list with this month's filter in the address; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: overview
- after: T69
- files: apps/web/src/pages/Overview.tsx, apps/web/src/components/home, e2e

### T106 Kuukausi steps back a month
Result: Kuukausi has a month picker, so an earlier month reads against its usual the same way as this one.
- why: design 1.2, the action: the view of T70 shows the running month only.
- done when: `e2e/month.spec.ts` steps back one month, reads that whole month's sums against their usual with the month in the address, and steps forward to today's answer; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: reports
- after: none
- files: apps/web/src/pages/reports/Month.tsx, apps/web/src/styles/report-month.css, e2e/month.spec.ts

### T107 A bill row opens its history
Result: In Tulossa a row opens the bill's earlier amounts and dates, so a changed amount can be checked.
- why: design 1.3, the action: T71 builds the list, and a row in it opens nothing.
- done when: an e2e spec opens a row of Tulossa and reads the bill's earlier amounts, their sum equal to the rows behind them; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: bills
- after: T71
- files: apps/web/src/pages/Bills.tsx, apps/web/src/components/bills, e2e

### T113 A wrong bill leaves the list
Result: A bill marked not recurring in Tulossa leaves the coming list and the Nyt sum.
- why: design 1.3, the action: T71 adds a missing bill, and nothing removes a wrong one; no such mark exists in the server.
- done when: a server test marks a bill not recurring and gets the coming list and the Nyt sum without it; an e2e spec marks a row away and no longer sees it; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: bills, expected-bills
- after: T107
- files: apps/web/src/components/bills, apps/server/src/routes, apps/server/src/services, apps/server/test, e2e

### T108 Vuosi has a year picker
Result: Vuosi shows the last 12 months against the 12 before, and a year picker opens an earlier year.
- why: design section 4, five years of data: core's year report follows the range it is given, and the view has no way to pick a year.
- done when: a core test on five made-up years gives each picked year against the year before it; an e2e spec picks an earlier year and reads its sums; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: reports
- after: T73
- files: apps/web/src/pages/reports/sections/YearOverYear.tsx, packages/core/src/reports, packages/core/test, e2e

### T109 The rows list pages by 100
Result: The rows list shows 100 rows at a time with a way to the next, so five years of rows open as fast as a month.
- why: design section 4, five years of data: the server pages by `limit` and `offset`, and the web asks for up to 5 000 rows at once (`MAX_LIST_ROWS`).
- done when: `git grep -n "limit: MAX_LIST_ROWS" apps/web/src/pages` is empty; `e2e/table-views.spec.ts` on 250 made-up rows sees 100, reaches the last row by the next link with the page in the address, and each day's sum equals all of that day's rows; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: transactions, table
- after: T58
- files: apps/web/src/pages/Transactions.tsx, apps/web/src/pages/TransactionRows.tsx, e2e/table-views.spec.ts

### T110 Short dates in the year now
Result: A date in the running year reads `9.11.` and a date in another year reads `9.11.2025`.
- why: design section 3, Finnish formats: `date()` in `format.ts` writes the year on every date.
- done when: a test of `apps/web/src/format.ts` formats a day of the running year without the year and a day of another year with it, in both languages, and periods keep both years when they differ; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: format
- after: T68
- files: apps/web/src/format.ts, packages/core/src, apps/web/test

### T111 First fetch counts its rows
Result: During the first fetch the answer slot says how many rows have come so far, so a long fetch is seen to move.
- why: design section 4, first fetch: the line says only that rows are being fetched, and the sync gives its count only when it ends.
- done when: a server test reads the rows fetched so far from a running sync; an e2e spec with a running first fetch reads "Haetaan tapahtumia" with that count; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: overview, sync
- after: T69
- files: apps/web/src/first-fetch.ts, apps/web/src/components/home/FirstFetch.tsx, apps/server/src/connectors/sync.ts, apps/server/src/services, apps/server/test, packages/core/src, e2e

### T112 A fault keeps the last answer
Result: When a view cannot load again, its last answer stays with its time and one line of what failed and what to do.
- why: design section 4, error: the last answer already stays on a failed reload, but a view shows the fault only when it has no answer, so an old answer reads as fresh; T77 proves only the queue item.
- done when: a web test fails the second load of a view and still reads the first answer, its time and the one line; an e2e spec does the same on Nyt at 390 px; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: api-state
- after: none
- files: apps/web/src/hooks.ts, apps/web/src/api.ts, apps/web/src/components, apps/web/test, e2e

## The audit

### T103 No extension pages in the web
Result: The web app has no extension pages, row parts or flag list, and every menu entry is a page that exists.
- why: audit move 1, the web half: the extension list is empty and each hook loops over nothing.
- done when: `git ls-files apps/web/src/extensions.ts apps/web/src/ExtensionPage.tsx apps/web/src/views/ExtensionView.tsx apps/web/src/components/ExtensionRowParts.tsx` lists nothing; `git grep -n "WEB_EXTENSIONS\|extensionPages" apps/web` is empty; `e2e/navigation.spec.ts` passes; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: nav, extensions
- after: none
- files: apps/web/src/extensions.ts, apps/web/src/ExtensionPage.tsx, apps/web/src/views/ExtensionView.tsx, apps/web/src/components/ExtensionRowParts.tsx, apps/web/src/nav.ts, apps/web/src/routes.ts, apps/web/src/pages/settings, apps/web/test

### T104 No flag frame in core, server
Result: Core and the server carry no feature flags or extension hooks, and an install behaves as before.
- why: audit move 1, the rest: `FeatureId` is `never` and the server's `EXTENSIONS` is an empty list that about 15 files read.
- done when: `git grep -n "EXTENSIONS\|FeatureId" apps packages` is empty; `git ls-files packages/core/src/features.ts apps/server/src/extensions.ts apps/server/test/extensions.test.ts apps/server/test/extension-demo.test.ts apps/server/test/features.test.ts` lists nothing; the service token and instance tests pass (`pnpm test service-tokens instance`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: extensions
- after: T103
- files: packages/core/src/features.ts, apps/server/src/extensions.ts, apps/server/src, apps/server/test

### T78 No module scaffold
Result: The generator for feature modules and its repo rules are gone, so a contributor meets one way to add code.
- why: audit move 2: about 570 lines of scaffold that no module uses.
- done when: `git ls-files packages/core/src/features tools/gen` lists nothing; `pnpm gen` is gone; `repo-rules.test.ts` lists no rule 29 to 33; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: repo-rules
- after: none
- files: packages/core/src/features, tools/gen, tools/repo-rules/modules.ts, tools/repo-rules, .gitattributes, package.json, docs/ARCHITECTURE.md

### T79 One golden file per household
Result: A household whose own and household answers agree keeps one golden file, and the test fails when they differ.
- why: audit move 3: four golden files repeat 14 305 lines.
- done when: `git ls-files 'apps/server/test/**/household-*.txt'` lists nothing and `apps/server/test/answers-golden.test.ts` asserts the two scopes equal; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: golden
- after: none
- files: apps/server/test/answers-golden.test.ts, apps/server/test

### T81 Changed checks by vitest
Result: `pnpm check --changed` runs vitest's own changed mode and the touched shell suites, with no scope finder of its own.
- why: audit move 5: about 2 100 lines in `tools/check/scope.mjs` and its tests redo what vitest does.
- done when: `git ls-files tools/check/scope.mjs` lists nothing; `pnpm check --changed` runs only `vitest --changed` and the shell suites of the touched folders; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: check-tools
- after: none
- files: tools/check, tools/check.sh, package.json

### T82 Knip finds unused exports
Result: Knip in `pnpm check` reports unused exports in place of the repo's own unread-exports rule.
- why: audit move 6: about 400 lines of a rule that a standard tool covers.
- done when: `git ls-files tools/repo-rules/exports.ts tools/repo-rules/exports-rule.ts tools/repo-rules/unread-exports.txt` lists nothing; `knip.json` exists and `pnpm knip` is in `pnpm check` and reports 0 with today's unused exports listed as ignored; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: repo-rules, deps
- after: none
- files: tools/repo-rules/exports.ts, tools/repo-rules/exports-rule.ts, tools/repo-rules/unread-exports.txt, knip.json, package.json, pnpm-lock.yaml

### T83 Unused exports of core, server
Result: Core and the server export only what another file reads.
- why: audit move 7: knip lists about 350 unused exports and types across the repo.
- done when: `pnpm knip` reports no unused export in `packages/core` and `apps/server` with no ignore line for them; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: exports-core
- after: T82
- files: packages/core/src, apps/server/src, knip.json

### T84 Unused exports of the web
Result: The web app exports only what another file reads.
- why: audit move 7, the web half.
- done when: `pnpm knip` reports no unused export in `apps/web` with no ignore line for it; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: exports-web
- after: T82
- files: apps/web/src, knip.json

### T85 Dead web files go
Result: Four web files and a stylesheet that nothing imports are gone.
- why: audit move 8: BasisSheet with basis.css, ui/Tabs and ui/Chip are imported by nothing (PriceLine goes in T60).
- done when: `git ls-files apps/web/src/components/BasisSheet.tsx apps/web/src/styles/basis.css apps/web/src/components/ui/Tabs.tsx apps/web/src/components/ui/Chip.tsx` lists nothing and `pnpm --filter @banking/web typecheck` passes; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: none
- after: none
- files: apps/web/src/components/BasisSheet.tsx, apps/web/src/styles/basis.css, apps/web/src/components/ui/Tabs.tsx, apps/web/src/components/ui/Chip.tsx

### T86 Data import, one store each
Result: The data import reads each store in its own function, so a fault in one store is found in one place.
- why: audit move 13: `data-import.ts` holds one function of complexity 231.
- done when: biome reports every function of `apps/server/src/services/data-import.ts` under 25 and the data-import tests pass (`pnpm test apps/server/test/data-import`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: data-import
- after: none
- files: apps/server/src/services/data-import.ts

### T87 Returns and sync split
Result: The returns matcher and the bank sync read as short functions with the same results.
- why: audit move 14: `returns.ts:151` and `sync.ts:185` are among the most complex functions.
- done when: biome lists no function of `packages/core/src/returns.ts` or `apps/server/src/connectors/sync.ts` over 40, and their tests pass unchanged (`pnpm test returns sync`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: returns, sync
- after: none
- files: packages/core/src/returns.ts, apps/server/src/connectors/sync.ts

### T88 Ahead moves and trace split
Result: The ahead moves and the money trace rows read as short functions with the same results.
- why: audit move 14: `ahead-moves.ts:128` and `money-trace-rows.ts:152` are among the most complex functions.
- done when: biome lists no function of `packages/core/src/analysis/ahead-moves.ts` or `packages/core/src/money-trace-rows.ts` over 40, and their tests pass unchanged (`pnpm test ahead-moves money-trace`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: ahead-moves, money-trace
- after: none
- files: packages/core/src/analysis/ahead-moves.ts, packages/core/src/money-trace-rows.ts

### T89 Two shot examples stay
Result: The shot examples folder keeps only the two files the docs name.
- why: audit move 15: the other examples are read by nobody.
- done when: `git grep -n shots-examples` names only `answers.mjs` and `steps.mjs`, and `git ls-files tools/shots-examples` lists those two; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: none
- after: none
- files: tools/shots-examples

### T90 Architecture says what is
Result: docs/ARCHITECTURE.md describes the app that exists, with no target section, scaffold paragraph or one-bank wording.
- why: audit move 20: the architecture doc still describes plans and one bank.
- done when: `grep -n "not built yet\|Nordea transactions" docs/ARCHITECTURE.md` is empty; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: arch-doc
- after: T78
- files: docs/ARCHITECTURE.md

### T91 Changelog of ten versions
Result: CHANGELOG.md keeps the last ten versions and points to the git tags for the rest.
- why: audit move 21: about 1 500 lines of old entries nobody reads in the file.
- done when: `grep -c '^## ' CHANGELOG.md` gives 10 and the file ends with the link to the tags; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: changelog
- after: none
- files: CHANGELOG.md

### T92 One number per decision
Result: Each decision record has its own number and the security audit sits with the other audits.
- why: audit move 22: two ADRs share 0023 and an audit sits outside `docs/audit/`.
- done when: `ls docs/adr | cut -c1-4 | uniq -d` is empty, `git ls-files docs/audit/security-audit-2026-10.md` lists it and `git grep -n "adr/0023"` points to one file; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: adr
- after: none
- files: docs/adr, docs/security-audit-2026-10.md, docs/audit

### T93 Twin blocks merged
Result: The filter chips, column picker, sign-in key list and calendar styles each exist once.
- why: audit move 23: four pairs of copied blocks in the web app.
- done when: jscpd at 20 lines reports no clone in `apps/web/src` (`pnpm dlx jscpd --min-lines 20 apps/web/src`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: transactions, settings
- after: none
- files: apps/web/src/pages/transactions/FilterChips.tsx, apps/web/src/pages/settings/BankFile.tsx, apps/web/src/pages/settings/CardFile.tsx, apps/web/src/pages/settings, apps/web/src/styles

### T94 Old addresses retire
Result: Old bookmarks that a release notice named are no longer rewritten, and only current addresses remain.
- why: audit move 24: legacy rewrites in `routes.ts` grow with every renamed page.
- done when: a released CHANGELOG entry named the old addresses one release earlier; `routes.test.ts` keeps only current addresses; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: routes
- after: T59, T73
- files: apps/web/src/routes.ts, apps/web/test

### T95 Plans live in Lineclear
Result: ADR 0001 says that plans and audits live in Lineclear and in `docs/`, as they do.
- why: the record still names an older home for plans.
- done when: `sed -n 5p docs/adr/0001-record-decisions.md` names Lineclear; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: adr
- after: none
- files: docs/adr/0001-record-decisions.md

### T98 Web extension frame goes
Result: The web app has no extension page, view or row parts, so its menu, routes and rows read no empty list.
- why: audit move 1, the web half: `extensions.ts`, `ExtensionPage.tsx`, `views/ExtensionView.tsx` and `components/ExtensionRowParts.tsx` serve a list that is always empty, and seven other web files read them.
- done when: `git ls-files apps/web/src | grep -i extension` lists nothing and `git grep -il extension apps/web/src` names no file; the web tests pass with no test of another feature removed; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: nav, routes
- after: none
- files: apps/web/src/extensions.ts, apps/web/src/ExtensionPage.tsx, apps/web/src/views/ExtensionView.tsx, apps/web/src/components/ExtensionRowParts.tsx, apps/web/src, apps/web/test

### T99 Server extension frame goes
Result: The server and core carry no extension list or feature flag, so no hook loops over nothing.
- why: audit move 1, the server and core half: `EXTENSIONS` is `[]` and `FeatureId` is `never`, yet about 20 server files import them and 260 lines of tests guard them.
- done when: `git grep -n "EXTENSIONS\|FeatureId" -- apps packages` is empty and `git ls-files apps/server/src/extensions.ts packages/core/src/features.ts apps/server/test/extensions.test.ts apps/server/test/extension-demo.test.ts apps/server/test/features.test.ts` lists nothing; a data folder that holds flag overrides from an older version still starts (a test); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: extensions-server
- after: T98
- files: apps/server/src/extensions.ts, packages/core/src/features.ts, apps/server/src, apps/server/test

## Open from before

### T96 Promote reads every file
Result: The Promote workflow passes on main, so v1.0.0 can be promoted to Latest.
- why: the sparse checkout in `.github/workflows/promote.yml` lacks `tools/lib/project.sh` and `project.json`, which `tools/ci/promote-release.sh` sources, so every Promote run since 9 November fails at line 21.
- done when: the sparse checkout lists every file `tools/ci/promote-release.sh` reads, and `bash -n tools/ci/promote-release.sh` plus a local run of the script from a sparse checkout with the same paths reach past line 21.
- locks: none
- after: none
- files: .github/workflows/promote.yml

### T97 Main CI shell job green
Result: The shell job of ci.yml passes on main again, with no check removed or skipped, so the release gate can trust main.
- why: the shell job is red on main since 1 November (build-ca RUN_TESTS and four repo key checks), and `ci-ok` fails with it.
- done when: the commands of the shell job in `.github/workflows/ci.yml` pass locally on the branch, and the PR's shell job passes; no check is weakened.
- locks: none
- after: none
- files: .github/workflows/ci.yml, tools/ci

### T54 English without the last Finnish
Result: In English the app shows no Finnish: the unknown merchant and the server's error messages read in English.
- why: In English the placeholder merchant "Tuntematon" and the server's error messages ("Virheellinen sääntö.", "Tuntematon kategoria.", the pattern problems of a rule) are Finnish.
- done when:
  - Each is in the catalogue in both languages and a scan with a failing rule and the unknown merchant row finds no Finnish; `pnpm strings` runs clean; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: texts, merchant-names, rules-route
- after: none
- files: packages/core/src/english, apps/server/src/routes

## Later

- T6 Stack review: repeat the interface stack comparison with new measurements (charts and components by 25 April 2027,
  the runtime by 25 October 2027), and add a dated row to the decision record with sizes measured on the same build.

## Not planned

- Payments from the app, credit scoring, investment advice, telemetry.
- Asking the home router for addresses.
- Free-text questions to the app.
- A cloud language model.
- Interest rate data bundled in the app.
- Opening data automatically after a period of inactivity.
- A native mobile app.
