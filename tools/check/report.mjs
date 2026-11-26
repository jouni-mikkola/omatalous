// @ts-check
/**
 * What `pnpm check` prints about the vitest step, from vitest's JSON result (tools/check.sh writes it).
 *   node tools/check/report.mjs <vitest.json>     line 1 is the summary, the following lines the failures and the slow tests
 *   node tools/check/report.mjs <vitest.json> --files   and then the slowest files, to see where the time of a run goes
 *
 * Line 1 and the "run it alone once" lines are read by the landing script, so their wording stays as it is.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A test that ran longer than this is named under its summary: vitest stops a test at 5 s unless it states a timeout. */
export const SLOW_MS = 2000;
/** How many slow tests are named. */
export const SLOW_SHOWN = 3;
/** How many files `--files` names. */
const FILES_SHOWN = 20;

/**
 * @typedef {{ status?: string, title?: string, fullName?: string, duration?: number | null, failureMessages?: string[] }} Assertion
 * @typedef {{ name: string, status?: string, message?: string, startTime?: number, endTime?: number, assertionResults?: Assertion[] }} FileResult
 * @typedef {{ numTotalTests: number, numFailedTests?: number, numPendingTests?: number, testResults: FileResult[] }} Result
 */

const clean = (/** @type {unknown} */ s) => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
/** vitest's JSON has no message for a timeout, only the stack of the test's definition, which starts with this line */
const timedOut = (/** @type {{ msg: string }} */ f) => /^Error: STACK_TRACE_ERROR/.test(f.msg);

/**
 * The passed tests over SLOW_MS, slowest first, as `{ file, name, ms }`. A failed test is reported as a failure
 * already, so it is not repeated here.
 * @param {Result} r @param {string} cwd
 */
export function slowTests(r, cwd, minMs = SLOW_MS, n = SLOW_SHOWN) {
  const out = [];
  for (const f of r.testResults) {
    for (const a of f.assertionResults ?? []) {
      if (a.status === "passed" && (a.duration ?? 0) > minMs) out.push({ file: f.name.replace(cwd, ""), name: a.fullName || a.title || "", ms: a.duration ?? 0 });
    }
  }
  return out.sort((a, b) => b.ms - a.ms).slice(0, n);
}

/**
 * The files that took longest, as `{ file, ms }`: the span vitest recorded for the file, else the sum of its tests.
 * @param {Result} r @param {string} cwd
 */
export function slowFiles(r, cwd, n = FILES_SHOWN) {
  return r.testResults
    .map((f) => {
      const span = typeof f.startTime === "number" && typeof f.endTime === "number" ? f.endTime - f.startTime : 0;
      const tests = (f.assertionResults ?? []).reduce((sum, a) => sum + (a.duration ?? 0), 0);
      return { file: f.name.replace(cwd, ""), ms: span || tests };
    })
    .sort((a, b) => b.ms - a.ms)
    .slice(0, n);
}

/** @param {Result} r @param {string} cwd the repository root with a trailing slash. @returns {string[]} */
export function report(r, cwd) {
  const fails = [];
  for (const f of r.testResults) {
    const file = f.name.replace(cwd, "");
    const bad = (f.assertionResults || []).filter((a) => a.status === "failed");
    for (const a of bad) fails.push({ file, name: a.fullName || a.title || "", msg: (a.failureMessages || []).join("\n"), title: a.title || "", took: a.duration ?? 0 });
    if (f.status === "failed" && bad.length === 0) fails.push({ file, name: "(file did not run)", msg: f.message || "", title: "", took: 0 });
  }
  const slow = fails.filter(timedOut).length;
  const skipped = r.numPendingTests ? `, ${r.numPendingTests} skipped` : "";
  const lines = [
    fails.length
      ? `${r.numFailedTests || fails.length} of ${r.numTotalTests} tests failed${slow ? `, ${slow} timed out` : ""}${skipped}`
      : `${r.numTotalTests} tests in ${r.testResults.length} files${skipped}`,
  ];
  for (const f of fails.slice(0, 10)) {
    lines.push(`  FAIL ${f.file} > ${f.name}`);
    if (timedOut(f)) {
      lines.push(`    timed out under load (ran ${(f.took / 1000).toFixed(1)} s): run it alone once: pnpm test ${f.file} -t "${f.title.slice(0, 60)}"`);
      continue;
    }
    const msg = clean(f.msg).split("\n").filter((l) => l.trim());
    for (const l of msg.filter((l) => !/^\s+at /.test(l)).slice(0, 5)) lines.push(`    ${l.slice(0, 160)}`);
    // the first stack frame outside node_modules says where
    const at = msg.find((l) => /^\s+at /.test(l) && !l.includes("node_modules"));
    if (at) lines.push(`    ${at.trim().replace(/\((.*)\)$/, "$1").replace(cwd, "").slice(0, 160)}`);
  }
  if (fails.length > 10) lines.push(`  ... and ${fails.length - 10} more`);
  if (fails.length) lines.push("  rerun one file: pnpm test " + [...new Set(fails.map((f) => f.file))].slice(0, 3).join(" "));
  // the next test to time out shows here before it does: name the slowest, whatever the result
  for (const s of slowTests(r, cwd)) lines.push(`  slow ${(s.ms / 1000).toFixed(1)} s: ${s.file} > ${s.name}`.slice(0, 170));
  return lines;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  /** @type {Result} */
  let r;
  try {
    r = JSON.parse(readFileSync(process.argv[2] ?? "", "utf8"));
  } catch {
    process.exit(2);
  }
  const cwd = process.cwd() + "/";
  const lines = report(r, cwd);
  if (process.argv.includes("--files")) {
    lines.push(`slowest ${FILES_SHOWN} test files:`);
    for (const f of slowFiles(r, cwd)) lines.push(`  ${(f.ms / 1000).toFixed(1)} s ${f.file}`);
  }
  console.log(lines.join("\n"));
}
