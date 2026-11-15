/**
 * A figure over an account several members use has two readings: the viewer's `part` and the bank's `whole`. A sum
 * names the side it adds up, so the parts of every member add up to the household's figure and the wholes are the
 * bank's own amounts, never a mix of the two. Rows carry the two as `amountCents` and `wholeCents` (account-use.ts);
 * code that sums or compares them reads the pair through this file, and `repo-rules` keeps direct reads of
 * `wholeCents` out of the rest.
 */
import type { LoanProposal } from "./loan-detect.ts";
import type { Transaction } from "./types.ts";

export interface Shared {
  /** The viewer's part: what the view counts. */
  part: number;
  /** The bank's whole amount: what the lender, the bank or the bill says. Equals `part` where nothing is cut. */
  whole: number;
}

export type Side = keyof Shared;

export const sharedOf = (part: number, whole: number = part): Shared => ({ part, whole });

/** The two readings of a row: its cents as the view counts them and as the bank wrote them. */
export const sharedRow = (t: Pick<Transaction, "amountCents" | "wholeCents">): Shared => sharedOf(t.amountCents, t.wholeCents ?? t.amountCents);

/** The two readings of a proposed loan's payment: `monthlyCents` is the viewer's part and `paymentCents` the bank's whole. */
export const paymentOf = (p: Pick<LoanProposal, "paymentCents" | "monthlyCents">): Shared => sharedOf(p.monthlyCents, p.paymentCents);

/** Whether the row is cut to a part of the bank's amount (`applyUse` set `wholeCents`). */
export const isCut = (t: Pick<Transaction, "wholeCents">): boolean => t.wholeCents !== undefined;

/** The figures added up on one side. */
export const sumShared = (figures: readonly Shared[], side: Side): number => figures.reduce((sum, f) => sum + f[side], 0);
