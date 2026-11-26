import { describe, expect, it } from "vitest";
import "@banking/core/late";
import { paymentHref } from "../src/pages/reports/sections/Income.tsx";
import { page } from "../src/pages/reports/pages/Income.tsx";
import { t } from "../src/text.ts";

// The page is Tulot ja menot: the twelve months first, then the income of the period, its kinds and its payers. The
// tax year rows are an export and stand on Asetukset > Tiedot.
describe("Raportit: Tulot ja menot", () => {
  it("is named Tulot ja menot and has the months and the income", () => {
    expect(page.title).toBe("Tulot ja menot");
    expect(page.sections.map((s) => s.id)).toEqual(["tulot-ja-menot", "tulot"]);
    expect(page.sections[1]!.reports).toEqual(["income", "cashflowMonths"]);
  });
  it("a payment opens its day in Tapahtumat", () => {
    expect(paymentHref("Acme Oy", "2026-03-25")).toBe("#/transactions?merchant=Acme+Oy&from=2026-03-25&to=2026-03-25");
  });
  it("the months have their own heading", () => {
    expect(t("rpt.in_months")).toBe("Tulot kuukausittain");
  });
});
