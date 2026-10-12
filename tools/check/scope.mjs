// @ts-check
/**
 * What `pnpm check --changed [base]` runs for a diff. Not for CI, which runs everything.
 *   node tools/check/scope.mjs <base>     prints key=value lines for tools/check.sh
 *
 * Vitest is narrowed by package: a change in a package runs its tests and those of the packages that depend on it
 * (read from the package.json files), and the repo rules always run because they read every tracked file. A change in
 * the src/ of a package also runs tools/ui-strings.test.ts, which pins the sentences those sources hold. A path
 * this module does not know (root config, relay/, Dockerfile, ...) is read by tests in other places, so it runs all
 * of vitest.
 *
 * A shell file (scripts/, tools/ and any .sh) is narrowed by name. The suites in tools/test/ and the vitest files
 * that name it run, by file name or through a script that sources it (a library reaches every script that sources
 * it). A file that nothing names runs everything: all of vitest and every suite. The shell lint runs on any shell
 * change.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RULES = "tools/repo-rules";
/** A source file of a package, which tools/ui-strings.test.ts reads for the literal sentences of the pages. */
const PACKAGE_SOURCE = /^(apps|packages)\/[^/]+\/src\//;
const UI_STRINGS = "tools/ui-strings.test.ts";
/** Paths that no vitest test reads outside their own package: docs, plans, fragments, the browser suite and the root
 * notes (CHANGELOG.md is read by a server test). */
const INERT = /^(docs\/|changelog\.d\/|\.claude\/|e2e\/|(?!CHANGELOG\.md$)[^/]+\.md$)/;
const SHELL = /^(scripts\/|tools\/test\/|tools\/ci\/)|\.sh$/;
/** Read by a shell suite without being shell: tools/test/ops-helper.test.sh copies the compose file. */
const SUITE_INPUTS = /^docker-compose\.yml$/;
const SUITE = /^tools\/test\/[^/]+\.test\.sh$/;
/** The files vitest runs (the `include` of vitest.config.ts). */
const VITEST_FILE = /^((packages|apps)\/[^/]+\/test\/.+|tools\/.+)\.test\.ts$/;

/** @typedef {{ dir: string, name: string, deps: string[] }} Pkg */
/** Every shell file and every vitest file with its text. @typedef {{ shell: Record<string, string>, vitest: Record<string, string> }} Corpus */

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

/** The shell files and vitest files of the checkout, tracked or not yet added. @returns {Corpus} */
export function loadCorpus(root = ROOT) {
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  /** @type {Corpus} */
  const out = { shell: {}, vitest: {} };
  for (const f of listed.split("\0")) {
    const into = f.endsWith(".sh") ? out.shell : VITEST_FILE.test(f) ? out.vitest : null;
    if (into && existsSync(join(root, f))) into[f] = readFileSync(join(root, f), "utf8");
  }
  return out;
}

const escape = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `dbcopy.sh` as a whole name: not `x-dbcopy.sh`, `dbcopy.sh-old` or `my.dbcopy.sh`. */
const nameOf = (/** @type {string} */ path) => `(?<![\\w.-])${escape(basename(path))}(?![\\w-])`;
/** Whether the text names the file by its file name, with or without a folder in front. */
const names = (/** @type {string} */ text, /** @type {string} */ path) => new RegExp(nameOf(path)).test(text);
/** Whether the shell text sources the file: a line `. scripts/lib/x.sh` or `source "$ROOT/lib/x.sh"`, comments left out. */
const sources = (/** @type {string} */ text, /** @type {string} */ path) =>
  new RegExp(`(?:^|[;&|({]|\\b(?:then|do))[ \\t]*(?:source|\\.)[ \\t]+[^\\n]*${nameOf(path)}`, "m").test(text.replace(/^[ \t]*#.*$/gm, ""));

/** The file and every shell file that sources it, directly or through another one. */
function reach(/** @type {string} */ file, /** @type {Record<string, string>} */ shell) {
  const set = new Set([file]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [p, text] of Object.entries(shell)) {
      if (set.has(p) || ![...set].some((d) => sources(text, d))) continue;
      set.add(p);
      grew = true;
    }
  }
  return [...set];
}

/** The suites and vitest files that name the shell file or sit on a path that sources it. */
function namedBy(/** @type {string} */ file, /** @type {Corpus} */ corpus) {
  const reached = reach(file, corpus.shell);
  const hit = (/** @type {string} */ path, /** @type {string} */ text) => reached.includes(path) || reached.some((r) => names(text, r));
  return {
    suites: Object.entries(corpus.shell).filter(([p, text]) => SUITE.test(p) && hit(p, text)).map(([p]) => p),
    vitest: Object.entries(corpus.vitest).filter(([p, text]) => hit(p, text)).map(([p]) => p),
  };
}

/**
 * @param {string[]} files changed paths from the repo root (deleted ones too)
 * @param {Pkg[]} [pkgs]
 * @param {Corpus} [corpus] read from the checkout when a shell file changed
 * @returns {{ full: boolean, tests: string[], lint: boolean, sh: boolean, suites: string[] | null, why: string }} `suites` is the
 * shell suites to run when `sh` is set; null means all of them
 */
export function scopeOf(files, pkgs = workspace(), corpus = undefined) {
  const lint = files.some((f) => SHELL.test(f));
  /** @type {Set<string> | null} */
  let suites = files.some((f) => SUITE_INPUTS.test(f)) ? null : new Set();
  const tests = new Set([RULES]);
  const touched = new Set();
  let why = "";
  const unknown = (/** @type {string} */ reason) => (why ||= reason);
  for (const f of files) {
    if (SHELL.test(f)) {
      corpus ??= loadCorpus();
      const hit = namedBy(f, corpus);
      for (const s of hit.suites) suites?.add(s);
      for (const t of hit.vitest) tests.add(t);
      if (hit.suites.length + hit.vitest.length === 0) {
        suites = null;
        if (!INERT.test(f)) unknown(`${f} is named by no suite or test`);
      }
      continue;
    }
    const pkg = pkgs.find((p) => f.startsWith(`${p.dir}/`));
    if (PACKAGE_SOURCE.test(f)) tests.add(UI_STRINGS);
    if (pkg) touched.add(pkg.dir);
    else if (f.startsWith("tools/")) tests.add("tools");
    else if (!INERT.test(f)) unknown(`${f} is read by tests in several places`);
  }
  const sh = suites === null || suites.size > 0;
  const shSuites = suites === null ? null : [...suites].sort();
  if (why) return { full: true, tests: [], lint, sh, suites: shSuites, why };
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
  // a file named under a folder that runs whole is already in
  const all = [...tests].sort();
  const dirs = all.filter((t) => !t.endsWith(".ts"));
  return { full: false, tests: all.filter((t) => !t.endsWith(".ts") || !dirs.some((d) => t.startsWith(`${d}/`))), lint, sh, suites: shSuites, why: "" };
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
    console.log(
      `files=${files.length}\nfull=${s.full ? 1 : 0}\ntests=${s.tests.join(" ")}\nlint=${s.lint ? 1 : 0}\nsh=${s.sh ? 1 : 0}\nsuites=${s.suites ? s.suites.join(" ") : "all"}\nwhy=${s.why}`,
    );
  } catch (err) {
    // an unknown base: say so and let check.sh run everything
    console.log(`error=${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`);
  }
}
