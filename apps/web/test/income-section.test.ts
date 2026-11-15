import { describe, expect, it } from "vitest";
import "@banking/core/late";
import { paymentHref } from "../src/pages/reports/sections/Income.tsx";
import { page } from "../src/pages/reports/pages/Income.tsx";
import { t } from "../src/text.ts";

// 1.0.0 listed Tulot among the reports. Main kept the tax year alone and named the page after it, so the income of the
// period, its kinds and its payers were on no page.
describe("Raportit: Tulot", () => {
  it("is named Tulot and starts with the income, the tax year under it", () => {
    expect(page.title).toBe("Tulot");
    expect(page.sections.map((s) => s.id)).toEqual(["tulot", "verovuosi"]);
    expect(page.sections[0]!.reports).toEqual(["income"]);
  });
  it("a payment opens its day in Tapahtumat", () => {
    expect(paymentHref("Acme Oy", "2026-03-25")).toBe("#/transactions?merchant=Acme+Oy&from=2026-03-25&to=2026-03-25");
  });
  it("the months have their own heading", () => {
    expect(t("rpt.in_months")).toBe("Tulot kuukausittain");
  });
});
