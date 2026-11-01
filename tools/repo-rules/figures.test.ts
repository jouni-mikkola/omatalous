import ts from "typescript6";
import { describe, expect, it } from "vitest";
import { figureProblems, looseLimits, ownLevels } from "./figures.ts";

const files: Record<string, string> = { "a.ts": "export function dueOf() { return { dueCents: 1 }; }", "b.ts": "export function billMonth() { return { dueCents: 2 }; }" };
const read = (f: string) => files[f] ?? null;
const entry = (name: string, file: string, fn: string, field: string) => ({ name, source: { file, fn, field } });

describe("rule 37 detection", () => {
  it("accepts two names for two figures with one field name", () => {
    expect(figureProblems({ due: entry("Erääntyvät maksut", "a.ts", "dueOf", "dueCents"), month: entry("Kuukauden laskut yhteensä", "b.ts", "billMonth", "dueCents") }, read)).toEqual([]);
  });

  it("refuses one name for two figures, whatever the case", () => {
    const found = figureProblems({ due: entry("Erääntyvät maksut", "a.ts", "dueOf", "dueCents"), month: entry("erääntyvät maksut", "b.ts", "billMonth", "dueCents") }, read);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "month", why: expect.stringContaining("also the name of due") });
  });

  it("refuses a source that is gone: a missing file, function or field", () => {
    expect(figureProblems({ x: entry("X", "none.ts", "f", "g") }, read)[0]!.why).toContain("does not exist");
    expect(figureProblems({ x: entry("X", "a.ts", "gone", "dueCents") }, read)[0]!.why).toContain("no gone");
    expect(figureProblems({ x: entry("X", "a.ts", "dueOf", "gone") }, read)[0]!.why).toContain("no gone");
    // a name inside a longer identifier is not the name
    expect(figureProblems({ x: entry("X", "a.ts", "due", "dueCents") }, read)[0]!.why).toContain("no due");
  });

  it("refuses two entries with one source", () => {
    const found = figureProblems({ a: entry("A", "a.ts", "dueOf", "dueCents"), b: entry("B", "a.ts", "dueOf", "dueCents") }, read);
    expect(found.map((f) => f.id)).toEqual(["b"]);
  });
});

describe("rule 38 detection", () => {
  const run = (src: string) => looseLimits(ts.createSourceFile("x.ts", src, ts.ScriptTarget.ES2022, true));

  it("finds a top-level numeric constant, signed, as a sum or with `as const`", () => {
    expect(run("const MIN_DAYS = 15;\nexport const SHARE = 0.5;\nconst GAP = -3;\nconst WEEKS = 7 * 4;\nconst N = (2 as const);")).toEqual([
      { name: "MIN_DAYS", line: 1 },
      { name: "SHARE", line: 2 },
      { name: "GAP", line: 3 },
      { name: "WEEKS", line: 4 },
      { name: "N", line: 5 },
    ]);
  });

  it("finds a limit whatever the case of its name", () => {
    expect(run("const minWeeks = 8;\nconst count = 3;\nexport const Share = 0.5;")).toEqual([
      { name: "minWeeks", line: 1 },
      { name: "count", line: 2 },
      { name: "Share", line: 3 },
    ]);
  });

  it("leaves words, calls, values from thresholds.ts and constants inside functions alone", () => {
    expect(run('const LABEL = "x";\nconst SET = new Set([1]);\nconst label = "x";\nconst D = THRESHOLDS.days.value;\nconst days = D;\nfunction f() { const MAX = 3; const max = 4; return MAX + max; }')).toEqual([]);
  });
});

describe("rule 39 detection", () => {
  const run = (src: string) => ownLevels(ts.createSourceFile("x.ts", src, ts.ScriptTarget.ES2022, true));

  it("finds a median or a mean taken from stats.ts, also renamed", () => {
    expect(run('import { median, sum } from "../stats.ts";\nimport { mean as avg } from "../../stats.ts";')).toEqual([
      { name: "median", line: 1 },
      { name: "mean", line: 2 },
    ]);
  });

  it("leaves a sum, a type, the expected figure and other modules alone", () => {
    expect(run('import { sum } from "../stats.ts";\nimport { expectedLevel } from "./expected.ts";\nimport { median } from "./other.ts";\nimport type { median as M } from "../stats.ts";')).toEqual([]);
  });
});
