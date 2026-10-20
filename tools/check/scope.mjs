// @ts-check
/**
 * What `pnpm check --changed [base]` runs for a diff. Not for CI, which runs everything.
 *   node tools/check/scope.mjs <base>     prints key=value lines for tools/check.sh
 *
 * Vitest is narrowed by the import graph (buildGraph below): a changed source file runs the test files that import
 * it, directly or through other files, and a changed test file runs itself. The package rule is the fallback: a file of a
 * package that no test reaches, that the graph does not read (a deleted file, a fixture) or a config file of the package
 * runs the package's tests and those of the packages that depend on it (read from the package.json files). The repo
 * rules always run because they read every tracked file. A change in
 * the src/ of a package also runs tools/ui-strings.test.ts, which pins the sentences those sources hold. A path
 * this module does not know (root config, relay/, Dockerfile, ...) is read by tests in other places, so it runs all
 * of vitest.
 *
 * A shell file (scripts/, tools/ and any .sh) is narrowed by name. The suites in tools/test/ and the vitest files
 * that name it run, by file name or through a script that sources it (a library reaches every script that sources
 * it). A file that nothing names runs everything: all of vitest and every suite. The shell lint runs on any shell
 * change.
 *
 * A changed file is also read as text: a vitest file or e2e spec that holds its repo path or its file name runs too
 * (a test that reads a stylesheet, a script or a fixture through fs is no import vitest could follow). A change to the
 * styles or the markup of the web app runs the pictures tests (tools/shots-*.test.ts). A changed class name or UI
 * sentence (read from the diff, `diffTexts`) brings the e2e specs that name it; `pnpm check` does not run those, it
 * lists them and tools/check/tests-for.sh prints them with the rest. This needs a corpus: a call without one (the
 * unit tests of the other rules) adds none of it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
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
const VITEST_FILE = /^((packages|apps)\/[^/]+\/(test|src\/features)\/.+|tools\/.+)\.test\.ts$/;

const E2E_SPEC = /^e2e\/.+\.spec\.ts$/;
const SHOTS_TEST = /^tools\/shots-[a-z]+\.test\.ts$/;
/** Files whose change shows on a page as a picture: styles, markup, components. */
const VISUAL = /^apps\/web\/(index\.html|src\/(?!.*\.test\.).+\.(css|tsx))$/;
/** Source files that hold class names or sentences; the diff of these is read for e2e specs and the pictures. */
const TEXT_SOURCE = /^((apps|packages)\/[^/]+\/src\/(?!.*\.test\.).+\.(tsx?|css)|apps\/web\/index\.html)$/;
/** File names too common to say a test reads this file: only the full repo path counts for these. */
const GENERIC = /^(index|types|main|config|package|tsconfig|README|vitest\.config|LICENSE|\.gitignore)\b/;
/** What the graph reads: code. A stylesheet runs its package (see `has` in buildGraph). */
const GRAPH_FILE = /^(apps|packages|tools)\/.+\.(m?[jt]sx?)$/;
/** A file of a package that sets up how all of it builds or runs: no import reaches it, so its package runs whole. */
const PACKAGE_CONFIG = /^(apps|packages)\/[^/]+\/([^/]+\.config\.[mc]?[jt]s|package\.json|tsconfig[^/]*\.json)$/;

/** @typedef {{ dir: string, name: string, deps: string[] }} Pkg */
/** Every shell file, vitest file and e2e spec with its text, and the code the import graph reads (`code`; without it the
 * package rule decides). @typedef {{ shell: Record<string, string>, vitest: Record<string, string>, e2e?: Record<string, string>, code?: Record<string, string>, pkgs?: Record<string, string> }} Corpus */

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
  const out = { shell: {}, vitest: {}, e2e: {}, code: {}, pkgs: entries(root) };
  for (const f of listed.split("\0")) {
    const into = f.endsWith(".sh") ? out.shell : VITEST_FILE.test(f) ? out.vitest : E2E_SPEC.test(f) ? out.e2e : null;
    const code = GRAPH_FILE.test(f);
    if (!(into || code) || !existsSync(join(root, f))) continue;
    const text = readFileSync(join(root, f), "utf8");
    if (into) into[f] = text;
    if (code && out.code) out.code[f] = text;
  }
  return out;
}

