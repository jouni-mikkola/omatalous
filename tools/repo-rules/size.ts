/**
 * Rule 9 of the repo rules: a file budget. Long files are where parallel work collides and where a reader loses the
 * thread, so a source file over BUDGET lines fails unless it is on LARGE_FILES. That list only shrinks: its entries
 * are today's large files, each capped 10 lines above its size, and the cap follows the file down.
 *
 * Counted: TypeScript, TSX and CSS under apps/<app>/src and packages/<package>/src, and shell scripts. A test file has
 * a budget of its own, TEST_BUDGET: every worker reads the whole file before adding to it, and the long ones are the
 * ones every new report, rule or action appends to.
 */
import { describe, expect, it } from "vitest";
import { type Finding, expectNoFindings, lineCount, lineIn, repoFiles } from "./lib.ts";

const SELF = "tools/repo-rules/size.ts";
const BUDGET = 500;
/** Lines a cap may sit above its file's size before the cap must come down. */
const SLACK = 50;
const TEST_BUDGET = 800;

/**
 * Line caps for the files over the budget today (size plus 10). A change that needs more room splits the file
 * instead. After a split the cap is set to the new size plus 10, and when a file is down to BUDGET lines or fewer its
 * line is deleted.
 */
const LARGE_FILES: Record<string, number> = {
  // the rule table and the recurring detector read top to bottom; split by concern when next touched
  "packages/core/src/categorize.ts": 596,
  "packages/core/src/recurring.ts": 570,
  // the installer and the maintenance helper: one script each, with their own shell suites
  "scripts/install.sh": 905,
  "scripts/ops-helper.sh": 746,
};

/** Line caps for the test files over TEST_BUDGET today (size plus 10), shrinking in the same way. */
const LARGE_TESTS: Record<string, number> = {
  // one scenario per function over a fake host: split by topic when next touched
  "tools/test/ops-helper.test.sh": 1043,
  "apps/server/test/optimise.test.ts": 820,
};

describe("repo rules: size", () => {
  it(`rule 9: a source file over ${BUDGET} lines is on the shrinking LARGE_FILES list, within its cap and at most ${SLACK} lines under it`, () => {
    const sources = repoFiles().filter(
      (f) => !/(^|\/)(test|fixtures)\//.test(f) && !f.endsWith(".d.ts") && (/^(apps|packages)\/[^/]+\/src\/.+\.(tsx?|css)$/.test(f) || (f.endsWith(".sh") && !f.endsWith(".test.sh"))),
    );
    expect(sources.length, "the scan found the sources").toBeGreaterThan(100);
    const found: Finding[] = [];
    for (const file of sources) {
      const lines = lineCount(file);
      const cap = LARGE_FILES[file];
      if (lines > BUDGET && cap === undefined) found.push({ file, line: lines, why: `${lines} lines, the budget is ${BUDGET}: split it by responsibility into a folder of smaller modules` });
      else if (cap !== undefined && lines > cap) found.push({ file, line: lines, why: `${lines} lines, over its cap of ${cap}: split it instead of growing it` });
    }
    for (const [file, cap] of Object.entries(LARGE_FILES)) {
      const at = { file: SELF, line: lineIn(SELF, `"${file}"`) };
      if (!sources.includes(file)) found.push({ ...at, why: `${file} is on LARGE_FILES but does not exist (moved or split): delete its line` });
      else if (lineCount(file) <= BUDGET) found.push({ ...at, why: `${file} is down to ${lineCount(file)} lines, under the budget of ${BUDGET}: delete its line (cap ${cap})` });
      else if (cap - lineCount(file) > SLACK) found.push({ ...at, why: `${file} has ${lineCount(file)} lines, ${cap - lineCount(file)} under its cap of ${cap}: lower the cap to ${lineCount(file) + 10}` });
    }
    expectNoFindings("file size budget", found, `keep files under ${BUDGET} lines. The list in ${SELF} only shrinks: never add a file or raise a cap.`);
  });

  it(`rule 9: a test file over ${TEST_BUDGET} lines is on the shrinking LARGE_TESTS list, within its cap and at most ${SLACK} lines under it`, () => {
    const tests = repoFiles().filter((f) => /\.(test|spec)\.(tsx?|sh)$/.test(f));
    expect(tests.length, "the scan found the tests").toBeGreaterThan(50);
    const found: Finding[] = [];
    for (const file of tests) {
      const lines = lineCount(file);
      const cap = LARGE_TESTS[file];
      if (lines > TEST_BUDGET && cap === undefined) found.push({ file, line: lines, why: `${lines} lines, the budget for a test file is ${TEST_BUDGET}: split it by topic` });
      else if (cap !== undefined && lines > cap) found.push({ file, line: lines, why: `${lines} lines, over its cap of ${cap}: split it instead of growing it` });
    }
    for (const [file, cap] of Object.entries(LARGE_TESTS)) {
      const at = { file: SELF, line: lineIn(SELF, `"${file}"`) };
      if (!tests.includes(file)) found.push({ ...at, why: `${file} is on LARGE_TESTS but does not exist (moved or split): delete its line` });
      else if (lineCount(file) <= TEST_BUDGET) found.push({ ...at, why: `${file} is down to ${lineCount(file)} lines, under the budget of ${TEST_BUDGET}: delete its line (cap ${cap})` });
      else if (cap - lineCount(file) > SLACK) found.push({ ...at, why: `${file} has ${lineCount(file)} lines, ${cap - lineCount(file)} under its cap of ${cap}: lower the cap to ${lineCount(file) + 10}` });
    }
    expectNoFindings("test file size budget", found, `keep test files under ${TEST_BUDGET} lines. The list in ${SELF} only shrinks: never add a file or raise a cap.`);
  });
});
