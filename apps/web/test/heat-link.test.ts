import { describe, expect, it } from "vitest";
import { cellHref } from "../src/charts/forms/heat-link.ts";

describe("cellHref", () => {
  it("names the category and the whole month", () => {
    expect(cellHref("groceries", "2026-02")).toBe("#/transactions?category=groceries&from=2026-02-01&to=2026-02-28");
  });
});
