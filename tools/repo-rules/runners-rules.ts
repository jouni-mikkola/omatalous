/**
 * The tests of the rules in runners.ts. They sit in a file of their own so that the unit tests of runners.ts, which import
 * it, do not register the rules a second time: repo-rules.test.ts is the one file that runs them.
 */
import { describe, expect, it } from "vitest";
import { type Finding, expectNoFindings, readText, repoFiles } from "./lib.ts";
import { RUNNERS, floatingRunners } from "./runners.ts";

describe("repo rules: runners", () => {
  it(`rule 23: every job of a workflow runs on ${RUNNERS.join(" or ")}, never on a -latest label`, () => {
    const files = repoFiles().filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
    expect(files.length, "the scan found the workflows").toBeGreaterThan(0);
    const found: Finding[] = [];
    let jobs = 0;
    for (const file of files) {
      const text = readText(file);
      jobs += text.split("\n").filter((l) => /^\s*runs-on\s*:/.test(l)).length;
      for (const { line, why } of floatingRunners(text)) found.push({ file, line, why });
    }
    expect(jobs, "the scan found the runs-on lines").toBeGreaterThan(0);
    expectNoFindings("runners", found, `write \`runs-on: ${RUNNERS[0]}\` on a line of its own, or a matrix key whose every value is ${RUNNERS.join(" or ")}. To move to a newer image, change RUNNERS in tools/repo-rules/runners.ts with the workflows and run the release workflow with dry_run before the next release.`);
  });
});
