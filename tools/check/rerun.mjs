// @ts-check
/**
 * Flake or real, decided by running the failure again: what `pnpm check --rerun` does.
 *   node tools/check/rerun.mjs [<check dir>] [--e2e-log <file>]
 * The check dir is the temp folder a red `pnpm check` keeps (its last line names it). Every failed vitest file, shell job
 * and (from an `pnpm e2e` log) page spec in it is run once more, one after the other, at nice 10, with the environment the
 * check recorded in the dir. A failure that passes alone prints `FLAKE (passes alone)`, one that fails again `REAL (fails
 * alone)`, each with the number of the other kept red runs (check.* beside the dir) it failed in. A red step this cannot run
 * again (types, lint, a vitest run that gave no result) is REAL. Exit 0 when every failure is a FLAKE, 1 when one is REAL,
 * 2 when the dir holds no failure at all, 3 when none is REAL but one is NOT RUN. NOT RUN is a failure the rerun did not run
 * (it selected no test, or gave no result): it proves nothing, so it is neither a flake nor real, and a landing refuses on it.
 * The landing script reads the FLAKE, REAL and NOT RUN lines, so their start stays.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Seconds one rerun may take before it counts as failed. */
export const RERUN_TIMEOUT_S = 240;
/** The variables tools/check.sh records in `env`: what a rerun has to run with as the check did. */
export const ENV_NAMES = ["CHECK_FRESH", "CHECK_STAMPS_DIR", "VITEST_MAX_WORKERS", "E2E_WORKERS", "CI", "TZ"];

/**
 * @typedef {{ kind: "vitest" | "sh" | "e2e" | "step", file: string, name: string }} Failure
 * @typedef {{ failed: Set<string>, passed: Set<string>, error?: string }} E2eResult
 * @typedef {{
 *   vitest: (file: string) => { ran: boolean, passed: Set<string>, failed: Set<string> },
 *   sh: (file: string, name: string) => boolean | null,
 *   e2e: (files: string[]) => E2eResult,
 * }} Runners
 */

/** @param {string} file */
const text = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
};
/** @param {string} file */
const json = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};
/** @param {Failure} f */
export const keyOf = (f) => `${f.kind}\t${f.file}\t${f.name}`;
/** @param {Failure} f */
export const labelOf = (f) => (f.kind === "step" ? `step ${f.file}${f.name ? ` (${f.name})` : ""}` : `${f.kind} ${f.file}${f.name ? ` > ${f.name}` : ""}`);

/**
 * The failed vitest tests of a vitest.json, as report.mjs reads it: a failed assertion, or a file that failed without one.
 * @param {string} dir @param {string} root
 * @returns {Failure[] | null} null when the dir has no result file
 */
export function vitestFailures(dir, root) {
  const r = json(join(dir, "vitest.json"));
  if (!r || !Array.isArray(r.testResults)) return null;
  /** @type {Failure[]} */
  const out = [];
  for (const f of r.testResults) {
    const file = f.name.startsWith(`${root}/`) ? f.name.slice(root.length + 1) : f.name;
    const bad = (f.assertionResults ?? []).filter((/** @type {{ status?: string }} */ a) => a.status === "failed");
    for (const a of bad) out.push({ kind: "vitest", file, name: a.fullName || a.title || "" });
    if (f.status === "failed" && bad.length === 0) out.push({ kind: "vitest", file, name: "(file did not run)" });
  }
  return out;
}

/** The failed shell jobs: tools/check.sh writes `sh-jobs` (id, suite, scenario filter, tab separated) and one `sh-<id>.rc` each.
 * @param {string} dir @returns {Failure[]} */
export function shFailures(dir) {
  /** @type {Failure[]} */
  const out = [];
  for (const line of text(join(dir, "sh-jobs")).split("\n")) {
    const [id, file, name = ""] = line.split("\t");
    if (!id || !file) continue;
    const rc = text(join(dir, `sh-${id}.rc`)).trim();
    if (rc !== "0") out.push({ kind: "sh", file, name });
  }
  return out;
}

/**
 * What the output of `pnpm e2e` (Playwright's list reporter) says. The failed tests are the ones listed under the summary's
 * "N failed" line, as `file.spec.ts:line` and a title: a test with a cross on its line that Playwright then ran again and
 * passed (or marks flaky) is not under it. The passed ones are the lines with a check mark.
 * @param {string} log @returns {{ failed: Map<string, string>, passed: Set<string> }}
 */