/**
 * The import graph of the code vitest runs, for `pnpm check --changed`: which test files reach a changed source file.
 * A test reaches a file it imports, and every file that file imports, as vitest would load them. An import of names
 * from a module that only passes them on (`export { x } from`, `export * from`: a barrel such as the index.ts of
 * @banking/core) reaches the module itself and the files that define those names, not the rest of the barrel: the
 * packages have no side effects on import (core says so in its package.json), so a test that uses no name of a changed
 * file cannot see the change. `import type` is left out, since vitest strips it and tsc checks the types. A namespace
 * import, a default import, a bare, dynamic or mocked import reach the whole module with all it passes on.
 * A node of the graph is a file (its own body and imports) or `file*` (the file with everything it passes on).
 */
/** The files the graph reads: TypeScript and JavaScript sources of the packages, the apps and tools. */
const CODE = /^(apps|packages|tools)\/.+\.(m?[jt]sx?)$/;
const EXT = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

/** @typedef {{ from: string, names: string[] | null }} Edge  names null = the whole module */
/** @typedef {{ local: Set<string>, re: { from: string, names: [string, string][] | null }[] }} Exports */

/** Text without comments, so a commented import or an example in a doc comment is no edge. */
function strip(/** @type {string} */ text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** `a, b as c, type d` to [["a","a"],["b","c"]] (imported name, local name), type-only names left out. */
function clause(/** @type {string} */ inner) {
  /** @type {[string, string][]} */
  const out = [];
  for (const part of inner.split(",")) {
    const p = part.trim();
    if (!p || /^type\s/.test(p)) continue;
    const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(p);
    if (m?.[1]) out.push([m[1], m[2] ?? m[1]]);
  }
  return out;
}

/**
 * The imports and exports of one file.
 * @param {string} text
 * @returns {{ imports: { spec: string, names: string[] | null, glob?: boolean }[], exports: { local: Set<string>, re: { spec: string, names: [string, string][] | null }[] } }}
 */
export function parse(text) {
  const t = strip(text);
  /** @type {{ spec: string, names: string[] | null, glob?: boolean }[]} */
  const imports = [];
  const local = new Set();
  /** @type {{ spec: string, names: [string, string][] | null }[]} */
  const re = [];
  for (const m of t.matchAll(/\bimport\s+(type\s+)?([^"'`;]*?)\s*from\s*["']([^"']+)["']/g)) {
    if (m[1]) continue;
    const what = m[2] ?? "";
    const spec = m[3] ?? "";
    const braces = /\{([^}]*)\}/.exec(what);
    const whole = /\*\s*as\s|^[\w$]+\s*(,|$)/.test(what.trim());
    const names = braces ? clause(braces[1] ?? "").map(([n]) => n) : [];
    if (whole) imports.push({ spec, names: null });
    else if (names.length) imports.push({ spec, names });
  }
  // a bare import, a dynamic import and vi.mock of a path load the whole module
  for (const m of t.matchAll(/(?:^|[;\s])import\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\bvi\.(?:mock|doMock|importActual)\(\s*["']([^"']+)["']/g))
    imports.push({ spec: m[1] ?? m[2] ?? m[3] ?? "", names: null });
  // import.meta.glob (Vite) loads every file its patterns match; a pattern with ! leaves files out and is no edge. Read
  // from the text as it is: a pattern such as "./sections/*.tsx" looks like the start of a comment to strip.
  for (const m of text.matchAll(/\bimport\.meta\.glob\s*(?:<[^(]*>)?\s*\(\s*(\[[^\]]*\]|"[^"]*"|'[^']*')/g))
    for (const q of (m[1] ?? "").matchAll(/["']([^"']+)["']/g)) if (!q[1]?.startsWith("!")) imports.push({ spec: q[1] ?? "", names: null, glob: true });
  for (const m of t.matchAll(/\bexport\s+(type\s+)?\{([^}]*)\}\s*(?:from\s*["']([^"']+)["'])?/g)) {
    if (m[1]) continue;
    const pairs = clause(m[2] ?? "");
    if (m[3]) re.push({ spec: m[3], names: pairs });
    else for (const [, as] of pairs) local.add(as);
  }
  for (const m of t.matchAll(/\bexport\s+\*\s*(?:as\s+([\w$]+)\s*)?from\s*["']([^"']+)["']/g)) {
    if (m[1]) re.push({ spec: m[2] ?? "", names: [["*", m[1]]] });
    else re.push({ spec: m[2] ?? "", names: null });
  }
  for (const m of t.matchAll(/\bexport\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|const|let|var|class|enum)\s+([\w$]+)/g)) local.add(m[1] ?? "");
  if (/\bexport\s+default\b/.test(t)) local.add("default");
  return { imports, exports: { local, re } };
}

/**
 * The graph over a set of files.
 * @param {Record<string, string>} files repo path to text
 * @param {Record<string, string>} packages workspace package name to its entry file (repo path)
 */
export function buildGraph(files, packages) {
  const parsed = new Map(Object.entries(files).filter(([p]) => CODE.test(p)).map(([p, text]) => [p, parse(text)]));
  /** The repo path a specifier of `from` names, or null for a package outside the workspace. */
  const resolveSpec = (/** @type {string} */ from, /** @type {string} */ spec) => {
    let base;
    if (spec.startsWith(".")) base = posix.join(posix.dirname(from), spec);
    else if (spec in packages) return packages[spec];
    else return null;
    const bare = base.replace(/\.(m?js|jsx)$/, "");
    for (const e of EXT) for (const b of [base, bare]) if (parsed.has(b + e) || (b + e) in files) return b + e;
    return base in files ? base : null;
  };
  /** The files a glob pattern of `from` matches: `*` within a folder, `**` across folders, `{a,b}` either. */
  const globbed = (/** @type {string} */ from, /** @type {string} */ pattern) => {
    const base = pattern.startsWith("/") ? pattern.slice(1) : posix.join(posix.dirname(from), pattern);
    const wild = (/** @type {string} */ w) => (w === "**/" ? "(?:.*/)?" : w === "**" ? ".*" : w === "*" ? "[^/]*" : "[^/]");
    const body = base
      .replace(/[.+^$()|[\]\\]/g, "\\$&")
      .replace(/\{([^}]*)\}/g, (_all, alt) => `(?:${String(alt).split(",").join("|")})`)
      .replace(/\*\*\/|\*\*|\*|\?/g, wild);
    const re = new RegExp(`^${body}$`);
    return [...parsed.keys()].filter((f) => re.test(f));
  };
  /** @type {Map<string, Map<string, Set<string>>>} module to (exported name to the files that define it) */
  const memo = new Map();
  const definers = (/** @type {string} */ mod, /** @type {Set<string>} */ seen = new Set()) => {
    const hit = memo.get(mod);
    if (hit) return hit;
    /** @type {Map<string, Set<string>>} */
    const out = new Map();
    const add = (/** @type {string} */ n, /** @type {Iterable<string>} */ fs) => {
      const s = out.get(n) ?? new Set();
      for (const f of fs) s.add(f);
      out.set(n, s);
    };
    const p = parsed.get(mod);
    if (!p || seen.has(mod)) return out;
    seen.add(mod);
    for (const n of p.exports.local) add(n, [mod]);
    for (const r of p.exports.re) {
      const to = resolveSpec(mod, r.spec);
      if (!to) continue;
      if (r.names === null) {
        for (const [n, fs] of definers(to, seen)) if (n !== "default") add(n, fs);
      } else {
        for (const [name, as] of r.names) {
          const fs = name === "*" ? null : definers(to, seen).get(name);
          add(as, fs ?? [to]);
        }
      }
    }
    memo.set(mod, out);
    return out;
  };
  /** @type {Map<string, Set<string>>} node to the nodes it loads directly */
  const deps = new Map();
  for (const [file, p] of parsed) {
    const out = new Set();
    for (const imp of p.imports) {
      if (imp.glob) {
        for (const f of globbed(file, imp.spec)) out.add(`${f}*`);
        continue;
      }
      const to = resolveSpec(file, imp.spec);
      if (!to) continue;
      if (imp.names === null) {
        out.add(`${to}*`);
        continue;
      }
      out.add(to);
      const defs = definers(to);
      for (const n of imp.names) for (const f of defs.get(n) ?? [`${to}*`]) out.add(f);
    }
    deps.set(file, out);
    // the whole module: its body and what it passes on
    const all = new Set([file]);
    for (const r of p.exports.re) {
      const to = resolveSpec(file, r.spec);
      if (to) all.add(`${to}*`);
    }
    deps.set(`${file}*`, all);
  }
  return {
    /** Whether the graph holds the file: code it reads. A stylesheet is no node of its own, though pages import it: tests
     * read the styles by a name they build (`../src/styles/${name}.css` in apps/web/test/base-css.test.ts), so a changed
     * one runs its package. */
    has: (/** @type {string} */ f) => parsed.has(f),
    /**
     * The files of `tests` that reach any of `changed`.
     * @param {string[]} changed
     * @param {string[]} tests
     */
    reaching(changed, tests) {
      const want = new Set(changed);
      /** @type {Map<string, boolean>} */
      const known = new Map();
      const reaches = (/** @type {string} */ start) => {
        const stack = [start];
        const seen = new Set(stack);
        while (stack.length) {
          const f = /** @type {string} */ (stack.pop());
          if (want.has(f.replace(/\*$/, "")) || known.get(f)) return true;
          for (const d of deps.get(f) ?? []) if (!seen.has(d)) (seen.add(d), stack.push(d));
        }
        return false;
      };
      return tests.filter((t) => {
        const r = reaches(t);
        known.set(t, r);
        return r;
      });
    },
  };
}

/** Each workspace package's name and the repo path of its "." export. @returns {Record<string, string>} */
function entries(root = ROOT) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const p of workspace(root)) {
    const pkg = JSON.parse(readFileSync(join(root, p.dir, "package.json"), "utf8"));
    const dot = typeof pkg.exports === "string" ? pkg.exports : pkg.exports?.["."] ?? pkg.main;
    if (typeof dot === "string") out[p.name] = join(p.dir, dot).replace(/^\.\//, "");
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

/** Whether a test text reads the file as text: its repo path, or its file name unless that is too common to mean it. */
const reads = (/** @type {string} */ text, /** @type {string} */ path) =>
  (path.includes("/") && text.includes(path)) || (!GENERIC.test(basename(path)) && names(text, path));

/** Whether an e2e spec names a changed file under e2e/: as `reads` does, or as an import without its extension. */
const specReads = (/** @type {string} */ text, /** @type {string} */ path) =>
  reads(text, path) || new RegExp(`/${escape(basename(path).replace(/\.[^.]+$/, ""))}["'.]`).test(text);

/** A string a page could show: a word or a sentence, not a path, an id or an identifier. */
function isSentence(/** @type {string} */ s) {
  const t = s.trim();
  if (t.length < 4 || /[/{}=]|[a-z][A-Z]|[-_]\w/.test(t) || !/[A-Za-zÄÖÅäöå]/.test(t)) return false;
  return /\s/.test(t) || /[ÄÖÅäöå]/.test(t) || /^[A-ZÄÖÅ][a-zäöå]+/.test(t);
}

/**
 * The class names and UI sentences in the changed lines (added and removed) of a source file.
 * @param {string} path
 * @param {string} text
 * @returns {{ classes: string[], strings: string[] }}
 */
export function uiTokens(path, text) {
  const classes = new Set();
  const strings = new Set();
  const addStrings = (/** @type {string} */ s) => {
    for (const piece of s.split(/\$\{[^}]*\}/)) if (isSentence(piece)) strings.add(piece.trim());
  };
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line || /^(\/\/|\/\*|\*)/.test(line)) continue;
    if (path.endsWith(".css")) {
      // selector lines only; a declaration ends with a semicolon
      if (line.endsWith(";")) continue;
      for (const m of line.matchAll(/\.([A-Za-z_][\w-]*)/g)) classes.add(m[1]);
      continue;
    }
    if (/^(import|export)\b.*\bfrom\b/.test(line)) continue;
    line = line.replace(/\bclass(?:Name)?=(?:"([^"]*)"|\{([^}]*)\})/g, (_all, plain, expr) => {
      const words = plain ?? [...String(expr).matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1]).join(" ");
      for (const c of words.split(/\s+/)) if (/^[A-Za-z_][\w-]*$/.test(c)) classes.add(c);
      return " ";
    });
    for (const m of line.matchAll(/"([^"\\]*)"|'([^'\\]*)'|`([^`\\]*)`/g)) addStrings(m[1] ?? m[2] ?? m[3] ?? "");
    for (const m of line.matchAll(/>([^<>]+)</g)) addStrings((m[1] ?? "").replace(/\{[^}]*\}/g, "${}"));
    if (/^[^<>{}=;()"'`/]+$/.test(line)) addStrings(line);
  }
  return { classes: [...classes].filter((c) => c.length >= 4).sort(), strings: [...strings].sort() };
}

