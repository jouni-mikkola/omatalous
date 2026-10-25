/**
 * The tests of the rules in roadmap.ts. They sit in a file of their own so that the unit tests of roadmap.ts, which import
 * it, do not register the rules a second time: repo-rules.test.ts is the one file that runs them.
 */
import { describe, expect, it } from "vitest";
import { type Finding, expectNoFindings, readText } from "./lib.ts";
import { shippedAsComing } from "./roadmap.ts";

describe("repo rules: roadmap", () => {
  it("rule 34: docs/ROADMAP.md lists no released version as coming", () => {
    const released = (JSON.parse(readText("apps/server/package.json")) as { version: string }).version;
    const text = readText("docs/ROADMAP.md");
    expect(text, "docs/ROADMAP.md has a Coming releases section").toMatch(/^## Coming releases/m);
    const found: Finding[] = shippedAsComing(text, released).map((f) => ({ file: "docs/ROADMAP.md", ...f }));
    expectNoFindings("roadmap", found, 'move the shipped release from "## Coming releases" to "## Done" in docs/ROADMAP.md');
  });
});
