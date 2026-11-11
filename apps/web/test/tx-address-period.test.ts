import { describe, expect, it } from "vitest";
import { periodOf } from "../src/pages/transactions/DateRange.tsx";

const read = (q: string) => periodOf(new URLSearchParams(q));

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