/** The e2e specs that name a class or a sentence of the tokens. */
function specsNaming(/** @type {{ classes: string[], strings: string[] }} */ tok, /** @type {Record<string, string>} */ e2e) {
  const classes = tok.classes.map((c) => new RegExp(`(?<![\\w-])${escape(c)}(?![\\w-])`));
  return Object.entries(e2e)
    .filter(([, text]) => tok.strings.some((s) => text.includes(s)) || classes.some((r) => r.test(text)))
    .map(([p]) => p);
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
 * @param {Corpus} [corpus] read from the checkout when a shell file changed; given, it also finds the tests that read a
 * changed file as text
 * @param {Record<string, string>} [diffs] the changed lines of each changed source file (`diffTexts`)
 * @returns {{ full: boolean, tests: string[], lint: boolean, sh: boolean, suites: string[] | null, why: string, readers: string[], e2e: string[] }}
 * `suites` is the shell suites to run when `sh` is set; null means all of them; `readers` the vitest files found by
 * reading as text, `e2e` the specs to run
 */
export function scopeOf(files, pkgs = workspace(), corpus = undefined, diffs = {}) {
  const found = corpus ? textReaders(files, corpus, diffs) : { vitest: [], e2e: [] };
  const lint = files.some((f) => SHELL.test(f));
  /** @type {Set<string> | null} */
  let suites = files.some((f) => SUITE_INPUTS.test(f)) ? null : new Set();
  const tests = new Set([RULES]);
  const touched = new Set();
  const graph = corpus?.code ? buildGraph(corpus.code, corpus.pkgs ?? {}) : null;
  const vitestFiles = Object.keys(corpus?.vitest ?? {});
  /** The test files the graph says reach the file, or none when the graph cannot say (then the package rule decides). */
  const reachedBy = (/** @type {string} */ f) =>
    graph && !PACKAGE_CONFIG.test(f) && graph.has(f) ? graph.reaching([f], vitestFiles) : [];
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
    const reached = pkg || f.startsWith("tools/") ? reachedBy(f) : [];
    if (reached.length) for (const t of reached) tests.add(t);
    else if (pkg) touched.add(pkg.dir);
    else if (f.startsWith("tools/")) tests.add("tools");
    else if (!INERT.test(f)) unknown(`${f} is read by tests in several places`);
  }
  const sh = suites === null || suites.size > 0;
  const shSuites = suites === null ? null : [...suites].sort();
  const extra = { readers: found.vitest, e2e: found.e2e };
  if (why) return { full: true, tests: [], lint, sh, suites: shSuites, why, ...extra };
  for (const t of found.vitest) tests.add(t);
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
  return { full: false, tests: all.filter((t) => !t.endsWith(".ts") || !dirs.some((d) => t.startsWith(`${d}/`))), lint, sh, suites: shSuites, why: "", ...extra };
}

