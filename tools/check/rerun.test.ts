import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempDir } from "../lib/tmp-kit.ts";
import { decide, e2eFailures, failures, history, main, parseE2e, recordedEnv, type Failure, type Runners } from "./rerun.mjs";

const ROOT = "/repo";
type A = { status: string; title: string; fullName: string };
const a = (title: string, status = "passed"): A => ({ status, title, fullName: `suite ${title}` });
const vitestJson = (files: Record<string, A[]>, failedFiles: string[] = []) => ({
  testResults: Object.entries(files).map(([name, assertionResults]) => ({
    name: `${ROOT}/${name}`,
    status: assertionResults.some((x) => x.status === "failed") || failedFiles.includes(name) ? "failed" : "passed",
    assertionResults,
  })),
});

/** A kept red check folder: a vitest result and shell jobs (id, suite, scenario; the rc of each). */
function redRun(parent: string, name: string, o: { vitest?: object; jobs?: [string, string, string, number][]; steps?: string[]; typesRc?: number } = {}) {
  const dir = join(parent, name);
  mkdirSync(dir, { recursive: true });
  if (o.vitest) writeFileSync(join(dir, "vitest.json"), JSON.stringify(o.vitest));
  if (o.jobs) {
    writeFileSync(join(dir, "sh-jobs"), o.jobs.map(([id, f, n]) => `${id}\t${f}\t${n}\n`).join(""));
    for (const [id, , , rc] of o.jobs) writeFileSync(join(dir, `sh-${id}.rc`), `${rc}\n`);
  }
  if (o.steps) writeFileSync(join(dir, "failed-steps"), o.steps.join("\n") + "\n");
  if (o.typesRc !== undefined) writeFileSync(join(dir, "types.log.rc1"), `${o.typesRc}\n`);
  return dir;
}

/** The output of a red `pnpm e2e` (Playwright's list reporter, made-up titles): gamma:139 has a cross at two scales and passed on
 * its retry, only delta:102 is under "1 failed", and the stack line in its failure holds a spec path of its own. */
const E2E_RED = `
  ✓    8 e2e/alpha.spec.ts:34:1 › first thing is shown (4.2s)
  ✘  122 e2e/gamma.spec.ts:139:3 › the picture drawn at scale 1, also gives the rate (4.1s)
  ✓  134 e2e/gamma.spec.ts:125:3 › the picture drawn at scale 2, fills the form (2.7s)
  ✘  180 e2e/gamma.spec.ts:139:3 › the picture drawn at scale 2, also gives the rate (2.6s)
  ✘  191 e2e/delta.spec.ts:102:1 › the month of the joint account: paid, share and who paid over (14.5s)
  -  218 e2e/delta.spec.ts:120:1 › a later step of the same group
  ✓  216 e2e/omega.spec.ts:245:1 › the last thing is shown (7.5s)


  1) e2e/delta.spec.ts:102:1 › the month of the joint account: paid, share and who paid over 

    Error: the figures of someone
      at standing (/tmp/wt/e2e/delta.spec.ts:89:87)

  1 failed
    e2e/delta.spec.ts:102:1 › the month of the joint account: paid, share and who paid over 
  1 did not run
  218 passed (1.5m)
`;

const runners = (o: Partial<Runners> = {}): Runners => ({
  vitest: () => ({ ran: true, passed: new Set(), failed: new Set() }),
  sh: () => true,
  e2e: () => ({ failed: new Set(), passed: new Set() }),
  ...o,
});

describe("check --rerun: what failed", () => {
  it("reads the failed test of a file, a file that did not run, and the failed shell jobs", () => {
    const parent = tempDir("rerun-");
    const dir = redRun(parent, "check.a", {
      vitest: vitestJson({ "x/a.test.ts": [a("one"), a("two", "failed")], "x/b.test.ts": [] }, ["x/b.test.ts"]),
      jobs: [["01", "tools/test/s.test.sh", "", 0], ["02", "tools/test/s.test.sh", "t_x", 1]],
    });
    expect(failures(dir, ROOT)).toEqual([
      { kind: "vitest", file: "x/a.test.ts", name: "suite two" },
      { kind: "vitest", file: "x/b.test.ts", name: "(file did not run)" },
      { kind: "sh", file: "tools/test/s.test.sh", name: "t_x" },
    ]);
  });

  it("a red type check or lint, and a step it cannot name, are failures of their own that no rerun can clear", () => {
    const parent = tempDir("rerun-");
    expect(failures(redRun(parent, "check.t", { vitest: vitestJson({}), typesRc: 2 }), ROOT)).toEqual([{ kind: "step", file: "types", name: "type errors do not change on a rerun" }]);
    expect(failures(redRun(parent, "check.l", { vitest: vitestJson({}), steps: ["lint"] }), ROOT).map((f) => f.file)).toEqual(["lint"]);
    expect(failures(redRun(parent, "check.n", { steps: ["tests"] }), ROOT)).toEqual([{ kind: "step", file: "tests", name: "vitest gave no result" }]);
    expect(failures(redRun(parent, "check.g", { vitest: vitestJson({ "x/a.test.ts": [a("one")] }), steps: ["tests"] }), ROOT).map((f) => f.name)).toEqual(["no failed test found"]);
  });

  it("reads the failed specs from the summary: a cross that passed on its retry, a stack line and a skipped test are not failures", () => {
    const p = parseE2e(E2E_RED);
    expect([...p.failed]).toEqual([["e2e/delta.spec.ts:102", "the month of the joint account: paid, share and who paid over"]]);
    expect([...p.passed]).toEqual(["e2e/alpha.spec.ts:34", "e2e/gamma.spec.ts:125", "e2e/omega.spec.ts:245"]);
    expect(e2eFailures(E2E_RED).map((f) => f.file)).toEqual(["e2e/delta.spec.ts:102"]);
  });

  it("records the environment of the run for the rerun, only the names it knows", () => {
    const dir = tempDir("rerun-");
    writeFileSync(join(dir, "env"), "CHECK_FRESH=1\nEVIL=1\nTZ=Europe/Helsinki\n");
    expect(recordedEnv(dir)).toEqual({ CHECK_FRESH: "1", TZ: "Europe/Helsinki" });
  });
});

