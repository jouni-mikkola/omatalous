import { describe, expect, it } from "vitest";
import { bridgeByMonth, placeOf } from "../src/analysis/conservation.ts";
import type { Flows } from "../src/analysis/flows.ts";
import type { Account } from "../src/types.ts";

const NONE: Flows = { consumption: 0, debt: 0, saved: 0, income: 0, borrowed: 0 };
const ACCOUNTS: Pick<Account, "id" | "type">[] = [
  { id: "chk", type: "checking" },
  { id: "chk-other", type: "checking" },
  { id: "sav", type: "savings" },
  { id: "card", type: "credit_card" },
  { id: "loan", type: "loan" },
];
const POOL = new Set(["chk"]);
const OTHER_IBAN = "FI2112345600000785";
const DAILY = new Set([OTHER_IBAN]);

let n = 0;
const row = (accountId: string, amountCents: number, flows: Partial<Flows> = {}, extra: { date?: string; iban?: string | null } = {}) => ({
  id: `r${++n}`,
  accountId,
  bookingDate: extra.date ?? "2026-03-10",
  amountCents,
  counterpartyIban: extra.iban ?? null,
  flows: { ...NONE, ...flows },
});
const march = (rows: ReturnType<typeof row>[]) => bridgeByMonth(rows, ACCOUNTS, POOL, DAILY)[0]!;

describe("bridgeByMonth: Tulos is the change of the pool and two named lines", () => {
  it("balances pay that arrives and spending that leaves with no line", () => {
    const m = march([row("chk", 300_000, { income: 300_000 }), row("chk", -4_500, { consumption: 4_500 })]);
    expect(m).toMatchObject({ leftCents: 295_500, poolCents: 295_500, residualCents: 0 });
    expect(m.lines.cards.cents).toBe(0);
    expect(m.lines.moved.cents).toBe(0);
  });

  it("names a card purchase that moves no money on the pool: the cards line takes it", () => {
    const m = march([row("card", -5_000, { consumption: 5_000 })]);
    expect(m.poolCents).toBe(0);
    expect(m.leftCents).toBe(-5_000);
    expect(m.lines.cards.cents).toBe(-5_000);
    expect(m.residualCents).toBe(0);
  });

  it("finds a card purchase that no flow counted: the pool did not move and Tulos should have", () => {
    const m = march([row("card", -5_000)]);
    expect(m).toMatchObject({ leftCents: 0, poolCents: 0, residualCents: 5_000 });
  });

  it("finds a card purchase counted twice", () => {
    const m = march([row("card", -5_000, { consumption: 10_000 })]);
    expect(m.residualCents).toBe(-5_000);
  });

  it("lets the bill of a card cancel the purchase: the pool pays what the cards line gives back", () => {
    const m = march([row("chk", -5_000), row("card", 5_000)]);
    expect(m).toMatchObject({ leftCents: 0, poolCents: -5_000, residualCents: 0 });
    expect(m.lines.cards.cents).toBe(5_000);
  });

  it("counts money put on a savings account as one leaving flow, with no line", () => {
    const m = march([row("chk", -20_000), row("sav", 20_000, { saved: 20_000 })]);
    expect(m).toMatchObject({ leftCents: -20_000, poolCents: -20_000, residualCents: 0 });
    expect(m.counted).toEqual([{ accountType: "savings", flow: "saved", cents: 20_000 }]);
  });

  it("finds a loan paid from savings that Tulos counts twice, and names the outside rows that did it", () => {
    const m = march([row("chk", -61_240), row("sav", 61_240, { saved: 61_240 }), row("sav", -61_240, { debt: 61_240 })]);
    expect(m.residualCents).toBe(-61_240);
    expect(m.counted).toEqual([
      { accountType: "savings", flow: "saved", cents: 61_240 },
      { accountType: "savings", flow: "debt", cents: 61_240 },
    ]);
  });

  it("names money moved to another daily account that no flow counts: the moved line takes it", () => {
    const m = march([row("chk", -8_150, {}, { iban: OTHER_IBAN })]);
    expect(m).toMatchObject({ leftCents: 0, poolCents: -8_150, residualCents: 0 });
    expect(m.lines.moved.cents).toBe(8_150);
  });

  it("leaves a payment to a daily account that a flow counted to the flow, not to the line", () => {
    const m = march([row("chk", -8_150, { consumption: 8_150 }, { iban: OTHER_IBAN })]);
    expect(m.lines.moved.cents).toBe(0);
    expect(m.residualCents).toBe(0);
  });

  it("keeps each row in one line, by its id", () => {
    const moved = row("chk", -8_150, {}, { iban: OTHER_IBAN });
    const card = row("card", -5_000, { consumption: 5_000 });
    const m = march([moved, card, row("chk", 1_000, { income: 1_000 })]);
    expect(m.lines.moved.rowIds).toEqual([moved.id]);
    expect(m.lines.cards.rowIds).toEqual([card.id]);
  });

  it("adds nothing for a loan account's own row, which repeats a payment counted where it left", () => {
    const m = march([row("chk", -61_240, { debt: 61_240 }), row("loan", 61_240)]);
    expect(m).toMatchObject({ leftCents: -61_240, poolCents: -61_240, residualCents: 0 });
    expect(m.rows).toEqual({ pool: 1, card: 0, loan: 1, outside: 0 });
  });

  it("gives one bridge for each month with rows, oldest first", () => {
    const bridges = bridgeByMonth([row("chk", 100, { income: 100 }, { date: "2026-04-02" }), row("chk", 200, { income: 200 }, { date: "2026-03-30" })], ACCOUNTS, POOL, DAILY);
    expect(bridges.map((b) => [b.month, b.poolCents])).toEqual([
      ["2026-03", 200],
      ["2026-04", 100],
    ]);
  });
});

describe("placeOf", () => {
  it("puts an account in the pool, or by its type", () => {
    expect(ACCOUNTS.map((a) => placeOf(a, POOL))).toEqual(["pool", "outside", "outside", "card", "loan"]);
  });
});
