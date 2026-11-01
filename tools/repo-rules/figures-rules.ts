/** Rules 37, 38 and 39. The detectors are in figures.ts, whose unit tests do not register the rules a second time. */
import { describe, it } from "vitest";
import { FIGURES } from "../../packages/core/src/figures.ts";
import { type Finding, expectNoFindings, lineIn, parse, readText, repoFiles, sourceFiles } from "./lib.ts";
import { figureProblems, looseLimits, ownLevels } from "./figures.ts";

const REGISTRY = "packages/core/src/figures.ts";
const BASELINE = "tools/repo-rules/limits-baseline.txt";
const LEVELS_BASELINE = "tools/repo-rules/levels-baseline.txt";
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
