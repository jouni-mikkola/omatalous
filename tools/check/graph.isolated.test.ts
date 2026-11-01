import { describe, expect, it } from "vitest";
import { buildGraph, loadCorpus, parse, scopeOf, workspace } from "./scope.mjs";

const PKGS = { "@banking/core": "packages/core/src/index.ts" };
// a small workspace: core with a barrel, a server that imports core by name, and tests of each
const code: Record<string, string> = {
  "packages/core/src/index.ts": 'export * from "./dates.ts";\nexport { holdings } from "./holdings.ts";\nexport * as fees from "./fees.ts";\n',
  "packages/core/src/dates.ts": "export const today = 1;\nexport function addDays() {}\n",
  "packages/core/src/holdings.ts": 'import { today } from "./dates.ts";\nexport const holdings = today;\n',
  "packages/core/src/fees.ts": "export const fee = 2;\n",
  "packages/core/src/unread.ts": "export const nobody = 3;\n",
  "packages/core/test/dates.test.ts": 'import { addDays } from "../src/dates.ts";\n',
  "packages/core/test/holdings.test.ts": 'import { holdings } from "../src/index.ts";\n',
  "apps/server/src/app.ts": 'import { holdings } from "@banking/core";\nimport type { Fee } from "./types.ts";\nexport const app = holdings;\n',
  "apps/server/src/types.ts": "export type Fee = number;\n",
  "apps/server/test/helpers.ts": 'export { app } from "../src/app.js";\n',
  "apps/server/test/app.test.ts": 'import { app } from "./helpers.ts";\n',
  "apps/server/test/dates.test.ts": 'import { today } from "@banking/core";\n',
  "apps/server/test/all.test.ts": 'import * as core from "@banking/core";\n',
  "apps/server/test/lazy.test.ts": 'const m = await import("../src/types.ts");\n// import { fee } from "@banking/core";\n',
  "apps/web/src/page.tsx": 'import "./page.css";\n',
  "apps/web/src/page.css": ".page {}\n",
  "apps/web/test/page.test.ts": 'vi.mock("../src/page.tsx");\n',
  "apps/web/src/registry.ts": 'const m = import.meta.glob<{ s?: { a: 1 } }>("./sections/*.tsx", { eager: true });\nconst n = import.meta.glob(["./deep/**/*.ts", "!./deep/skip.ts"]);\n',
  "apps/web/src/sections/Food.tsx": "export const section = 1;\n",
  "apps/web/src/sections/sub/Not.tsx": "export const section = 2;\n",
  "apps/web/src/deep/a/b.ts": "export const b = 1;\n",
  "apps/web/test/registry.test.ts": 'import { x } from "../src/registry.ts";\n',
};
const tests = Object.keys(code).filter((f) => f.endsWith(".test.ts"));
const graph = buildGraph(code, PKGS);
const reach = (f: string) => graph.reaching([f], tests).sort();

