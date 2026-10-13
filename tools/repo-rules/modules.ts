/**
 * Rules 29 to 33 of the repo rules: the feature modules under packages/core/src/features/<kind>/<id>/ and the views
 * under apps/web/src/features/view/<id>/ (docs/ARCHITECTURE.md, "Feature modules"). A rule applies to whatever is in
 * those folders, so a new module meets all of them with no line added here. The import boundaries of a module are a
 * row of boundaries.ts (rule 6).
 *
 * Each rule is a function of a `Tree` (a list of paths and their text), so the same rule runs on the real tree and on a
 * made-up one: the last `describe` feeds each rule the smallest module that breaks it and expects the rule, the file
 * and the sentence.
 */
import { posix } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { KINDS, differences, registryPath, registryText } from "../gen/registry.mjs";
import { unreadExports } from "./exports.ts";
import { type Finding, expectNoFindings, importsOf, readText, repoFiles } from "./lib.ts";

const CORE = "packages/core/src/features";
const WEB = "apps/web/src/features/view";
const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const CASES = ["moneyIn", "moneyOut", "refund"];
const FOLDER_LINES = 400;
const FILE_LINES = 300;
/** The largest group of core files that import each other, types included. DL2 took it from 104 to this; it only goes down. */
export const TYPE_GROUP_CEILING = 104;

interface Tree {
  list: string[];
  read(path: string): string;
}
interface Hit extends Finding {
  rule: string;
}
const real: Tree = { list: [], read: readText };
const inFeatures = (f: string) => f.startsWith(`${CORE}/`) || f.startsWith(`${WEB}/`) || f.startsWith("e2e/views/");
const isTest = (f: string) => /\.(test|spec)\.tsx?$/.test(f);

