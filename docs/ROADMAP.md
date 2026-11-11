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

### N17 Plan parallel steps for e2e/
Result: Plan parallel steps for e2e/ and the visual shots (coverage of every page and flow): read the code, the design docs and best practice, then
- why: the owner (11 Nov): more Fable 5.2 workers in parallel now, no bottlenecks; each step in its own area so they never conflict
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan parallel steps for e2e/ and the visual shots (coverage of every page and flow): read the code, the design docs and best practice, then add up to 6 small steps that each touch only that area, depend on no unmerged step unless needed, and finish in under an hour; done when the roadmap has them
- locks: none
- after: none

### N19 Plan parallel steps for docs/
Result: Plan parallel steps for docs/ and the in-app help (what a household user needs): read the code, the design docs and best practice, then add
- why: the owner (11 Nov): more Fable 5.2 workers in parallel now, no bottlenecks; each step in its own area so they never conflict
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan parallel steps for docs/ and the in-app help (what a household user needs): read the code, the design docs and best practice, then add up to 6 small steps that each touch only that area, depend on no unmerged step unless needed, and finish in under an hour; done when the roadmap has them
- locks: none
- after: none

### N20 Plan two hours of parallel work
Result: A planning step reads docs/design/README.md, docs/audit/simplify.md and the code, then adds 12 to 16 steps the roadmap and main do not hold
- why: 13:24Z on 11 Nov: 6 of 14 slots are free and no step is: all 36 open steps run, wait in review, or wait behind the four tabs (T102, then T69, T75, T76, T77, T105, T111) and Knip (T83, T84); the plan steps N14 to N19 have all landed and gave only 3 steps for packages/core
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan two hours of parallel work. A planning step reads docs/design/README.md, docs/audit/simplify.md and the code, then adds 12 to 16 steps the roadmap and main do not hold yet, spread over packages/core (numbers, imports, budgets), apps/server and web pages that the four tabs lock does not hold, so every free worker has a step: each step is 50 to 150 lines of product code a user sees or relies on, in one or two files of its own area with its own lock, its tests in the same step, no step that is only tests, fixtures or CI, and after none unless truly needed.
- locks: none
- after: none

### N21 Main's full check passes again
Result: A full check run on main is green: the four server names are no longer exported unread, and the text scan's floor follows the smaller app.
- why: Main's full check fails on two repo rules that light-scope runs hide (run 43029509215 on d36e4c3): rule 24a names KEEP_ALIVE_TIMEOUT_MS, HEADERS_TIMEOUT_MS (apps/server/src/entry/server-timeouts.ts:12,18) and shutdown, StopEvent (apps/server/src/entry/shutdown.ts:25,47) as exports no source file reads; rule 10 (tools/repo-rules/text-rules.ts:132) wants over 300 UI texts and finds 295 after the design deletions, which will delete more. Every full-scope PR check (D2 #131) and main run goes red on them.
- done when: a test that fails without the change passes with it (`lineclear check`), and the pull request names that test file and what a user sees.
- locks: none
- after: none

