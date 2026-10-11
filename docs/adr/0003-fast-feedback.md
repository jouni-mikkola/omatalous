# 0003 Fast feedback: scoped checks while working, full checks in CI

Status: accepted (0.9.0, H2a)

## Context

One `pnpm check` took 107 s and every worker ran it three or four times per task, mostly for shell suites a diff
could not touch. Four checks at once made the seeded tests time out (127 s each, 5 s default timeout), and vitest hid
the timeout behind `STACK_TRACE_ERROR`, so workers looked for a false finding that was not there.

## Decision

- `pnpm check --changed [base]` is the loop while working: `tsc --incremental` with the build info under
  `node_modules/.cache/tsc`, vitest on the packages the diff touches and their dependents plus the repo rules, the shell
  lint and suites only for a diff that touches shell. A path no rule knows runs all of vitest (`tools/check/scope.mjs`).
- `pnpm check` with no argument and CI stay full. The lead and CI are the gate, the scoped check is a faster guess.
- At most two checks run at once per clone and its worktrees (`tools/slots.sh`, directories under `.git`). A killed
  holder is taken over and a wait ends after 30 minutes, so the lock cannot block for ever.
- Tests that build random households carry a 30 s timeout (repo rule 13), and a timeout is reported as a timeout with
  the command to run it alone.
- Test files have a budget of 800 lines with a baseline that only shrinks (rule 9).
- `tools/worker-start.sh`, `tools/commit.sh`, `pnpm where` and `pnpm shots` replace the by-hand steps every task repeated.

## Consequences

A scoped check can miss a failure that a full check finds: a test that reads a file the scope table does not list. The
table sends unknown paths to the full run, and the full run before hand-back (at most three per task) stays. The new
scripts are shell and Node files in `tools/`, each with its own test.
