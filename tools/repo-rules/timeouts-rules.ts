/**
 * The tests of the rules in timeouts.ts. They sit in a file of their own so that the unit tests of timeouts.ts, which import
 * it, do not register the rules a second time: repo-rules.test.ts is the one file that runs them.
 */
import { describe, expect, it } from "vitest";
import { type Finding, expectNoFindings, isTestFile, parse, readText, repoFiles } from "./lib.ts";
import { MIN_MS, untimedSeeded } from "./timeouts.ts";

describe("repo rules: seeded tests", () => {
  it(`rule 13: a test that builds random households (directly or through a helper) sets a timeout of at least ${MIN_MS / 1000} s`, () => {
    const files = repoFiles().filter((f) => /\.tsx?$/.test(f) && isTestFile(f) && !f.startsWith("tools/repo-rules/") && readText(f).includes("randomHistory("));
    expect(files.length, "the scan found the seeded tests").toBeGreaterThan(3);
    const found: Finding[] = [];
    for (const file of files) {
      for (const { line, ms } of untimedSeeded(parse(file))) found.push({ file, line, why: ms === undefined ? "builds random households and has no timeout" : `builds random households with a timeout of ${ms} ms` });
    }
    expectNoFindings("seeded tests", found, `pass ${MIN_MS.toLocaleString("en").replace(/,/g, "_")} as the last argument of the test: \`it("...", () => { ... }, 30_000)\`.`);
  });
});
