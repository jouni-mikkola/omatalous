/**
 * One label, one source: *Tavallinen kuukausi* (`home.months_usual`) is the first page's usual month of spending
 * (`overview.usualSpendCents`, which core reads from `typicalFlowCents` of Menot kuukausittain). Every place that prints
 * the label reads that figure and no other, so two pages never print two sums under it. A new reader of the label
 * fails here until it is listed with the field it reads. The buffer's own label (`home.buffer_spend`, all spending and
 * loan payments) is held apart the same way: it never reads a sum of the usual month, so the two never share a name.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../src/", import.meta.url).pathname;
const LABEL = "home.months_usual";
const BUFFER_LABEL = "home.buffer_spend";

/** The files that print the label and the field each takes the sum from. */
const READERS: Record<string, { reads: string; never: string }> = {
  "charts/MonthBars.tsx": { reads: "usualSpendCents", never: "typicalCents" },
  "pages/reports/sections/SpendingMonths.tsx": { reads: "typicalFlowCents", never: "typicalCents" },
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}

function printing(label: string): string[] {
  return sources(SRC)
    .filter((f) => readFileSync(f, "utf8").includes(`"${label}"`))
    .map((f) => relative(SRC, f))
    .sort();
}

describe("the buffer's spending label is not a usual month", () => {
  it("is printed only by Buffer.tsx, which takes the sum from bufferSpendCents", () => {
    expect(printing(BUFFER_LABEL)).toEqual(["components/home/Buffer.tsx"]);
    const text = readFileSync(join(SRC, "components/home/Buffer.tsx"), "utf8");
    expect(text).toContain("bufferSpendCents");
    for (const usual of ["usualSpendCents", "typicalFlowCents", "typicalCents", LABEL]) expect(text, `Buffer.tsx names ${usual}`).not.toContain(usual);
  });
});

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