/**
 * The vitest files and e2e specs that read a changed file as text, and the pictures tests when the look of the web app
 * changed.
 * @param {string[]} files
 * @param {Corpus} corpus
 * @param {Record<string, string>} diffs
 */
function textReaders(files, corpus, diffs) {
  const specs = corpus.e2e ?? {};
  const vitest = new Set();
  const e2e = new Set();
  let visual = false;
  const tok = { classes: /** @type {string[]} */ ([]), strings: /** @type {string[]} */ ([]) };
  for (const f of files) {
    if (E2E_SPEC.test(f)) {
      if (f in specs) e2e.add(f);
      continue;
    }
    if (f.startsWith("e2e/")) for (const [p, text] of Object.entries(specs)) if (specReads(text, f)) e2e.add(p);
    if (VISUAL.test(f)) visual = true;
    if (TEXT_SOURCE.test(f) && diffs[f] !== undefined) {
      const t = uiTokens(f, diffs[f]);
      tok.classes.push(...t.classes);
      tok.strings.push(...t.strings);
      if (t.strings.length && f.startsWith("apps/web/")) visual = true;
    }
    if (VITEST_FILE.test(f)) continue;
    for (const [p, text] of Object.entries(corpus.vitest)) if (p !== f && reads(text, f)) vitest.add(p);
    for (const [p, text] of Object.entries(specs)) if (reads(text, f)) e2e.add(p);
  }
  for (const p of specsNaming(tok, specs)) e2e.add(p);
  if (visual) for (const p of Object.keys(corpus.vitest)) if (SHOTS_TEST.test(p)) vitest.add(p);
  return { vitest: [...vitest].sort(), e2e: [...e2e].sort() };
}