describe("check --changed: the import graph", () => {
  it("reads named, default, namespace, bare and dynamic imports, vi.mock and re-exports, and leaves types and comments out", () => {
    const p = parse('import a, { b, c as d, type E } from "./x.ts";\nimport type { F } from "./f.ts";\nimport * as g from "./g.ts";\nimport "./h.css";\nawait import("./i.ts");\nvi.mock("./j.ts");\n// import { k } from "./k.ts";\nexport { l } from "./l.ts";\nexport * from "./m.ts";\nexport * as n from "./n.ts";\nexport const o = 1;\nexport type P = 1;\n');
    expect(p.imports).toEqual([
      { spec: "./x.ts", names: null },
      { spec: "./g.ts", names: null },
      { spec: "./h.css", names: null },
      { spec: "./i.ts", names: null },
      { spec: "./j.ts", names: null },
    ]);
    expect([...p.exports.local]).toEqual(["o"]);
    expect(p.exports.re).toEqual([
      { spec: "./l.ts", names: [["l", "l"]] },
      { spec: "./m.ts", names: null },
      { spec: "./n.ts", names: [["*", "n"]] },
    ]);
    expect(parse('import { b, c as d } from "./x.ts";\n').imports).toEqual([{ spec: "./x.ts", names: ["b", "c"] }]);
  });

  it("a name taken from a barrel reaches the file that defines it, not the rest of the barrel", () => {
    expect(reach("packages/core/src/holdings.ts")).toEqual(["apps/server/test/all.test.ts", "apps/server/test/app.test.ts", "packages/core/test/holdings.test.ts"]);
    // fees.ts is passed on as a namespace: only the test that imports the whole barrel reaches it
    expect(reach("packages/core/src/fees.ts")).toEqual(["apps/server/test/all.test.ts"]);
  });

  it("reaches through other files and the packages' entry, by import and by export ... from", () => {
    expect(reach("packages/core/src/dates.ts")).toEqual([
      "apps/server/test/all.test.ts",
      "apps/server/test/app.test.ts",
      "apps/server/test/dates.test.ts",
      "packages/core/test/dates.test.ts",
      "packages/core/test/holdings.test.ts",
    ]);
  });

  it("a type-only import is no edge; a dynamic import and vi.mock are", () => {
    expect(reach("apps/server/src/types.ts")).toEqual(["apps/server/test/lazy.test.ts"]);
  });

  it("import.meta.glob reaches the files its pattern matches, and only those", () => {
    expect(parse('import.meta.glob<{ a?: { b: 1 } }>("./s/*.tsx", { eager: true });\n').imports).toEqual([{ spec: "./s/*.tsx", names: null, glob: true }]);
    expect(reach("apps/web/src/sections/Food.tsx")).toEqual(["apps/web/test/registry.test.ts"]);
    expect(reach("apps/web/src/deep/a/b.ts")).toEqual(["apps/web/test/registry.test.ts"]);
    expect(reach("apps/web/src/sections/sub/Not.tsx")).toEqual([]);
  });

  it("a stylesheet is no node: tests read the styles by names they build, so the package rule decides", () => {
    expect(graph.has("apps/web/src/page.css")).toBe(false);
    expect(scopeOf(["apps/web/src/page.css"], workspace(), { shell: {}, vitest: {}, code, pkgs: PKGS }).tests).toContain("apps/web");
  });

  it("a file nothing imports reaches no test, and a changed test reaches itself", () => {
    expect(reach("packages/core/src/unread.ts")).toEqual([]);
    expect(reach("apps/server/test/helpers.ts")).toEqual(["apps/server/test/app.test.ts"]);
    expect(reach("apps/server/test/app.test.ts")).toEqual(["apps/server/test/app.test.ts"]);
  });
});

describe("check --changed: vitest by the import graph", () => {
  const corpus = { shell: {}, vitest: Object.fromEntries(tests.map((t) => [t, code[t] ?? ""])), code, pkgs: PKGS };
  const scope = (files: string[]) => scopeOf(files, workspace(), corpus);

  it("a source change runs the tests that reach it, the UI sentences and the repo rules, not its package and the dependents", () => {
    expect(scope(["packages/core/src/holdings.ts"]).tests).toEqual([
      "apps/server/test/all.test.ts",
      "apps/server/test/app.test.ts",
      "packages/core/test/holdings.test.ts",
      "tools/repo-rules",
      "tools/ui-strings.test.ts",
    ]);
  });

  it("falls back to the package rule for a file no test reaches, a file the graph does not hold and a config file", () => {
    for (const f of ["packages/core/src/unread.ts", "packages/core/test/fixtures/rows.json", "packages/core/package.json", "packages/core/tsconfig.json"])
      expect(scope([f]).tests, f).toEqual(expect.arrayContaining(["packages/core", "apps/server", "apps/web"]));
    expect(scope(["apps/server/src/gone.ts"]).tests).toEqual(["apps/server", "tools/repo-rules", "tools/ui-strings.test.ts"]);
  });

  it("the graph and the package rule add up: a reached file and a fallback in one diff", () => {
    const t = scope(["apps/web/src/page.tsx", "apps/server/src/gone.ts"]).tests;
    expect(t).toEqual(["apps/server", "apps/web/test/page.test.ts", "tools/repo-rules", "tools/ui-strings.test.ts"]);
  });

  it("in this checkout a report section runs the tests that load sections/ by import.meta.glob", () => {
    const t = scopeOf(["apps/web/src/pages/reports/sections/Food.tsx"], workspace(), loadCorpus()).tests;
    expect(t).toEqual(expect.arrayContaining(["apps/web/test/section-reports.test.ts", "apps/web/test/sections.test.ts"]));
  });

  it("in this checkout a stylesheet runs the web package, so base-css.test.ts with its built paths is in", () => {
    const t = scopeOf(["apps/web/src/styles/settings.css"], workspace(), loadCorpus()).tests;
    expect(t).toContain("apps/web");
  });

  it("in this checkout a core source runs test files of core and server, not the three packages", () => {
    const t = scopeOf(["packages/core/src/holdings.ts"], workspace(), loadCorpus()).tests;
    expect(t.filter((f) => !f.endsWith(".ts"))).toEqual(["tools/repo-rules"]);
    expect(t.some((f) => f.startsWith("packages/core/test/"))).toBe(true);
    expect(t.some((f) => f.startsWith("apps/server/test/"))).toBe(true);
  });
});
