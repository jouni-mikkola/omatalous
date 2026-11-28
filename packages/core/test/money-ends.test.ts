import { describe, expect, it } from "vitest";
import { moneyEnds } from "../src/money-ends.ts";

const corner = (date: string, cents: number) => ({ date, cents });
const walk = {
  line: [corner("2026-12-01", 54_000), corner("2026-12-03", 12_000), corner("2026-12-03", -30_000), corner("2026-12-06", -43_000), corner("2026-12-10", -58_000)],
  steps: [
    { date: "2026-12-03", payee: "Sähkö", cents: -5_000 },
    { date: "2026-12-03", payee: "Korttilasku", cents: -42_000 },
    { date: "2026-12-06", payee: "Puhelin", cents: -9_000 },
  ],
};

describe("moneyEnds", () => {
  it("is the first day the line is below zero and the biggest payment of that day", () => {
    expect(moneyEnds(walk, "2026-12-10")).toEqual({ date: "2026-12-03", payee: "Korttilasku" });
  });

  it("names no payment when the spending between the days takes the balance below zero", () => {
    expect(moneyEnds({ line: [corner("2026-12-01", 10_000), corner("2026-12-04", -2_000)], steps: [] }, "2026-12-10")).toEqual({ date: "2026-12-04", payee: null });
  });

  it("names no payment when the spending had already taken the balance below zero before that day's payments", () => {
    const opened = { line: [corner("2026-12-01", 10_000), corner("2026-12-04", -2_000), corner("2026-12-04", -62_000)], steps: [{ date: "2026-12-04", payee: "Vuokra", cents: -60_000 }] };
    expect(moneyEnds(opened, "2026-12-10")).toEqual({ date: "2026-12-04", payee: null });
  });

  it("is null while the line stays at or above zero until the payday", () => {
    expect(moneyEnds({ line: [corner("2026-12-01", 10_000), corner("2026-12-10", 0)], steps: [] }, "2026-12-10")).toBeNull();
    expect(moneyEnds(walk, "2026-12-02")).toBeNull();
  });
});
