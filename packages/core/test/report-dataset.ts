import { addMonths } from "../src/dates.ts";
import type { Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";

// test helpers put every transaction on account "acc-1"
const today = "2026-10-09";

export function dataset(): Transaction[] {
  return [
    ...series("2025-09-25", 30.44, 13, 300000, { category: "salary", merchant: "Acme Oy" }),
    ...series("2025-09-02", 30.44, 13, -105000, { category: "housing", merchant: "Sato Oyj" }),
    ...series("2025-09-12", 30.44, 13, -1199, { category: "subscriptions", merchant: "Spotify" }),
    ...series("2025-09-05", 30.44, 13, -25000, { category: "loans", merchant: "Nordea Rahoitus Suomi Oy" }),
    ...series("2025-09-06", 30.44, 13, -20000, { category: "investments", merchant: "Nordnet" }),
    ...series("2025-09-01", 3.5, 115, (i) => -(2000 + (i % 7) * 900), { category: "groceries", merchant: "K-Market" }),
    ...monthlyOn("2025-09", 8, 14, (i) => (i < 9 ? -1399 : -1599), { category: "subscriptions", merchant: "Netflix" }),
    tx({ bookingDate: "2026-06-14", amountCents: -38900, category: "travel", merchant: "Finnair" }),
    tx({ bookingDate: "2026-09-20", amountCents: -12900, category: "home", merchant: "Uusi Kauppa" }),
  ].filter((t) => t.bookingDate <= today);
}

/** `count` charges on day `day` of consecutive months from `firstMonth`. */
export function monthlyOn(firstMonth: string, day: number, count: number, amount: (i: number) => number, partial: Partial<Transaction>): Transaction[] {
  return Array.from({ length: count }, (_, i) => tx({ ...partial, bookingDate: `${addMonths(firstMonth, i)}-${String(day).padStart(2, "0")}`, amountCents: amount(i) }));
}
