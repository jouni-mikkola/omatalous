// @ts-check
/**
 * `pnpm where <symbol | file | text>`: where a function, type or constant is defined (file and line), which files import
 * it (also through a barrel such as packages/core/src/index.ts) and which test files mention it. Reads the tracked
 * TypeScript and shell files, uses the TypeScript parser that is already a dev dependency and changes nothing.
 *   pnpm where buildOptimise      a name: Class.member works too, and a shell function (act_update)
 *   pnpm where optimise/index.ts  a file: header comment, exports, importers, tests
 *   pnpm where "Menojen muutos"   text that is no name: the string literals that hold it
 * A name that is defined in several places lists every place.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isTest = (/** @type {string} */ f) => /(^|\/)(test|fixtures)\//.test(f) || /\.(test|spec)\.(tsx?|sh)$/.test(f);
const word = (/** @type {string} */ s, flags = "") => new RegExp(`(?<![\\w$])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`, flags);

/** @param {string} [cwd] */
export function load(cwd = ROOT) {
  const list = execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8", maxBuffer: 64 << 20 }).split("\0");
  /** @type {Map<string, string>} */
  const text = new Map();
  for (const f of list.filter((f) => /\.(tsx?|mjs|sh)$/.test(f) && !f.endsWith(".d.ts"))) {
    // a file that is deleted or moved and not yet committed is still listed
    try {
      text.set(f, readFileSync(join(cwd, f), "utf8"));
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== "ENOENT") throw err;
    }
  }
  const files = [...text.keys()];
  return { files, text, set: new Set(files) };
}

/** The tracked file a module specifier of `from` points at, or undefined (a package from node_modules). */
function resolveSpec(/** @type {ReturnType<typeof load>} */ w, /** @type {string} */ from, /** @type {string} */ spec) {
  const base = spec.startsWith(".") ? normalize(join(dirname(from), spec)) : /^@banking\/(\w+)$/.test(spec) ? `packages/${spec.slice(9)}/src/index.ts` : "";
  if (!base) return undefined;
  return [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((c) => w.set.has(c));
}

/** Line of a node, doc comment of its statement. */
function docOf(/** @type {ts.SourceFile} */ sf, /** @type {ts.Node} */ node) {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? [];
  const last = ranges[ranges.length - 1];
  if (!last) return "";
  const first = sf.text.slice(last.pos, last.end).replace(/^\/\*+|\*+\/$/g, "").split("\n").map((l) => l.replace(/^\s*(\/\/+|\*+)?\s?/, "").trim()).find(Boolean);
  return first ?? "";
}

/** Top-level declarations of a TypeScript file, and the members of its classes and enums. */
export function declarations(/** @type {string} */ file, /** @type {string} */ src) {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ES2022, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  /** @type {{ name: string, kind: string, line: number, exported: boolean, doc: string }[]} */
  const out = [];
  const line = (/** @type {ts.Node} */ n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  for (const st of sf.statements) {
    const exported = ts.canHaveModifiers(st) && !!ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const add = (/** @type {string} */ name, /** @type {string} */ kind, /** @type {ts.Node} */ n = st) => out.push({ name, kind, line: line(n), exported, doc: docOf(sf, st) });
    if ((ts.isFunctionDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) && st.name) add(st.name.text, ts.isFunctionDeclaration(st) ? "function" : ts.isInterfaceDeclaration(st) ? "interface" : "type");
    else if (ts.isClassDeclaration(st) && st.name) {
      add(st.name.text, "class");
      for (const m of st.members) if ((ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m)) && m.name && ts.isIdentifier(m.name)) out.push({ name: `${st.name.text}.${m.name.text}`, kind: "member", line: line(m), exported, doc: docOf(sf, m) });
    } else if (ts.isEnumDeclaration(st)) {
      add(st.name.text, "enum");
      for (const m of st.members) if (ts.isIdentifier(m.name)) out.push({ name: `${st.name.text}.${m.name.text}`, kind: "member", line: line(m), exported, doc: "" });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) add(d.name.text, st.declarationList.flags & ts.NodeFlags.Const ? "const" : "let", d);
    }
  }
  return out;
}

