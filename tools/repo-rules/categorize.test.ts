import ts from "typescript6";
import { describe, expect, it } from "vitest";
import { directCategorizeUses } from "./categorize.ts";

// no parent pointers, as `parse` in lib.ts reads a file
const run = (src: string) => directCategorizeUses(ts.createSourceFile("x.ts", src, ts.ScriptTarget.ES2022, false)).map((u) => u.line);

describe("rule 51 detection", () => {
  it("finds a bare call, an import under any alias and a destructuring of the name", () => {
    expect(run("categorize(a, b);")).toEqual([1]);
    expect(run('import { categorize } from "./c.ts";')).toEqual([1]);
    expect(run('import { categorize as run } from "./c.ts";')).toEqual([1]);
    expect(run("const { categorize } = core;")).toEqual([1]);
    expect(run("const { categorize: run } = core;")).toEqual([1]);
  });

  it("finds a re-export of the name, under any alias and with or without a source", () => {
    expect(run('export { categorize } from "@banking/core";')).toEqual([1]);
    expect(run('export { categorize as run } from "@banking/core";')).toEqual([1]);
    expect(run('import { x } from "./c.ts";\nexport { categorize as run };')).toEqual([2]);
    expect(run('export { categorizeInDirection, compileRules } from "@banking/core";')).toEqual([]);
  });

  it("finds a property or namespace access, called or only read", () => {
    expect(run("core.categorize(a, b);")).toEqual([1]);
    expect(run("const f = core.categorize;")).toEqual([1]);
    expect(run('core["categorize"](a);')).toEqual([1]);
    expect(run("x.y.categorize(a);")).toEqual([1]);
  });

  it("finds a namespace import of core handed out whole", () => {
    expect(run('import * as core from "@banking/core";\nexport const modules = { "@banking/core": core };')).toEqual([2]);
    expect(run('import * as core from "@banking/core";\nuse(core);\nuse({ ...core });')).toEqual([2, 3]);
    expect(run('import * as cat from "./categorize.ts";\nconst all = cat;')).toEqual([2]);
  });

  it("accepts the whole namespace only through moduleApiOf", () => {
    expect(run('import * as core from "@banking/core";\nconst m = core.moduleApiOf(core);')).toEqual([]);
    expect(run('import * as core from "@banking/core";\nconst m = moduleApiOf(core);')).toEqual([]);
    expect(run('import * as core from "@banking/core";\nconst m = other(core);')).toEqual([2]);
    expect(run('import * as core from "@banking/core";\nconst m = moduleApiOf({ ...core });')).toEqual([2]);
  });

  it("leaves other names, members of core and unrelated namespaces alone", () => {
    expect(run('import * as core from "@banking/core";\ncore.categorizeInDirection(a);\ncore["compileRules"]([]);\ntype T = core.CompiledRule;\nconst c: typeof core = core.x;')).toEqual([]);
    expect(run("recategorize(id);\nconst o = { categorize: 1 };\nclass A { categorize() {} }\nautocategorize(x);")).toEqual([]);
    expect(run('import * as hono from "hono";\nexport const m = { hono };')).toEqual([]);
  });
});
