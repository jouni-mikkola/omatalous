import ts from "typescript6";
import { describe, expect, it } from "vitest";
import { figureProblems, figureWords, looseLimits, ownLevels, partWholeProblems, partWholeReads, shapeProblems, wordProblems } from "./figures.ts";

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

describe("rule 52 detection", () => {
  const base = { name: "X", source: { file: "a.ts", fn: "dueOf", field: "dueCents" } };

  it("accepts an entry with a scope, an additive flag and one function", () => {
    expect(shapeProblems({ a: { ...base, scope: "own", additive: true }, b: { ...base, scope: "household", additive: false } })).toEqual([]);
  });

  it("refuses a missing or unknown scope, an additive that is no boolean and a source.fn that is not one name", () => {
    expect(shapeProblems({ a: base })).toEqual([
      { id: "a", why: expect.stringContaining("scope is undefined") },
      { id: "a", why: expect.stringContaining("additive is not true or false") },
    ]);
    expect(shapeProblems({ a: { ...base, scope: "member", additive: true } })[0]!.why).toContain('scope is "member"');
    expect(shapeProblems({ a: { ...base, scope: "own", additive: "yes" } })[0]!.why).toContain("additive");
    expect(shapeProblems({ a: { ...base, scope: "own", additive: true, source: { ...base.source, fn: "dueOf or billMonth" } } })[0]!.why).toContain("source.fn");
  });

  const doc = ["text", "| Word | Means | In core |", "|---|---|---|", "| *Tulot* | all | `x` |", "| *Katettu luotolla*, *Katettu säästöistä* | cover | `y` |", "| Plain | no italics | `z` |", "", "| *Other* | a table below the first | `w` |"].join("\n");

  it("reads the italic words of the first column of the table and no other table", () => {
    expect(figureWords(doc)).toEqual([
      { word: "Tulot", line: 4 },
      { word: "Katettu luotolla", line: 5 },
      { word: "Katettu säästöistä", line: 5 },
    ]);
  });

  it("accepts a word that is a registry name in any case or on the baseline", () => {
    expect(wordProblems(figureWords(doc), new Set(["tulot"]), ["Katettu luotolla", "katettu säästöistä"])).toEqual([]);
  });

  it("refuses a word that is neither, and a baseline line that is a name now or no word of the table", () => {
    const found = wordProblems(figureWords(doc), new Set<string>(), ["Gone"]);
    expect(found.map((p) => `${p.where} ${p.word}`)).toEqual(["doc Tulot", "doc Katettu luotolla", "doc Katettu säästöistä", "baseline Gone"]);
    expect(wordProblems(figureWords(doc), new Set(["tulot"]), ["Tulot", "Katettu luotolla", "Katettu säästöistä"]).map((p) => `${p.where} ${p.word}`)).toEqual(["baseline Tulot"]);
  });
});

describe("rule 53 detection", () => {
  const run = (src: string) => partWholeReads(ts.createSourceFile("x.ts", src, ts.ScriptTarget.ES2022, true));

  it("finds a read of the field and the name in a destructuring", () => {
    expect(run("const a = loan.paymentCents;\nconst { wholeCents } = row;\nconst { paymentCents: bank } = loan;")).toEqual([
      { name: "paymentCents", line: 1 },
      { name: "wholeCents", line: 2 },
      { name: "paymentCents", line: 3 },
    ]);
  });

  it("leaves a write, a type, an object literal and an array destructuring alone", () => {
    expect(run("row.wholeCents = 5;\ninterface L { paymentCents: number }\nconst l = { paymentCents: 1, wholeCents: 2 };\nconst [paymentCents] = list;\nconst m = loan.monthlyCents;")).toEqual([]);
  });

  const read = (file: string, name: string, line: number) => ({ key: `${file}  ${name}`, line });

  it("allows the reads a baseline line counts", () => {
    expect(partWholeProblems([read("a.ts", "paymentCents", 3), read("a.ts", "paymentCents", 9)], ["a.ts  paymentCents  2"])).toEqual([]);
  });

  it("refuses a read past the count, naming the first one past it", () => {
    const found = partWholeProblems([read("a.ts", "paymentCents", 3), read("a.ts", "paymentCents", 9), read("a.ts", "paymentCents", 12)], ["a.ts  paymentCents  2"]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ where: "source", line: 12, why: expect.stringContaining("more than the baseline's 2") });
  });

  it("refuses a read in a file or of a field the baseline does not list", () => {
    const found = partWholeProblems([read("b.ts", "wholeCents", 4), read("a.ts", "wholeCents", 5)], ["a.ts  paymentCents  1"]);
    expect(found.filter((p) => p.where === "source").map((p) => [p.key, p.line])).toEqual([["b.ts  wholeCents", 4], ["a.ts  wholeCents", 5]]);
  });

  it("refuses a count above the reads and a line with no reads, so the list only shrinks", () => {
    const found = partWholeProblems([read("a.ts", "paymentCents", 3)], ["a.ts  paymentCents  2", "b.ts  wholeCents  1"]);
    expect(found.map((p) => [p.where, p.line, p.why])).toEqual([
      ["baseline", 1, expect.stringContaining("lower the count from 2")],
      ["baseline", 2, expect.stringContaining("delete the line")],
    ]);
  });
});