/** Shell functions: `name()` and `function name` at the start of a line. */
function shellDefinitions(/** @type {string} */ src, /** @type {string} */ name) {
  const re = new RegExp(`^\\s*(?:function\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\(\\)`);
  return src.split("\n").flatMap((l, i) => (re.test(l) || new RegExp(`^\\s*function\\s+${name}\\b`).test(l) ? [i + 1] : []));
}

const REEXPORT = /export\s+(\*|\{[^}]*\})\s+(?:as\s+\w+\s+)?from\s+["']([^"']+)["']/g;
const IMPORT = /import\s+(?:type\s+)?([^;'"]*?)\s*from\s+["']([^"']+)["']/g;

/** Files that export the symbol of `defFile` under its own name: the file itself and every barrel that re-exports it. */
function exportersOf(/** @type {ReturnType<typeof load>} */ w, /** @type {string} */ defFile, /** @type {string} */ name) {
  const barrels = new Set([defFile]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of w.files) {
      if (barrels.has(f) || !f.endsWith("ts") && !f.endsWith("tsx")) continue;
      for (const m of (w.text.get(f) ?? "").matchAll(REEXPORT)) {
        const target = resolveSpec(w, f, m[2] ?? "");
        const names = (m[1] ?? "").replace(/[{}]/g, "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]);
        if (target && barrels.has(target) && (m[1] === "*" || names.includes(name))) { barrels.add(f); grew = true; break; }
      }
    }
  }
  return barrels;
}

/** @param {string} query @param {ReturnType<typeof load>} [w] */
export function find(query, w = load()) {
  const [member] = query.split(".");
  const fileMode = /[/]|\.(tsx?|mjs|sh)$/.test(query);
  /** @type {{ file: string, line: number, kind: string, doc: string }[]} */
  const defs = [];
  /** @type {string[]} */
  const fileHits = [];
  if (fileMode) fileHits.push(...w.files.filter((f) => f === query || f.endsWith(`/${query}`) || f.endsWith(query.replace(/^\.\//, ""))));
  else {
    const re = word(member ?? query);
    for (const f of w.files) {
      const src = w.text.get(f) ?? "";
      if (!re.test(src)) continue;
      if (f.endsWith(".sh")) for (const line of shellDefinitions(src, query)) defs.push({ file: f, line, kind: "shell function", doc: "" });
      else if (/\.(tsx?|mjs)$/.test(f)) for (const d of declarations(f, src)) if (d.name === query) defs.push({ file: f, line: d.line, kind: `${d.exported ? "export " : ""}${d.kind}`, doc: d.doc });
    }
  }
  const targets = fileMode ? fileHits : [...new Set(defs.map((d) => d.file))];
  const named = fileMode ? undefined : query;
  /** @type {Set<string>} */ const importers = new Set();
  /** @type {Set<string>} */ const reexporters = new Set();
  for (const t of targets) {
    // a file query counts direct importers only: through the barrel it would list everything that imports the package
    const mods = named ? exportersOf(w, t, named) : new Set([t]);
    if (!named) for (const f of exportersOf(w, t, "*")) if (f !== t) reexporters.add(f);
    for (const f of w.files) {
      const src = w.text.get(f) ?? "";
      if (!f.endsWith("ts") && !f.endsWith("tsx") && !f.endsWith("mjs")) continue;
      for (const m of src.matchAll(IMPORT)) {
        const target = resolveSpec(w, f, m[2] ?? "");
        if (!target || !mods.has(target) || f === t) continue;
        if (!named || word(named).test(m[1] ?? "") || /\*\s+as\s/.test(m[1] ?? "")) (mods.has(f) ? reexporters : importers).add(f);
      }
    }
    for (const f of mods) if (f !== t) reexporters.add(f);
  }
  const needle = named ? word(named, "g") : undefined;
  const base = (/** @type {string} */ t) => t.replace(/^.*\//, "").replace(/\.\w+$/, "");
  const tests = w.files
    .filter(isTest)
    .map((f) => {
      const src = w.text.get(f) ?? "";
      const count = needle ? (src.match(needle) ?? []).length : targets.some((t) => base(f).replace(/\.test$/, "") === base(t) || importersIncludes(w, f, t)) ? 1 : 0;
      return { file: f, count };
    })
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
  /** @type {string[]} */
  const literals = [];
  if (!fileMode && defs.length === 0) {
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    for (const f of w.files.filter((f) => /\.tsx?$/.test(f) && !isTest(f))) {
      (w.text.get(f) ?? "").split("\n").forEach((l, i) => { if (/["'`]/.test(l) && re.test(l)) literals.push(`${f}:${i + 1}  ${l.trim().slice(0, 100)}`); });
    }
  }
  /** @type {string[]} */
  const callers = [];
  if (defs.some((d) => d.kind === "shell function")) {
    for (const f of w.files.filter((f) => f.endsWith(".sh") && !isTest(f))) {
      const n = (w.text.get(f) ?? "").split("\n").filter((l) => word(query).test(l)).length - defs.filter((d) => d.file === f).length;
      if (n > 0) callers.push(`${f} (${n})`);
    }
  }
  const header = fileMode ? targets.map((t) => ({ file: t, text: fileHeader(w.text.get(t) ?? "") })) : [];
  return { defs, importers: [...importers].filter((f) => !isTest(f)).sort(), reexporters: [...reexporters].sort(), tests, literals, callers, header, ambiguous: targets.length > 1 };
}

function importersIncludes(/** @type {ReturnType<typeof load>} */ w, /** @type {string} */ f, /** @type {string} */ target) {
  for (const m of (w.text.get(f) ?? "").matchAll(IMPORT)) if (resolveSpec(w, f, m[2] ?? "") === target) return true;
  return false;
}

/** The first lines of the comment that opens a file. */
function fileHeader(/** @type {string} */ src) {
  const body = src.replace(/^#!.*\n/, "");
  const block = /^\s*(?:\/\/ @ts-check\n\s*)?(\/\*[\s\S]*?\*\/|(?:\/\/.*\n?|#.*\n?)+)/.exec(body)?.[1] ?? "";
  return block.split("\n").map((l) => l.replace(/^\s*(\/\*+|\*+\/?|\/\/+|#+)\s?/, "").replace(/\*\/\s*$/, "").trim()).filter(Boolean).slice(0, 3).join(" ");
}

function print(/** @type {string} */ query) {
  const r = find(query);
  const more = (/** @type {string[]} */ l, n = 8) => (l.length > n ? `${l.slice(0, n).join(", ")} and ${l.length - n} more` : l.join(", "));
  const out = [];
  for (const d of r.defs) out.push(`define    ${d.file}:${d.line}  ${d.kind} ${query}${d.doc ? `\n          ${d.doc.slice(0, 110)}` : ""}`);
  for (const h of r.header) out.push(`file      ${h.file}${h.text ? `\n          ${h.text.slice(0, 160)}` : ""}`);
  if (r.defs.length > 1 || r.ambiguous) out.push(`note      ${r.defs.length || r.header.length} places match: the importers below are all of them together`);
  if (r.defs.length + r.header.length > 0) {
    if (r.callers.length) out.push(`callers   ${more(r.callers)}`);
    else out.push(`import    ${r.importers.length ? `${r.importers.length} files: ${more(r.importers)}` : "none"}`);
    if (r.reexporters.length) out.push(`reexport  ${more(r.reexporters)}`);
    out.push(`tests     ${r.tests.length ? more(r.tests.map((t) => `${t.file}${t.count > 1 ? ` (${t.count})` : ""}`), 10) : "none mention it"}`);
  } else if (r.literals.length) {
    out.push(`no definition named ${query}; string literals that hold it:`, ...r.literals.slice(0, 10).map((l) => `literal   ${l}`));
    if (r.literals.length > 10) out.push(`          and ${r.literals.length - 10} more`);
  } else {
    out.push(`nothing found for ${query}`);
    process.exitCode = 1;
  }
  console.log(out.join("\n"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const q = process.argv.slice(2).join(" ").trim();
  if (!q) { console.error("usage: pnpm where <symbol | file | text>"); process.exit(2); }
  print(q);
}
