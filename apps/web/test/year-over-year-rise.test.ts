import { describe, expect, it } from "vitest";
import { largestRise } from "../src/pages/reports/sections/YearOverYear.tsx";

// a loan that began this year is a fixed cost: the slope leaves it out, the table and the total have it
const rows = [
  { category: "groceries", changeCents: 427_00 },
  { category: "consumer_credit", changeCents: 10_206_00 },
  { category: "clothing", changeCents: -1_186_00 },
  { category: "fees", changeCents: 4_00 },
];

describe("the largest rise the year comparison names", () => {
  it("is the largest rise of the table, a fixed cost too", () => {
    expect(largestRise(rows)?.category).toBe("consumer_credit");
  });
  it("is none when nothing rose by 100 € or more", () => {
    expect(largestRise(rows.filter((r) => r.changeCents < 100_00))).toBeUndefined();
  });
});
