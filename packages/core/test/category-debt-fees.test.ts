/** The debt paid and the fees of a range in the category report (`debtPaidCents`, `feesCents`). Made-up household only. */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { categoryReport } from "../src/reports/categories.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const range = { from: "2026-10-01", to: "2026-10-31" };

const report = (rows: Transaction[]) => categoryReport(createContext(rows, [checking], "2026-11-10"), range, "fi");

describe("the debt paid and the fees of the category report", () => {
  it("sums the debt service and the bank prices, interest and late fees of the range", () => {
    const out = report([
      tx({ bookingDate: "2026-10-01", amountCents: 300_000, merchant: "Acme Oy", category: "salary" }),
      tx({ bookingDate: "2026-10-03", amountCents: -30_000, merchant: "Prisma", category: "groceries" }),
      tx({ bookingDate: "2026-10-05", amountCents: -80_000, merchant: "Esimerkkipankki", category: "mortgage" }),
      tx({ bookingDate: "2026-10-06", amountCents: -12_000, merchant: "Esimerkkipankki", category: "interest" }),
      tx({ bookingDate: "2026-10-07", amountCents: -500, merchant: "Esimerkkipankki", category: "fees" }),
      tx({ bookingDate: "2026-10-08", amountCents: -1_000, merchant: "Esimerkkilaskutus", description: "Muistutusmaksu", category: "other" }),
      // outside the range
      tx({ bookingDate: "2026-09-30", amountCents: -9_900, merchant: "Esimerkkipankki", category: "interest" }),
    ]);
    expect(out.debtPaidCents).toBe(92_000);
    expect(out.feesCents).toBe(13_500);
  });

  it("leaves out a bill paid together with its collection fee: that row pays the bill too", () => {
    const out = report([
      tx({ bookingDate: "2026-10-01", amountCents: 300_000, merchant: "Acme Oy", category: "salary" }),
      tx({ bookingDate: "2026-10-08", amountCents: -45_000, merchant: "Esimerkkilaskutus", description: "LASKU 4471 JA PERINTAKULU", category: "other" }),
      tx({ bookingDate: "2026-10-09", amountCents: -1_000, merchant: "Esimerkkilaskutus", description: "Muistutusmaksu", category: "other" }),
    ]);
    expect(out.feesCents).toBe(1_000);
  });

  it("is zero for a household with neither", () => {
    const out = report([
      tx({ bookingDate: "2026-10-01", amountCents: 300_000, merchant: "Acme Oy", category: "salary" }),
      tx({ bookingDate: "2026-10-03", amountCents: -30_000, merchant: "Prisma", category: "groceries" }),
    ]);
    expect(out.debtPaidCents).toBe(0);
    expect(out.feesCents).toBe(0);
  });
});