describe("check --rerun: flake or real", () => {
  const list = [
    { kind: "vitest", file: "x/a.test.ts", name: "suite one" },
    { kind: "vitest", file: "x/a.test.ts", name: "suite two" },
    { kind: "sh", file: "tools/test/s.test.sh", name: "t_x" },
    { kind: "e2e", file: "e2e/budget.spec.ts:12", name: "budget › saves a limit" },
  ] as [Failure, Failure, Failure, Failure];

  it("a test that passes alone is a FLAKE and one that fails alone is REAL, with the kept runs it failed in", () => {
    const lines: string[] = [];
    const count = new Map([[`vitest\tx/a.test.ts\tsuite two`, 3]]);
    const r = decide({
      failures: list.slice(0, 3),
      runners: runners({ vitest: () => ({ ran: true, passed: new Set(["suite one"]), failed: new Set(["suite two"]) }), sh: () => true }),
      count,
      runs: 90,
      print: (l) => lines.push(l),
    });
    expect(lines).toEqual([
      "FLAKE (passes alone) vitest x/a.test.ts > suite one [failed in 0 of 90 kept red runs]",
      "REAL (fails alone) vitest x/a.test.ts > suite two [failed in 3 of 90 kept red runs]",
      "FLAKE (passes alone) sh tools/test/s.test.sh > t_x [failed in 0 of 90 kept red runs]",
      "check: rerun: 2 FLAKE, 1 REAL",
    ]);
    expect(r.reals).toHaveLength(1);
  });

  it("a file is run once for all its failed tests, and a test that did not show up again is NOT RUN", () => {
    let runs = 0;
    const lines: string[] = [];
    decide({
      failures: list.slice(0, 2),
      runners: runners({ vitest: () => (runs++, { ran: true, passed: new Set(["suite one"]), failed: new Set() }) }),
      print: (l) => lines.push(l),
    });
    expect(runs).toBe(1);
    expect(lines.map((l) => l.split(" ")[0])).toEqual(["FLAKE", "NOT", "check:"]);
  });

  it("a step is REAL, and a vitest run with no result and a spec the rerun did not select are NOT RUN, which is not REAL", () => {
    const lines: string[] = [];
    decide({
      failures: [list[0], { kind: "step", file: "types", name: "type errors do not change on a rerun" }, list[3]],
      runners: runners({ vitest: () => ({ ran: false, passed: new Set(), failed: new Set() }), e2e: () => ({ failed: new Set(), passed: new Set() }) }),
      print: (l) => lines.push(l),
    });
    expect(lines.map((l) => l.split(" ")[0])).toEqual(["REAL", "NOT", "NOT", "check:"]);
    expect(lines.at(-1)).toBe("check: rerun: 0 FLAKE, 1 REAL, 2 NOT RUN");
  });

  it("a spec that passes on its rerun is a FLAKE, one the rerun did not select is NOT RUN, and the specs go to the runner once, as file:line", () => {
    const seen: string[][] = [];
    const lines: string[] = [];
    decide({
      failures: [list[3], { kind: "e2e", file: "e2e/budget.spec.ts:30", name: "budget › other" }],
      runners: runners({ e2e: (files) => (seen.push(files), { failed: new Set(), passed: new Set(["e2e/budget.spec.ts:12"]) }) }),
      print: (l) => lines.push(l),
    });
    expect(seen).toEqual([["e2e/budget.spec.ts:12", "e2e/budget.spec.ts:30"]]);
    expect(lines.map((l) => l.split(" ")[0])).toEqual(["FLAKE", "NOT", "check:"]);
  });

  it("counts the kept red runs a failure was in, this one included", () => {
    const parent = tempDir("rerun-");
    const f = vitestJson({ "x/a.test.ts": [a("two", "failed")] });
    redRun(parent, "check.1", { vitest: f });
    redRun(parent, "check.2", { vitest: f });
    redRun(parent, "check.3", { vitest: vitestJson({ "x/b.test.ts": [a("other", "failed")] }) });
    redRun(parent, "other.4", { vitest: f });
    const h = history(parent, ROOT);
    expect(h.runs).toBe(3);
    expect(h.count.get("vitest\tx/a.test.ts\tsuite two")).toBe(2);
  });
});

