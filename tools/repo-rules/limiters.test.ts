import ts from "typescript6";
import { describe, expect, it } from "vitest";
import { handWrittenLimiters } from "./limiters.ts";

const run = (src: string) => handWrittenLimiters(ts.createSourceFile("x.ts", src, ts.ScriptTarget.ES2022, true));

describe("rule 42 detection", () => {
  it("flags a limiter built from a number", () => {
    expect(run("const a = new RateLimiter(5, 15 * 60_000);")).toEqual([{ line: 1, name: "RateLimiter" }]);
    expect(run("const a = new LoginLimiter(10, 1000);")).toEqual([{ line: 1, name: "LoginLimiter" }]);
    expect(run("const a = new RateLimiter(5 * 2, 1);")).toHaveLength(1);
  });

  it("follows a constant of the same file", () => {
    expect(run("const LIMIT = 10;\nconst W = LIMIT * 2;\nnew RateLimiter(W, 1);")).toEqual([{ line: 3, name: "RateLimiter" }]);
  });

  it("accepts a limit that comes from elsewhere", () => {
    expect(run("new RateLimiter(...shape.ops);")).toEqual([]);
    expect(run("new RateLimiter(v.limit, v.window);")).toEqual([]);
    expect(run("let n = 3;\nnew RateLimiter(n, 1);")).toEqual([]);
    expect(run("new Gate(4); new Other(5);")).toEqual([]);
  });
});
