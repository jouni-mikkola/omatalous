/**
 * A share of spending is of the categories that net above zero (`spendingBase`), so none passes 100 % when another
 * category has more refunds than spending. The Kategoriat report and the data quality signal read the same base.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

describe("a share when another category nets below zero", () => {
  // groceries 600,00; shopping 100,00 spent and the 250,00 of September refunded, so it nets -150,00 and the net total is 450,00
  const rows = (big: "groceries" | "other") => [
    tx({ bookingDate: "2026-09-20", amountCents: -25_000, category: "shopping", merchant: "Vaatekauppa Oy" }),
    tx({ bookingDate: "2026-10-02", amountCents: -60_000, category: big, merchant: "Ruokakauppa Oy" }),
    tx({ bookingDate: "2026-10-03", amountCents: -10_000, category: "shopping", merchant: "Vaatekauppa Oy" }),
    tx({ bookingDate: "2026-10-05", amountCents: 25_000, category: "shopping", merchant: "Vaatekauppa Oy" }),
  ];
  const reports = (txs: Transaction[]) => buildReports({ ctx: createContext(txs, [checking], today), range: { from: "2026-10-01", to: today }, balances: [] });

  it("Kategoriat: the shares of the categories that net above zero add up to 100 %, and the total stays net", () => {
    const c = reports(rows("groceries")).categories;
    const all = c.groups.flatMap((g) => g.categories);
    expect(c.totalCents).toBe(45_000);
    expect(all.find((x) => x.category === "groceries")!.share).toBe(1);
    expect(all.find((x) => x.category === "shopping")!.totalCents).toBe(-15_000);
    expect(c.groups.filter((g) => g.totalCents > 0).reduce((s, g) => s + g.share, 0)).toBeCloseTo(1, 10);
  });

  it("Tietojen laatu: the known share is of the same base", () => {
    // the known share is of the twelve complete months up to October: the September purchase is in them, so shopping
    // nets +100,00 and the base is 700,00 (spendingBase), of which the 600,00 in Muut menot is not known
    const ctx = createContext(rows("other"), [checking], "2026-10-31");
    const s = buildReports({ ctx, range: { from: "2026-10-01", to: "2026-10-31" }, balances: [] }).dataQuality.signals.find((x) => x.id === "uncategorised");
    expect(s?.title.replace(/\s/g, " ")).toBe("14 % viimeisen 12 valmiin kuukauden menoista on tunnistettu");
  });
});
