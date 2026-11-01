/** Shared by the money-flow scenario files: a bank row, and the rows carried through categorising, transfers and flows. */
import { flowsOf, totalsOf } from "../src/analysis/flows.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

export function row(accountId: string, bookingDate: string, euros: number, description: string, counterparty: string | null = null, extra: Partial<Transaction> = {}) {
  return tx({ accountId, bookingDate, amountCents: Math.round(euros * 100), description, counterparty, merchant: normalizeMerchant(counterparty, description), ...extra });
}

export function run(rows: Transaction[], accounts: Account[]) {
  const changed = new Map(enrichTransactions(rows, accounts, []).map((t) => [t.id, t]));
  const final = rows.map((t) => changed.get(t.id) ?? t);
  const savingsIds = new Set(accounts.filter((a) => a.type === "savings").map((a) => a.id));
  const loanIds = new Set(accounts.filter((a) => a.type === "loan").map((a) => a.id));
  const flows = final.map((t) => flowsOf(t, savingsIds, loanIds));
  return { final, flows, totals: totalsOf(flows), byDesc: (d: string) => final.find((t) => t.description === d)! };
}
