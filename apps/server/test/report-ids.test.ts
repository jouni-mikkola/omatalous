import { REPORTS } from "@banking/core";
import { describe, expect, it } from "vitest";
import { parseReportIds } from "../src/routes/shared.ts";

describe("parseReportIds", () => {
  it("keeps every report of the registry, so a page can ask for all of them", () => {
    const all = Object.keys(REPORTS);
    expect(parseReportIds(all.join(","))).toEqual(all);
  });

  it("refuses a list longer than the registry and an unknown id at any place", () => {
    const all = Object.keys(REPORTS);
    expect(() => parseReportIds([...all, "cashflow"].join(","))).toThrow();
    expect(() => parseReportIds([...all.slice(0, 24), "nope"].join(","))).toThrow();
  });
});
