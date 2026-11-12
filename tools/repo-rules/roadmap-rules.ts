/**
 * The tests of the rules in roadmap.ts. They sit in a file of their own so that the unit tests of roadmap.ts, which import
 * it, do not register the rules a second time: repo-rules.test.ts is the one file that runs them.
 */
import { describe, expect, it } from "vitest";
import { type Finding, expectNoFindings, readText } from "./lib.ts";
import { shippedAsComing, staleReview, unreadableFrontMatter } from "./roadmap.ts";

describe("repo rules: roadmap", () => {
  it("rule 34: docs/ROADMAP.md lists no released version as coming", () => {
    const released = (JSON.parse(readText("apps/server/package.json")) as { version: string }).version;
    const text = readText("docs/ROADMAP.md");
    expect(text, "docs/ROADMAP.md has a Coming releases section").toMatch(/^## Coming releases/m);
    const found: Finding[] = shippedAsComing(text, released).map((f) => ({ file: "docs/ROADMAP.md", ...f }));
    expectNoFindings("roadmap", found, 'move the shipped release from "## Coming releases" to "## Done" in docs/ROADMAP.md');
  });

  it("rule 44: the payment rules review note in docs/BANK_NOTES.md is at most 6 months old", () => {
    // The clock is read here, in tools; roadmap.ts takes the date as an argument.
    const today = new Date().toISOString().slice(0, 10);
    const stale = staleReview(readText("docs/BANK_NOTES.md"), today);
    const found: Finding[] = stale ? [{ file: "docs/BANK_NOTES.md", ...stale }] : [];
    expectNoFindings("payment rules review", found, 'review the EU payment rules (PSD3, PSR, FiDA), update "## Payment rules watch" and its "Last reviewed" date in docs/BANK_NOTES.md');
  });

  it("rule 47: WORKFLOW.md's check line is a bare command: no quotes around it, no colon and space in it", () => {
    // The board runs the text after "check:" as it stands, so a quoted line is a command sh cannot find (exit 127);
    // a colon and a space, or a space and a hash, inside it would break the YAML of the front matter.
    const text = readText("WORKFLOW.md");
    expect(text, "WORKFLOW.md has a check line in its front matter").toMatch(/^---\n(?:(?!---\n).*\n)*?check:/);
    const found: Finding[] = unreadableFrontMatter(text).map((f) => ({ file: "WORKFLOW.md", ...f }));
    expectNoFindings("WORKFLOW.md check line", found, 'write the command bare after "check:" and match a test name by a pattern without a colon (-t "repo rules. roadmap")');
  });
});
