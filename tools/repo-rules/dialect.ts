/**
 * Rule 21 of the repo rules: the bank dialect is data (ADR 0008). Payee, keyword, issuer and lender lists live in the
 * dialect files as named predicates, and every other core file calls those. A list here is an upper-case regex
 * alternation of three or more words, in a regex literal or in a string a regex is built from. Lists outside the
 * dialect files today are in BASELINE, which only shrinks: an entry that no longer occurs fails too.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { type Finding, expectNoFindings, lineIn, lineOf, parse, sourceFiles, walk } from "./lib.ts";

const SELF = "tools/repo-rules/dialect.ts";
const DIALECT = /^packages\/core\/src\/(categorize\.ts|wording(-loan-pages|-lenders|-car|-swedish|-shops)?\.ts|industry\.ts|merchant\.ts)/;

/** `file  start of the list`: lists that still sit outside the dialect files. */
const BASELINE: readonly string[] = [
  "packages/core/src/analysis/alerts.ts  ONEDRIVE|MICROSOFT ?365|OFFICE ?365",
  "packages/core/src/analysis/income.ts  LOMARAHA[A-Z]*|LOMAPALKKA|SEMESTERPENNIN",
  "packages/core/src/analysis/income.ts  LOMAKORVAUS|SEMESTERERSATTNING|PALKKIO|K",
  "packages/core/src/analysis/income.ts  KELA|FPA|KANSANELAKELAITOS|FOLKPENSIONSA",
  "packages/core/src/analysis/income.ts  [A-Z]*ASUMISTUKI|ASUMISLISA|BOSTADSBIDRA",
  "packages/core/src/analysis/income.ts  OPINTOTUKI|OPINTORAHA|STUDIEPENNING|STUD",
  "packages/core/src/analysis/income.ts  YLEISTUKI|TYOMARKKINATUKI|PERUSPAIVARAHA",
  "packages/core/src/analysis/income.ts  VANHEMPAIN(?:PAIVA)?RAHA|AITIYSRAHA|ISYY",
  "packages/core/src/analysis/income.ts  KOTIHOIDON ?TUKI|JOUSTAVA HOITORAHA|OSIT",
  "packages/core/src/analysis/income.ts  KANSANELAKE|TAKUUELAKE|ELAKETUKI|FOLKPEN",
  "packages/core/src/analysis/income.ts  [A-Z]*TYOTTOMYYSKASSA[A-Z]*|ERILLISKASSA",
];

/** An alternative that is a word or a phrase in capitals once the regex syntax around it is gone. */
function isWord(alternative: string): boolean {
  const bare = alternative.replace(/\\[bBsdw]|\[[^\]]*\]|\(\?(?:<?[=!]|:)|[()?*+^$]|\{\d+(?:,\d*)?\}/g, "");
  return /[A-ZÄÖ]{2,}/.test(bare) && !/[a-zäö]/.test(bare);
}

/** The longest run of upper-case words between `|` in a pattern's text. */
function longestRun(text: string): number {
  let best = 0;
  let run = 0;
  for (const alternative of text.split("|")) {
    run = isWord(alternative) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function listsIn(file: string): { text: string; line: number }[] {
  const sf = parse(file);
  const out: { text: string; line: number }[] = [];
  walk(sf, (n) => {
    let text: string | undefined;
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral) text = (n as ts.RegularExpressionLiteral).text.replace(/^\/|\/[a-z]*$/g, "");
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
    else if (ts.isTemplateExpression(n)) text = n.head.text + n.templateSpans.map((s) => `\u0000${s.literal.text}`).join("");
    if (text !== undefined && text.includes("|") && longestRun(text) >= 3) out.push({ text, line: lineOf(sf, n) });
  });
  return out;
}

const keyOf = (file: string, text: string) => `${file}  ${text.replace(/^\(\?<!\[A-Z0-9\]\)\(\?:/, "").slice(0, 40)}`;

let scanned: { key: string; file: string; line: number }[] | undefined;
function scan() {
  if (scanned) return scanned;
  scanned = [];
  for (const file of sourceFiles("packages/core/src/")) {
    if (DIALECT.test(file)) continue;
    for (const { text, line } of listsIn(file)) scanned.push({ key: keyOf(file, text), file, line });
  }
  return scanned;
}

describe("repo rules: bank dialect (rule 21)", () => {
  it("rule 21a: an upper-case keyword list sits in categorize.ts, wording.ts, wording-loan-pages.ts, wording-lenders.ts, wording-car.ts, wording-swedish.ts, wording-shops.ts, industry.ts or merchant.ts, except the baseline", () => {
    expect(longestRun("SATO|KOJAMO|LUMO"), "the scan sees a list").toBe(3);
    expect(longestRun(String.raw`\d{1,2}\.\d{1,2}|[−-]?\d+`), "and no number pattern").toBe(0);
    const base = new Set(BASELINE);
    const found: Finding[] = scan()
      .filter((l) => !base.has(l.key))
      .map((l) => ({ file: l.file, line: l.line, why: `keyword list outside the dialect files: ${l.key.split("  ")[1]}` }));
    expectNoFindings("bank dialect", found, "move the list to wording.ts (or categorize.ts, industry.ts) behind a named predicate such as isLateFeeText and call that (ADR 0008). Do not add it to BASELINE.");
  });

  it("rule 21b: every baseline entry still occurs, so the list shrinks when a list moves", () => {
    const live = new Set(scan().map((l) => l.key));
    const found: Finding[] = BASELINE.filter((b) => !live.has(b)).map((b) => ({ file: SELF, line: lineIn(SELF, b), why: `baseline entry no longer occurs, delete it: ${b}` }));
    expectNoFindings("bank dialect baseline", found, "remove the listed lines from BASELINE in tools/repo-rules/dialect.ts. Good: the list moved.");
  });
});
