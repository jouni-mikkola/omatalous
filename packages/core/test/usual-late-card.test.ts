/**
 * A card linked late (analysis/usual.ts with reports/pivot.ts): its first month is incomplete for the household total,
 * and a large card stops the household's walk of complete months there. A reader that names the accounts it sums
 * (`completeMonthsBefore` with accounts, `accountCovers`) keeps its months: the rent and the groceries paid from the
 * checking account keep their usual level, and only the card's own rows wait for complete months.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { completeMonthsBefore, usualSpending } from "../src/analysis/usual.ts";
import { addMonths, dateIn, monthEnd } from "../src/dates.ts";
import { pivotReport } from "../src/reports/pivot.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking", bank: "Pankki" };
const card: Account = { id: "card-1", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card", bank: "Pankki" };
/** Twelve complete months, December 2025 to November 2026; the card's first row is on 10 September, month 10. */
const TODAY = "2026-12-05";

const monthly = (first: string, last: string, euros: number, merchant: string, category: string, accountId: string, day: number): Transaction[] => {
  const out: Transaction[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) out.push(tx({ bookingDate: dateIn(m, day), amountCents: -euros * 100, merchant, category, categorySource: "rule", accountId }));
  return out;
};

const rows = [
  ...monthly("2025-12", "2026-11", 900, "Asunto Oy Esimerkki", "housing", "acc-1", 2),
  ...monthly("2025-12", "2026-11", 300, "Lähikauppa", "groceries", "acc-1", 6),
  // the card carries far more than a tenth of the spending from its first month on
  ...monthly("2026-09", "2026-11", 600, "Vaateliike", "shopping", "card-1", 12),
];
const ctx = createContext(rows, [checking, card], TODAY);

describe("a card linked in month 10 of 12", () => {
  it("stops the household's walk at its first month", () => {
    expect(completeMonthsBefore(ctx, "2026-12")).toEqual(["2026-10", "2026-11"]);
    expect(usualSpending(ctx, "2026-12")).toBeNull();
  });

  it("leaves the checking account's months to a reader that names it", () => {
    expect(completeMonthsBefore(ctx, "2026-12", 6, ["acc-1"])).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(completeMonthsBefore(ctx, "2026-12", 6, ["card-1"])).toEqual(["2026-10", "2026-11"]);
  });

  it("keeps the usual level of the rent and the groceries in Menot kuukausittain, and the card's waits", () => {
    const r = pivotReport(ctx, { from: "2025-12-01", to: monthEnd("2026-11") });
    const themes = [...r.themes, ...(r.rest?.themes ?? [])];
    const housing = themes.find((t) => t.id === "housing")!;
    const food = themes.find((t) => t.id === "food")!;
    const shopping = themes.find((t) => t.id === "shopping")!;
    expect(housing.usualCents).toBe(90_000);
    expect(food.usualCents).toBe(30_000);
    expect(food.lines.find((l) => l.id === "groceries")!.usualCents).toBe(30_000);
    expect(shopping.usualCents).toBeNull();
  });
});
