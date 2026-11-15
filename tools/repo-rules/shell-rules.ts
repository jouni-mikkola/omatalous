/**
 * The tests of the rules in shell.ts. They sit in a file of their own so that the unit tests of shell.ts, which import
 * it, do not register the rules a second time: repo-rules.test.ts is the one file that runs them.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type Finding, ROOT, expectNoFindings, readText, repoFiles } from "./lib.ts";
import { SECRET_PATHS, definitions, isShellFile, namedElsewhere, notIgnored, quietGrepPipes } from "./shell.ts";

describe("repo rules: shell scripts", () => {
  it("rule 25: no shell file and no workflow pipes into grep -q (under pipefail a match reads as a miss)", () => {
    const files = repoFiles().filter((f) => isShellFile(f) || /^\.github\/.+\.ya?ml$/.test(f));
    expect(files.length, "the scan found the shell files").toBeGreaterThan(30);
    const found: Finding[] = [];
    for (const file of files) for (const { line, why } of quietGrepPipes(readText(file))) found.push({ file, line, why });
    expectNoFindings("grep -q behind a pipe", found, "write `... | grep PATTERN >/dev/null` (and keep the options but q). grep -q on a file is fine.");
  });

  it("rule 26: a function defined in a file under scripts/ is named a second time under scripts/", () => {
    const files = repoFiles().filter((f) => f.startsWith("scripts/") && isShellFile(f));
    expect(files.length, "the scan found the scripts").toBeGreaterThan(10);
    const all = files.map((f) => readText(f)).join("\n");
    const found: Finding[] = [];
    for (const file of files) {
      for (const { name, line } of definitions(readText(file))) {
        if (!namedElsewhere(all, name)) found.push({ file, line, why: `${name} is defined and never named again under scripts/` });
      }
    }
    expectNoFindings("function nothing calls", found, "delete the function (and its test, if one reads it), or call it. A name used only in tools/test does not count.");
  });

  it("rule 27: .gitignore keeps the files that hold a secret out of the repository", () => {
    expect(existsSync(resolve(ROOT, ".git")), "the rule needs git").toBe(true);
    const open = notIgnored(ROOT, SECRET_PATHS);
    expectNoFindings(
      "secret files not ignored",
      open.map((p) => ({ file: ".gitignore", line: 1, why: `git does not ignore ${p}` })),
      "a line of .gitignore no longer matches it: put the line back, or the next `git add -A` commits a secret.",
    );
  });
});