export function parseE2e(log) {
  const failed = new Map();
  const passed = new Set();
  let section = "";
  for (const line of log.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").split("\n")) {
    const head = /^ {2}(\d+) (failed|flaky|interrupted|skipped|did not run|not run|passed)\b/.exec(line);
    if (head) {
      section = head[2] ?? "";
      continue;
    }
    const m = /([\w./-]+\.spec\.ts):(\d+):\d+(.*)$/.exec(line);
    if (!m) continue;
    const key = `${m[1]}:${m[2]}`;
    if (section === "failed" && /^ {4}\S/.test(line)) {
      failed.set(key, (m[3] ?? "").replace(/^\s*›\s*/, "").trim());
    } else if (/^\s*[✓✔]/.test(line)) passed.add(key);
  }
  return { failed, passed };
}

/** @param {string} log @returns {Failure[]} */
export function e2eFailures(log) {
  return [...parseE2e(log).failed].map(([key, title]) => ({ kind: /** @type {const} */ ("e2e"), file: key, name: title }));
}

/**
 * Everything that failed in a check dir. A red step whose failures this cannot name or run again is a "step" failure.
 * @param {string} dir @param {string} root @returns {Failure[]}
 */
export function failures(dir, root) {
  /** @type {Failure[]} */
  const out = [];
  const marked = text(join(dir, "failed-steps")).split("\n").filter(Boolean);
  const types = marked.includes("types") || readdirSync(dir).some((n) => /^types\.log\.rc\d+$/.test(n) && text(join(dir, n)).trim() !== "0");
  if (types) out.push({ kind: "step", file: "types", name: "type errors do not change on a rerun" });
  if (marked.includes("lint")) out.push({ kind: "step", file: "lint", name: "shell lint does not change on a rerun" });
  const v = vitestFailures(dir, root);
  if (v) out.push(...v);
  else if (marked.includes("tests") || existsSync(join(dir, "vitest.log"))) out.push({ kind: "step", file: "tests", name: "vitest gave no result" });
  const sh = shFailures(dir);
  out.push(...sh);
  if (marked.includes("sh") && sh.length === 0) out.push({ kind: "step", file: "sh", name: "no failed job found" });
  if (marked.includes("tests") && !v?.length && v) out.push({ kind: "step", file: "tests", name: "no failed test found" });
  return out;
}

/** The failures of every kept red run beside `dir` (check.* in its folder), by key, for "failed in N of M".
 * @param {string} parent @param {string} root @returns {{ runs: number, count: Map<string, number> }} */
export function history(parent, root) {
  const count = new Map();
  let runs = 0;
  for (const name of readdirSync(parent)) {
    const dir = join(parent, name);
    if (!name.startsWith("check.") || !statSync(dir).isDirectory()) continue;
    runs++;
    const keys = new Set([...(vitestFailures(dir, root) ?? []), ...shFailures(dir)].map(keyOf));
    for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1);
  }
  return { runs, count };
}

/** @param {string} dir the recorded environment: NAME=value lines */
export function recordedEnv(dir) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const line of text(join(dir, "env")).split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && ENV_NAMES.includes(line.slice(0, i))) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return env;
}

/** The real runners: nice 10, in the repository root, with the recorded environment where the caller set none.
 * @param {string} root @param {NodeJS.ProcessEnv} env @returns {Runners} */
