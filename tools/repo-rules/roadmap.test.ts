import { describe, expect, it } from "vitest";
import { shippedAsComing, staleReview, unreadableFrontMatter } from "./roadmap.ts";

const page = (coming: string) => `# Roadmap\n\nAfter 0.40.0 the page changed.\n\n## Coming releases\n${coming}\n## Done\n### 0.64.0: shipped\n`;

describe("rule 34 detection", () => {
  it("refuses a heading under Coming releases at or below the released version", () => {
    expect(shippedAsComing(page("### 0.64.0: shipped already\n"), "0.64.0")).toEqual([{ line: 6, why: "lists 0.64.0 as coming, and 0.64.0 is out" }]);
    expect(shippedAsComing(page("### 0.44.0: old\n"), "0.64.0")).toHaveLength(1);
    expect(shippedAsComing(page("### 0.69.0 and 0.64.1: two\n"), "0.64.1")).toHaveLength(1);
    expect(shippedAsComing(page("#### 0.9.9: deeper\n"), "0.64.0")).toHaveLength(1);
  });

  it("accepts the next version and later ones", () => {
    expect(shippedAsComing(page("### 0.65.0: next\n### 0.64.1: a fix\n### 1.0.0: one day\n"), "0.64.0")).toEqual([]);
  });

  it("does not read a version in prose, nor a heading outside the section", () => {
    expect(shippedAsComing(page("Since 0.64.0 shipped, the list moved.\n- 0.20.0 was the start.\n### 0.65.0: next\n"), "0.64.0")).toEqual([]);
    expect(shippedAsComing("## Done\n### 0.44.0: done\n## Version 1.0\n### 0.10.0\n", "0.64.0")).toEqual([]);
  });
});

describe("rule 44 detection", () => {
  const note = (date: string) => `# Bank\n\n## Payment rules watch\n\nLast reviewed: ${date}\n\ntext\n`;

  it("accepts a review up to 6 months old, the last day included", () => {
    expect(staleReview(note("2026-10-30"), "2026-10-30")).toBeUndefined();
    expect(staleReview(note("2026-10-30"), "2027-04-30")).toBeUndefined();
    expect(staleReview(note("2026-08-31"), "2027-02-28")).toBeUndefined();
  });

  it("refuses a review older than 6 months", () => {
    expect(staleReview(note("2026-10-30"), "2027-05-01")?.why).toMatch(/more than 6 months old/);
    expect(staleReview(note("2026-08-31"), "2027-03-01")?.why).toMatch(/more than 6 months old/);
  });

  it("refuses a missing section, a missing or impossible date and a date in the future", () => {
    expect(staleReview("# Bank\n", "2026-10-30")?.why).toMatch(/no "## Payment rules watch"/);
    expect(staleReview("## Payment rules watch\n\nsome text\n", "2026-10-30")?.why).toMatch(/no "Last reviewed/);
    expect(staleReview(note("2026-02-31"), "2026-10-30")?.why).toMatch(/not a date/);
    expect(staleReview(note("2026-11-01"), "2026-10-30")?.why).toMatch(/is after/);
  });

  it("points at the date line and reads the section only", () => {
    expect(staleReview(note("2027-01-01"), "2026-10-30")?.line).toBe(5);
    expect(staleReview("## Payment rules watch\n\ntext\n\n## Other\n\nLast reviewed: 2026-10-30\n", "2026-10-30")?.why).toMatch(/no "Last reviewed/);
    expect(staleReview("Last reviewed: 2026-10-30\n\n## Payment rules watch\n\ntext\n", "2026-10-30")?.why).toMatch(/no "Last reviewed/);
  });
});

describe("rule 47 detection", () => {
  const file = (check: string, key = "check") => `---\n${key}: ${check}\n---\n# Workflow\n\nnote: a colon in the text below is fine\n`;

  it("refuses a plain value with a colon and a space, or a comment sign", () => {
    expect(unreadableFrontMatter(file('vitest run -t "repo rules: roadmap"'))).toEqual([{ line: 2, why: 'the value of "check" has a colon and a space, or a space and a hash, in it' }]);
    expect(unreadableFrontMatter(file("pnpm check # all of it"))).toHaveLength(1);
    expect(unreadableFrontMatter(file("pnpm check:"))).toEqual([{ line: 2, why: 'the value of "check" ends in a colon' }]);
  });

  it("refuses a check value in quotes or behind another YAML mark: the board runs the text as it stands", () => {
    const why = "the check line starts with a quote or another YAML mark";
    expect(unreadableFrontMatter(file(`'vitest run -t "repo rules: roadmap"'`))).toEqual([{ line: 2, why }]);
    expect(unreadableFrontMatter(file(`"vitest run -t \\"repo rules: roadmap\\""`))).toEqual([{ line: 2, why }]);
    expect(unreadableFrontMatter(file("'pnpm check'"))).toEqual([{ line: 2, why }]);
    expect(unreadableFrontMatter(file("| pnpm check"))).toEqual([{ line: 2, why }]);
    expect(unreadableFrontMatter("---\ncheck:'pnpm check'\n---\n")).toEqual([{ line: 2, why }]);
    expect(unreadableFrontMatter('---\ncheck:"pnpm check"\n---\n')).toEqual([{ line: 2, why }]);
  });

  it("refuses quotes of another key that do not close at the end of the line", () => {
    expect(unreadableFrontMatter(file("'pnpm check", "name"))[0]?.why).toMatch(/do not close/);
    expect(unreadableFrontMatter(file("'it's: here'", "name"))[0]?.why).toMatch(/do not close/);
    expect(unreadableFrontMatter(file('"a "b": c"', "name"))[0]?.why).toMatch(/do not close/);
    expect(unreadableFrontMatter("---\ncheck: pnpm check\n")).toEqual([{ line: 1, why: "the front matter has no closing --- line" }]);
  });

  it("accepts a bare check line, a quoted value of another key, and a file with no front matter", () => {
    expect(unreadableFrontMatter(file('vitest run --project rules a.test.ts -t "repo rules. roadmap"'))).toEqual([]);
    expect(unreadableFrontMatter(file("'it''s: here'", "name"))).toEqual([]);
    expect(unreadableFrontMatter(file(`"a \\"b\\": c"`, "name"))).toEqual([]);
    expect(unreadableFrontMatter(file("pnpm check:lint && node a.mjs#b"))).toEqual([]);
    expect(unreadableFrontMatter("# Workflow\n\ncheck: a: b\n")).toEqual([]);
  });
});
