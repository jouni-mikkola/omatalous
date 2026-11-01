import { describe, expect, it } from "vitest";
import { startedByVitest } from "./lib/cores.mjs";

describe("startedByVitest", () => {
  it("is true for the vitest entry file, however it is reached", () => {
    expect(startedByVitest(["node", "/repo/node_modules/vitest/vitest.mjs", "run"])).toBe(true);
    expect(startedByVitest(["node", "/repo/node_modules/.bin/vitest"])).toBe(true);
  });

  it("is false for a tool that only reads the config", () => {
    expect(startedByVitest(["node", "/tools/node_modules/knip/bin/knip.js", "--config", "knip.json"])).toBe(false);
    expect(startedByVitest(["node", "/repo/scripts/vitest-report.mjs"])).toBe(false);
  });
});
