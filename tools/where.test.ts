import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { find, load } from "./where.mjs";

const dir = mkdtempSync(join(tmpdir(), "where-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const FILES: Record<string, string> = {
  "src/a.ts": '/** Adds one. */\nexport function add(n: number) {\n  return n + 1;\n}\nexport class Box {\n  open() {}\n}\nexport const LIMIT = 3;\n',
  "src/barrel.ts": 'export * from "./a.ts";\n',
  "src/use.ts": 'import { add } from "./barrel.ts";\nadd(1);\n',
  "src/other.ts": 'import { LIMIT } from "./a.ts";\nconsole.log(LIMIT);\n',
  "src/ns.ts": 'import * as a from "./a.ts";\nconsole.log(a);\n',
  "src/dup.ts": "export const LIMIT = 4;\n",
  "src/unrelated.ts": 'import { other } from "./nowhere.ts";\nconst add = 1;\n',
  "test/a.test.ts": 'import { add } from "../src/a.ts";\nadd(1);\nadd(2);\n',
  "scripts/x.sh": "#!/usr/bin/env bash\n# Helpers.\nhelper() {\n  echo hi\n}\nhelper\n",
  "src/ui.tsx": 'export const title = "Menojen muutos";\n',
};
for (const [f, text] of Object.entries(FILES)) {
  mkdirSync(join(dir, dirname(f)), { recursive: true });
  writeFileSync(join(dir, f), text);
}
execFileSync("git", ["init", "-q"], { cwd: dir });
execFileSync("git", ["add", "-A"], { cwd: dir });
const world = load(dir);

describe("pnpm where", () => {
  it("finds a function with its line and doc, its importers through a barrel, and the tests that mention it", () => {
    const r = find("add", world);
    expect(r.defs[0]).toEqual({ file: "src/a.ts", line: 2, kind: "export function", doc: "Adds one." });
    expect(r.importers).toEqual(["src/ns.ts", "src/use.ts"]); // a namespace import takes any name
    expect(r.reexporters).toEqual(["src/barrel.ts"]);
    expect(r.tests).toEqual([{ file: "test/a.test.ts", count: 3 }]);
  });

  it("a second top-level definition of the name is listed too, and says it is not exported", () => {
    expect(find("add", world).defs.map((d) => `${d.file} ${d.kind}`)).toEqual(["src/a.ts export function", "src/unrelated.ts const"]);
  });

  it("lists every definition of an ambiguous name, and a namespace import counts as an importer", () => {
    const r = find("LIMIT", world);
    expect(r.defs.map((d) => `${d.file}:${d.line}`)).toEqual(["src/a.ts:8", "src/dup.ts:1"]);
    expect(r.importers).toEqual(["src/ns.ts", "src/other.ts"]);
  });

  it("finds a class member and a shell function with its callers", () => {
    expect(find("Box.open", world).defs).toMatchObject([{ file: "src/a.ts", line: 6, kind: "export member" }]);
    const sh = find("helper", world);
    expect(sh.defs).toMatchObject([{ file: "scripts/x.sh", line: 3, kind: "shell function" }]);
    expect(sh.callers).toEqual(["scripts/x.sh (1)"]);
  });

  it("a file query lists direct importers, the barrel and tests that import or are named after it", () => {
    const r = find("src/a.ts", world);
    expect(r.header).toEqual([{ file: "src/a.ts", text: "Adds one." }]);
    expect(r.importers).toEqual(["src/ns.ts", "src/other.ts"]);
    expect(r.reexporters).toEqual(["src/barrel.ts"]);
    expect(r.tests.map((t) => t.file)).toEqual(["test/a.test.ts"]);
  });

  it("text that is no name falls back to the string literals that hold it", () => {
    const r = find("Menojen muutos", world);
    expect(r.defs).toEqual([]);
    expect(r.literals).toEqual(['src/ui.tsx:1  export const title = "Menojen muutos";']);
  });

  it("skips a tracked file that was deleted and not committed", () => {
    rmSync(join(dir, "src/dup.ts"));
    const w = load(dir);
    expect(w.files).not.toContain("src/dup.ts");
    expect(find("LIMIT", w).defs.map((d) => d.file)).toEqual(["src/a.ts"]);
  });

  it("works on this repository: scopeOf is defined in tools/check/scope.mjs and tested beside it", () => {
    const r = find("scopeOf");
    expect(r.defs.map((d) => d.file)).toEqual(["tools/check/scope.mjs"]);
    expect(r.tests.map((t) => t.file)).toContain("tools/check/scope.test.ts");
  });
});
