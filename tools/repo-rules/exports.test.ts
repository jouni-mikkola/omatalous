import ts from "typescript";
import { describe, expect, it } from "vitest";
import { unreadExports } from "./exports.ts";

/** A small tree: file name to text. Every file is parsed as it is. */
const tree = (texts: Record<string, string>) =>
  unreadExports(
    Object.keys(texts),
    (f) => ts.createSourceFile(f, texts[f] ?? "", ts.ScriptTarget.ES2022, false, ts.ScriptKind.TS),
  ).map((u) => u.key);

const CORE = "packages/core/src/";
const WEB = "apps/web/src/";

describe("rule 24 detection", () => {
  it("finds an export whose only reader is a test, with its line in an index file", () => {
    // the case as it was: merchantStats, exported, passed on by the index, read by one test
    expect(
      tree({
        [`${CORE}dashboard.ts`]: "export function merchantStats() { return []; }\nexport function buildDashboard() { return 1; }\n",
        [`${CORE}index.ts`]: 'export * from "./dashboard.ts";\nexport { merchantStats } from "./dashboard.ts";\n',
        "packages/core/test/pipeline.test.ts": 'import { merchantStats } from "../src/dashboard.ts";\nmerchantStats();\n',
        [`${WEB}Page.tsx`]: 'import { buildDashboard } from "@omatalous/core";\nbuildDashboard();\n',
      }),
    ).toEqual([`${CORE}dashboard.ts  merchantStats`]);
  });

  it("counts a private reader for a private export only, so the public tree holds up without the private folders", () => {
    expect(
      tree({
        [`${CORE}shared.ts`]: "export const used = 1;\nexport const onlyPrivate = 2;\n",
        [`${CORE}use.ts`]: 'import { used } from "./shared.ts";\nexport const s = used;\n',
        [`${CORE}private/mod.ts`]: 'import { onlyPrivate } from "../shared.ts";\nexport const inner = onlyPrivate;\n',
        [`${CORE}private/other.ts`]: 'import { inner } from "./mod.ts";\ninner;\n',
      }),
    ).toEqual([`${CORE}shared.ts  onlyPrivate`, `${CORE}use.ts  s`]);
  });

  it("accepts an export that another source file calls, also by an alias, a type position or a namespace", () => {
    expect(
      tree({
        [`${CORE}a.ts`]: "export const A = 1;\nexport function b() {}\nexport interface C { x: number }\nexport type D = string;\nexport class E {}\nexport function f() {}\n",
        [`${CORE}use.ts`]:
          'import { A, b as bee, type C } from "./a.ts";\nimport * as a from "./a.ts";\nimport type { D } from "./a.ts";\nexport const s: C | D = A + 1;\nbee();\na.f();\nnew a.E();\n',
      }),
    ).toEqual([`${CORE}use.ts  s`]);
  });

  it("is not read by its own file, by a name it passes on, or by a declaration of the same name elsewhere", () => {
    expect(
      tree({
        [`${CORE}a.ts`]: "export function used() {}\nused();\nexport function other() {}\nexport { used as again };\n",
        [`${CORE}index.ts`]: 'export { used, other } from "./a.ts";\n',
        [`${CORE}b.ts`]: "function other() {}\nconst x = { used: 1 };\ninterface I { used: number }\nexport {};\n",
      }),
    ).toEqual([`${CORE}a.ts  used`, `${CORE}a.ts  other`, `${CORE}a.ts  again`]);
  });

  it("looks only where the rule says: web exports are not checked, and a web file is a reader", () => {
    expect(tree({ [`${WEB}a.ts`]: "export function a() {}\n", [`${CORE}b.ts`]: "export function b() {}\n", [`${WEB}c.ts`]: "b();\n" })).toEqual([]);
    expect(tree({ "tools/other/a.ts": "export function a() {}\n", [`${CORE}b.ts`]: "export function b() {}\n", "tools/other/c.ts": "b();\n" })).toEqual([`${CORE}b.ts  b`]);
  });

  it("reads a binding pattern and a list export, and skips a default export", () => {
    expect(tree({ [`${CORE}a.ts`]: "const p = 1;\nconst q = 2;\nexport { p, q as r };\nexport const { s, t: [u] } = [1] as never;\nexport default function () {}\n" })).toEqual([
      `${CORE}a.ts  p`,
      `${CORE}a.ts  r`,
      `${CORE}a.ts  s`,
      `${CORE}a.ts  u`,
    ]);
  });
});
