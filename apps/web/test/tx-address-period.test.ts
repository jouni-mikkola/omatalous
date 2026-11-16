import { describe, expect, it } from "vitest";
import { listPeriodOf, periodOf, periodParams } from "../src/pages/transactions/DateRange.tsx";

const read = (q: string) => periodOf(new URLSearchParams(q));
const listed = (q: string) => listPeriodOf(new URLSearchParams(q), "2026-11-16");

describe("the period the list opens on", () => {
  it("is the running month up to today when the address names no period and no limit", () => {
    expect(listed("")).toEqual({ from: "2026-11-01", to: "2026-11-16" });
    expect(listed("?q=Wolt")).toEqual({ from: "2026-11-01", to: "2026-11-16" });
  });
  it("keeps a period the address names", () => {
    expect(listed("?from=2026-09-01&to=2026-09-30")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
  it("is the whole history for period=all", () => {
    expect(listed("?period=all")).toEqual({ from: "", to: "" });
  });
  it("is the whole history for a link that names a merchant, an account or a category without a period", () => {
    for (const q of ["?merchant=Lidl", "?accountId=a", "?category=groceries"]) expect(listed(q)).toEqual({ from: "", to: "" });
  });
  it("writes the whole history as period=all and a period as its days", () => {
    expect(periodParams({ from: "", to: "" })).toEqual({ from: "", to: "", period: "all" });
    expect(periodParams({ from: "2026-09-01", to: "2026-09-30" })).toEqual({ from: "2026-09-01", to: "2026-09-30", period: undefined });
  });
});

describe("the period read from the address", () => {
  it("drops a day that is not a real one and keeps the other", () => {
    expect(read("?from=2026-13-45&to=2026-09-01")).toEqual({ from: "", to: "2026-09-01" });
  });
  it("swaps two days in the wrong order", () => {
    expect(read("?from=2026-10-05&to=2026-09-01")).toEqual({ from: "2026-09-01", to: "2026-10-05" });
  });
  it("gives no period for text that is no day", () => {
    expect(read("?from=abc")).toEqual({ from: "", to: "" });
  });
  it("reads a valid period as sent", () => {
    expect(read("?from=2026-09-01&to=2026-10-05")).toEqual({ from: "2026-09-01", to: "2026-10-05" });
  });
});
