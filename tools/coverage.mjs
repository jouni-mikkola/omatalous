// @ts-check
/**
 * `pnpm coverage`: the tests of the web app (apps/web) with line coverage, by area, against the floor in
 * `apps/web/coverage-floor.json`. An area is a file or a folder of `apps/web/src`; its figure is covered lines over all
 * lines of its files, files no test loads included. The floor only rises:
 *   pnpm coverage            runs, prints each area, exits 1 when one is under its floor
 *   pnpm coverage --raise    also writes the floor up to what the run reached (a tenth of a percent, rounded down, so a removed test shows)
 * The floor also counts the tests of the click-and-type files (`*.dom.test.ts`), since a deleted test need not be the
 * only one on its lines. The run refuses a floor that is lower than the one on the main branch (`origin/main`, when git
 * has it), that moves an area to other files or drops one, so a floor cannot be loosened to make a run pass. It runs on this machine, as a part of `pnpm check` or alone, not on GitHub.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FLOOR_FILE = "apps/web/coverage-floor.json";

/** @typedef {Record<string, { path: string, lines: number }>} Areas */
/** @typedef {{ areas: Areas, domTests: number }} Floor */

/** What a floor may not do against the one on main: lower a figure, drop an area, move an area to other files, or lose tests. */
export function loweredAreas(/** @type {Floor} */ floor, /** @type {Floor | null} */ main) {
  if (!main) return [];
  const found = Object.entries(main.areas).flatMap(([name, was]) => {
    const now = floor.areas[name];
    if (!now) return [`${name}: removed`];
    return [
      ...(now.lines < was.lines ? [`${name}: ${now.lines} is under ${was.lines} on main`] : []),
      ...(now.path !== was.path ? [`${name}: the path ${now.path} is not ${was.path} of main`] : []),
    ];
  });
  if (floor.domTests < main.domTests) found.push(`domTests: ${floor.domTests} is under ${main.domTests} on main`);
  return found;
}

/** Covered over total lines of the files under each area's path, from a json-summary report. */
export function areasOf(/** @type {Areas} */ floor, /** @type {Record<string, { lines: { total: number, covered: number } }>} */ summary) {
  /** @type {Record<string, { total: number, covered: number, pct: number }>} */
  const out = {};
  for (const [name, { path }] of Object.entries(floor)) {
    let total = 0;
    let covered = 0;
    for (const [file, v] of Object.entries(summary)) {
      if (file === "total") continue;
      const rel = file.startsWith(ROOT) ? file.slice(ROOT.length + 1) : file;
      if (rel === path || (path.endsWith("/") && rel.startsWith(path))) {
        total += v.lines.total;
        covered += v.lines.covered;
      }
    }
    out[name] = { total, covered, pct: total === 0 ? 0 : (100 * covered) / total };
  }
  return out;
}

/** The tests that passed in the files `*.dom.test.ts`, from the json report. */
export function domTestsPassed(/** @type {{ testResults: { name: string, assertionResults: { status: string }[] }[] }} */ report) {
  return report.testResults
    .filter((f) => f.name.endsWith(".dom.test.ts"))
    .reduce((n, f) => n + f.assertionResults.filter((t) => t.status === "passed").length, 0);
}

function main() {
  const raise = process.argv.includes("--raise");
  /** @type {Floor} */
  const floor = JSON.parse(readFileSync(join(ROOT, FLOOR_FILE), "utf8"));
  /** @type {Floor | null} */
  let onMain = null;
  try {
    onMain = JSON.parse(execFileSync("git", ["show", `origin/main:${FLOOR_FILE}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    // no origin/main, or the floor is new on this branch
  }
  const lowered = loweredAreas(floor, onMain);
  if (lowered.length) {
    console.error(`coverage: the floor was lowered:\n  ${lowered.join("\n  ")}`);
    process.exit(1);
  }
  const out = mkdtempSync(join(tmpdir(), "coverage-"));
  try {
    const run = spawnSync(
      "npx",
      [
        "vitest", "run", "--project", "main", "--project", "isolated", "--project", "dom", "apps/web",
        "--coverage.enabled", "--coverage.provider=v8", "--coverage.reporter=json-summary", `--coverage.reportsDirectory=${out}`,
        "--reporter=default", "--reporter=json", `--outputFile.json=${join(out, "tests.json")}`,
        "--coverage.include=apps/web/src/**", "--coverage.exclude=**/*.d.ts", "--coverage.exclude=apps/web/src/types.ts",
      ],
      { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] },
    );
    if (run.status !== 0) {
      console.error("coverage: the tests failed");
      process.exit(run.status ?? 1);
    }
    const areas = areasOf(floor.areas, JSON.parse(readFileSync(join(out, "coverage-summary.json"), "utf8")));
    let under = 0;
    for (const [name, a] of Object.entries(areas)) {
      const area = /** @type {Areas[string]} */ (floor.areas[name]);
      const ok = a.pct >= area.lines;
      if (!ok) under++;
      console.log(`${ok ? "ok   " : "UNDER"} ${name.padEnd(16)} ${a.pct.toFixed(1).padStart(5)} %  floor ${area.lines} %  (${a.covered}/${a.total} lines)`);
      if (raise && a.pct > area.lines) area.lines = Math.floor(a.pct * 10) / 10;
    }
    // a test of the dom project is a promise that a click does what the page says: fewer of them is a deleted test, whether or not it was the only one on its lines
    const domTests = domTestsPassed(JSON.parse(readFileSync(join(out, "tests.json"), "utf8")));
    const domOk = domTests >= floor.domTests;
    if (!domOk) under++;
    console.log(`${domOk ? "ok   " : "UNDER"} ${"dom tests".padEnd(16)} ${String(domTests).padStart(5)}    floor ${floor.domTests}`);
    if (raise && domTests > floor.domTests) floor.domTests = domTests;
    if (raise) {
      writeFileSync(join(ROOT, FLOOR_FILE), `${JSON.stringify(floor, null, 2)}\n`);
      console.log(`coverage: floor written to ${FLOOR_FILE}`);
    }
    if (under) {
      console.error(`coverage: ${under} area(s) under the floor`);
      process.exit(1);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
