// @ts-check
/**
 * What `pnpm check --changed [base]` runs for a diff. Not for CI, which runs everything.
 *   node tools/check/scope.mjs <base>     prints key=value lines for tools/check.sh
 *
 * Vitest is narrowed by package: a change in a package runs its tests and those of the packages that depend on it
 * (read from the package.json files), and the repo rules always run because they read every tracked file. A path
 * this module does not know (root config, scripts/, relay/, Dockerfile, ...) is read by tests in other places, so it
 * runs all of vitest. The shell lint and suites run when the diff touches a shell script or what the suites read.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RULES = "tools/repo-rules";
/** Paths that no vitest test reads outside their own package: docs, plans, fragments, the browser suite and the root
 * notes (CHANGELOG.md is read by a server test). */
const INERT = /^(docs\/|changelog\.d\/|\.claude\/|e2e\/|(?!CHANGELOG\.md$)[^/]+\.md$)/;
const SHELL = /^(scripts\/|tools\/test\/|tools\/ci\/)|\.sh$/;
/** Read by a shell suite without being shell: tools/test/ops-helper.test.sh copies the compose file. */
const SUITE_INPUTS = /^docker-compose\.yml$/;

/** @typedef {{ dir: string, name: string, deps: string[] }} Pkg */

/** The workspace packages (`apps/*`, `packages/*`) and the workspace packages each depends on. @returns {Pkg[]} */
export function workspace(root = ROOT) {
  /** @type {Pkg[]} */
  const out = [];
  for (const base of ["apps", "packages"]) {
    if (!existsSync(join(root, base))) continue;
    for (const d of readdirSync(join(root, base))) {
      const file = join(root, base, d, "package.json");
      if (!existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, "utf8"));
      out.push({ dir: `${base}/${d}`, name: pkg.name, deps: Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }) });
    }
  }
  return out.map((p) => ({ ...p, deps: p.deps.filter((n) => out.some((o) => o.name === n)) }));
}

/**
 * @param {string[]} files changed paths from the repo root (deleted ones too)
 * @param {Pkg[]} [pkgs]
 * @returns {{ full: boolean, tests: string[], lint: boolean, sh: boolean, why: string }}
 */
export function scopeOf(files, pkgs = workspace()) {
  const lint = files.some((f) => SHELL.test(f));
  const sh = lint || files.some((f) => SUITE_INPUTS.test(f));
  const tests = new Set([RULES]);
  const touched = new Set();
  for (const f of files) {
    const pkg = pkgs.find((p) => f.startsWith(`${p.dir}/`));
    if (pkg) touched.add(pkg.dir);
    else if (f.startsWith("tools/")) tests.add("tools");
    else if (!INERT.test(f)) return { full: true, tests: [], lint, sh, why: `${f} is read by tests in several places` };
  }
  // dependents of a touched package, transitively
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of pkgs) {
      if (touched.has(p.dir) || !p.deps.some((n) => pkgs.some((o) => o.name === n && touched.has(o.dir)))) continue;
      touched.add(p.dir);
      grew = true;
    }
  }
  for (const d of touched) tests.add(d);
  return { full: false, tests: [...tests].sort(), lint, sh, why: "" };
}

/**
 * Paths that differ from the merge base of HEAD and `base`: committed, staged, unstaged, deleted and untracked.
 * @param {string} base
 * @param {string} [cwd]
 */
export function changedFiles(base, cwd = ROOT) {
  const git = (/** @type {string[]} */ ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const mb = git("merge-base", "HEAD", base).trim();
  const lines = [...git("diff", "--name-only", "--no-renames", mb).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")];
  return [...new Set(lines.filter(Boolean))].sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] ?? "";
  try {
    const files = changedFiles(base);
    const s = scopeOf(files);
    console.log(`files=${files.length}\nfull=${s.full ? 1 : 0}\ntests=${s.tests.join(" ")}\nlint=${s.lint ? 1 : 0}\nsh=${s.sh ? 1 : 0}\nwhy=${s.why}`);
  } catch (err) {
    // an unknown base: say so and let check.sh run everything
    console.log(`error=${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`);
  }
}
