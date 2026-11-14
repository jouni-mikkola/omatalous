/**
 * The repo rules: invariants of CLAUDE.md and the structure plan that no compiler checks. They read the working
 * tree (the tracked files, parsed with the TypeScript API that is already a dev dependency), change nothing and run
 * with `pnpm test` and in CI. They look at the tracked files and at the untracked ones that are not ignored, so a new
 * file meets them before its commit.
 *
 * Three test files, one per group of modules, which the `rules` project of vitest.config.ts runs without isolation: the
 * files that land on one worker share its module cache, so they load the compiler and parse each source once
 * (`warmParse`, warm.ts). The groups are about equal in time, so the run is no longer than its slowest group:
 *   repo-rules.test.ts         the text of the UI and the docs     text-rules, finnish, glossary-rule, dialect
 *   repo-rules-code.test.ts    the code and its imports            code-rules, boundaries, size, timeouts-rules, figures-rules, css-tokens, limiters-rules, sheets-rules
 *   repo-rules-tree.test.ts    the files, scripts and registries   parity, shell-rules, runners-rules, roadmap-rules
 * A new rule module is imported by the file of its group. Each rule is its own `it` in one of the modules, so a failure
 * names the rule, then `file:line`, then what to do.
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
 *   rule 13  seeded tests carry a 30 s timeout                timeouts-rules.ts
 *   rule 14  request bodies go through strictObject or parse*  code-rules.ts
 *   rule 15  web does not parse mark subjects                 code-rules.ts
 *   rule 16  no core threshold as a literal in web text       text-rules.ts
 *   rule 17  a series' charges a year only from recurring.ts  code-rules.ts
 *   rule 18  no local month length or month-end string         code-rules.ts
 *   rule 19  historyCovers only in usual.ts and context.ts      code-rules.ts
 *   rule 21  keyword lists only in the dialect files          dialect.ts
 *   rule 22  text a copy pass removed stays out of the UI      text-rules.ts
 *   rule 23  every job names a fixed runner image             runners-rules.ts
 *   rule 25  no shell file or workflow pipes into grep -q     shell-rules.ts
 *   rule 26  a function defined in scripts/ is named twice    shell-rules.ts
 *   rule 27  the lines that keep a secret out stay ignored    shell-rules.ts
 *   rule 28  the UI text keeps the fixes of a Finnish pass    finnish.ts
 *   rule 34  docs/ROADMAP.md lists no released version as coming roadmap-rules.ts
 *   rule 35  the UI text keeps the glossary: removed words stay out, a settings path names a tab   glossary-rule.ts (words: glossary.ts, paths: ui-paths.ts)
 *   rule 36  no window.confirm, alert or prompt in the web app    code-rules.ts
 *   rule 37  one name, one figure: the registry agrees with the code   figures-rules.ts (detector: figures.ts)
 *   rule 38  a limit is in thresholds.ts, not a constant of analysis/ or reports/   figures-rules.ts
 *   rule 39  no median or mean of its own in analysis/ or reports/: the expected figure   figures-rules.ts
 *   rule 40  the look comes from tokens: no new px, colour or font-size literal, baseline only shrinks   css-tokens.ts (detector: css-look.ts)
 *   rule 41  only the files on card-users.json import Card, the list only shrinks   css-tokens.ts
 *   rule 42  a rate limiter is built from the limits schema, not a number written at the call   limiters-rules.ts (detector: limiters.ts)
 *   rule 43  no hand-written Finnish locale tag: LOCALE of core locale.ts is the one   code-rules.ts
 *   rule 44  the payment rules review note is at most 6 months old   roadmap-rules.ts
 *   rule 45  no style attribute in the web app (style-src has no 'unsafe-inline')   code-rules.ts
 *   rule 46  an own class selector is styled in one stylesheet, base.css apart   css-tokens.ts (detector: css-look.ts)
 *   rule 48  a class a component writes is styled by a sheet its page loads   sheets-rules.ts (detector: sheets.ts)
 *   rule 49  two rows are paired by amount only in pairing.ts   code-rules.ts
 *
 * Run one: `pnpm vitest run tools/repo-rules -t "rule 6"`.
 */
import { warmParse } from "./warm.ts";
import "./text-rules.ts";
import "./finnish.ts";
import "./glossary-rule.ts";
import "./dialect.ts";

warmParse();
