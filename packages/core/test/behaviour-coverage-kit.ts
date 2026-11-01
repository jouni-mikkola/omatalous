/** The accounts, today and the rows of the coverage tests (work: behaviour-coverage.test.ts, time: behaviour-coverage.perf.test.ts). */
import { addDays } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

export const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
export const card: Account = { id: "card-1", name: "Luottokortti", iban: null, currency: "EUR", type: "credit_card" };
export const TODAY = "2026-10-14";
export const MONDAY = "2026-10-12";

export const paid = (bookingDate: string, cents: number, merchant: string, category: string, accountId = "acc-1") =>
  tx({ bookingDate, amountCents: -cents, merchant, category, categorySource: "rule", accountId });

/** 100 000 rows over four merchants and two accounts, 90 a day. */
export function householdRows(): Transaction[] {
  const merchants: [string, string][] = [["Esimerkkikauppa", "groceries"], ["Esimerkkiruoka", "food_delivery"], ["Esimerkkipelit", "gambling"], ["Kahvila", "restaurants"]];
  return Array.from({ length: 100_000 }, (_, i) => {
    const [merchant, category] = merchants[i % 4]!;
    return paid(addDays("2023-10-01", Math.floor(i / 90)), 500 + (i % 3_000), merchant, category, i % 3 ? "acc-1" : "card-1");
  });
}
