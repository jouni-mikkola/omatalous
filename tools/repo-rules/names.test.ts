import ts from "typescript6";
import { describe, expect, it } from "vitest";
import { unnamedControls } from "./names.ts";

const run = (jsx: string) => unnamedControls(ts.createSourceFile("x.tsx", `const a = ${jsx};`, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX));

describe("rule 50 detection", () => {
  it("flags a button or link with only a mark in it", () => {
    expect(run('<button><span aria-hidden="true">x</span></button>')).toEqual([{ line: 1, tag: "button" }]);
    expect(run('<a href="#/settings"><svg /></a>')).toEqual([{ line: 1, tag: "a" }]);
    expect(run("<summary></summary>")).toEqual([{ line: 1, tag: "summary" }]);
  });

  it("flags a field with no label around it, no name and no id", () => {
    expect(run("<div><select value={1} /></div>")).toEqual([{ line: 1, tag: "select" }]);
    expect(run('<input type="text" />')).toEqual([{ line: 1, tag: "input" }]);
  });

  it("accepts a word, an expression, an aria-label, a title, a label around a field or an id", () => {
    expect(run("<button>Go</button>")).toEqual([]);
    expect(run("<button>{t(x)}</button>")).toEqual([]);
    expect(run('<button aria-label="Close"><span aria-hidden="true">x</span></button>')).toEqual([]);
    expect(run('<a href="#" title="Settings"><svg /></a>')).toEqual([]);
    expect(run('<button><span className="sr-only">Close</span><span aria-hidden="true">x</span></button>')).toEqual([]);
    expect(run('<label>Name <input type="text" /></label>')).toEqual([]);
    expect(run('<input id="n" type="text" />')).toEqual([]);
    expect(run('<input type="hidden" />')).toEqual([]);
    expect(run("<select aria-label={x} />")).toEqual([]);
  });

  it("leaves a component that spreads its props alone", () => {
    expect(run("<button {...rest} />")).toEqual([]);
  });
});