export function realRunners(root, env) {
  const run = (/** @type {string[]} */ argv) => spawnSync("nice", ["-n", "10", ...argv], { cwd: root, env, encoding: "utf8", timeout: RERUN_TIMEOUT_S * 1000, maxBuffer: 64 << 20 });
  return {
    vitest(file) {
      const tmp = mkdtempSync(join(tmpdir(), "rerun-"));
      try {
        const out = join(tmp, "vitest.json");
        run(["pnpm", "exec", "vitest", "run", file, `--reporter=json`, `--outputFile=${out}`]);
        const r = json(out);
        const passed = new Set(), failed = new Set();
        let ran = false;
        for (const f of r?.testResults ?? []) {
          ran = true;
          for (const a of f.assertionResults ?? []) {
            if (a.status === "passed") passed.add(a.fullName || a.title || "");
            else if (a.status === "failed") failed.add(a.fullName || a.title || "");
          }
          const anyFailed = (f.assertionResults ?? []).some((/** @type {{ status?: string }} */ a) => a.status === "failed");
          if (f.status === "passed") passed.add("(file did not run)");
          else if (f.status === "failed" && !anyFailed) failed.add("(file did not run)");
        }
        return { ran, passed, failed };
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
    sh(file, name) {
      const r = run(["bash", file, ...(name ? [name] : [])]);
      // a filter that matched no scenario ends in 0 passed, 0 failed: that is not a green job (as in tools/check.sh)
      if (name && !/^(ok|FAIL) /m.test(r.stdout ?? "")) return null;
      return r.status === 0;
    },
    e2e(files) {
      const r = run(["pnpm", "e2e", ...files]);
      const p = parseE2e(`${r.stdout ?? ""}\n${r.stderr ?? ""}`);
      const failed = new Set(p.failed.keys());
      // a run that exits non-zero without naming a failed test (no test selected, a crash) proves nothing
      const error = r.status !== 0 && failed.size === 0 ? `pnpm e2e ended with ${r.status ?? "a signal"} and no test result` : undefined;
      return { failed, passed: p.passed, error };
    },
  };
}

/**
 * Runs every failure once more and says FLAKE, REAL or NOT RUN for each.
 * @param {{ failures: Failure[], runners: Runners, count?: Map<string, number>, runs?: number, print?: (line: string) => void }} o
 * @returns {{ flakes: Failure[], reals: Failure[], notRun: Failure[] }}
 */
export function decide(o) {
  const print = o.print ?? console.log;
  /** @type {Failure[]} */
  const flakes = [];
  /** @type {Failure[]} */
  const reals = [];
  /** @type {Failure[]} */
  const notRun = [];
  /** @param {Failure} f @param {boolean | null} flake true passes alone, false fails alone, null did not run @param {string} [why] */
  const say = (f, flake, why = "") => {
    (flake === null ? notRun : flake ? flakes : reals).push(f);
    const n = o.count?.get(keyOf(f));
    const past = o.runs && f.kind !== "step" && f.kind !== "e2e" ? ` [failed in ${n ?? 0} of ${o.runs} kept red runs]` : "";
    const word = flake === null ? "NOT RUN" : flake ? "FLAKE (passes alone)" : "REAL (fails alone)";
    print(`${word} ${labelOf(f)}${why ? ` (${why})` : ""}${past}`);
  };
  /** @type {Map<string, Failure[]>} */
  const byFile = new Map();
  for (const f of o.failures.filter((x) => x.kind === "vitest")) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  for (const f of o.failures.filter((x) => x.kind === "step")) say(f, false, f.name);
  for (const [file, list] of byFile) {
    const r = o.runners.vitest(file);
    for (const f of list) {
      if (r.failed.has(f.name)) say(f, false);
      else if (r.passed.has(f.name)) say(f, true);
      else say(f, null, r.ran ? "the rerun selected no such test" : "vitest gave no result");
    }
  }
  for (const f of o.failures.filter((x) => x.kind === "sh")) {
    const ok = o.runners.sh(f.file, f.name);
    say(f, ok, ok === null ? "the scenario filter matched no scenario" : "");
  }
  const e2e = o.failures.filter((x) => x.kind === "e2e");
  if (e2e.length) {
    // each spec by file:line, as Playwright takes it: a title that several runs share (a scale, a phone and a desktop) is all of them
    const r = o.runners.e2e([...new Set(e2e.map((f) => f.file))]);
    for (const f of e2e) {
      if (r.failed.has(f.file)) say(f, false);
      else if (r.passed.has(f.file)) say(f, true);
      else say(f, null, r.error ?? "the rerun selected no test");
    }
  }
  print(`check: rerun: ${flakes.length} FLAKE, ${reals.length} REAL${notRun.length ? `, ${notRun.length} NOT RUN` : ""}`);
  return { flakes, reals, notRun };
}

/** @param {string[]} argv @returns {number} the exit code */
export function main(argv, env = process.env, root = process.cwd()) {
  let dir = "", e2eLog = "";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--e2e-log") e2eLog = argv[++i] ?? "";
    else if (arg && !arg.startsWith("-") && !dir) dir = arg;
    else {
      console.error("Usage: pnpm check --rerun [<check dir>] [--e2e-log <file>]");
      return 2;
    }
  }
  if (!dir && !e2eLog) {
    console.error("Usage: pnpm check --rerun [<check dir>] [--e2e-log <file>]");
    return 2;
  }
  if (dir && !existsSync(dir)) {
    console.error(`check: rerun: ${dir} is not a folder`);
    return 2;
  }
  const list = [...(dir ? failures(resolve(dir), root) : []), ...(e2eLog ? e2eFailures(text(e2eLog)) : [])];
  if (list.length === 0) {
    console.log(`check: rerun: no failed test, job or spec found${dir ? ` in ${dir}` : ""}${e2eLog && !dir ? ` in ${e2eLog}` : ""}`);
    return 2;
  }
  const recorded = dir ? recordedEnv(resolve(dir)) : {};
  const merged = { ...recorded, ...env };
  const kept = dir ? history(dirname(resolve(dir)), root) : { runs: 0, count: new Map() };
  console.log(`check: rerun of ${list.length} failure(s), one after the other, at nice 10`);
  const { reals, notRun } = decide({ failures: list, runners: realRunners(root, merged), count: kept.count, runs: kept.runs });
  return reals.length ? 1 : notRun.length ? 3 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
