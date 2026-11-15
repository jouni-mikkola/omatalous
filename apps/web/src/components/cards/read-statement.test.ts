import { describe, expect, it } from "vitest";
import { readStatement } from "./read-statement.ts";

describe("readStatement", () => {
  it("reads day, text and sum, the year from the period, and drops payment rows with a count", () => {
    const text = ["03.10. K-MARKET ESIMERKKI 61,50", "09.10.2026 ESIMERKKI POLTTOAINE 80,00 EUR", "10.10. MAKSU KIITOS 100,00", "12.10. VERKKOKAUPPA ESIMERKKI 1 150,00"].join("\n");
    const r = readStatement(text, "2026-10-12");
    expect(r.rows).toEqual([
      { day: "2026-10-03", cents: 6150, text: "K-MARKET ESIMERKKI" },
      { day: "2026-10-09", cents: 8000, text: "ESIMERKKI POLTTOAINE" },
      { day: "2026-10-12", cents: 115000, text: "VERKKOKAUPPA ESIMERKKI" },
    ]);
    expect(r.payments).toBe(1);
    expect(r.unread).toEqual([]);
  });

  it("reads a refund from a minus before or after the sum, and the last year for a day after the period's end", () => {
    const r = readStatement("28.12. PALAUTUS ESIMERKKI 12,00-\n29.12. ESIMERKKI -5,00", "2026-01-10");
    expect(r.rows).toEqual([
      { day: "2025-12-28", cents: -1200, text: "PALAUTUS ESIMERKKI" },
      { day: "2025-12-29", cents: -500, text: "ESIMERKKI" },
    ]);
  });

  it("keeps a line with no day, no sum, no text, a sum of nothing or an unreal day as unread", () => {
    const lines = ["ESIMERKKI 12,00", "03.10. ESIMERKKI", "03.10. 12,00", "03.10. ESIMERKKI 0,00", "31.02. ESIMERKKI 1,00"];
    const r = readStatement([...lines, "", "  "].join("\n"), "2026-10-12");
    expect(r.rows).toEqual([]);
    expect(r.unread).toEqual(lines);
  });

  it("a near miss: a word that only contains MAKSU is a purchase", () => {
    expect(readStatement("03.10. MAKSUPALVELU ESIMERKKI 3,00", "2026-10-12").rows).toHaveLength(1);
  });
});
