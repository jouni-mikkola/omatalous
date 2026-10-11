import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { report, SLOW_MS, slowTests } from "./report.mjs";

const CWD = "/repo/";
type T = { status: string; title: string; fullName: string; duration: number | null; failureMessages: string[] };
const test = (title: string, ms: number | null, status = "passed", failureMessages: string[] = []): T => ({ status, title, fullName: `suite ${title}`, duration: ms, failureMessages });
const file = (name: string, tests: T[], status = "passed") => ({ name: `${CWD}${name}`, status, assertionResults: tests });
const result = (files: ReturnType<typeof file>[], extra = {}) => ({
  numTotalTests: files.reduce((n, f) => n + f.assertionResults.length, 0),
  numFailedTests: files.reduce((n, f) => n + f.assertionResults.filter((a) => a.status === "failed").length, 0),
  testResults: files,
  ...extra,
});

describe("check: the vitest step's report", () => {
  it("a clean run is one summary line when no test took more than 2 s", () => {
    const r = result([file("a/test/x.test.ts", [test("one", 40), test("two", SLOW_MS)])], { numPendingTests: 1 });
    expect(report(r, CWD)).toEqual(["2 tests in 1 files, 1 skipped"]);
  });

  it("names the three slowest tests over 2 s, slowest first, with the file to rerun", () => {
    const r = result([
      file("a/test/x.test.ts", [test("a", 2100), test("b", 7800)]),
      file("b/test/y.test.ts", [test("c", 3200), test("d", 2600), test("fast", 90)]),
    ]);
    expect(report(r, CWD)).toEqual([
      "5 tests in 2 files",
      "  slow 7.8 s: a/test/x.test.ts > suite b",
      "  slow 3.2 s: b/test/y.test.ts > suite c",
      "  slow 2.6 s: b/test/y.test.ts > suite d",
    ]);
  });

  it("a test that did not run (no duration) is not slow", () => {
    const r = result([file("a/test/x.test.ts", [test("skipped", null, "pending")])]);
    expect(slowTests(r as never, CWD)).toEqual([]);
  });

  it("a timeout keeps the wording the landing script reads, and the slow tests follow the failures", () => {
    const stack = "Error: STACK_TRACE_ERROR\n    at Object.it (/repo/a/test/x.test.ts:9:3)";
    const r = result([file("a/test/x.test.ts", [test("stuck on load", 5100, "failed", [stack]), test("long but fine", 4300)])]);
    const lines = report(r, CWD);
    expect(lines[0]).toMatch(/^1 of 2 tests failed, 1 timed out$/);
    // the landing script: `\(([0-9]+) of [0-9]+ tests? failed, ([0-9]+) timed out` after "check: tests FAILED", and this line
    expect(lines).toContain('    timed out under load (ran 5.1 s): run it alone once: pnpm test a/test/x.test.ts -t "stuck on load"');
    // the failed test is reported once, as a failure, not again as slow
    expect(lines.filter((l) => l.startsWith("  slow "))).toEqual(["  slow 4.3 s: a/test/x.test.ts > suite long but fine"]);
    expect(lines.findIndex((l) => l.startsWith("  slow "))).toBeGreaterThan(lines.findIndex((l) => l.startsWith("  FAIL ")));
  });

  it("an assertion failure shows its first lines and where, without the slow list when nothing is slow", () => {
    const msg = "AssertionError: expected 1 to be 2\n    at /repo/node_modules/x.js:1:1\n    at /repo/a/test/x.test.ts:12:5";
    const lines = report(result([file("a/test/x.test.ts", [test("wrong", 20, "failed", [msg])])]), CWD);
    expect(lines).toEqual([
      "1 of 1 tests failed",
      "  FAIL a/test/x.test.ts > suite wrong",
      "    AssertionError: expected 1 to be 2",
      "    at a/test/x.test.ts:12:5",
      "  rerun one file: pnpm test a/test/x.test.ts",
    ]);
  });

  it("prints nothing and exits 2 for a result file that is not there, so check.sh says vitest did not run", () => {
    const run = (path: string) => spawnSync(process.execPath, [join(import.meta.dirname, "report.mjs"), path], { encoding: "utf8" });
    const missing = run(join(mkdtempSync(join(tmpdir(), "report-")), "none.json"));
    expect(missing).toMatchObject({ status: 2, stdout: "" });
    const ok = join(mkdtempSync(join(tmpdir(), "report-")), "r.json");
    writeFileSync(ok, JSON.stringify(result([file("/x.test.ts", [test("one", 10)])])));
    expect(run(ok)).toMatchObject({ status: 0, stdout: "1 tests in 1 files\n" });
  });
});