interface Mod {
  kind: string;
  id: string;
  dir: string;
  files: string[];
}
/** The module folders of the core features: `<kind>/<id>/...` for each kind. */
function modulesOf(tree: Tree): Mod[] {
  const by = new Map<string, Mod>();
  for (const f of tree.list) {
    const m = new RegExp(`^${CORE}/(${KINDS.join("|")})/([^/]+)/`).exec(f);
    if (!m) continue;
    const dir = `${CORE}/${m[1]}/${m[2]}`;
    const mod = by.get(dir) ?? { kind: m[1]!, id: m[2]!, dir, files: [] };
    mod.files.push(f);
    by.set(dir, mod);
  }
  return [...by.values()];
}
function viewsOf(tree: Tree): { id: string; dir: string; files: string[] }[] {
  const by = new Map<string, { id: string; dir: string; files: string[] }>();
  for (const f of tree.list) {
    const m = new RegExp(`^${WEB}/([^/]+)/`).exec(f);
    if (!m) continue;
    const v = by.get(m[1]!) ?? { id: m[1]!, dir: `${WEB}/${m[1]}`, files: [] };
    v.files.push(f);
    by.set(m[1]!, v);
  }
  return [...by.values()];
}
const strings = (list: string) => [...list.matchAll(/"([^"]+)"/g)].map((x) => x[1]!);
/** The string items of `key: [...]` in a module's text, or undefined when it has no such key. */
const listOf = (text: string, key: string) => {
  const m = new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`).exec(text);
  return m ? strings(m[1]!) : undefined;
};
const lines = (text: string) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

function sourceOf(tree: Tree, path: string): ts.SourceFile {
  return ts.createSourceFile(path, tree.read(path), ts.ScriptTarget.ES2022, false, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
const exported = (s: ts.Statement) => ts.canHaveModifiers(s) && !!ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
/** The names a file exports as values (`type: false`) or as types only (`type: true`), and `*` for a re-export of everything. */
function exportsOf(sf: ts.SourceFile) {
  const values: string[] = [];
  const types: string[] = [];
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) {
      if (!s.exportClause) values.push("*");
      else if (ts.isNamedExports(s.exportClause)) for (const e of s.exportClause.elements) (s.isTypeOnly || e.isTypeOnly ? types : values).push(e.name.text);
    } else if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) {
      if (exported(s)) types.push(s.name.text);
    } else if (ts.isVariableStatement(s) && exported(s)) {
      for (const d of s.declarationList.declarations) values.push(ts.isIdentifier(d.name) ? d.name.text : "{...}");
    } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isEnumDeclaration(s)) && exported(s)) values.push(s.name?.text ?? "default");
    else if (ts.isExportAssignment(s)) values.push("default");
  }
  return { values, types };
}
/** The keys of `export const cases = {...}` (also under `satisfies` and `as`), or undefined when it is not there. */
function caseKeys(sf: ts.SourceFile): string[] | undefined {
  for (const s of sf.statements) {
    if (!ts.isVariableStatement(s) || !exported(s)) continue;
    for (const d of s.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== "cases" || !d.initializer) continue;
      let e: ts.Expression = d.initializer;
      while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
      if (ts.isObjectLiteralExpression(e)) return e.properties.flatMap((p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? [p.name.text] : []));
    }
  }
  return undefined;
}

/** Every finding of rules 29 to 32 over a tree, each with its rule name. */
export function findingsOf(tree: Tree): Hit[] {
  const out: Hit[] = [];
  const hit = (rule: string, file: string, why: string, line = 1) => out.push({ rule, file, line, why });
  const mods = modulesOf(tree);
  const views = viewsOf(tree);
  const present = new Set(tree.list);

  // rule 29a: each registry is what the generator prints for the folders (the same lines, in any order)
  for (const kind of KINDS) {
    const path = registryPath(kind);
    const ids = mods.filter((m) => m.kind === kind && ID.test(m.id) && present.has(`${m.dir}/index.ts`)).map((m) => m.id);
    if (!present.has(path)) hit("29a registry", path, "is missing: run `pnpm gen`");
    else for (const d of differences(tree.read(path), registryText(ids))) hit("29a registry", path, `${d} (run \`pnpm gen\`)`);
  }
  for (const m of mods) {
    if (!ID.test(m.id)) hit("29a registry", m.dir, "is not a module id (lower case words joined by single hyphens)");
    // rule 29b: the id is the folder's name and the kind its parent's
    const index = `${m.dir}/index.ts`;
    if (!present.has(index)) continue;
    const text = tree.read(index);
    const id = /\bid:\s*"([^"]*)"/.exec(text)?.[1];
    const kind = /\bkind:\s*"([^"]*)"/.exec(text)?.[1];
    if (id !== m.id) hit("29b identity", index, `says id ${id === undefined ? "nothing" : `"${id}"`}, the folder is "${m.id}": \`id\` is the folder's name`);
    if (kind !== m.kind) hit("29b identity", index, `says kind ${kind === undefined ? "nothing" : `"${kind}"`}, the folder is under ${m.kind}/: \`kind\` is the parent folder's name`);
    // rule 29c: the files every module holds
    for (const need of ["index.ts", "index.test.ts", "fixture.ts"]) if (!present.has(`${m.dir}/${need}`)) hit("29c files", m.dir, `has no ${need}`);
  }
  for (const v of views) {
    for (const need of ["meta.ts", "View.tsx", "View.test.ts"]) if (!present.has(`${v.dir}/${need}`)) hit("29c files", v.dir, `has no ${need}`);
    if (!present.has(`e2e/views/${v.id}.spec.ts`)) hit("29c files", v.dir, `has no e2e/views/${v.id}.spec.ts`);
  }

  // rule 29d: every `needs` and `uses` names a module that exists, and every section is needed by some view
  const ids = new Set(mods.map((m) => m.id));
  const sections = new Set(mods.filter((m) => m.kind === "section").map((m) => m.id));
  const needed = new Set<string>();
  for (const v of views) {
    const meta = `${v.dir}/meta.ts`;
    if (!present.has(meta)) continue;
    for (const n of listOf(tree.read(meta), "needs") ?? []) {
      needed.add(n);
      if (!sections.has(n)) hit("29d needs", meta, `needs the section "${n}", which has no folder under features/section/`);
    }
  }
  for (const m of mods) {
    if (!present.has(`${m.dir}/index.ts`)) continue;
    for (const u of listOf(tree.read(`${m.dir}/index.ts`), "uses") ?? []) if (!ids.has(u)) hit("29d needs", `${m.dir}/index.ts`, `uses "${u}", which no folder under features/ has`);
    if (m.kind === "section" && !needed.has(m.id)) hit("29d needs", `${m.dir}/index.ts`, `the section "${m.id}" is in the needs of no view (add it to the meta.ts of the view that shows it)`);
  }

  // rule 30: only registry.gen.ts imports a module's index.ts (its own folder's files may)
  for (const f of tree.list) {
    if (!/\.tsx?$/.test(f) || f.endsWith("/registry.gen.ts")) continue;
    const text = tree.read(f);
    for (const ref of ts.preProcessFile(text, true, true).importedFiles) {
      if (!ref.fileName.startsWith(".")) continue;
      const to = posix.normalize(posix.join(posix.dirname(f), ref.fileName)).replace(/\.tsx?$/, "").replace(/\/index$/, "");
      const m = new RegExp(`^${CORE}/(${KINDS.join("|")})/([^/]+)$`).exec(to);
      if (m && ID.test(m[2]!) && !f.startsWith(`${to}/`)) hit("30 registry only", f, `imports the module ${m[2]} (${ref.fileName}): only ${registryPath(m[1]!)} imports a module, everything else asks the frame`, text.slice(0, ref.pos).split("\n").length);
    }
  }

  // rule 31: a module folder is at most 400 lines of source, a file at most 300
  for (const m of mods) {
    const src = m.files.filter((f) => /\.(tsx?|css)$/.test(f) && !isTest(f));
    const total = src.reduce((n, f) => n + lines(tree.read(f)), 0);
    if (total > FOLDER_LINES) hit("31 size", m.dir, `${total} lines of source, a module folder holds at most ${FOLDER_LINES}: split the feature`);
    for (const f of src) if (lines(tree.read(f)) > FILE_LINES) hit("31 size", f, `${lines(tree.read(f))} lines, a file of a module holds at most ${FILE_LINES}`);
  }

  // rule 32: index.ts exports `module` and types; fixture.ts exports `cases` with the three cases
  for (const m of mods) {
    if (present.has(`${m.dir}/index.ts`)) {
      const e = exportsOf(sourceOf(tree, `${m.dir}/index.ts`));
      const extra = e.values.filter((v) => v !== "module");
      if (!e.values.includes("module")) hit("32 exports", `${m.dir}/index.ts`, "does not export `module`");
      if (extra.length) hit("32 exports", `${m.dir}/index.ts`, `exports ${extra.join(", ")} besides \`module\`: only \`module\` and types may leave the folder`);
    }
    if (present.has(`${m.dir}/fixture.ts`)) {
      const keys = caseKeys(sourceOf(tree, `${m.dir}/fixture.ts`));
      const lacks = keys ? CASES.filter((c) => !keys.includes(c)) : CASES;
      if (!keys) hit("32 exports", `${m.dir}/fixture.ts`, "does not `export const cases = { moneyIn, moneyOut, refund }`");
      else if (lacks.length) hit("32 exports", `${m.dir}/fixture.ts`, `\`cases\` lacks ${lacks.join(", ")}: every module is tried with money in, money out and a refund`);
    }
  }
  return out;
}

