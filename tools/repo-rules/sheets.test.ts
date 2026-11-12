import ts from "typescript6";
import { describe, expect, it } from "vitest";
import { bareClasses, classesOf, type Module, ownClasses } from "./sheets.ts";

const tsx = (src: string) => classesOf(ts.createSourceFile("x.tsx", src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)).map((c) => c.name);
const mod = (imports: string[], classes: string[] = [], lazy: string[] = []): Module => ({ imports, lazy, classes: classes.map((name) => ({ name, line: 1 })) });

describe("rule 48 detection", () => {
  it("reads the own classes of a sheet as rule 46 does", () => {
    expect([...ownClasses("/* .gone {} */ @layer c { .a, .b { x: 1 } .c .d { x: 1 } .e:hover { x: 1 } }")]).toEqual(["a", "b"]);
  });

  it("reads the words of every string of a className, and nothing else", () => {
    expect(tsx(`<ul className="st-rows notice-list" title="st-name"><li className={ok ? "x warn" : \`y \${z} w\`} /></ul>`)).toEqual(["st-rows", "notice-list", "x", "warn", "y", "w"]);
  });

  it("finds a class whose sheet only another page's chunk loads", () => {
    const modules = new Map([
      ["main.tsx", mod(["router.tsx"])],
      ["router.tsx", mod([], [], ["Home.tsx", "Bills.tsx"])],
      ["Home.tsx", mod(["Notices.tsx"])],
      ["Notices.tsx", mod(["notices.css"], ["st-rows", "notice-list"])],
      ["Bills.tsx", mod(["statement.css"], ["st-rows"])],
    ]);
    const sheets = new Map([
      ["statement.css", new Set(["st-rows"])],
      ["notices.css", new Set(["notice-list"])],
    ]);
    expect(bareClasses(modules, sheets, "main.tsx")).toEqual([{ file: "Notices.tsx", line: 1, name: "st-rows", sheet: "statement.css", root: "Home.tsx" }]);
  });

  it("accepts a sheet the module, a module above it in its chunk, or the entry loads", () => {
    const modules = new Map([
      ["main.tsx", mod(["global.css"], [], ["Home.tsx"])],
      ["Home.tsx", mod(["page.css", "Row.tsx"])],
      ["Row.tsx", mod([], ["page-row", "shell-row", "free"])],
    ]);
    const sheets = new Map([
      ["page.css", new Set(["page-row"])],
      ["global.css", new Set(["shell-row"])],
    ]);
    expect(bareClasses(modules, sheets, "main.tsx")).toEqual([]);
  });
});