### C1 Pay day moved past month end
Result: An income paid on the next banking day after a closed last day of the month is expected on that day, also when it falls in the next month.
- why: `payDayOf` and `nextPayDate` in `pay-day.ts` look for a pay date only in its own month and the month before it, so a day 31 moved forward to the 1st or 2nd is missed: nine such pay dates read as day 31 moved back with 6 hits of 9, and after 1 June 2025 the next pay date reads 30 June, not 2 June.
- done when: a new `packages/core/test/pay-day.test.ts` that fails without the change gets `{ day: 31, rule: "next", hits: 9, of: 9 }` from `payDayOf` for 2025-03-31, 04-30, 06-02, 06-30, 07-31, 09-01, 09-30, 10-31 and 12-01, gets 2025-06-02 from `nextPayDate("2025-06-01", { day: 31, rule: "next" })`, and still gets 2025-10-31 for a day 1 moved back after 2025-10-30 (`bun test packages/core/test/pay-day.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: pay-day
- after: none
- files: packages/core/src/pay-day.ts, packages/core/test/pay-day.test.ts

### N23 Plan the server and budget steps
Result: Ten to fourteen new steps wait for free workers, each a fault or gap in the server or the budget code that a person using the app would
- why: No free step for 13 free slots: the last plan gave 3 steps, all in the import code of packages/core, and its handoff (PR 142) says apps/server beyond nine named files and the budgets code (packages/core/src/thresholds.ts, analysis/) were never read
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the server and budget steps. Ten to fourteen new steps wait for free workers, each a fault or gap in the server or the budget code that a person using the app would meet, each proven on main, 50 to 150 lines with its tests, each with its own lock and none waiting on the four tabs.
- locks: none
- after: none

### N22 Shots of every page, again. pnpm
Result: Shots of every page, again. pnpm shots --all again takes a picture of every page, each Raportit question and each Asetukset target
- why: E4 (32fce71) turned main red and PR #139 reverts it: tools/shots-a.test.ts expected 13 routes for --all and got 16, because pages merged beside it (T74, T62, E2) changed the route list the test wrote out by hand. After the revert the option is gone, and a reverted step is not reopened.
- done when: a test that fails without the change passes with it (`lineclear check`), and the pull request names that test file and what a user sees. The request in full: Shots of every page, again. pnpm shots --all again takes a picture of every page, each Raportit question and each Asetukset target, and its test reads the page list from the code so a new page does not break it.
- locks: none
- after: none

### N25 Plan the login and install steps
Result: The plan gains 10 to 14 steps for signing in, passkeys, sessions, the command line tool and the install, so free workers have work.
- why: At 14:05Z no step is free for 14 slots and steps finish in 1 to 2 minutes. No plan step has read apps/server/src/auth, apps/server/src/security, the cli*.ts files, deploy/ or relay/.
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the login and install steps. The plan gains 10 to 14 steps for signing in, passkeys, sessions, the command line tool and the install, so free workers have work. Each step: a fault or gap reproduced on main with its file and line, 50 to 150 lines of product code a user sees or relies on, its tests in the same step, its own lock named by no other step, not behind T69 or the nav lock, and not a result that main or an open step (P1-P10, S6-S11, C5, T56, T76, T77, T82-T84, T105, T111) already holds. No step that is only tests, and no done-when that says under N lines.
- locks: none
- after: none

### N24 Plan the web page steps
Result: Ten to fourteen new steps wait for free workers, each one thing docs/design/README.md, docs/audit/simplify.md or docs/UI_STYLE.md asks
- why: No free step for 13 free slots: the last plan's handoff (PR 142) says no web page was read and docs/design/README.md and docs/audit/simplify.md only by their headings, so nothing is planned for apps/web outside the nav lock
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the web page steps. Ten to fourteen new steps wait for free workers, each one thing docs/design/README.md, docs/audit/simplify.md or docs/UI_STYLE.md asks of a web page that main lacks, 50 to 150 lines with its tests, each with its own lock outside the navigation and none waiting on the four tabs.
- locks: none
- after: none

### N26 Plan the audit's open moves
Result: The plan gains 10 to 14 steps, one for each move of the audit that main still lacks, so the app loses parts nobody uses.
- why: At 14:05Z no step is free for 14 slots. docs/audit/simplify.md section 7 ranks 25 moves and sections 2 and 3 name over-built parts and features; nobody has checked which of them main still lacks.
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the audit's open moves. The plan gains 10 to 14 steps, one for each move of the audit that main still lacks, so the app loses parts nobody uses. Each step: a fault or gap reproduced on main with its file and line, 50 to 150 lines of product code a user sees or relies on, its tests in the same step, its own lock named by no other step, not behind T69 or the nav lock, and not a result that main or an open step (P1-P10, S6-S11, C5, T56, T76, T77, T82-T84, T105, T111) already holds. No step that is only tests, and no done-when that says under N lines.
- locks: none
- after: none

### N28 Remote access and high contrast
Result: The remote access settings and the high contrast look work as before, and a change to the checks lands again instead of failing on these two
- why: Main fails its full check today, hidden by light-scope runs: rule 9 on apps/web/src/pages/settings/RemoteAccess.tsx (714 lines since T75, budget 500) and rule 40 on apps/web/src/styles/forced-colors.css lines 10-13 (2px literals since W1, 0 allowed). Every PR that gets the full check fails on it (T82 #43, run 43036269209).
- done when: a test that fails without the change passes with it (`lineclear check`), and the pull request names that test file and what a user sees. The request in full: Remote access and high contrast pass. The remote access settings and the high contrast look work as before, and a change to the checks lands again instead of failing on these two files.
- locks: none
- after: none

### N29 Plan the money flow steps
Result: The plan gains 10 to 14 steps where the sums, transfers, refunds and recurring payments the app shows differ from what the money flows
- why: At 14:26Z no step is free for 14 slots and no plan step runs; 16 steps left, all taken or chained. docs/MONEY_FLOWS.md (900 lines) was never a plan source: packages/core/src/analysis and behaviour were not read against it.
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the money flow steps. The plan gains 10 to 14 steps where the sums, transfers, refunds and recurring payments the app shows differ from what the money flows document promises. Each step: a fault or gap reproduced on main with its file and line, 50 to 150 lines of product code a user sees or relies on, its tests in the same step, its own lock named by no other step and no step behind another unless it must be, and not a result that main or an open step (A1, A2, D6, L1-L4, T76, T77, T82-T84, T105, T111, Y2, Y3) already holds. No step that is only tests, and no done-when that says under N lines. When fewer real steps are found than asked, add those found and list the files read.
- locks: none
- after: none

### C2 No repeated common password
Result: A password that is one word said twice with a digit at the end, such as passwordpassword1, is refused like the word said twice alone.
- why: `checkPassword` tests for a repeated block on the whole password only, so one digit or sign after the repeats lets it through: passwordpassword1 is allowed at level 3 of 4.
- done when: a test in `packages/core/test/password-strength.test.ts` that fails without the change gets the issue `pw.repeated` for passwordpassword1 and kissakissakissa12!, while a password of four different words with a digit at the end is still allowed and the file's other tests pass unchanged (`bun test packages/core/test/password-strength.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: password-strength
- after: none
- files: packages/core/src/password-strength.ts, packages/core/test/password-strength.test.ts

### N30 Plan the export and report steps
Result: The plan gains 10 to 14 steps where an exported file or a report lacks or misstates what the data export document promises, or fails
- why: At 14:26Z no step is free for 14 slots and no plan step runs. docs/DATA_EXPORT.md (476 lines) was never a plan source: the export and report code in packages/core and apps/server/src/routes and services was not read against it.
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the export and report steps. The plan gains 10 to 14 steps where an exported file or a report lacks or misstates what the data export document promises, or fails on empty, large or odd data. Each step: a fault or gap reproduced on main with its file and line, 50 to 150 lines of product code a user sees or relies on, its tests in the same step, its own lock named by no other step and no step behind another unless it must be, and not a result that main or an open step (A1, A2, D6, L1-L4, T76, T77, T82-T84, T105, T111, Y2, Y3) already holds. No step that is only tests, and no done-when that says under N lines. When fewer real steps are found than asked, add those found and list the files read.
- locks: none
- after: none

### N27 Plan the keyboard and phone
Result: The plan gains 10 to 14 steps for web charts, tables, search and offline use with a keyboard, a narrow screen or a screen reader.
- why: At 14:05Z no step is free for 14 slots. N24 read the pages against the design only: apps/web/src/charts, components, search.ts, offline.ts and table-state.ts were not tried by keyboard, on a narrow screen, offline or with a screen reader.
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the keyboard and phone steps. The plan gains 10 to 14 steps for web charts, tables, search and offline use with a keyboard, a narrow screen or a screen reader. Each step: a fault or gap reproduced on main with its file and line, 50 to 150 lines of product code a user sees or relies on, its tests in the same step, its own lock named by no other step, not behind T69 or the nav lock, and not a result that main or an open step (P1-P10, S6-S11, C5, T56, T76, T77, T82-T84, T105, T111) already holds. No step that is only tests, and no done-when that says under N lines.
- locks: none
- after: none

### N31 Plan the safety and storage
Result: The plan gains 8 to 12 steps where the server's handling of sessions, limits, headers, backups and the database falls short of the security
- why: At 14:26Z no step is free for 14 slots and no plan step runs. docs/SECURITY.md and docs/security-audit-2026-10.md (2 mentions in the roadmap) were not read against apps/server/src/security, platform, db and static-files.ts.
- done when: the pull request adds the planned steps to docs/ROADMAP.md and `lineclear roadmap check .` passes; when fewer real steps are found than asked, it adds those it found and lists what it checked. The request in full: Plan the safety and storage steps. The plan gains 8 to 12 steps where the server's handling of sessions, limits, headers, backups and the database falls short of the security document and the October audit. Each step: a fault or gap reproduced on main with its file and line, 50 to 150 lines of product code a user sees or relies on, its tests in the same step, its own lock named by no other step and no step behind another unless it must be, and not a result that main or an open step (A1, A2, D6, L1-L4, T76, T77, T82-T84, T105, T111, Y2, Y3) already holds. No step that is only tests, and no done-when that says under N lines. When fewer real steps are found than asked, add those found and list the files read.
- locks: none
- after: none

### C3 A small MobilePay share fits
Result: A MobilePay payment of 2 euros no longer lowers a 30 euro purchase as a friend's share of it.
- why: `isShareOf` in `mobilepay.ts` lets a share be a euro off whatever its size, so 2,00 passes as a tenth of 30,00 and one cent as a tenth of 10,00: small money in is taken off the nearest purchase's category and never counted as income.
- done when: a test in `packages/core/test/mobilepay.test.ts` that fails without the change gives no match to 2,00 against a purchase of 30,00 and to 0,01 against 10,00, a match to 3,00 and 2,90 against 30,00, the share is held to one euro and to a fifth of the purchase's exact share, whichever is less, and the file's other tests pass unchanged (`bun test packages/core/test/mobilepay.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: mobilepay
- after: none
- files: packages/core/src/mobilepay.ts, packages/core/test/mobilepay.test.ts

### C4 A bank row without text reads
Result: A bank statement file is read also when one of its rows has only a reference number or the bank's own code for a text.
- why: `entryText` in `bank-camt.ts` reads the other party's name, the free message (`RmtInf/Ustrd`) and `AddtlNtryInf` only. An entry that carries just a structured reference (`RmtInf/Strd/CdtrRefInf/Ref`) or just the bank's code (`BkTxCd/Prtry/Cd`, as a service fee does) has no text, and `readBankCamt` then answers `{ error: "unreadable" }` for the whole file: one such row keeps every row of the statement out (seen on 11 Nov with a one entry statement of each kind).
- done when: new cases of `packages/core/test/bank-camt.test.ts` that fail without the change read a statement whose entry has only `RmtInf/Strd/CdtrRefInf/Ref` 1234561 as a row whose text holds 1234561, and one whose entry has only `BkTxCd/Prtry/Cd` as a row with that code's text, each after the name, the message and `AddtlNtryInf` in that order; an entry with none of the five is still `unreadable`, the closing balance is still checked and the file's other tests pass unchanged (`bun test packages/core/test/bank-camt.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: bank-camt
- after: none
- files: packages/core/src/bank-camt.ts, packages/core/test/bank-camt.test.ts

### C5 Statement file names its period
Result: After a bank statement file is read, the page names the period the bank wrote in it, not the days of its first and last row.
- why: `readBankCamt` in `bank-camt.ts` never reads the statement's `FrToDt`: `periodFrom` and `periodTo` are the earliest and latest row day, so a statement of 1 to 30 September whose only row is of the 5th is shown by `BankFile.tsx` (`card_file.found`) as 5.9. to 5.9. and the household cannot tell whether the quiet days are covered.
- done when: new cases of `packages/core/test/bank-camt.test.ts` that fail without the change get `periodFrom` 2026-09-01 and `periodTo` 2026-09-30 from a statement with `FrToDt` of `FrDtTm` 2026-09-01T00:00:00 and `ToDtTm` 2026-09-30T23:59:59 and one row on the 5th, the earliest start and latest end over several statements of one account, and the row days as now when `FrToDt` is absent, is no real day, ends before it starts or leaves a row outside it; the file's other tests pass unchanged (`bun test packages/core/test/bank-camt.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: bank-camt
- after: none
- files: packages/core/src/bank-camt.ts, packages/core/test/bank-camt.test.ts

### C6 Quoted cells in a card file
Result: A card statement row whose shop name is written in quotes is read, with the name shown without the quotes.
- why: `readOp` in `card-file.ts` splits a line at every semicolon and keeps the cells as they are. A quoted shop name with a semicolon in it (`"K-MARKET; HELSINKI"`) makes five cells, so the row lands in `unread` and its purchase is missing from the statement; a quoted name without one is read with the quote marks in its text (`"PRISMA"`), which then never matches the same shop on other rows (both seen on 11 Nov with a two row file).
- done when: new cases of `packages/core/test/card-file.test.ts` that fail without the change read `01.09.2026;02.09.2026;"K-MARKET; HELSINKI";12,50` as a row of -1250 cents with the text `K-MARKET; HELSINKI`, read `"PRISMA"` as `PRISMA` and a doubled quote inside quotes as one quote, in the `op` layout and for a quoted cell of the tab separated `nordea` layout; a line whose quote never closes is still in `unread`, and the file's other tests pass unchanged (`bun test packages/core/test/card-file.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: card-file
- after: none
- files: packages/core/src/card-file.ts, packages/core/test/card-file.test.ts

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

### E1 The tax sheet prints alone
Result: The print of the tax-year sheet is held by a test: the paper shows the sheet and nothing else, and the page comes back.
- why: `components/SheetActions.tsx` and the `@media print` rules of `styles/sheets.css` are the app's only print flow, and no spec in `e2e/` presses Tulosta or reads the page as print.
- done when: a new `e2e/print-sheet.spec.ts` opens `#/reports?q=tulot#verovuosi` on the demo household with `window.print` replaced by a stub, presses the print button and sees `printing-sheet` on the root; with `page.emulateMedia({ media: "print" })` the sheet's table is visible and the header, the navigation and another card are not; after `afterprint` the class is gone and the header shows again (`pnpm e2e print-sheet`); a fault the spec finds is fixed in the two files named below and nowhere else; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: e2e-print, sheet-print
- after: none
- files: e2e/print-sheet.spec.ts, apps/web/src/components/SheetActions.tsx, apps/web/src/styles/sheets.css

### E2 Sign-in keeps the address
Result: A link to a page opened without a session lands on that page after the sign-in, and a test holds it.
- why: `App.tsx` shows the sign-in form in place of the page and leaves the address alone, but every spec that signs in starts from `/`: a link from a notice or a bookmark that lost its page would pass the suite.
- done when: a new `e2e/sign-in-address.spec.ts` opens `#/bills`, `#/reports?q=menot&period=6m` and `#/settings/security` in a context with no session, signs in with the form each time and sees the page's title and the same address with its parameters; a member who must change the password first (`mustChangePassword`) lands on `#/overview` after the change, as `App.tsx` says, and the spec holds that too; there is no console problem but the 401 of the first read (`pnpm e2e sign-in-address`); a fault the spec finds is fixed in `apps/web/src/App.tsx` and nowhere else; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: e2e-sign-in
- after: none
- files: e2e/sign-in-address.spec.ts, apps/web/src/App.tsx

### E3 English fits a phone
Result: A test holds that no page scrolls sideways at 390 px when the member reads the app in English.
- why: `no-sideways.spec.ts` and `settings-sideways.spec.ts` measure the pages in Finnish only, and `english-scan.spec.ts` reads the words and no width; the English texts differ in length on every button and head.
- done when: a new `e2e/english-phone.spec.ts` makes a member who links the fake bank and chooses English (as `english-scan.spec.ts` does), opens overview, bills, transactions, transactions?view=merchants, the seven question addresses of Raportit that `english-scan.spec.ts` walks (kuukausi, menot, tulot, kiinteat, velat, saldot, yhteiset), review and the member's four targets of Asetukset at 390 px, and `overflow` of `e2e/helpers.ts` is 0 or less on each; the member is removed at the end (`pnpm e2e english-phone`); a page that is too wide is fixed in its stylesheet under `apps/web/src/styles` and nowhere else; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: e2e-english-phone, styles
- after: none
- files: e2e/english-phone.spec.ts, apps/web/src/styles

### E4 Shots of every page at once
Result: `pnpm shots --all` takes a picture of every page, so a visual check of a change covers the whole app with one command.
- why: `tools/shots.mjs` takes only the routes typed on the command line, so `tools/visual-check.sh` compares the pages someone remembered; the pictures of `docs/audit/shots/` were taken by hand, page by page.
- done when:
  - `--all` stands for overview, bills, transactions, transactions?view=merchants, review, reports with each question of `QUESTIONS` and with `q=kiinteat` (a page the app still serves outside that list), and `settings/<id>` for each target of `SETTINGS_TARGETS`, beside routes typed with it and with no route named twice; `--help` lists it in one line, within its limit of 26.
  - A route may name a target of Asetukset: `settings/security` is taken (today the route pattern refuses any `/`), opens that target, and its picture is `settings-security-<width>.png`: `shotName` writes the `/` as `-`. A route with any other `/` is still refused.
  - Tests in `tools/shots-a.test.ts` that fail without the change hold each of these: the list of `--all` read from the options has every question and every target, `settings/security` parses and `settings/../x` does not, and no file name has a `/` (`bun test tools/shots-a.test.ts`). `pnpm shots --all --demo --widths 390` writes one picture per page and exits 0.
  - `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: shots
- after: none
- files: tools/shots.mjs, tools/shots-a.test.ts

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

## The web: seen and heard

### W1 High contrast keeps the choice
Result: With Windows high contrast on, the chosen tab and the pressed choice of a switch still stand out from the others.
- why: no stylesheet has a `forced-colors` rule; the pressed key of `.segmented` and the chosen one of `.tabs` in `apps/web/src/styles/base.css` are told by a background and a `box-shadow` alone, and forced colours remove both.
- done when: a new stylesheet under `@media (forced-colors: active)` gives the pressed key and the chosen tab a border or outline in a system colour; a new e2e spec with `forcedColors: "active"` at 390 and 1440 px finds on Kuukausi and Asetukset that the chosen one's computed border or outline differs from its siblings' and the focus can be seen; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: forced-colors
- after: none
- files: apps/web/src/styles/forced-colors.css, apps/web/src/main.tsx, e2e/forced-colors.spec.ts

### W3 A menu row's focus is plain
Result: In the sort menu of a table and the account list of the rows filter, a keyboard user sees which row has the focus.
- why: `.rtb-item[data-focused]` in `apps/web/src/styles/toolbar.css` and `.tx-acctlist li:focus-visible` in `apps/web/src/styles/transactions.css` remove the outline and show the hover ground alone (`#eef1f5` on white, about 1.1:1), under the 3:1 of WCAG 1.4.11.
- done when: both rows show a focus mark at 3:1 or more against the surface that hover alone does not show; a new test of the two stylesheets holds it; `e2e/table-sort.spec.ts` and `e2e/a11y.spec.ts` pass; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: toolbar, transactions
- after: none
- files: apps/web/src/styles/toolbar.css, apps/web/src/styles/transactions.css, apps/web/test/menu-focus-css.test.ts

### W4 A refused key file is read out
Result: A screen reader says the error when the bank key file is refused, and the file field names it.
- why: the file error of `apps/web/src/pages/settings/BankAppSetup.tsx` is a plain span outside any live region, with no `role="alert"` and no `aria-describedby` on the file input, so the error is seen and never spoken; the application id error beside it is tied to its field.
- done when: the file error has `role="alert"` and an id that the file input names with `aria-describedby`, as the application id does; the new `apps/web/test/bank-key-error.dom.test.ts` gives the form a refused key file and finds the role and the tie; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: bank-app
- after: none
- files: apps/web/src/pages/settings/BankAppSetup.tsx, apps/web/test/bank-key-error.dom.test.ts

## The web: keyboard and phone

From reading `apps/web/src/charts`, `components`, `search.ts`, `offline.ts` and `table-state.ts` on main (11 Nov) for
use by keyboard, on a narrow screen and with a screen reader. Four faults were found that a step of this size can
mend; each step has a lock no other step of this file names, and none waits on the four tabs. The three that add texts
also take `texts`.

### Y1 A longer list keeps the focus
Result: A press that shows more or fewer rows of a long list or of a figure's sheet keeps the focus in the list, and the count is spoken.
- why: `MoreButtons` in `apps/web/src/components/More.tsx` (lines 15 to 24) draws "Näytä lisää" only while `shown < total` and "Näytä vähemmän" only while `shown > step`, so the press that shows the last rows and the press that folds the list each remove the button that has the focus: the focus falls to the page and Tab starts from the top. The count beside them (`20 / 57`) is a plain span in no live region, so the change is never spoken. `WhyPanel` in `apps/web/src/components/Why.tsx` (lines 358 to 362) does the same inside a modal sheet: "Näytä kaikki" is drawn only while `!all`, the press removes it, and nothing says how many rows came.
- done when: after a press in `MoreButtons` that removes a button the focus is on the button that is left, and the count is in a polite live region that is silent until a button is pressed; after "Näytä kaikki" the focus is on the first row that came and the number of rows is spoken once; the new `apps/web/test/more-focus.dom.test.ts`, which fails without the change, presses both buttons of a list of three pages and finds the focus on a button of the list each time and the count in the live region; a test in `apps/web/test/why.dom.test.ts`, which fails without the change, presses "Näytä kaikki" and finds the focus inside the sheet's table; `apps/web/test/reports-more.test.ts` passes; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: more-list
- after: none
- files: apps/web/src/components/More.tsx, apps/web/src/components/Why.tsx, apps/web/test/more-focus.dom.test.ts, apps/web/test/why.dom.test.ts

### Y2 Change chart heard in English
Result: In English a screen reader reads the year to year chart of Raportit in English.
- why: `apps/web/src/charts/SlopeChart.tsx` writes Finnish in the code: the name of the focusable group at line 179 ("Nuolinäppäimet siirtävät viivasta toiseen, Enter näyttää rivin taulukossa."), the readout row "Muutos" at line 121, which `LiveReadout` speaks at every arrow key, the sentence under the chart at line 212 ("ei mahdu kuvaan", in one and in many) and the "ja" that joins its names at line 29. None goes through `t()`, so an English reader hears Finnish read with English sounds.
- done when: the four texts come from the catalogue in both languages; the new `apps/web/test/slope-chart-english.dom.test.ts`, which fails without the change, draws the chart in English with one and with three lines that do not fit, moves with an arrow key and finds no Finnish word in the group's name, the live readout or the sentence under the chart, and the same chart in Finnish reads as before; `pnpm strings` runs clean; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: slope-chart, texts
- after: none
- files: apps/web/src/charts/SlopeChart.tsx, packages/core/src/messages-tables.ts, packages/core/src/english/tables.ts, apps/web/test/slope-chart-english.dom.test.ts

### Y3 Week sums by keyboard and touch
Result: The week sums and weekday averages of the spending calendar are read with the arrow keys and stay on the screen after a tap.
- why: in `apps/web/src/charts/CalendarHeat.tsx` the bars of the week sums (line 268) and of the weekday averages (line 290) get their readout from `hit` (lines 162 to 166), which listens to the pointer alone: `onKey` (lines 167 to 180) walks the days only, so a keyboard or screen reader user never reaches a week's sum, and of the averages the one of an empty weekday ("ei päiviä") is in the readout alone. `onPointerLeave` there clears the readout for every pointer, where the days at line 240 clear it for a mouse only, so on a phone the readout of a tapped bar goes the moment the finger lifts. The strip's label "vk" at line 279 is Finnish in the code.
- done when: from the last row of days the down arrow goes to the week sum of that column and from the last column the right arrow goes to the average of that weekday, the arrows walk both and go back to the days, and each stop shows the readout and sends its sentence to the live region; a tap on a bar keeps its readout until the next tap or Escape, and a mouse that leaves still clears it; the group's name tells of the sums and "vk" comes from the catalogue, in both languages; the new `apps/web/test/calendar-sums.dom.test.ts`, which fails without the change, holds the keys, the touch and the mouse case; `pnpm strings` runs clean; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: calendar-heat, texts
- after: none
- files: apps/web/src/charts/CalendarHeat.tsx, apps/web/src/charts/kit/readout.ts, packages/core/src/messages-transactions.ts, packages/core/src/english/transactions.ts, apps/web/test/calendar-sums.dom.test.ts

### Y4 Bank picker heard in English
Result: In English the whole bank picker is in English, on the screen and for a screen reader, from its heading to its notices.
- why: `apps/web/src/components/BankPicker.tsx` has no `t()` at all and writes every text in Finnish in the code: the heading "Valitse pankki" (line 91), which takes the focus when the picker opens (line 79), "Sulje" (line 94), the two notices of an empty list (lines 101 and 104), the search field's placeholder and `aria-label` "Hae pankkia" (line 109), the name of every bank button "Yhdistä …" (line 116), the notes "Avataan…" and "Viimeksi käytetty" (line 85), "Haulla ei löydy pankkia." in a `role="status"` (line 126) and the note on other banks at line 129. In English the first thing a screen reader says on opening the picker is Finnish.
- done when: every text of the picker named in the why comes from the catalogue in both languages, the link in the admin's notice still opens the bank app's section; tests in `apps/web/test/bank-picker.test.ts`, which fail without the change, draw the picker in English with no bank (as admin and as member), with nine banks of which one was last used and one is being opened, and with a search that finds nothing, and find no Finnish in any text or `aria-label` of the picker; the same picker in Finnish reads as before; `pnpm strings` runs clean; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: bank-picker, texts
- after: none
- files: apps/web/src/components/BankPicker.tsx, packages/core/src/messages-set-banks.ts, packages/core/src/english/set-banks.ts, apps/web/test/bank-picker.test.ts

## The web: what the design asks

From reading `docs/design/README.md`, `docs/audit/simplify.md` and `docs/UI_STYLE.md` against the pages on main
(11 Nov). Each step has a lock no other step of this file names, and none waits on the four tabs: a step in an `after` here
is merged, and is named because it edited the same file.

### P1 Rows without the amount bar
Result: A row of the rows list shows its sum as a number only, with no coloured bar under it.
- why: design section 2 and audit section 4: the amount bar is one of the four marks that repeat the text. T58 named it in its result and merged without it: its done-when did not ask for it, and `apps/web/src/pages/TransactionRows.tsx` on main still draws `tx-bar` under every sum.
- done when: `git grep -n "tx-bar" apps/web/src` is empty; a test in `apps/web/test/transaction-rows.test.ts` that fails without the change renders the amount cell of a row and finds the sum and no element after it but the share part; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: row-amount
- after: T58, T109
- files: apps/web/src/pages/TransactionRows.tsx, apps/web/src/styles/transactions.css, apps/web/test/transaction-rows.test.ts

### P2 A row's category is text
Result: The category of a row is its name as plain text, with no icon in front of it.
- why: design section 1.5 ("category as text") and section 2 (category chip icons go). T58 named the chip icons in its result and merged with them: its done-when did not ask for it. `Face` of `apps/web/src/pages/transactions/CategoryChip.tsx` on main still draws a `CategoryIcon`, for `CategoryLabel` (the category cell of a row) and for `SharedCategory` alike.
- done when: `Face` renders no `CategoryIcon`, so `CategoryLabel` and `SharedCategory` are both text with no `svg`; a test in `apps/web/test/tx-category-look.test.ts` that fails without the change renders each of the two labels and finds the category's name and no `svg`; the category menu still changes a row's category (its present test passes); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: category-chip
- after: T58
- files: apps/web/src/pages/transactions/CategoryChip.tsx, apps/web/src/styles/categories.css, apps/web/test/tx-category-look.test.ts

### P3 A failed page shows no exception
Result: When a page cannot be opened, the reader sees one sentence of what happened and what to do, never the browser's own error text.
- why: `docs/UI_STYLE.md`, Sentences: the text of an exception is not shown. The `defaultErrorComponent` of `apps/web/src/router.tsx` gives `error.message` or `String(error)` to `ErrorCard`, so a page chunk that cannot be fetched reads in the browser's English.
- done when: an error that is not an `ApiError` shows the present `app.request_failed` of the catalogue in the member's language with the retry button (no new key), and an `ApiError` keeps its own sentence; the new `apps/web/test/router-error.dom.test.ts` throws a `TypeError` with an English text from a route and finds the text of `app.request_failed` and not the thrown text; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: router
- after: none
- files: apps/web/src/router.tsx, apps/web/test/router-error.dom.test.ts

### P4 Foreign rows, short dates
Result: The rows in another currency under an account write a date of this year without the year, and follow the member's language.
- why: `docs/UI_STYLE.md`, Dates and times: a date in the year now is `23.10.`, through the formatters of `format.ts`. `apps/web/src/pages/settings/ForeignRows.tsx` has a `dayText` of its own that always writes the year, in Finnish form.
- done when: `ForeignRows.tsx` has no date formatter of its own and uses `date` of `apps/web/src/format.ts`; the new `apps/web/test/foreign-rows.dom.test.ts` renders a row of this year and one of last year and reads `3.10.` and `3.10.2025`, and the English form in English; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: foreign-dates
- after: N12
- files: apps/web/src/pages/settings/ForeignRows.tsx, apps/web/test/foreign-rows.dom.test.ts

### P5 A failure says who and what next
Result: Four failure messages speak in the app's own voice and say what the reader can do, as the style sheet asks.
- why: `docs/UI_STYLE.md`, Tone and Sentences: the app says "Emme saaneet…", not a passive, and an error says what happened and what can be done. Two texts say what to do and are passive: `card_file.err_save` ("Rivejä ei voitu tallentaa. Yritä uudelleen.") and `app.request_failed` ("Pyyntöä ei voitu tehdä. Yritä uudelleen."). Two are sentences that name no doer and nothing to do: `set.brt.the_test_failed` ("Testi epäonnistui.") and `load.failed` ("Tietojen haku epäonnistui."). The row status `set.conn.fetch_failed` and the log label `set.sec.remote_access_change_failed` are not sentences and stay.
- done when: each of the four is in the first person plural and ends with what to do, in Finnish and English; a new case in `packages/core/test/messages.test.ts` that fails without the change holds that none of the four contains "ei voitu" or "epäonnistui" in Finnish; `pnpm strings` runs clean; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: failure-texts
- after: none
- files: packages/core/src/messages.ts, packages/core/src/messages-en.ts, packages/core/src/messages-card-file.ts, packages/core/src/messages-set-brt.ts, packages/core/src/messages-shell.ts, packages/core/src/english/card-file.ts, packages/core/src/english/set-brt.ts, packages/core/src/english/shell.ts, packages/core/test/messages.test.ts

### P6 The queue says where you are
Result: Tarkistettavat shows which question is open and how many there are, like "3 / 8", while the reader answers.
- why: design section 1.4: the count of open items is in the header of the queue ("Tarkistettavat 3 / 8"). `apps/web/src/pages/Review.tsx` counts what is left only for the menu and for the end card, so a reader in the queue does not see how far it goes.
- done when: the heading of an open question carries its place and the total of the sitting from the catalogue in both languages, and a screen reader hears it once per question; a test in `apps/web/test/review.dom.test.ts` that fails without the change gives a queue of three, answers one and reads "2 / 3"; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: review-page
- after: T72
- files: apps/web/src/pages/Review.tsx, apps/web/src/styles/review.css, packages/core/src/messages-set-rv.ts, packages/core/src/english/set-rv.ts, apps/web/test/review.dom.test.ts

### P7 Account rows without a logo
Result: An account in Asetukset > Pankit ja tilit is its name, number and balance, with no bank logo in the row.
- why: design section 3, Avoid: avatars and logos in rows. Each account row of `apps/web/src/pages/settings/Accounts.tsx` starts with an `AccountMark`.
- done when: `git grep -n "AccountMark" apps/web/src/pages/settings/Accounts.tsx` is empty and the bank's name stays as text in the row; a test in `apps/web/test/accounts-view.test.ts` that fails without the change renders an account and finds its name and no `img`; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: accounts
- after: none
- files: apps/web/src/pages/settings/Accounts.tsx, apps/web/src/styles/banks.css, apps/web/test/accounts-view.test.ts

### P8 Connection rows without a logo
Result: A bank connection and a consent to renew are named in text, with no bank logo in the row.
- why: design section 3, Avoid: avatars and logos in rows. `apps/web/src/pages/settings/BankConnections.tsx` and `RenewalRound.tsx` put a `BankLogo` before the bank's name in each row; the bank picker keeps its logos, which are the choice itself.
- done when: `git grep -n "BankLogo" apps/web/src/pages/settings/BankConnections.tsx apps/web/src/pages/settings/RenewalRound.tsx` is empty and each row still names its bank; a test in `apps/web/test/bank-connections.test.ts` that fails without the change renders a connection and finds the bank's name and no `img`; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: bank-connections
- after: none
- files: apps/web/src/pages/settings/BankConnections.tsx, apps/web/src/pages/settings/RenewalRound.tsx, apps/web/test/bank-connections.test.ts

### P9 Balance rows without a logo
Result: An account in Lisää > Tilit ja saldot is its name and balance, with no bank logo in the row.
- why: design section 3, Avoid: avatars and logos in rows. The account rows of `apps/web/src/pages/reports/holdings/Holdings.tsx` give each `Name` an `AccountMark`.
- done when: `git grep -n "AccountMark" apps/web/src/pages/reports/holdings/Holdings.tsx` is empty and a row still opens its rows list; a test in `apps/web/test/holdings.test.ts` that fails without the change renders an account row and finds its name, its link and no `img`; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: balance-rows
- after: T57
- files: apps/web/src/pages/reports/holdings/Holdings.tsx, apps/web/src/styles/holdings.css, apps/web/test/holdings.test.ts

### P10 A failed card save reads plainly
Result: When saving a card statement fails for a reason the server did not name, the reader sees a plain sentence, not a programming error.
- why: `docs/UI_STYLE.md`, Sentences: the text of an exception is not shown. `apps/web/src/components/cards/CardStatement.tsx` shows `e.message` of any error and `String(e)` of anything else, so a fault in the page itself reads as its English exception.
- done when: an `ApiError` keeps its own sentence and any other failure shows the present `app.request_failed` of the catalogue (no new key; the same key P3 uses, read in each file, so neither step waits on the other); the new `apps/web/test/card-statement-error.dom.test.ts` makes the save throw a `TypeError` with an English text and finds the text of `app.request_failed` in a `role="alert"` and not the thrown text; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: card-statement
- after: none
- files: apps/web/src/components/cards/CardStatement.tsx, apps/web/test/card-statement-error.dom.test.ts

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

### A1 Savings tips leave the API
Result: The server no longer answers with the findings of the removed Säästövinkit page, and an access token cannot read them.
- why: audit move 10 and design D1. T55 removed the page and merged in part: no file of `apps/web/src` reads the findings, yet on main (11 Nov, N26) `apps/server/src/routes/optimise.ts:60`, `:62` and `:74` still serve `GET /api/optimise`, `GET /api/optimise/evidence` and `PUT /api/optimise/findings/:id`, and `apps/server/src/services/service-tokens.ts:36` lets a token read the first two. `PUT` and `DELETE /api/optimise/inputs/:key` (lines 67 and 72) stay: Tarkistettavat saves a number with them (`apps/web/src/components/InputForm.tsx:104`).
- done when: the three routes answer 404, in new cases of `apps/server/test/optimise.isolated.test.ts`, and the two input routes answer as before; `optimisePage`, `optimiseEvidence` and `decide` of `services/optimise.ts` are gone unless `neededInputs` needs one, and then it is no longer exported; `READABLE` of `service-tokens.ts` names no optimise address and a case of `apps/server/test/service-tokens.test.ts` gets a refusal for `GET /api/optimise` with a token; `apps/server/test/optimise-demo.test.ts` and the two `own-optimise.txt` golden files go when nothing else reads what they hold, and `e2e/second-household.spec.ts:12` no longer lists the address; `apps/server/test/review.test.ts` passes unchanged; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: optimise-api
- after: none
- files: apps/server/src/routes/optimise.ts, apps/server/src/services/optimise.ts, apps/server/src/services/service-tokens.ts, apps/server/test/optimise.isolated.test.ts, apps/server/test/optimise-demo.test.ts, apps/server/test/service-tokens.test.ts, apps/server/test/fixtures/answers, e2e/second-household.spec.ts

### A2 The queue asks no tip numbers
Result: Tarkistettavat no longer asks for a number that only the removed Säästövinkit page used.
- why: audit move 10 and design D1. The source `inputs` of `apps/server/src/services/review.ts:323` to 324 ("the numbers Säästövinkit waits for") still adds a question of the kind `input` for each number the findings engine misses, and `apps/web/src/pages/review-items.ts:101` and `apps/web/src/pages/ReviewChoices.tsx:95` draw it with `components/InputForm.tsx`. On main (11 Nov, N26) the page those numbers fed is gone (T55), so the member answers a question whose answer no view shows.
- done when: the PR first names every reader of a stored input outside `packages/core/src/optimise` and `services/optimise.ts`, found by `git grep -n "listInputs\|StoredInput" apps packages`; when a view on main still shows a figure made from an input, that input keeps its question and the PR says which; for every other input `GET /api/review` gives no item of the kind `input`, in a new case of `apps/server/test/review.test.ts` on a household that got one before; when no input keeps its question the kind `input` leaves `review-items.ts` and `ReviewChoices.tsx`, `InputForm.tsx` goes with what only it read, and `apps/web/test/review-items.test.ts` holds the kinds that stay; a stored input is not deleted and a backup with inputs still imports (`apps/server/test/data-roundtrip.test.ts` passes unchanged); `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: review-inputs
- after: T56, A1
- files: apps/server/src/services/review.ts, apps/server/src/services/optimise.ts, apps/web/src/pages/review-items.ts, apps/web/src/pages/ReviewChoices.tsx, apps/web/src/components/InputForm.tsx, apps/server/test/review.test.ts, apps/web/test/review-items.test.ts

### A3 No goal line nobody can set
Result: The month chart no longer draws a spending goal that the member has no way to change or remove.
- why: audit move 18 and design D3. T57 removed the goal card of Asetukset (`SpendingGoalCard.tsx`), and no file of `apps/web/src` calls `/api/spending-goal` any longer. On main (11 Nov, N26) `apps/server/src/services/analysis.ts:403` still reads the stored sum (`repo.spendingGoal()`) and line 426 gives it to the dashboard, so `packages/core/src/analysis/dashboard.ts:174` answers with a `goal` and the chart draws its line; `apps/server/src/routes/spending-goal.ts:25`, `:27` and `:35` still serve `GET`, `PUT` and `DELETE /api/spending-goal`, which no page calls. A member who set a goal before the update sees its line and cannot move it.
- done when: `GET /api/dashboard` answers `goal: null` for a member with a row in the table `spending_goal`, in a new case of `apps/server/test/dashboard-cockpit.test.ts` that fails without the change; `services/analysis.ts` reads no stored goal; `GET`, `PUT` and `DELETE /api/spending-goal` answer 404, in a case of the same test, and `routes/spending-goal.ts`, `db/finance/spending-goal.ts`, their lines in `app.ts` and `db/finance-repo.ts` and `apps/server/test/spending-goal.test.ts` go; the table and the `spendingGoals` store of the backup stay, so an old backup imports (`apps/server/test/data-roundtrip.test.ts` passes unchanged) and no applied migration is edited; golden files are written again with `pnpm findings --golden` when they held a goal; no file of `apps/web` or `packages/core` changes: the field `goal` and the line of `PaceChart` stay as code that gets no goal, and the PR names them for a step after T69; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: spending-goal
- after: none
- files: apps/server/src/services/analysis.ts, apps/server/src/routes/spending-goal.ts, apps/server/src/db/finance/spending-goal.ts, apps/server/src/db/finance-repo.ts, apps/server/src/app.ts, apps/server/test/spending-goal.test.ts, apps/server/test/dashboard-cockpit.test.ts

### A4 No texts of the tips page
Result: The app no longer ships about 150 sentences, in each language, of a page that was removed.
- why: audit move 10 and design D1 ("`pnpm strings` finds no Säästövinkit"). `packages/core/src/messages-optimise-web.ts` holds 156 keys that start with `ow.`, the texts of the removed page, and `packages/core/src/english/optimise-web.ts` their English. On main (11 Nov, N26) a `git grep -F` of each key in `apps/web/src`, `apps/server/src` and `packages/core/src` outside the catalogues finds seven (`ow.fa_save`, `ow.in_and`, `ow.in_saved`, `ow.in_choose`, `ow.in_margin_aria`, `ow.in_ref_aria`, `ow.cancel`), and no file builds an `ow.` key from parts.
- done when: the two files hold only the `ow.` keys a source file reads, the same keys in both languages; a new case of `packages/core/test/messages.test.ts` that fails without the change reads the sources of `apps/web/src`, `apps/server/src` and `packages/core/src` and finds each `ow.` key of the Finnish catalogue named in one of them; `pnpm strings` runs clean and the test of the equal keys of the two languages passes; the keys of `messages-optimise.ts`, `-a` and `-b` are not touched, the findings engine still reads them; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: optimise-texts
- after: none
- files: packages/core/src/messages-optimise-web.ts, packages/core/src/english/optimise-web.ts, packages/core/test/messages.test.ts

## Money flows

Found by reading `packages/core/src/returns.ts`, `contract.ts`, `mobilepay.ts`, `analysis/alerts.ts`, `analysis/money-in.ts`
and `analysis/fees.ts` against [MONEY_FLOWS.md](MONEY_FLOWS.md) on 11 November (N29). M1 stays in the alerts. M2 and M3
both change `returns.ts` and `analysis/money-in.ts`, so M3 waits for M2.

### M1 Alerts count what came back
Result: A bill, a reminder fee or a bank fee that was paid back no longer raises an alert or adds to an alert's sum on Yhteenveto.
- why: MONEY_FLOWS.md, *Money that comes back*: "A purchase that was paid back leaves the lists of merchants, habits and double charges by the amount that came back." On main (11 Nov, N29) only the same-day double charge reads it (`packages/core/src/analysis/alerts.ts:134`). The monthly bill paid twice within a week (line 161) never reads `refunded`, so a second payment the biller sent back still shows *Sama veloitus kahdesti*. The late fee total (line 185) adds `-t.amountCents` and the bank fee sum (line 411) adds `t.spend`, so a fee that was returned stays whole in *Myöhästymiskuluja* and in *Pankkikuluja … vuodessa*, and can carry the yearly sum over its 100 € gate alone.
- done when: new cases of `packages/core/test/alerts.test.ts` that fail without the change show: a monthly bill paid twice within a week whose second payment came back whole gives no `double_charge`, and the same pair with no refund still gives one; a reminder fee paid back whole is in no `late_fee` alert, and one paid back in part counts at what is left; a bank fee paid back counts at what is left in the `fees` alert, so a year of fees over 100 € of which enough came back to be under it gives no alert; each sum reads `netSpend` or `refunded` of the row and no new pairing is made; the alerts of a history with no refund are unchanged (the golden files pass unchanged); `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: alerts-refunds
- after: none
- files: packages/core/src/analysis/alerts.ts, packages/core/src/analysis/fees.ts, packages/core/test/alerts.test.ts

### M2 A refund above its purchase
Result: A refund larger than what its shop was paid is income again and no longer takes a spending category far below zero.
- why: MONEY_FLOWS.md, *Money that comes back*: "A payment is cancelled once, and never by more than it cost" and "A refund after 120 days and one larger than the purchase stay income". On main (11 Nov, N29) `pairByPayee` asks that the money fits what is left of the payments only of a row with no refund word (`packages/core/src/returns.ts:260`). `matchReturns` on a purchase of 20 € at Kauppa Oy and money in of 500 € from it nine days later with the text HYVITYS answers `r → p`: the row gets the purchase's category and the *palautus* badge, and `lateRefundOf` (`packages/core/src/analysis/money-in.ts:161`) takes the whole 500 € off that category, "however small" the payment. The same row without the word stays income.
- done when: new cases of `packages/core/test/returns.test.ts` and `packages/core/test/money-in.test.ts` that fail without the change show: money in with a refund word that is larger than what is left of the payee's payments of the 120 days before it is paired with no payment by `matchReturns`, and `moneyIn` answers null for it, so it is income (*Hyvitykset*); the same row at or under what is left is paired as today; a row whose category the user set by hand lowers that category as today; a contract's closing refund is not touched; the cases of the two test files that hold a paired refund larger than its payment are changed to the document's rule and the PR names each; golden files are written again with `pnpm findings --golden` when a row moved and the PR says which; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: refund-size
- after: none
- files: packages/core/src/returns.ts, packages/core/src/analysis/money-in.ts, packages/core/test/returns.test.ts, packages/core/test/money-in.test.ts

### M3 Closing refunds stay in cost
Result: When a lease or a loan that ended pays money back twice, the two together no longer take more off the category than the contract cost.
- why: MONEY_FLOWS.md, *Money that comes back*, the row *A contract ends with a refund*: the refund "is no more than the contract cost altogether". On main (11 Nov, N29) `pairClosedContracts` asks `closedContract` about each row of money in alone (`packages/core/src/returns.ts:231` to 236) and keeps no count of what earlier rows took. `matchReturns` on six monthly payments of 100 € to Liisinki Oy (600 € in all) and two rows of money in of 450 € each, two days apart after the last payment, answers `r1 → c5` and `r2 → c5`: 900 € comes back on a contract of 600 €, both rows show as *palautus*, and `lateRefundOf` (`analysis/money-in.ts:161`) takes the second one off the category whole. `contractOf` already counts down what is left (`packages/core/src/contract.ts:138`, `room`), so the contract's own panel and the sums disagree.
- done when: new cases of `packages/core/test/returns.test.ts` and `packages/core/test/money-in.test.ts` that fail without the change show: of two closing refunds that together are more than the contract cost, the first in date and id order is paired and the second is not and is income; two that together fit the cost are both paired as today; the sum `moneyIn` takes off the contract's category is never above what its payments cost; the answer does not depend on the order of the input rows; `packages/core/test/contract.test.ts` passes unchanged; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: closing-refund
- after: M2
- files: packages/core/src/returns.ts, packages/core/src/analysis/money-in.ts, packages/core/test/returns.test.ts, packages/core/test/money-in.test.ts

## The server: robustness

Found by reading `apps/server/` on 11 November (N15). Each step stays in that folder and waits for no other step.
S6 to S11 were found by asking the running app on 11 November (N23): each `why` names the request and the answer main
gave. S7 and S8 share two files, so S8 waits for S7. S9 puts the check of a name in one place, so S10 and S11 wait for
S9. S2 (an unknown CSV report is refused) is on main and is gone from this list.

### S1 A huge offset is a 400
Result: A list asked with an absurd page number answers "bad number" instead of "something went wrong".
- why: `queryInt` in `routes/shared.ts` takes any integer, so `GET /api/transactions?offset=1e300` passes `Math.max(f.offset ?? 0, 0)` in `db/finance/transaction-list.ts` and is bound to `OFFSET ?` as a float, which SQLite refuses with "datatype mismatch": a 500 and a stack trace in the log for bad input.
- done when: `queryInt` refuses a number that is not a safe integer, and `GET /api/transactions` with `offset=1e300`, `offset=9007199254740993` and `limit=1e300` each answer 400 with the code `check.number`, in new cases of `apps/server/test/transactions.test.ts`; an offset inside the range still pages as before; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: query-numbers
- after: none
- files: apps/server/src/routes/shared.ts, apps/server/test/transactions.test.ts

### S3 A bank outage is a 502
Result: When Enable Banking cannot be reached, the app says the bank did not answer instead of "something went wrong".
- why: `request` in `connectors/enable-banking/client.ts` does not catch a failed `fetch` (no network, a TLS fault, the timeout) and throws a plain `Error` for an answer over the size cap. Neither is an `UpstreamError`: `linkFailure` in `link.ts` passes it on unchanged and `classify` in `connector.ts` answers null for it, so the error handler of `app.ts` has only its 500 left.
- done when: in the new `apps/server/test/eb-client-outage.test.ts`, a `fetch` that rejects, one that times out and an answer over the cap each make `request` throw an `UpstreamError` whose log message names the path and the cause code and never the answer's text; the tests of `apps/server/test/eb-*.test.ts` pass unchanged; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: eb-client
- after: none
- files: apps/server/src/connectors/enable-banking/client.ts, apps/server/test/eb-client-outage.test.ts

### S4 A stray failure stops cleanly
Result: A fault nobody caught stops the server the same careful way as `docker stop`, with exit code 1.
- why: `entry/node.ts` listens for SIGINT and SIGTERM only, so an unhandled rejection or an uncaught exception ends the process at once: running writes are cut, the database is not closed and the log holds no line of the app's own.
- done when: `shutdown` in `entry/shutdown.ts` takes the exit code (0 when none is given), and the same file exports the handler that `entry/node.ts` registers for SIGINT, SIGTERM, `uncaughtException` and `unhandledRejection`, with the `stopping` guard inside it; new cases of `apps/server/test/shutdown.test.ts` show that a fault logs one line with the error and exits 1, that a second fault or a signal during it starts no second shutdown, and that a signal alone still exits 0; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: server-entry
- after: none
- files: apps/server/src/entry/node.ts, apps/server/src/entry/shutdown.ts, apps/server/test/shutdown.test.ts

### S5 Idle links outlive the proxy
Result: The server keeps an idle connection open longer than the tunnel in front of it does, so the tunnel never writes to a closed one.
- why: `serve` in `entry/node.ts` sets no timeouts, and on the Node of the `Dockerfile` (24.22) `node -e 'console.log(require("http").createServer().keepAliveTimeout)'` prints 5000. The cloudflared of `docker-compose.yml` keeps an idle connection to the app for `keepAliveTimeout`, 1m30s by default (developers.cloudflare.com/tunnel/reference/origin-parameters). The side that closes first should be the proxy; no failed request from this was seen, the step closes the gap.
- done when: the new `apps/server/src/entry/server-timeouts.ts` exports a function that sets `keepAliveTimeout` above 90 s and `headersTimeout` above that on a server, both named constants with the reason beside them; the new `apps/server/test/server-timeouts.test.ts` runs it on `http.createServer()` and reads both values and an unchanged `requestTimeout`; `entry/node.ts` calls it on what `serve` returns (`grep -n server-timeouts apps/server/src/entry/node.ts` finds the import); `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: server-entry
- after: none
- files: apps/server/src/entry/server-timeouts.ts, apps/server/src/entry/node.ts, apps/server/test/server-timeouts.test.ts

### S6 A wrong agreement day is a 400
Result: An agreement saved or removed with a day that is no date answers "invalid day" instead of "something went wrong".
- why: `parseDay` in `services/settlement.ts` reads ``new Date(`${value}T00:00:00Z`).toISOString()`` for any text of the form 0000-00-00, and that throws a RangeError for a month over 12 or a day over 31. On main (11 Nov, N23) `PUT /api/settlement/agreements/pool-a` with `validFrom: "2026-13-45"` and `DELETE /api/settlement/agreements/pool-a/2026-13-45` each answer 500 with `app.error`, while `2026-02-30` answers 400.
- done when: `parseDay` refuses every text that is no calendar date with its "Virheellinen päivä." and never throws anything else; in new cases of `apps/server/test/settlement.test.ts` the PUT and the DELETE answer 400 for `2026-13-45`, `2026-00-10` and `2026-02-30`, and a real day still saves and removes as before; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: settlement-agreements
- after: none
- files: apps/server/src/services/settlement.ts, apps/server/test/settlement.test.ts

### S7 The rows file in English
Result: A member who uses the app in English downloads the transactions as a file with English headings, categories and words.
- why: `GET /api/export/transactions.csv` in `routes/data.ts` writes its heading row, the category and group of a row (`getCategory`), the words "varaus" and "kirjattu", the source words (`SOURCE_WORDS`), the transfer mark and the file name `tapahtumat_` as Finnish literals whatever the member's language. On main (11 Nov, N23) a member with the language `en` got `Päivä;Tili;Kauppias;...` and `Ruokakauppa;Ruoka;-30;kirjattu;tiedosto`.
- done when: the new `apps/server/src/platform/csv-words.ts` holds the words of the rows file in both languages (the heading row, the two states, the source words, the transfer mark, the start of the file name), as `platform/refusals-en.ts` holds the English of the refusals, and `routes/data.ts` has none of them as a literal; the category and the group of a row come from `categoriesIn` of `services/category-names.ts`; with the language `en` every cell of the heading row and those words, names and the file name are English, in new cases of `apps/server/test/csv-export.test.ts`; with `fi` the file is the same bytes as before; no file of `packages/core` changes; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: csv-export
- after: none
- files: apps/server/src/platform/csv-words.ts, apps/server/src/routes/data.ts, apps/server/test/csv-export.test.ts

### S8 The report files in English
Result: A member who uses the app in English downloads the month table, the categories and the cash flow as files with English headings and names.
- why: `GET /api/export/report.csv` in `routes/data.ts` calls `buildReports({ ctx, range, balances, inputs })` and `pivotReport(ctx, range)` with no language, though both take one (`routes/finance.ts` passes `lang`), and writes the three heading rows, the row "Yhteensä" and the file names `kuukausitaulukko_`, `kategoriat_` and `kassavirta_` as Finnish literals; `cashflowReport(ctx, range, balances)` gives only numbers, so its file needs the headings alone. On main (11 Nov, N23) a member with the language `en` got `Kategoria;Ryhmä;2026-09;2026-10;Yhteensä €;Keskiarvo €`, `Ruoka;Ruokakauppa;42;...` and `Kuukausi;Tulot €;Kulutus €;...`.
- done when: `buildReports` and `pivotReport` get the member's language; the three heading rows, the sum row and the starts of the three file names are in `apps/server/src/platform/csv-words.ts` in both languages and `routes/data.ts` has none of them as a literal; with the language `en` each of the three files has English headings, category and group names, sum row and file name, in new cases of `apps/server/test/csv-export.test.ts`; with `fi` each is the same bytes as before; no file of `packages/core` changes; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: csv-export
- after: S7
- files: apps/server/src/platform/csv-words.ts, apps/server/src/routes/data.ts, apps/server/test/csv-export.test.ts

### S9 An account's name can be read
Result: An account cannot be given a name nobody can see or one that breaks its row, and a name that is too long is refused instead of cut.
- why: `updateAccount` in `services/accounts.ts` trims the name and cuts it at 80 characters, and checks nothing else. On main (11 Nov, N23) `PATCH /api/accounts/:id` saved the name `a\u0000b​\nc` as it came, and a name of 150 letters came back as its first 80 with a 200. A loan's name refuses both, with a pattern (`CONTROL`) that only `routes/loans.ts` can read.
- done when: `platform/validate.ts` exports the pattern of the characters a name may not hold (control characters and the ones nobody sees, today `CONTROL` of `routes/loans.ts`) and a check of a name that takes the text and the longest length and throws `UserError.of("check.field_bad")`, a code both languages already have; `routes/loans.ts` reads the pattern from there and keeps its own sentences, so the pattern is written once; an account's name with such a character, or over 80 characters after the trim, answers 400 with `check.field_bad` and changes nothing; a name of only such characters is refused, not saved as blank; an empty name still takes the own name away; new cases of `apps/server/test/accounts.test.ts` hold each and `apps/server/test/loans.test.ts` passes unchanged; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: account-edit, loan-route
- after: none
- files: apps/server/src/platform/validate.ts, apps/server/src/routes/loans.ts, apps/server/src/services/accounts.ts, apps/server/test/accounts.test.ts

### S10 A bill's name can be read
Result: A bill the member types in cannot have a name nobody can see, so every row of the bills has a name.
- why: `parseExpectedBill` in `routes/expected-bills.ts` refuses only the ASCII control characters in a name (`/[\x00-\x1f\x7f]/`). On main (11 Nov, N23) `POST /api/expected-bills` saved a bill whose name is one zero-width space (`​`) and one whose name holds a right-to-left override (`‮`).
- done when: `parseExpectedBill` tests the name with the pattern S9 exports from `platform/validate.ts`, in place of its own, and keeps its own sentence; a name of a zero-width space, one with a right-to-left override and one with a line separator each answer 400 and add no row, and a name with ä, an emoji or a dash is still saved, in new cases of `apps/server/test/expected-bills.test.ts`; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: bill-name
- after: S9
- files: apps/server/src/routes/expected-bills.ts, apps/server/test/expected-bills.test.ts

### S11 A member's name can be read
Result: A household member cannot be given a display name nobody can see, so every list of members shows a name on each row.
- why: `createUser` and `createFirstAdmin` in `services/users.ts` trim the display name and check nothing else, and `updateUser` hands it to `s.users.update` as `routes/users.ts` trimmed it. On main (11 Nov, N23) `POST /api/users` saved the display name `​` (a zero-width space), `PATCH /api/users/:id` saved `a\u0000\nb`, and `GET /api/meta` served both to every member in `members`.
- done when: the three functions pass the display name through the check of a name S9 exports from `platform/validate.ts`, so a name with a control character or a character nobody sees answers 400 with `check.field_bad` for a new member, the first admin and a changed name, and nothing is saved; a name of only such characters is refused, not replaced by the user name in silence; an empty name still becomes the user name; the new `apps/server/test/user-names.test.ts` holds each; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: user-names
- after: S9
- files: apps/server/src/services/users.ts, apps/server/test/user-names.test.ts

## Signing in and the command line

Found by running the app and `runCli` on main on 11 November (N25): each `why` names what was sent and what main
answered. L1 stays in files no other step here edits. L2, L3 and L4 all edit `cli.ts`, so each waits for the one
before it.

### L1 Passkey offered where it works
Result: A passkey is offered only at the address it works at, at sign-in and in the settings, so nobody is shown a button that can only fail.
- why: `POST /login` in `routes/auth.ts` (line 128) and `passkeyChallenge` in `services/passkeys.ts` (line 136) read only the saved app address, never the address the request came to. With the app address `https://talous.example.com` and a passkey made there, a sign-in sent to `http://192.168.1.10:8080` (Host and Origin of the home network) answered `{"needsFactor":true,"passkey":true,"codes":true}` and `POST /api/auth/passkey/options` answered 200 with `rpId` `talous.example.com`, which a browser at the home address refuses. The request passes the Origin check of `auth/middleware.ts` (line 90) because its Origin is its own Host. `passkeyStatus` and `startPasskey` (lines 38 and 72 of `services/passkeys.ts`) read the same saved address alone, so by the code (read on main, not run) the settings opened at the home address answer `usable: true` and hand out options for a new passkey that the browser there refuses as well.
- done when: new cases of `apps/server/test/passkeys.test.ts` that fail without the change get `passkey: false` from `POST /api/auth/login` and the 400 of `passkey.none` from `POST /api/auth/passkey/options` when the request's Origin (or, without one, its Host) is not the app address, with `codes` as before and no challenge stored; the same sign-in sent to the app address still gets `passkey: true` and signs in with the passkey; behind a proxy that sends the app address as Host the passkey is offered; `GET /api/security/factor` sent to another address than the app address answers `usable: false` with the app address still in `address`, and `POST /api/security/factor/passkey/start` there answers 400 with a message that names the app address and stores no challenge, while at the app address both answer as before; the file's other tests pass unchanged; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: passkey-offer
- after: none
- files: apps/server/src/routes/auth.ts, apps/server/src/routes/second-factor.ts, apps/server/src/services/passkeys.ts, apps/server/test/passkeys.test.ts

### L2 Stray words stop a command
Result: A command with a mistyped flag or a word too many stops and names that word, so a slip never creates, deletes or signs out anybody.
- why: `runCli` in `cli.ts` (line 43) reads three words and ignores the rest, `option` in `cli-args.ts` takes any next word as a value, and `runServiceTokenCli` in `cli-service-token.ts` (line 15) reads `--name` and `--days` and no other word. On main (11 Nov, N25) `user create anna --admn` printed `Created user anna.` with exit 0, so a household that meant an admin got a member; `user create --admin carl` printed `Created admin --admin.` (the user name rule of `services/users.ts`, line 66, allows it); `user create bob --name --admin` made the admin bob with the display name `--admin`; `user delete anna --help` printed `Deleted anna and all their data.`; `user delete bob carl` deleted bob; `user reset-password anna --help` gave anna a new password; `sessions revoke-all --help` signed everyone out; `service-token list extra` listed with exit 0; and `service-token create aino --name x --dayz 5`, like the same with `--days` as the last word, printed a working token valid for the default 30 days and not the 5 asked for, and a token is shown only once.
- done when: in a new `apps/server/test/cli-words.test.ts` that fails without the change, each command of the why and `service-token create aino bob --name x` exits 1, names the word in question on stderr and leaves `user list`, the sessions and `service-token list` as they were; `user create --admin carl --name "Carl C"` and `user create carl --name "Carl C" --admin` both create the admin carl with that display name; `user create anna`, `user create anna --name` (the flag last, as `cli-args.test.ts` holds), `user delete anna`, `user reset-password anna`, `user remove-factor anna`, `sessions revoke-all`, `service-token create aino --name x` with `--days 5` before or after the name, `revoke <id>` and `revoke --all` work as before; `secret check <file>`, `address set <url>`, `ops` and `version` are not touched; one function that `cli-args.ts` gains does the check for both files, with its own cases in `apps/server/test/cli-args.test.ts`; `apps/server/test/service-tokens.test.ts` passes unchanged; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: cli-words
- after: none
- files: apps/server/src/cli.ts, apps/server/src/cli-args.ts, apps/server/src/cli-service-token.ts, apps/server/test/cli-words.test.ts, apps/server/test/cli-args.test.ts

### L3 Help for the command line
Result: `help` lists the commands one to a line and succeeds, and a wrong command in a group gets that group's commands.
- why: `runCli` in `cli.ts` (lines 115 to 118) has one usage sentence of over 400 characters for everything. On main `help` and `--help` printed it on stdout with exit 1; `sessions`, `address show` and `secret` printed the same whole sentence; `user frobnicate` answered `Give a username.` and `user frobnicate ghost` answered `User ghost not found.` (lines 123 to 141), neither of which says the command does not exist.
- done when: in a new `apps/server/test/cli-usage.test.ts` that fails without the change, `help`, `--help` and `-h` exit 0 and print every command of the header comment of `cli.ts` on stdout, one to a line; `sessions frobnicate`, `address show`, `secret` and `user frobnicate ghost` exit 1 and print on stderr only the lines of their own group, with `Unknown command` and the word for a command that does not exist; an unknown group exits 1 with the whole list on stderr; `user list`, `version`, `address set <url>` (its ` is now ` wording, which `scripts/install.sh` reads) and the `ops` and `service-token` usage lines are unchanged; the list lives in a new `apps/server/src/cli-usage.ts`; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: cli-usage
- after: L2
- files: apps/server/src/cli-usage.ts, apps/server/src/cli.ts, apps/server/test/cli-usage.test.ts

### L4 Sign one member out at the host
Result: On the host, `sessions list` shows who is signed in and `sessions revoke <username>` signs one member out, nobody else.
- why: `runCli` in `cli.ts` (line 59) knows only `sessions revoke-all`. On main `sessions list` and `sessions revoke aino` printed the usage sentence with exit 1, so after a lost phone the host can only sign the whole household out or reset the member's password (`user reset-password`, which also makes them choose a new one).
- done when: in a new `apps/server/test/cli-sessions.test.ts` that fails without the change, `sessions list` prints one line for each live session with the user name, the device as `deviceLabel` names it and when it was last seen, and never a token or its hash; `sessions revoke aino` ends every session of aino (their cookie then gets `user: null` at `/api/auth/state`), leaves another member signed in, records a `session_revoked` event that names the command line and says how to sign in again; an unknown user name exits 1 with `User <name> not found.`; `sessions revoke-all` works as before; both commands are in the usage list and the header comment of `cli.ts`, and the code lives in a new `apps/server/src/cli-sessions.ts`; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: cli-sessions
- after: L3
- files: apps/server/src/cli-sessions.ts, apps/server/src/cli.ts, apps/server/test/cli-sessions.test.ts

## The server: safety and storage

Found by reading `docs/SECURITY.md` and `docs/audit/security-audit-2026-10.md` against `apps/server/src/security`,
`platform`, `db`, `auth`, `app.ts` and `static-files.ts` on 11 November (N31): each `why` names the file and line on
main and what main did. The three steps share no file and wait for no other step.

### G1 Daily use keeps you signed in
Result: A member who uses the app every week stays signed in, and a session that has ended is not listed as a device.
- why: `docs/SECURITY.md` (Login) says a session expires after 30 days without use, and the October audit records that each use extends it. `resolveSession` in `auth/session.ts` (line 91) moves only the database row's end: the cookie is written by `setSessionCookie` (line 72) at sign-in alone, with a `Max-Age` of the session's days, so the browser drops it 30 days after the sign-in however often the member came. `listSessions` in `db/users-repo.ts` (line 170) has no check of `expires_at` and the ended rows go only in the hourly tick (`services/schedule.ts`, line 110), so until then *Asetukset* lists an ended session as a signed-in device. `touchSession` (line 157) writes `new Date()` and not the server's clock. `int` in `platform/config.ts` (lines 98 and 177) takes any positive start of `SESSION_DAYS`: `30abc` is 30, and with `100000000` the end of a new session is past the last date JavaScript has (on main `new Date(Date.now() + 100000000 * 86_400_000).getTime()` printed `NaN`), so `toISOString` in `startSession` (line 32) throws and every sign-in answers 500.
- done when: in the new `apps/server/test/session-length.test.ts`, which fails without the change, a request made more than an hour after the session's last use answers with a `Set-Cookie` of the session cookie that has the same token, `HttpOnly`, `SameSite=Lax` and a `Max-Age` of the session's days, and one made inside that hour sets no cookie; a session used every 20 days is still signed in after 70 days by that cookie's age and by the row; `GET /api/security/sessions` leaves out a session whose end has passed while its row is still there; the row's `last_seen_at` is the time of the server's clock (`s.now()`); `loadConfig` takes `SESSION_DAYS` only as a whole number from 1 to 365, and for `30abc`, `0`, `1.5` and `100000000` warns with the name of the setting and uses 30, as `validSetupCode` does for a short code; `apps/server/test/session-cookie.test.ts` passes unchanged; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: session-length
- after: none
- files: apps/server/src/auth/session.ts, apps/server/src/db/users-repo.ts, apps/server/src/platform/config.ts, apps/server/test/session-length.test.ts

### G2 A missing file is a 404
Result: After an update, a tab that asks for a file of the old version is told it is gone, not handed the start page to keep for a year.
- why: `staticFiles` in `static-files.ts` ends with `app.get("*", serveStatic({ root, precompressed: true, path: "index.html" }))` (line 27), which answers every GET that matched no file with the page, and the middleware above it (line 22) gives every 200 under `/assets/` a year of `immutable`. On main (11 Nov, N31), with a folder that held only `index.html`, `GET /assets/index-OLD123.js` answered 200 with `Content-Type: text/html` and `Cache-Control: public, max-age=31536000, immutable`, and `GET /favicon.ico` answered 200 with the page as `text/html`. The build's file names carry a hash and an update removes the old ones, so a tab or a service worker of the old version that asks for its own script gets the page as that script, and the browser and the tunnel's cache may keep it a year.
- done when: in the new `apps/server/test/static-missing.test.ts`, which fails without the change and serves a folder of its own, a GET or HEAD for a path under `/assets/` with no file answers 404 with `Cache-Control: no-store` and no page in the body, and so does a path whose last part has a file ending (`/favicon.ico`, `/sw.js`, `/old/logo.png`) with no file; a path with no ending (`/`, `/raportit`, `/asetukset/palvelin`) still answers the page with `no-cache`, a file that is there under `/assets/` still gets its year of `immutable` and `Vary: Accept-Encoding`, and a path with `..` or an encoded slash reaches no file outside the folder; `apps/server/test/static-compress.test.ts` passes unchanged; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: static-missing
- after: none
- files: apps/server/src/static-files.ts, apps/server/test/static-missing.test.ts

### G3 Database files are owner only
Result: The database and every copy the app makes of it can be read by the app's own user alone, as the security document says of backup files.
- why: `docs/SECURITY.md` says "Backup files are mode 600" (Data) and lists the files beside the database as mode 600 (Copies and how long they live), and every one of them holds transactions in plain text. Only `stageCopy` in `db/restore.ts` (line 72) sets a mode. `copyDatabase` in `db/open.ts` (lines 137 to 149) writes the daily copy and every `pre-*` copy with `VACUUM INTO` and never sets one, `savePrevious` in `db/restore.ts` (lines 116 and 132 to 135) writes `pre-restore-*.db` and its `-wal` the same way, `openNodeSqlite` in `db/node-sqlite.ts` creates the database itself, and `moveAside` in `db/startup-gate.ts` (line 154) moves a damaged one to `damaged/` as it was. On main (11 Nov, N31) a database made with `node:sqlite` and its `VACUUM INTO` copy both had mode 644, also under a umask of 002. The folders are made with `mode: 0o700` (`open.ts` line 127, `restore.ts` line 111, `startup-gate.ts` line 212), which `mkdirSync` does not apply to a folder that is already there.
- done when: `platform/durable.ts` exports one function that sets a file to mode 600 and one that makes a folder and sets it to 700 also when it exists, and the four places of the why use them; in the new `apps/server/test/copy-modes.test.ts`, which fails without the change and runs under a umask of 022, the database a start opens and its `-wal` and `-shm`, the day's copy, a `pre-*` copy, `pre-restore-*.db` from both branches of `savePrevious` (with its `-wal` from the raw one) and the three files a start moves to `damaged/` each have mode 600, a database that was 644 before the start is 600 after it, and `backups/` and `damaged/` are 700 also when they were 755 before; a file that cannot be set (not the owner's) stops no start and no copy and logs one line that names the file; the tests of `apps/server/test/backup.test.ts`, `backups.isolated.test.ts`, `copy-fsync.isolated.test.ts` and `restore-latest.test.ts` pass unchanged; `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: copy-modes
- after: none
- files: apps/server/src/platform/durable.ts, apps/server/src/db/open.ts, apps/server/src/db/restore.ts, apps/server/src/db/node-sqlite.ts, apps/server/src/db/startup-gate.ts, apps/server/test/copy-modes.test.ts

## Docs and help

What a household user reads. The tabs of Asetukset are the six labels of `packages/core/src/messages-set-tabs.ts`
(Pankit ja tilit, Talous, Jäsenet, Turvallisuus, Tiedot, Palvelin ja ylläpito); a card's heading follows the tab. D1 to
D4 each add a test of their own guide, so they share no file; D6 makes the four tests one when T74 has cut the tabs to
three. The README and its pictures wait for the redesign and are not steps yet.

### D1 Install guide, real tabs
Result: Every place in Asetukset that the install guide sends a reader to is a tab the app has, so nobody looks for Tekniset asetukset.
- why: `docs/INSTALL.md` names *Tekniset asetukset* (lines 86, 94, 131, 136, 148), *Pankkiyhteydet* (87), *Talouden jäsenet* (103) and *Lainat* (110) as tabs of Asetukset; the app has none of them (the cards are on Palvelin ja ylläpito, Pankit ja tilit, Jäsenet and Talous), so the first hour with the app starts with a search.
- done when: the new `tools/test/docs-tabs-install.test.ts`, which fails without the change, reads `docs/INSTALL.md` and finds that the name after each `Asetukset > ` is one of the six tab labels written in the test, also where the label wraps over a line end (line 96), and the card's heading follows the tab where the guide names a card (`bun test tools/test/docs-tabs-install.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: install-doc
- after: none
- files: docs/INSTALL.md, tools/test/docs-tabs-install.test.ts

### D2 Troubleshooting, real tabs
Result: Each fix in the troubleshooting tables names the tab of Asetukset where its button is.
- why: `docs/TROUBLESHOOTING.md` sends a reader with a failed update, a full disk or an old backup to *Asetukset > Ylläpito* (lines 86, 91, 115, 117), and others to *Talouden jäsenet* (61), *Pankkiyhteydet* (68), *Lainat* (149) and *Tilit* (162); the app has no such tabs (they are cards on Palvelin ja ylläpito, Jäsenet, Pankit ja tilit and Talous).
- done when: the new `tools/test/docs-tabs-troubleshooting.test.ts`, which fails without the change, reads `docs/TROUBLESHOOTING.md` and finds that the name after each `Asetukset > ` is one of the six tab labels written in the test, and the card's heading follows the tab where the guide names a card (`bun test tools/test/docs-tabs-troubleshooting.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: troubleshooting-doc
- after: none
- files: docs/TROUBLESHOOTING.md, tools/test/docs-tabs-troubleshooting.test.ts

### D3 Bank guide, real tabs
Result: The guide to connecting a bank names the tab Pankit ja tilit and its cards, as the app shows them.
- why: `docs/ENABLE_BANKING.md` names *Asetukset > Pankkiyhteydet* (lines 12, 38, 88, 108, 224, 347) and *Asetukset > Tilit* (96, 103, 106, 266) as tabs; both are cards of the one tab Pankit ja tilit, and the same file already uses that name elsewhere, so one guide gives two addresses for one place.
- done when: the new `tools/test/docs-tabs-bank.test.ts`, which fails without the change, reads `docs/ENABLE_BANKING.md` and finds that the name after each `Asetukset > ` is one of the six tab labels written in the test, and the card's heading follows the tab where the guide names a card (`bun test tools/test/docs-tabs-bank.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: bank-doc
- after: none
- files: docs/ENABLE_BANKING.md, tools/test/docs-tabs-bank.test.ts

### D4 Advanced, security: real tabs
Result: The advanced guide and the security page name the tabs of Asetukset that the app has.
- why: `docs/SECURITY.md` names *Tekniset asetukset* (lines 154, 296, 388, 454, 472), *Asetukset > Lainat* (67) and a tab *Palvelin* (101, 578), and `docs/ADVANCED.md` names *Asetukset > Talouden jäsenet* (230) and a tab *Palvelin* (320, 869) beside 14 uses of the real label Palvelin ja ylläpito.
- done when: the new `tools/test/docs-tabs-advanced.test.ts`, which fails without the change, reads `docs/SECURITY.md` and `docs/ADVANCED.md` and finds that the name after each `Asetukset > ` is one of the six tab labels written in the test, whole (Palvelin ja ylläpito, not Palvelin), and the card's heading follows the tab where the guide names a card (`bun test tools/test/docs-tabs-advanced.test.ts`); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: advanced-doc, security-doc
- after: none
- files: docs/ADVANCED.md, docs/SECURITY.md, tools/test/docs-tabs-advanced.test.ts

### D5 Ohjeet link in the footer
Result: The footer of every page has a link Ohjeet (Help in English) that opens the troubleshooting guide in a new tab.
- why: the app's only link to its guides is the one to the maintenance helper on the admin's update panel; a member who sees a notice or a wrong figure has the source link in the footer and nothing that says where the fixes are.
- done when: a test in `apps/web/test/about.test.ts` that fails without the change sees a link with the text Ohjeet to `docs/TROUBLESHOOTING.md` of the project's repository, opened like the source link, and the text is in the catalogue in both languages (`bun test apps/web/test/about.test.ts`, `pnpm strings` runs clean); `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: texts, footer
- after: none
- files: apps/web/src/about.ts, apps/web/src/components/AboutFoot.tsx, packages/core/src/messages-shell.ts, packages/core/src/english/shell.ts, apps/web/test/about.test.ts

### D6 Guides follow the three tabs
Result: The five guides name the three tabs Asetukset has after T74, and one test keeps them to the labels the app shows.
- why: T74 cuts Asetukset to Pankit ja tilit, Kotitalous and Palvelin and its files hold no guide, so the labels D1 to D4 wrote (Talous, Jäsenet, Turvallisuus, Tiedot, Palvelin ja ylläpito) are false again the day it lands, and four tests each hold a copy of the old list.
- done when: the new `tools/test/docs-tabs.test.ts`, which fails without the change, reads the tab labels from `packages/core/src/messages-set-tabs.ts` and finds that the name after each `Asetukset > ` in `docs/INSTALL.md`, `docs/TROUBLESHOOTING.md`, `docs/ENABLE_BANKING.md`, `docs/ADVANCED.md` and `docs/SECURITY.md` is one of them (`bun test tools/test/docs-tabs.test.ts`); `git ls-files 'tools/test/docs-tabs-*.test.ts'` lists nothing; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: install-doc, troubleshooting-doc, bank-doc, advanced-doc, security-doc
- after: T74, D1, D2, D3, D4
- files: docs/INSTALL.md, docs/TROUBLESHOOTING.md, docs/ENABLE_BANKING.md, docs/ADVANCED.md, docs/SECURITY.md, tools/test/docs-tabs.test.ts, tools/test

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

## The checks: fast and steady

Measured on 11 November: a pull request's commit starts the `check` workflow twice, a job waits one to two minutes for
a runner, the tests take 100 to 215 s of a run, and the shell lint burns 107 CPU seconds. The twelve latest red runs
were real failures, none a flake. K1, K2 and K3 share `ci.yml` and so one lock; K4 stands alone.

### K1 One CI run for a PR commit
Result: A commit on a pull request starts the checks once, so the jobs of every branch wait half as long for a runner.
- why: `on.push.branches: ["**"]` and `on.pull_request` in `.github/workflows/ci.yml` both fire for a branch with an open pull request: on 11 November every work branch had a push run and a pull_request run of the same commit, and a job waited one to two minutes for a runner.
- done when: a push starts the workflow only on main, a pull request and a run by hand start it as before; the header comment and the `concurrency` comment of `ci.yml` and the comment of `tools/ci/light-scope.sh` on a new branch say what now starts a run; the PR names every caller of `tools/ci/wait.sh` and every other reader of a commit's checks found by `git grep -n "check-runs\|gh run"`, and none waits for a push run of a branch other than main; the test of `tools/test/release-workflow.test.ts` that pins the trigger holds the new one and still proves that a push to main starts the run the board reads; `gh run list --workflow check` shows one run for the PR's last commit; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: ci-workflow
- after: none
- files: .github/workflows/ci.yml, tools/ci/light-scope.sh, tools/test/release-workflow.test.ts

### K2 CI tests on two runners
Result: The tests of a pull request finish in about half the time, with every test still run once.
- why: the step `Types and tests` took 103 to 108 s of a two minute js job on 11 November, and 129 to 215 s on changes that reach every test; one four core runner runs all of it.
- done when: `CHECK_SHARD=<i>/<n>` makes the tests step of `tools/check.sh` pass `--shard` to vitest, with a scenario in `tools/test/check.test.sh`; the js job of `ci.yml` is a matrix of two shards, the types run in one of them, and `ci-ok` fails when either fails; with `CI=1` the test files of the runs `1/2` and `2/2` add up to those of a run with no shard, with and without `--changed`; the PR's two js jobs pass; on this machine with `CI=1 VITEST_MAX_WORKERS=4` and no `--changed`, so every test runs, the slower shard's tests step takes at most 60 % of the seconds of the run with no shard, and the three figures are in the PR; a rerun (`tools/check/rerun.mjs`) runs a failed file alone and needs no shard, so it is not changed; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: ci-workflow, check-tools
- after: none
- files: .github/workflows/ci.yml, tools/check.sh, tools/test/check.test.sh

### K3 A red CI run says flake or real
Result: A failed test run on GitHub says for each failure whether it passes when run again alone, so a flake is seen and not guessed.
- why: `pnpm check --rerun` decides flake or real only on the machine that ran the check; a red run of `ci.yml` prints the failure and stops, and the board reverts the commit that turned main red. The twelve latest red runs were real, so this is for the first flake, not a known one.
- done when: after a failed `Types and tests` step the js job of `ci.yml` runs `tools/check.sh --rerun` on the folder the red run kept and prints its FLAKE, REAL and NOT RUN lines; the shell job has no Node, which the rerun needs (`tools/check/pinned-node.sh`), so it gets no rerun and keeps printing the logs of its failed suites, and a comment there says so; the js job stays red whatever the rerun says, and the step fits the job's time limit; a test in `tools/test/release-workflow.test.ts` holds the step and its `failure()` condition; a branch with a test made to fail shows the REAL line in its run, linked in the PR, and the test is put back; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: ci-workflow
- after: none
- files: .github/workflows/ci.yml, tools/test/release-workflow.test.ts

### K4 Shell lint burns less CPU
Result: The shell lint of `pnpm check` takes under half the CPU of today in the same time, so checks side by side slow each other less.
- why: `tools/ci/shell-lint.sh` starts half as many shellcheck runs as CPUs and each reads every library again: on 28 CPUs that is 14 runs and 107 CPU seconds in 9 s, where one run of all 119 files takes 14 CPU seconds.
- done when: the number of shellcheck runs has a ceiling, chosen from `time bash tools/ci/shell-lint.sh` with 2, 4 and 8 runs on this machine (the figures are in the PR); the lint's CPU seconds are under half of today's and its seconds on the clock at most 2 more; every file and library is still checked at the same severity, and `tools/test/shell-lint.test.sh` proves the ceiling and that a finding in any group still fails the lint; `python3 ~/.cache/lc-bench/leak-scan.py omatalous` passes and `~/.cache/lc-bench/name-scan.sh` prints nothing.
- locks: shell-lint
- after: none
- files: tools/ci/shell-lint.sh, tools/test/shell-lint.test.sh

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
