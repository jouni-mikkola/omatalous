import { type AccountType, addDays, AVAILABLE_BALANCE_TYPES } from "@banking/core";
import type { BalanceReading } from "./types.ts";

/**
 * The balance as it is stored, in cents. The app's convention is that a debt is a balance below zero (`creditAccountLoan`
 * in core). A loan account holds no deposit: the amount the bank tells is what is owed, and banks tell it with either
 * sign, so a plus on a loan account is stored as a minus. Zero, no balance and a minus pass as they are. Every other
 * account type is stored as told here; a card's sign is learned from its reconciled balances (`sign` of `reconcile`, core)
 * and applied by the sync.
 */
export function storedBalanceCents(type: AccountType, cents: number): number;
export function storedBalanceCents(type: AccountType, cents: number | null): number | null;
export function storedBalanceCents(type: AccountType, cents: number | null): number | null {
  return type === "loan" && cents !== null && cents > 0 ? -cents : cents;
}

/**
 * The balance a card's debt is read from: the first told that is not of an available-credit type (the free credit, not
 * the debt), or none. `told` starts with the one the bank shows first.
 */
export function cardBalance<T extends Pick<BalanceReading, "type">>(told: readonly T[]): T | undefined {
  return told.find((b) => !AVAILABLE_BALANCE_TYPES.includes(b.type?.toUpperCase() ?? ""));
}

/** Whether a currency code is the euro, the one currency the app's totals count in. */
export const isEuro = (currency: string | null | undefined): boolean => currency?.trim().toUpperCase() === "EUR";

/** Whether an account's currency is a real one (three letters, not the "unknown" code XXX): the one that names what its balance is in. */
export const isCurrencyCode = (currency: string | null | undefined): boolean => /^[A-Z]{3}$/.test(currency?.trim().toUpperCase() ?? "") && currency!.trim().toUpperCase() !== "XXX";

/**
 * Whether a balance may be stored on an account: the bank names the currency and it is the account's own. A balance
 * in another currency than the account's, or with none named, is not stored: it would be read as the account's money.
 */
export function balanceFitsAccount(told: Pick<BalanceReading, "currency">, accountCurrency: string): boolean {
  return !!told.currency && told.currency === accountCurrency.trim().toUpperCase();
}

/**
 * The stamp stored with a balance (`accounts.balance_at`): the day the balance stands for, as an instant at noon UTC
 * so that any time zone reads the same day. That is the bank's reference day when it sends one that is not in the
 * future; an opening balance (OPBD) is the state at the start of its day, so it stands for the day before. Without a
 * reference day the day of the fetch stands, as the instant of the fetch.
 */
export function balanceStamp(told: Pick<BalanceReading, "type" | "referenceDay">, now: Date, today: string): string {
  const ref = told.referenceDay;
  if (!ref || ref > today) return now.toISOString();
  return `${told.type?.toUpperCase() === "OPBD" ? addDays(ref, -1) : ref}T12:00:00.000Z`;
}
