/**
 * The repo rules: invariants of CLAUDE.md and the structure plan that no compiler checks. They read the working
 * tree (the tracked files, parsed with the TypeScript API that is already a dev dependency), change nothing and run
 * with `pnpm test` and in CI. They look at the tracked files and at the untracked ones that are not ignored, so a new
 * file meets them before its commit.
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
 *   rule 24  an export of core or the server has a reader     exports-rule.ts (detector: exports.ts)
 *   rule 25  no shell file or workflow pipes into grep -q     shell-rules.ts
 *   rule 26  a function defined in scripts/ is named twice    shell-rules.ts
 *   rule 27  the lines that keep a secret out stay ignored    shell-rules.ts
 *   rule 28  the UI text keeps the fixes of a Finnish pass    finnish.ts
 *   rule 29  feature registries, identity, files, needs         modules.ts
 *   rule 30  only a registry imports a module                     modules.ts
 *   rule 31  a module folder and its files stay small             modules.ts
 *   rule 32  a module exports `module`; its fixture, three cases   modules.ts
 *   rule 33  no loop in `uses`; the type-import group has a ceiling modules.ts
 *   rule 34  docs/ROADMAP.md lists no released version as coming roadmap-rules.ts
 *   rule 35  the UI text keeps the glossary: removed words stay out glossary-rule.ts (words: glossary.ts)
 *
 * Run one: `pnpm vitest run tools/repo-rules -t "rule 6"`.
 */
import { beforeAll } from "vitest";
import { parse, sourceFiles } from "./lib.ts";
import "./code-rules.ts";
import "./dialect.ts";
import "./text-rules.ts";
import "./boundaries.ts";
import "./parity.ts";
import "./size.ts";
import "./timeouts-rules.ts";
import "./runners-rules.ts";
import "./exports-rule.ts";
import "./shell-rules.ts";
import "./modules.ts";
import "./roadmap-rules.ts";
import "./glossary-rule.ts";

// The sources every rule walks are parsed once, here, and not inside whichever rule runs first: that rule would carry the
// whole cost of the cold start in its own timeout (a full check on a busy machine took over 20 s for it). The hook has
// the time the parse needs; a rule's timeout then measures that rule.
beforeAll(() => {
  for (const f of sourceFiles("packages/", "apps/", "tools/findings/")) parse(f);
}, 300_000);