/** The `uses` graph of the modules as `id -> ids`, and a loop in it if there is one. */
export function usesLoop(graph: ReadonlyMap<string, readonly string[]>): string[] | undefined {
  const state = new Map<string, 1 | 2>();
  const path: string[] = [];
  const visit = (v: string): string[] | undefined => {
    if (state.get(v) === 2) return undefined;
    if (state.get(v) === 1) return [...path.slice(path.indexOf(v)), v];
    state.set(v, 1);
    path.push(v);
    for (const w of graph.get(v) ?? []) {
      const loop = visit(w);
      if (loop) return loop;
    }
    path.pop();
    state.set(v, 2);
    return undefined;
  };
  for (const v of graph.keys()) {
    const loop = visit(v);
    if (loop) return loop;
  }
  return undefined;
}
function loopsOf(tree: Tree): Hit[] {
  const present = new Set(tree.list);
  const graph = new Map<string, string[]>();
  for (const m of modulesOf(tree)) if (present.has(`${m.dir}/index.ts`)) graph.set(m.id, listOf(tree.read(`${m.dir}/index.ts`), "uses") ?? []);
  const loop = usesLoop(graph);
  return loop ? [{ rule: "33 uses", file: `${CORE}/`, line: 1, why: `\`uses\` makes a loop: ${loop.join(" -> ")}` }] : [];
}

