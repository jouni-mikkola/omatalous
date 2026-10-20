/**
 * Rule 34: the public docs/ROADMAP.md lists no shipped release as coming. A heading under "## Coming releases" that
 * names a version at or below the released one fails, so the release that ships a version also moves it to "## Done".
 * The version is that of apps/server/package.json: the root package.json has none, and prepare.mjs bumps the three
 * package files together.
 */
import { type Finding, expectNoFindings, readText } from "./lib.ts";
import { describe, expect, it } from "vitest";

const VERSION = /\b(\d+)\.(\d+)\.(\d+)\b/g;

function compare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

/** The headings of the "Coming releases" section that name a version at or below `released`. Prose lines are not read. */
export function shippedAsComing(text: string, released: string): { line: number; why: string }[] {
  const current = released.split(".").map(Number);
  const found: { line: number; why: string }[] = [];
  let coming = false;
  text.split("\n").forEach((raw, i) => {
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (!heading) return;
    if ((heading[1] ?? "").length <= 2) {
      coming = /^coming releases\b/i.test(heading[2] ?? "");
      return;
    }
    if (!coming) return;
    for (const m of (heading[2] ?? "").matchAll(VERSION)) {
      if (compare([Number(m[1]), Number(m[2]), Number(m[3])], current) <= 0) found.push({ line: i + 1, why: `lists ${m[0]} as coming, and ${released} is out` });
    }
  });
  return found;
}

describe("repo rules: roadmap", () => {
  it("rule 34: docs/ROADMAP.md lists no released version as coming", () => {
    const released = (JSON.parse(readText("apps/server/package.json")) as { version: string }).version;
    const text = readText("docs/ROADMAP.md");
    expect(text, "docs/ROADMAP.md has a Coming releases section").toMatch(/^## Coming releases/m);
    const found: Finding[] = shippedAsComing(text, released).map((f) => ({ file: "docs/ROADMAP.md", ...f }));
    expectNoFindings("roadmap", found, 'move the shipped release from "## Coming releases" to "## Done" in docs/ROADMAP.md');
  });
});
