import { addMonths } from "../src/dates.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

export const today = "2026-10-09";
export const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };

/** `count` charges on `day` of each month from `start` (YYYY-MM). */
export function monthly(start: string, day: number, count: number, amount: number | ((i: number) => number), partial: Partial<Transaction> = {}): Transaction[] {
  return Array.from({ length: count }, (_, i) =>
    tx({ merchant: "Test", ...partial, bookingDate: `${addMonths(start, i)}-${String(day).padStart(2, "0")}`, amountCents: typeof amount === "function" ? amount(i) : amount }),
  );
}

/** 30 months from April 2024: pay, rent, food shops and restaurants with small month-to-month changes. */
export function household(): Transaction[] {
  const n = 30;
  return [
    ...monthly("2024-04", 15, n, 350000, { merchant: "Työnantaja Oy", category: "salary" }),
    ...monthly("2024-04", 2, n, -90000, { merchant: "Vuokranantaja", category: "housing" }),
    ...[5, 12, 19, 26].flatMap((day, k) => monthly("2024-04", day, n, (i) => -(6000 + (((i % 12) * 137 + k * 500) % 3000)), { merchant: "Prisma", category: "groceries" })),
    ...[9, 23].flatMap((day, k) => monthly("2024-04", day, n, (i) => -(2500 + (((i % 12) * 53 + k * 300) % 2000)), { merchant: "Ravintola", category: "restaurants" })),
  ];
}
