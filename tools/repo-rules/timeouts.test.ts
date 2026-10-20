import ts from "typescript";
import { describe, expect, it } from "vitest";
import { untimedSeeded } from "./timeouts.ts";

const run = (src: string) => untimedSeeded(ts.createSourceFile("x.test.ts", src, ts.ScriptTarget.ES2022, true));

describe("rule 13 detection", () => {
  it("flags a test that calls randomHistory without a timeout, and accepts 30 s", () => {
    expect(run('it("a", () => { randomHistory(1, 5); });')).toEqual([{ line: 1, ms: undefined }]);
    expect(run('it("a", () => { randomHistory(1, 5); }, 5_000);')).toEqual([{ line: 1, ms: 5000 }]);
    expect(run('it("a", () => { randomHistory(1, 5); }, 30_000);')).toEqual([]);
    expect(run('it("a", () => { randomHistory(1, 5); }, { timeout: 30_000 });')).toEqual([]);
  });

  it("follows a local helper, also through a second helper, and a const arrow function", () => {
    const helper = "function load(seed) { return randomHistory(seed, 5); }\n";
    expect(run(`${helper}it("a", () => { load(1); });`)).toEqual([{ line: 2, ms: undefined }]);
    expect(run(`${helper}const more = (s) => load(s);\nit.each([1])("a", (s) => { more(s); });`)).toEqual([{ line: 3, ms: undefined }]);
    expect(run(`${helper}it("a", () => { load(1); }, 30_000);`)).toEqual([]);
  });

  it("leaves tests alone that only mention the names", () => {
    expect(run('function load() { return 1; }\nit("a", () => { load(); });')).toEqual([]);
    expect(run('function load(seed) { return randomHistory(seed, 5); }\nit("a", () => { obj.load(); });')).toEqual([]);
  });
});