describe("check --rerun: the command", () => {
  it("exits 2 with nothing to rerun, and 1 or 0 by the verdicts of the shell jobs it really runs", () => {
    const parent = tempDir("rerun-");
    const root = tempDir("rerun-root-");
    mkdirSync(join(root, "tools/test"), { recursive: true });
    writeFileSync(join(root, "tools/test/ok.test.sh"), "echo 'ok   fine'\n");
    writeFileSync(join(root, "tools/test/bad.test.sh"), "echo 'FAIL no'; exit 1\n");
    const green = redRun(parent, "check.green", { vitest: vitestJson({ "x/a.test.ts": [a("one")] }) });
    const flaky = redRun(parent, "check.flaky", { jobs: [["01", "tools/test/ok.test.sh", "", 1]] });
    const real = redRun(parent, "check.real", { jobs: [["01", "tools/test/ok.test.sh", "", 1], ["02", "tools/test/bad.test.sh", "", 1]] });
    const quiet = { ...process.env, CHECK_FRESH: "1" };
    const { log, error } = console;
    console.log = console.error = () => {};
    try {
      expect(main([green], quiet, root)).toBe(2);
      expect(main([flaky], quiet, root)).toBe(0);
      expect(main([real], quiet, root)).toBe(1);
      expect(main([join(parent, "missing")], quiet, root)).toBe(2);
      expect(main([], quiet, root)).toBe(2);
    } finally {
      console.log = log;
      console.error = error;
    }
  });
});

describe("check --rerun: a red pnpm e2e log", () => {
  /** A pnpm that answers `pnpm e2e ...` with the given output and exit code, and records its arguments. */
  function fakePnpm(output: string, code: number) {
    const bin = tempDir("rerun-bin-");
    writeFileSync(join(bin, "pnpm"), `#!/bin/sh
echo "$@" >>"${bin}/args"
cat <<'EOT'
${output}
EOT
exit ${code}
`);
    chmodSync(join(bin, "pnpm"), 0o755);
    return { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, args: () => readFileSync(join(bin, "args"), "utf8").trim() };
  }
  const SPEC = "the month of the joint account: paid, share and who paid over";
  const run = (output: string, code: number) => {
    const root = tempDir("rerun-root-");
    const log = join(root, "e2e.log");
    writeFileSync(log, E2E_RED);
    const fake = fakePnpm(output, code);
    const say = console.log;
    const lines: string[] = [];
    console.log = (l: string) => void lines.push(l);
    try {
      return { code: main(["--e2e-log", log], fake.env, root), lines, args: fake.args() };
    } finally {
      console.log = say;
    }
  };

  it("runs only the failed spec of the summary, by file and line, and a pass is a FLAKE (exit 0)", () => {
    const r = run(`  ✓  1 e2e/delta.spec.ts:102:1 › ${SPEC} (3.0s)
  1 passed (4s)`, 0);
    expect(r.args).toBe("e2e e2e/delta.spec.ts:102");
    expect(r.lines.filter((l) => /^(FLAKE|REAL|NOT RUN)/.test(l))).toEqual([`FLAKE (passes alone) e2e e2e/delta.spec.ts:102 > ${SPEC}`]);
    expect(r.code).toBe(0);
  });

  it("a spec that fails again is REAL (exit 1)", () => {
    const r = run(`  ✘  1 e2e/delta.spec.ts:102:1 › ${SPEC} (3.0s)
  1 failed
    e2e/delta.spec.ts:102:1 › ${SPEC}`, 1);
    expect(r.lines.some((l) => l.startsWith("REAL (fails alone) e2e e2e/delta.spec.ts:102"))).toBe(true);
    expect(r.code).toBe(1);
  });

  it("a rerun that selects no test is NOT RUN and not REAL (exit 3)", () => {
    const r = run("Error: No tests found", 1);
    expect(r.lines.some((l) => l.startsWith("NOT RUN e2e e2e/delta.spec.ts:102"))).toBe(true);
    expect(r.lines.some((l) => l.startsWith("REAL"))).toBe(false);
    expect(r.lines.at(-1)).toBe("check: rerun: 0 FLAKE, 0 REAL, 1 NOT RUN");
    expect(r.code).toBe(3);
  });

  it("a rerun that exits 0 and runs nothing else is NOT RUN too", () => {
    expect(run("  0 passed", 0).code).toBe(3);
  });
});
