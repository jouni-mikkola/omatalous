import { describe, expect, it } from "vitest";
import { bridgeByMonth, placeOf } from "../src/analysis/conservation.ts";
import type { Flows } from "../src/analysis/flows.ts";
import type { Account } from "../src/types.ts";
import { ibanOf } from "./kit/generate-rows.ts";

const NONE: Flows = { consumption: 0, debt: 0, saved: 0, income: 0, borrowed: 0 };
// made-up account numbers: the first two are accounts of the view, the third is a daily account the view does not hold
const [CHK_IBAN, SECOND_IBAN, OUTSIDE_IBAN] = [ibanOf(1), ibanOf(2), ibanOf(3)];
const ACCOUNTS: Pick<Account, "id" | "type" | "iban">[] = [
  { id: "chk", type: "checking", iban: CHK_IBAN },
  { id: "chk-other", type: "checking", iban: SECOND_IBAN },
  { id: "sav", type: "savings", iban: null },
  { id: "card", type: "credit_card", iban: null },
  { id: "loan", type: "loan", iban: null },
];
const POOL = new Set(["chk"]);
const TWO_POOL = new Set(["chk", "chk-other"]);
const DAILY = new Set([CHK_IBAN, SECOND_IBAN, OUTSIDE_IBAN]);

let n = 0;
const row = (accountId: string, amountCents: number, flows: Partial<Flows> = {}, extra: { date?: string; iban?: string | null; wholeCents?: number } = {}) => ({
  id: `r${++n}`,
  accountId,
  bookingDate: extra.date ?? "2026-03-10",
  amountCents,
  counterpartyIban: extra.iban ?? null,
  ...(extra.wholeCents === undefined ? {} : { wholeCents: extra.wholeCents }),
  flows: { ...NONE, ...flows },
});
const march = (rows: ReturnType<typeof row>[], pool: ReadonlySet<string> = POOL) => bridgeByMonth(rows, ACCOUNTS, pool, DAILY)[0]!;

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

  it("names money moved to a daily account the view does not hold: the moved line takes all of it", () => {
    const m = march([row("chk", -8_150, {}, { iban: OUTSIDE_IBAN })]);
    expect(m).toMatchObject({ leftCents: 0, poolCents: -8_150, residualCents: 0 });
    expect(m.lines.moved.cents).toBe(8_150);
  });

  it("does not read the flows of a leg: a move that a flow counted shows as a residual", () => {
    const m = march([row("chk", -8_150, { consumption: 8_150 }, { iban: OUTSIDE_IBAN })]);
    expect(m.lines.moved.cents).toBe(8_150);
    expect(m.residualCents).toBe(-8_150);
  });

  it("matches the two legs of a move between two accounts of the view: nothing is left", () => {
    const out = row("chk", -8_150, {}, { iban: SECOND_IBAN });
    const back = row("chk-other", 8_150, {}, { iban: CHK_IBAN });
    const m = march([out, back], TWO_POOL);
    expect(m).toMatchObject({ leftCents: 0, poolCents: 0, residualCents: 0 });
    expect(m.lines.moved.rowIds.sort()).toEqual([out.id, back.id].sort());
  });

  it("leaves the fee of a move in the residual: legs of -8150 and +8000 leave 150 that Tulos does not count", () => {
    const m = march([row("chk", -8_150, {}, { iban: SECOND_IBAN }), row("chk-other", 8_000, {}, { iban: CHK_IBAN })], TWO_POOL);
    expect(m).toMatchObject({ leftCents: 0, poolCents: -150, residualCents: 150 });
    expect(m.lines.moved.cents).toBe(0);
  });

  it("lets a fee that a flow counted cancel against the pool, and the line still leaves only the fee", () => {
    const m = march([row("chk", -8_150, { consumption: 150 }, { iban: SECOND_IBAN }), row("chk-other", 8_000, {}, { iban: CHK_IBAN })], TWO_POOL);
    expect(m.residualCents).toBe(0);
  });

  it("takes a leg cut to a part in full: the bank's amount decides what matches, the part decides what the pool holds", () => {
    const m = march([row("chk", -9_000, {}, { iban: SECOND_IBAN }), row("chk-other", 4_500, {}, { iban: CHK_IBAN, wholeCents: 9_000 })], TWO_POOL);
    expect(m).toMatchObject({ leftCents: 0, poolCents: -4_500, residualCents: 0 });
    expect(m.lines.moved.cents).toBe(4_500);
  });

  it("leaves a leg in the residual when the other account is in the view and its leg is not", () => {
    expect(march([row("chk", -8_150, {}, { iban: SECOND_IBAN })], TWO_POOL)).toMatchObject({ residualCents: 8_150 });
  });

  it("matches only legs of one day: a leg of the next day is no mate", () => {
    const m = march([row("chk", -8_150, {}, { iban: SECOND_IBAN }), row("chk-other", 8_150, {}, { iban: CHK_IBAN, date: "2026-03-11" }), row("chk-other", 8_150, {}, { iban: CHK_IBAN })], TWO_POOL);
    expect(m.lines.moved.rowIds).toHaveLength(2);
    expect(m.residualCents).toBe(-8_150);
  });

  it("pairs a tie by row id, so the order of the rows changes nothing", () => {
    const rows = [
      row("chk", -10_500, {}, { iban: SECOND_IBAN }),
      row("chk", -9_500, {}, { iban: SECOND_IBAN }),
      row("chk-other", 10_000, {}, { iban: CHK_IBAN }),
      row("chk-other", 9_500, {}, { iban: CHK_IBAN }),
    ];
    const forward = march(rows, TWO_POOL);
    const backward = march([...rows].reverse(), TWO_POOL);
    expect([backward.lines.moved.cents, backward.residualCents]).toEqual([forward.lines.moved.cents, forward.residualCents]);
    expect([...backward.lines.moved.rowIds].sort()).toEqual([...forward.lines.moved.rowIds].sort());
  });

  it("keeps each row in one line, by its id", () => {
    const moved = row("chk", -8_150, {}, { iban: OUTSIDE_IBAN });
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