/**
 * The changed lines (added and removed) of each changed source file since the merge base of HEAD and `base`; a file
 * that git does not track yet counts whole.
 * @param {string} base
 * @param {string[]} files
 * @param {string} [cwd]
 * @returns {Record<string, string>}
 */
export function diffTexts(base, files, cwd = ROOT) {
  const git = (/** @type {string[]} */ ...a) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "pipe"] });
  const want = files.filter((f) => TEXT_SOURCE.test(f));
  /** @type {Record<string, string>} */
  const out = {};
  if (!want.length) return out;
  const mb = git("merge-base", "HEAD", base).trim();
  for (const block of git("diff", "-U0", "--no-renames", mb, "--", ...want).split(/^diff --git /m).slice(1)) {
    const path = /^a\/(.+?) b\//.exec(block)?.[1];
    if (path) out[path] = block.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)).map((l) => l.slice(1)).join("\n");
  }
  for (const f of want) if (!(f in out) && existsSync(join(cwd, f))) out[f] = readFileSync(join(cwd, f), "utf8");
  return out;
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
    const corpus = loadCorpus();
    const s = scopeOf(files, workspace(), corpus, diffTexts(base, files));
    // for tests-for.sh: the changed vitest files, and the changed sources `vitest related` can follow
    const own = files.filter((f) => f in corpus.vitest);
    const related = files.filter((f) => /^(apps|packages|tools)\/.+\.(m?[jt]sx?|css)$/.test(f) && !VITEST_FILE.test(f) && existsSync(join(ROOT, f)));
    console.log(
      `files=${files.length}\nfull=${s.full ? 1 : 0}\ntests=${s.tests.join(" ")}\nlint=${s.lint ? 1 : 0}\nsh=${s.sh ? 1 : 0}\nsuites=${s.suites ? s.suites.join(" ") : "all"}\nwhy=${s.why}\nreaders=${s.readers.join(" ")}\ne2e=${s.e2e.join(" ")}\nown=${own.join(" ")}\nrelated=${related.join(" ")}`,
    );
  } catch (err) {
    // an unknown base: say so and let check.sh run everything
    console.log(`error=${(err instanceof Error ? err.message : String(err)).split("\n")[0]}`);
  }
}
