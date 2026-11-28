/**
 * One label, one source: *Tavallinen kuukausi* (`home.months_usual`) is the first page's usual month of spending
 * (`overview.usualSpendCents`, which core reads from `typicalFlowCents` of Menot kuukausittain). Every place that prints
 * the label reads that figure and no other, so two pages never print two sums under it. A new reader of the label
 * fails here until it is listed with the field it reads.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src/", import.meta.url).pathname;
const LABEL = "home.months_usual";

/** The files that print the label and the field each takes the sum from. */
const READERS: Record<string, { reads: string; never: string }> = {
  "charts/MonthBars.tsx": { reads: "usualSpendCents", never: "typicalCents" },
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}

describe("Tavallinen kuukausi has one source", () => {
  it("is printed only by the listed readers", () => {
    const users = sources(SRC)
      .filter((f) => readFileSync(f, "utf8").includes(`"${LABEL}"`))
      .map((f) => relative(SRC, f))
      .sort();
    expect(users).toEqual(Object.keys(READERS).sort());
  });

  for (const [file, { reads, never }] of Object.entries(READERS)) {
    it(`${file} takes the sum from ${reads}`, () => {
      const text = readFileSync(join(SRC, file), "utf8");
      const call = text.split("\n").filter((l) => l.includes(`"${LABEL}"`) || l.includes("usual="));
      expect(text).toContain(reads);
      expect(call.length).toBeGreaterThan(0);
      for (const line of call) expect(line, `${file}: ${line.trim()}`).not.toContain(never);
    });
  }
});
