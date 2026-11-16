import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account } from "../src/types.ts";
import { dataset } from "./report-dataset.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

describe("Saldot: the change per month and the accounts missing from the picture", () => {
  const ctx = createContext(dataset(), [checking], today);
  const eur = { id: "acc-1", name: "Käyttötili", type: "checking" as const, balanceCents: 123456, ownerName: null, balanceAt: null };
  const usd = { id: "acc-3", name: "Dollaritili", type: "checking" as const, balanceCents: null, foreign: { currency: "USD", cents: 250_000 }, ownerName: null, balanceAt: null };
  const unknown = { id: "acc-4", name: "Uusi tili", type: "checking" as const, balanceCents: null, ownerName: null, balanceAt: null };
  const r = buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-30" }, balances: [eur, usd, unknown] }).balances;

  it("the change of a month is the plain difference of the totals shown, an account that starts in between included", () => {
    const late = { id: "acc-5", name: "Myöhäinen", type: "savings" as const, balanceCents: 500_000, ownerName: null, balanceAt: null };
    const two = buildReports({ ctx: createContext(dataset(), [checking, { ...checking, id: "acc-5", name: "Myöhäinen", type: "savings" }], today), range: { from: "2026-01-01", to: "2026-09-30" }, balances: [eur, late] }).balances;
    // the second account has no row, so it is known only from today: no month end of the range holds it
    expect(two.monthChange.slice(1).some((c) => c !== null)).toBe(true);
    let checked = 0;
    for (const report of [r, two]) {
      report.monthChange.forEach((change, i) => {
        if (change === null) return;
        checked++;
        expect(change, report.months[i]).toBe(report.total[i]! - report.total[i - 1]!);
      });
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("names the accounts left out with their sum in their own currency, or that it is not known", () => {
    expect(r.missing).toEqual([
      { accountId: "acc-3", name: "Dollaritili", type: "checking", foreign: { currency: "USD", cents: 250_000 } },
      { accountId: "acc-4", name: "Uusi tili", type: "checking", foreign: null },
    ]);
    expect(r.accounts.map((a) => a.accountId)).toEqual(["acc-1"]);
  });
});
