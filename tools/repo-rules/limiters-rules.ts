/** The tests of the rules in limiters.ts (the detector has its own tests in limiters.test.ts). */
import { describe, it } from "vitest";
import { expectNoFindings, type Finding, isTestFile, parse, sourceFiles } from "./lib.ts";
import { handWrittenLimiters } from "./limiters.ts";

describe("repo rules: limits", () => {
  it("rule 42: no `new RateLimiter(5, ...)` or `new LoginLimiter(...)` with a number written at the call: the limits come from the schema", () => {
    const found: Finding[] = [];
    // the private modules (the folders named private) keep their own limits and answer to their own rules
    for (const file of sourceFiles("apps/server/src/").filter((f) => !isTestFile(f) && !f.includes("/private/"))) {
      for (const { line, name } of handWrittenLimiters(parse(file))) found.push({ file, line, why: `new ${name}() with a number written by hand` });
    }
    expectNoFindings("hand-written limiters", found, "add the limit to LIMIT_SCHEMA (platform/limits.ts) and build the limiter in services/context.ts from limiterShapes (services/limiters.ts).");
  });
});
