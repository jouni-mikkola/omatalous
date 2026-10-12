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
import { type Finding, ROOT, expectNoFindings } from "./lib.ts";

export interface Pattern {
  name: string;
  re: RegExp;
  /** One line: how to write it instead. */
  fix: string;
}

export const PATTERNS: readonly Pattern[] = [
  { name: "pois lukien", re: /pois lukien/i, fix: 'write "ilman" ("ilman kertaostoja")' },
  { name: "täysi kuukausi", re: /(täy(si|ttä|den)|kokonai(nen|sen|sta))\s+kuukau/iu, fix: 'write "valmis kuukausi" (completeMonths() on the web)' },
  { name: "calque: laskelma olettaa", re: /(?<!\p{L})(laskelma|arvio|sovellus)\s+olettaa/iu, fix: 'write "Laskelmassa oletetaan, että"' },
  { name: "ending glued to a name", re: /\}-\p{Ll}/u, fix: "a name of two words breaks the compound: write the ending as its own word, or leave the name out" },
  { name: "löydös", re: /löyd(ös|öksen|östä|öksi[aä]|ökset)/iu, fix: 'write "vinkki"' },
  { name: "te-form in the past tense", re: /(?<!\p{L})\p{L}{3,}itte(ko|kö)?(?!\p{L})/iu, fix: "address the reader as sinä (\"muutit\") or use the passive" },
  { name: "syötetty", re: /(?<!\p{L})syötetty(?!\p{L})/iu, fix: 'write "annettu"' },
  { name: "keskiostos, skripti", re: /keskiostos|skripti/iu, fix: 'write "ostoskerta keskimäärin" or "asennusohjelma"' },
  // whatever the list found: three marks of machine-written prose
  // the character is built from its code point, so this file holds none (rule 4 reads every file)
  { name: "em dash", re: new RegExp(String.fromCharCode(0x2014)), fix: "write a comma, a colon, parentheses or two sentences" },
  // "ei vain" in a plain sentence has no "vaan"; "ei X, vaan Y" is the contrast
  { name: '"ei ... vaan" as a contrast', re: /(?<!\p{L})(ei|eivät|en|et|emme|ette)(?!\p{L})[^.!?]*?(?<!\p{L})vaan(?!\p{L})/iu, fix: "say the one thing that is true and leave the other out" },
  // a mark that ends a sentence; one inside a quoted bank text ("KIITOS!") stays
  { name: "exclamation mark at the end of a sentence", re: /!(?=\s*$|\s+\p{Lu})/u, fix: "write a plain statement with a full stop" },
];

/** The patterns a text breaks. */
export const breaks = (text: string): Pattern[] => PATTERNS.filter((p) => p.re.test(text));

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
  }, 30_000); // reads every text the browser shows: a loaded machine takes over the five seconds a test gets
});
