/** Rules 37, 38, 39, 52 and 53. The detectors are in figures.ts, whose unit tests do not register the rules a second time. */
import { describe, expect, it } from "vitest";
import { FIGURES } from "../../packages/core/src/figures.ts";
import { type Finding, expectNoFindings, lineIn, parse, readText, repoFiles, sourceFiles } from "./lib.ts";
import { figureProblems, figureWords, looseLimits, ownLevels, partWholeProblems, partWholeReads, shapeProblems, wordProblems } from "./figures.ts";

const REGISTRY = "packages/core/src/figures.ts";
const BASELINE = "tools/repo-rules/limits-baseline.txt";
const LEVELS_BASELINE = "tools/repo-rules/levels-baseline.txt";
const WORDS_BASELINE = "tools/repo-rules/figure-words-baseline.txt";
const PART_WHOLE_BASELINE = "tools/repo-rules/part-whole-baseline.txt";
const MONEY_FLOWS = "docs/MONEY_FLOWS.md";
/** Where a limit must come from thresholds.ts. */
const LIMIT_DIRS = ["packages/core/src/analysis/", "packages/core/src/reports/"];

describe("repo rules: figures and limits", () => {
  it("rule 37: the figure registry gives one name to one figure, and every source is in its file", () => {
    const found: Finding[] = figureProblems(FIGURES, (file) => (repoFiles().includes(`packages/core/src/${file}`) ? readText(`packages/core/src/${file}`) : null)).map((p) => ({
      file: REGISTRY,
      line: lineIn(REGISTRY, `  ${p.id}: {`),
      why: `${p.id}: ${p.why}`,
    }));
    expectNoFindings("figure registry", found, `fix the entry in ${REGISTRY}. Two figures that differ get two names, and the definition says how they differ (ADR 0020).`);
  });

  it("rule 38: a limit of a figure is written in thresholds.ts, not as a constant of analysis/ or reports/ (the baseline only shrinks)", () => {
    const baseline = new Set(readText(BASELINE).split("\n").filter(Boolean));
    const seen = new Set<string>();
    const found: Finding[] = [];
    for (const file of sourceFiles(...LIMIT_DIRS)) {
      for (const { name, line } of looseLimits(parse(file))) {
        const key = `${file}  ${name}`;
        seen.add(key);
        if (!baseline.has(key)) found.push({ file, line, why: `const ${name} is a number written where it is used: put it in packages/core/src/thresholds.ts with its unit and reason` });
      }
    }
    for (const key of baseline) if (!seen.has(key)) found.push({ file: BASELINE, line: lineIn(BASELINE, key), why: `no longer a loose limit, delete the line: ${key}` });
    expectNoFindings("limits", found, "add the limit to THRESHOLDS in packages/core/src/thresholds.ts. Do not add it to the baseline.");
  });

  it("rule 39: a file of analysis/ or reports/ takes no median or mean of its own: the expected figure is made in expected.ts (the baseline only shrinks)", () => {
    const baseline = new Set(readText(LEVELS_BASELINE).split("\n").filter(Boolean));
    const seen = new Set<string>();
    const found: Finding[] = [];
    for (const file of sourceFiles(...LIMIT_DIRS)) {
      for (const { name, line } of ownLevels(parse(file))) {
        const key = `${file}  ${name}`;
        seen.add(key);
        if (!baseline.has(key)) found.push({ file, line, why: `${name} over values: what a month, a category or an income is expected to be comes from expectedFor, expectedSpending, expectedIncome or expectedLevel in analysis/expected.ts (ADR 0021)` });
      }
    }
    for (const key of baseline) if (!seen.has(key)) found.push({ file: LEVELS_BASELINE, line: lineIn(LEVELS_BASELINE, key), why: `no longer takes its own level, delete the line: ${key}` });
    expectNoFindings("levels", found, "call expectedLevel or the figure of analysis/expected.ts. Do not add the file to the baseline.");
  });
});

describe("repo rules: the one definition of a figure (ADR 0020)", () => {
  it("rule 52: every figure of the registry says its scope, whether it is additive and its one function, and every figure word of docs/MONEY_FLOWS.md is in the registry (the baseline only shrinks)", () => {
    const found: Finding[] = shapeProblems(FIGURES).map((p) => ({ file: REGISTRY, line: lineIn(REGISTRY, `  ${p.id}: {`), why: `${p.id}: ${p.why}` }));
    const words = figureWords(readText(MONEY_FLOWS));
    expect(words.length, "the table of docs/MONEY_FLOWS.md has its figure words").toBeGreaterThan(10);
    const names = new Set(Object.values(FIGURES).map((f) => f.name.toLowerCase()));
    const baseline = readText(WORDS_BASELINE).split("\n").filter(Boolean);
    for (const p of wordProblems(words, names, baseline)) found.push({ file: p.where === "doc" ? MONEY_FLOWS : WORDS_BASELINE, line: p.line, why: p.why });
    expectNoFindings("figure definitions", found, `give the entry its scope, additive and source.fn in ${REGISTRY}. A word of the table is a figure of the registry, and a word that is not yet one goes on the baseline only when it is no figure at all.`);
  });

  it("rule 53: no new read of paymentCents or wholeCents, the whole of a bank's payment or of a row beside the viewer's part: each file reads each field at most as often as its baseline line counts (the baseline only shrinks)", () => {
    const baseline = readText(PART_WHOLE_BASELINE).split("\n").filter(Boolean);
    const reads: { key: string; line: number }[] = [];
    for (const file of sourceFiles("packages/core/src/", "apps/server/src/", "apps/web/src/")) {
      for (const { name, line } of partWholeReads(parse(file))) reads.push({ key: `${file}  ${name}`, line });
    }
    const found: Finding[] = partWholeProblems(reads, baseline).map((p) => ({
      file: p.where === "source" ? p.key.split("  ")[0]! : PART_WHOLE_BASELINE,
      line: p.line,
      why: p.why,
    }));
    expectNoFindings("part and whole", found, "read the part of the figure and leave the whole to the code that names the loan or the row (ADR 0016). Do not raise a count in the baseline.");
  });
});
