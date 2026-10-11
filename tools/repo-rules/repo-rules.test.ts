/**
 * The repo rules: invariants of CLAUDE.md and the structure plan that no compiler checks. They read the working
 * tree (the tracked files, parsed with the TypeScript API that is already a dev dependency), change nothing and run
 * with `pnpm test` and in CI. Stage a new file before running them: an untracked file is not looked at.
 *
 * One test file on purpose: vitest runs each file in its own worker, and every worker would load the compiler
 * and parse the same sources again. Here they load once and share the parse cache, which keeps all rules together
 * under 3 seconds. Each rule is its own `it` in one of the modules below, so a failure names the rule, then
 * `file:line`, then what to do.
 *
 *   rule 1   core is pure                                     code-rules.ts
 *   rule 2   SQL only in db/                                  code-rules.ts
 *   rule 3   every FinanceRepo statement carries user_id      code-rules.ts
 *   rule 4   no em dash in text we write                      text-rules.ts
 *   rule 5   security events written in one place             code-rules.ts
 *   rule 6   import boundaries, baseline, no import cycle     boundaries.ts
 *   rule 7   the ops action list agrees in three places       parity.ts
 *   rule 8   reports are registered, shown and documented     parity.ts
 *   rule 9   file size budget with a shrinking allowlist      size.ts
 *   rule 10  no English in the UI text                        text-rules.ts
 *   rule 11  every report and section has a Decision comment  parity.ts
 *   rule 12  Finnish style: no te-form, "!", banned words      text-rules.ts
 *   rule 13  seeded tests carry a 30 s timeout                timeouts.ts
 *   rule 14  request bodies go through strictObject or parse*  code-rules.ts
 *   rule 15  web does not parse mark subjects                 code-rules.ts
 *   rule 16  no core threshold as a literal in web text       text-rules.ts
 *   rule 17  a series' charges a year only from recurring.ts  code-rules.ts
 *   rule 18  no local month length or month-end string         code-rules.ts
 *   rule 19  historyCovers only in usual.ts and context.ts      code-rules.ts
 *   rule 21  keyword lists only in the dialect files          dialect.ts
 *   rule 22  text a copy pass removed stays out of the UI      text-rules.ts
 *
 * Run one: `pnpm vitest run tools/repo-rules -t "rule 6"`.
 */
import "./code-rules.ts";
import "./dialect.ts";
import "./text-rules.ts";
import "./boundaries.ts";
import "./parity.ts";
import "./size.ts";
import "./timeouts.ts";
