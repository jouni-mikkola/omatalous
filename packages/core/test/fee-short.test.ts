/**
 * The fee of a payment between two accounts of the view that arrived short (analysis/fee-short.ts): the payer's bank
 * fee, spending under Pankkikulut, while the pair stays a transfer for what arrived. It is derived from the legs on every
 * run, so a view that holds one leg only has none.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { totalsOf } from "../src/analysis/flows.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const [A_IBAN, B_IBAN, SAVINGS_IBAN] = ["FI0000000000000001", "FI0000000000000002", "FI0000000000000005"];
const checking = (id: string, iban: string): Account => ({ id, name: id, iban, currency: "EUR", type: "checking" });
const A = checking("a", A_IBAN);
const B = checking("b", B_IBAN);
const SAVINGS: Account = { id: "s", name: "Säästö", iban: SAVINGS_IBAN, currency: "EUR", type: "savings" };

const sent = (to: string, cents: number) => tx({ id: "out", accountId: "a", bookingDate: "2025-04-01", amountCents: -cents, counterpartyIban: to, description: "Siirto" });
const arrived = (accountId: string, cents: number) => tx({ id: "in", accountId, bookingDate: "2025-04-02", amountCents: cents, description: "Siirto" });
const viewOf = (rows: Transaction[], accounts: Account[]) => {
  const changed = new Map(enrichTransactions(rows, accounts, []).map((t) => [t.id, t]));
  const ctx = createContext(rows.map((t) => changed.get(t.id) ?? t), accounts, "2025-04-20");
  return { ctx, row: (id: string) => ctx.txs.find((t) => t.id === id)! };
};

describe("the fee of a payment that arrived short", () => {
  it("is spending under Pankkikulut where both legs are in the view, and the pair is a transfer for what arrived", () => {
    const { ctx, row } = viewOf([sent(B_IBAN, 8150), arrived("b", 8000)], [A, B]);
    expect(row("out")).toMatchObject({ isTransfer: true, category: "fees", spend: 150, flows: { consumption: 150, income: 0, saved: 0 } });
    expect(row("in")).toMatchObject({ isTransfer: true, spend: 0, flows: { consumption: 0, income: 0, saved: 0 } });
    // Tulos falls by the fee and by nothing else, as the two accounts together do
    expect(totalsOf(ctx.txs.map((t) => t.flows)).leftCents).toBe(-150);
  });

  it("is in no figure of a payment that arrived whole", () => {
    const { ctx, row } = viewOf([sent(B_IBAN, 8000), arrived("b", 8000)], [A, B]);
    expect(row("out")).toMatchObject({ isTransfer: true, spend: 0 });
    expect(totalsOf(ctx.txs.map((t) => t.flows)).leftCents).toBe(0);
  });

  it("is saved for what arrived on the savings account, and the fee is the rest", () => {
    const { ctx, row } = viewOf([sent(SAVINGS_IBAN, 8150), arrived("s", 8000)], [A, SAVINGS]);
    expect(row("in").flows).toMatchObject({ saved: 8000, consumption: 0 });
    expect(row("out")).toMatchObject({ category: "fees", flows: { consumption: 150, saved: 0 } });
    expect(totalsOf(ctx.txs.map((t) => t.flows))).toMatchObject({ savedCents: 8000, consumptionCents: 150, leftCents: -8150 });
  });

  it("counts only in a view that holds both legs", () => {
    // the sender's leg alone, with the other account not in the view: it has no pair, so no fee
    const sender = viewOf([sent(B_IBAN, 8150)], [A]);
    expect(sender.row("out").category).not.toBe("fees");
    // two accounts in the view but the money in not among the rows
    const missing = viewOf([sent(B_IBAN, 8150)], [A, B]);
    expect(missing.row("out").category).not.toBe("fees");
    expect(missing.row("out").spend).not.toBe(150);
  });
});
