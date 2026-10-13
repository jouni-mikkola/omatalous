import type { AccountType } from "@banking/core";

/**
 * The balance as it is stored, in cents. The app's convention is that a debt is a balance below zero (`creditAccountLoan`
 * in core). A loan account holds no deposit: the amount the bank tells is what is owed, and banks tell it with either
 * sign, so a plus on a loan account is stored as a minus. Zero, no balance and a minus pass as they are. Every other
 * account type is stored as told: a credit card with a plus is money the bank owes the holder.
 */
export function storedBalanceCents(type: AccountType, cents: number): number;
export function storedBalanceCents(type: AccountType, cents: number | null): number | null;
export function storedBalanceCents(type: AccountType, cents: number | null): number | null {
  return type === "loan" && cents !== null && cents > 0 ? -cents : cents;
}
