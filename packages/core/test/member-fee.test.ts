/**
 * The fee of a transfer between two accounts of the household: the receiving leg is smaller than the sending one, the
 * difference is a bank fee and the legs stay a transfer.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { isBankFee } from "../src/analysis/fees.ts";
import { MAX_TRANSFER_FEE_CENTS, splitMemberFees } from "../src/member-fee.ts";
import type { Account } from "../src/types.ts";
import { ibanOf } from "./kit/generate-rows.ts";
import { tx } from "./helpers.ts";

const [FIRST, SECOND, ELSEWHERE] = [ibanOf(1), ibanOf(2), ibanOf(3)];
const accounts: Account[] = [
  { id: "first", name: "Ensimmäinen", iban: FIRST, currency: "EUR", type: "checking" },
  { id: "second", name: "Toinen", iban: SECOND, currency: "EUR", type: "checking" },
];

/** The two legs of one transfer: `sent` leaves the first account and `got` reaches the second. */
const legs = (sent: number, got: number, extra: { day?: string; gotDay?: string } = {}) => [
  tx({ id: "out", accountId: "first", bookingDate: extra.day ?? "2026-03-10", amountCents: -sent, counterpartyIban: SECOND, isTransfer: true, category: "transfer", categorySource: "transfer" }),
  tx({ id: "in", accountId: "second", bookingDate: extra.gotDay ?? extra.day ?? "2026-03-10", amountCents: got, counterpartyIban: FIRST, isTransfer: true, category: "transfer", categorySource: "transfer" }),
];

describe("splitMemberFees", () => {
  it("splits the fee off the sending leg as a bank fee", () => {
    const rows = splitMemberFees(legs(8150, 8000), accounts);
    expect(rows.map((t) => [t.id, t.amountCents, t.category, t.isTransfer])).toEqual([
      ["out", -8000, "transfer", true],
      ["out:fee", -150, "fees", false],
      ["in", 8000, "transfer", true],
    ]);
    expect(rows.reduce((sum, t) => sum + t.amountCents, 0)).toBe(-150);
  });

  it("counts the fee as spending and leaves the legs neutral", () => {
    const ctx = createContext(splitMemberFees(legs(8150, 8000), accounts), accounts, "2026-03-20");
    expect(ctx.txs.reduce((sum, t) => sum + t.spend, 0)).toBe(150);
    expect(ctx.txs.filter(isBankFee).map((t) => t.spend)).toEqual([150]);
    expect(ctx.txs.filter((t) => t.isTransfer).every((t) => t.spend === 0 && t.flows.income === 0)).toBe(true);
  });

  it("pairs legs a few days apart", () => {
    expect(splitMemberFees(legs(5100, 5000, { gotDay: "2026-03-12" }), accounts)).toHaveLength(3);
  });

  it("leaves legs of the same amount alone", () => {
    const rows = legs(8000, 8000);
    expect(splitMemberFees(rows, accounts)).toEqual(rows);
  });

  it("takes no difference above the most a fee can be", () => {
    const rows = legs(8000 + MAX_TRANSFER_FEE_CENTS + 1, 8000);
    expect(splitMemberFees(rows, accounts)).toEqual(rows);
  });

  it("leaves legs too far apart in time alone", () => {
    const rows = legs(8150, 8000, { gotDay: "2026-03-25" });
    expect(splitMemberFees(rows, accounts)).toEqual(rows);
  });

  it("leaves a leg whose other account is not the household's alone", () => {
    const rows = legs(8150, 8000).map((t) => (t.id === "out" ? { ...t, counterpartyIban: ELSEWHERE } : t));
    expect(splitMemberFees(rows, accounts)).toEqual(rows);
  });

  it("leaves a row the user decided alone", () => {
    const rows = legs(8150, 8000).map((t) => (t.id === "out" ? { ...t, categorySource: "user" as const } : t));
    expect(splitMemberFees(rows, accounts)).toEqual(rows);
  });

  it("pairs equal legs first, so the fee goes to the leg that has none", () => {
    const rows = [...legs(8000, 8000), tx({ id: "out2", accountId: "first", bookingDate: "2026-03-10", amountCents: -8150, counterpartyIban: SECOND, isTransfer: true, category: "transfer", categorySource: "transfer" }), tx({ id: "in2", accountId: "second", bookingDate: "2026-03-10", amountCents: 8000, counterpartyIban: FIRST, isTransfer: true, category: "transfer", categorySource: "transfer" })];
    const fees = splitMemberFees(rows, accounts).filter((t) => t.id.endsWith(":fee"));
    expect(fees.map((t) => [t.id, t.amountCents])).toEqual([["out2:fee", -150]]);
  });
});