const onlyRule = (hits: Hit[], prefix: string) => hits.filter((h) => h.rule.startsWith(prefix));
const FIX = "see docs/ARCHITECTURE.md, \"Feature modules\"; a registry is written by `pnpm gen`.";

describe("repo rules: feature modules (rules 29 to 33)", () => {
  const tree = (): Tree => ({ ...real, list: repoFiles().filter(inFeatures) });
  const run = (prefix: string, name: string) => () => {
    const t = tree();
    expectNoFindings(name, onlyRule(findingsOf(t), prefix).map(({ rule, ...f }) => ({ ...f, why: `${rule}: ${f.why}` })), FIX);
  };
  it("rule 29a: each registry.gen.ts holds one line a module folder and nothing else", run("29a", "feature registries"));
  it("rule 29b: module.id is the folder's name and module.kind its parent's", run("29b", "module identity"));
  it("rule 29c: every module folder holds index.ts, index.test.ts and fixture.ts, every view its files and a spec", run("29c", "module files"));
  it("rule 29d: every needs and uses names a module that exists, and every section is needed by a view", run("29d", "needs and uses"));
  it("rule 30: only a registry.gen.ts imports a module's index.ts", run("30", "registry only"));
  it("rule 31: a module folder is at most 400 lines of source and a file of it at most 300", run("31", "module size"));
  it("rule 32: index.ts exports module and types, fixture.ts exports cases with moneyIn, moneyOut and refund", run("32", "module exports"));
  it("rule 33a: the uses of the modules make no loop", () => expectNoFindings("uses graph", loopsOf(tree()), "a module reads the answer of others, never in a circle: move what both need into a module they both use."));
  it("rule 33b: the biggest group of core files that import each other, types included, is not above its ceiling", () => {
    // the strongly connected group is measured by rule 6d for runtime imports; here the type-only imports count too
    const known = new Set(repoFiles());
    const core = repoFiles().filter((f) => /^packages\/core\/src\/.+\.tsx?$/.test(f) && !isTest(f));
    const graph = new Map<string, string[]>();
    for (const f of core) {
      const to = importsOf(f)
        .filter((r) => r.spec.startsWith("."))
        .map((r) => posix.normalize(posix.join(posix.dirname(f), r.spec)))
        .map((b) => [b, `${b}.ts`, `${b}/index.ts`, b.replace(/\.js$/, ".ts")].find((c) => known.has(c)))
        .filter((t): t is string => !!t && t !== f);
      graph.set(f, [...new Set(to)]);
    }
    const size = largestGroup(graph);
    expect(size, `${size} core files import each other in one group, the ceiling is ${TYPE_GROUP_CEILING}: lower TYPE_GROUP_CEILING in tools/repo-rules/modules.ts when it falls, never raise it`).toBeLessThanOrEqual(TYPE_GROUP_CEILING);
  });
});

/** The size of the largest strongly connected group (Tarjan). */
function largestGroup(graph: ReadonlyMap<string, readonly string[]>): number {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  let next = 0;
  let best = 0;
  const visit = (v: string) => {
    index.set(v, next);
    low.set(v, next++);
    stack.push(v);
    on.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!graph.has(w)) continue;
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) !== index.get(v)) return;
    let n = 0;
    for (let w = stack.pop()!; ; w = stack.pop()!) {
      on.delete(w);
      n++;
      if (w === v) break;
    }
    best = Math.max(best, n);
  };
  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return best;
}

