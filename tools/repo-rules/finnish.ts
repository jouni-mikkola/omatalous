/**
 * Rule 28 of the repo rules: the app's Finnish keeps out the habits a copy pass took out of it. A pass that reads every
 * text finds a few things a machine can keep from coming back: a calque ("pois lukien", "laskelma olettaa"), a rejected
 * glossary word ("löydös", "syötetty", "keskiostos"), a verb in the te-form, a hyphenated ending glued to a name, and
 * the marks of machine-written prose (an em dash, "ei ... vaan" as a contrast, an exclamation mark that ends a
 * sentence). The texts are the ones `pnpm strings` lists, read through `collect()` of tools/ui-strings.mjs, so the rule
 * and the tool share one list of files. A figure in a sentence without a singular form ("1 veloitusta") is not found
 * here: a regular expression cannot see it.
 */
import { describe, expect, it } from "vitest";
import { collect } from "../ui-strings.mjs";
import { breaks } from "./finnish-patterns.ts";
import { type Finding, ROOT, expectNoFindings } from "./lib.ts";

describe("repo rules: Finnish voice (rule 28)", () => {
  it("rule 28: no text the browser shows breaks a pattern of the Finnish voice", () => {
    // every default folder of `pnpm strings`, and the maintenance page that the tool leaves out until its release
    const rows = collect(ROOT, { also: ["apps/web/src/components/ops"] });
    expect(rows.length, "the scan found the UI texts").toBeGreaterThan(1000);
    const found: Finding[] = [];
    for (const r of rows) {
      for (const p of breaks(r.text)) found.push({ file: r.file, line: r.line, why: `${p.name} (${p.fix}): ${r.text.replace(/\s+/g, " ").slice(0, 80)}` });
    }
    expectNoFindings("Finnish voice", found, "the patterns and their fixes are in tools/repo-rules/finnish.ts; a text that must keep a word (a quoted bank text) needs the pattern narrowed there, with a case in finnish.test.ts.");
  }, 90_000); // reads every text the browser shows: 2 s alone, and a full check on 8 CPUs took over 30
});