// ── each rule on the smallest module that breaks it ────────────────────────────────────────────────────────────────
const GOOD = (id: string, kind = "insight") => `import { define } from "../../contract.ts";\nexport const module = define({ kind: "${kind}", id: "${id}", order: 10, reads: ["range"] });\n`;
const CASE_TEXT = "export const cases = { moneyIn: 1, moneyOut: 2, refund: 3 };\n";
/** A tree with one sound insight "price-rises", its registry, and `edit` applied: path -> text, null deletes. */
function fixture(edit: Record<string, string | null> = {}): Tree {
  const dir = `${CORE}/insight/price-rises`;
  const files: Record<string, string> = {
    [`${dir}/index.ts`]: GOOD("price-rises"),
    [`${dir}/index.test.ts`]: "",
    [`${dir}/fixture.ts`]: CASE_TEXT,
    ...Object.fromEntries(KINDS.map((k) => [registryPath(k), registryText(k === "insight" ? ["price-rises"] : [])])),
  };
  for (const [p, t] of Object.entries(edit)) if (t === null) delete files[p];
  else files[p] = t;
  return { list: Object.keys(files).sort(), read: (p) => files[p] ?? "" };
}
const DIR = `${CORE}/insight/price-rises`;
const BREAKS: [string, string, Record<string, string | null>, RegExp][] = [
  ["29a registry", registryPath("insight"), { [registryPath("insight")]: registryText([]) }, /lacks: export \{ module as price_rises \}/],
  ["29a registry", registryPath("section"), { [registryPath("section")]: registryText(["gone"]) }, /has a line the folders do not give: export \{ module as gone \}/],
  ["29b identity", `${DIR}/index.ts`, { [`${DIR}/index.ts`]: GOOD("price-rise") }, /says id "price-rise", the folder is "price-rises"/],
  ["29b identity", `${DIR}/index.ts`, { [`${DIR}/index.ts`]: GOOD("price-rises", "check") }, /says kind "check"/],
  ["29c files", DIR, { [`${DIR}/fixture.ts`]: null }, /has no fixture\.ts/],
  ["29c files", `${WEB}/prices`, { [`${WEB}/prices/meta.ts`]: "" }, /has no View\.tsx/],
  ["29d needs", `${WEB}/prices/meta.ts`, { [`${WEB}/prices/meta.ts`]: 'export const meta = { needs: ["nothing"] };', [`${WEB}/prices/View.tsx`]: "", [`${WEB}/prices/View.test.ts`]: "", "e2e/views/prices.spec.ts": "" }, /needs the section "nothing"/],
  ["29d needs", `${DIR}/index.ts`, { [`${DIR}/index.ts`]: `${GOOD("price-rises")}// uses: ["no"]\nconst x = { uses: ["no"] };\n` }, /uses "no", which no folder/],
  ["30 registry only", `${CORE}/check/rival/index.ts`, { [`${CORE}/check/rival/index.ts`]: 'import { module } from "../../insight/price-rises/index.ts";\nexport { module };\n' }, /imports the module price-rises/],
  ["31 size", `${DIR}/index.ts`, { [`${DIR}/index.ts`]: `${GOOD("price-rises")}${"// pad\n".repeat(301)}` }, /lines, a file of a module holds at most 300/],
  ["32 exports", `${DIR}/index.ts`, { [`${DIR}/index.ts`]: `${GOOD("price-rises")}export const helper = 1;\n` }, /exports helper besides `module`/],
  ["32 exports", `${DIR}/fixture.ts`, { [`${DIR}/fixture.ts`]: "export const cases = { moneyIn: 1, moneyOut: 2 };\n" }, /`cases` lacks refund/],
];
describe("repo rules: feature modules, each rule on a module that breaks it", () => {
  it("the sound module passes every rule", () => {
    expect(findingsOf(fixture())).toEqual([]);
  });
  for (const [rule, file, edit, why] of BREAKS) {
    it(`${rule}: names ${file.replace(/^.*features\//, "")} and the rule (${why.source.slice(0, 40)})`, () => {
      const hits = findingsOf(fixture(edit)).filter((h) => h.rule === rule && h.file === file);
      expect(hits.map((h) => h.why).join("\n")).toMatch(why);
    });
  }
  it("rule 33a: a loop of uses is named", () => {
    expect(usesLoop(new Map([["a", ["b"]], ["b", ["c"]], ["c", ["a"]]]))).toEqual(["a", "b", "c", "a"]);
    expect(usesLoop(new Map([["a", ["b", "c"]], ["b", ["c"]], ["c", []]]))).toBeUndefined();
  });
  it("rule 24: the exports a module leaves unread are the frame's to read, not an unread export", () => {
    const sf = (f: string) => ts.createSourceFile(f, f.endsWith("index.ts") ? "export const module = 1;\nexport interface T {}\n" : "export const cases = 1;\n", ts.ScriptTarget.ES2022);
    const files = [`${DIR}/index.ts`, `${DIR}/fixture.ts`];
    expect(unreadExports(files, sf, [`${CORE}/`], [`${CORE}/`]).map((u) => u.key)).toEqual([`${DIR}/index.ts  T`]);
  });
});
