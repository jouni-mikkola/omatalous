/**
 * The settlement between the partners of a joint account for one month. Made-up names and sums: Matti Meikalainen
 * (u:1), Maija Meikalainen (u:2), Liisa Esimerkki (m:3, no login), the pool "Yhteinen tili".
 */
import { describe, expect, it } from "vitest";
import type { CardUse } from "../src/card-holder.ts";
import { dayNumber as d } from "../src/dates.ts";
import type { Owner, TraceRow } from "../src/money-trace.ts";
import { trace } from "../src/money-trace.ts";
import { type AgreementRow, agreementRefusal, type Incomes } from "../src/settlement-agreements.ts";
import { type SaidAnswer } from "../src/settlement-ledger.ts";
import { cardHolderOf } from "../src/card-holder.ts";
import { type ClosedMonth, type Settlement, settlement } from "../src/settlement.ts";

const MATTI = "u:1";
const MAIJA = "u:2";
const LIISA = "m:3";
const POOL = "iban-yhteinen-tili";
const CARD_MAIJA = "card-maija";
const BOTH = [
  { owner: MATTI, weight: 1 },
  { owner: MAIJA, weight: 1 },
];

const row = (label: string, date: string, cents: number, extra: Partial<TraceRow> = {}): TraceRow => {
  const day = d(date);
  return { key: `${day}|${cents}|${label}|00000`, ids: [label], day, cents, ...extra };
};
const own = (owner: Owner): Partial<TraceRow> => ({ from: { owner, kind: "own" } });
const refundOf = (of: TraceRow): Partial<TraceRow> => ({ from: { refundOf: of.key } });
const agree = (validFrom: string, kind: AgreementRow["kind"], value: Record<string, unknown>, accountKey = POOL): AgreementRow => ({ accountKey, validFrom, kind, value });
const equal = (validFrom = "2026-01-01"): AgreementRow => agree(validFrom, "equal", { who: [MATTI, MAIJA] });
const cardOf = (key: string, ...users: Owner[]): CardUse => ({ key, users: users.map((owner) => ({ owner, weight: 1 })) });

interface Setup {
  agreements?: AgreementRow[];
  members?: Owner[];
  users?: { owner: Owner; weight: number }[];
  cards?: CardUse[];
  incomes?: Incomes;
  answers?: SaidAnswer[];
  asOf?: string;
  opening?: number;
  closed?: ClosedMonth[];
}
const run = (month: string, rows: readonly TraceRow[], o: Setup = {}): Settlement => {
  const t = trace(rows, o.opening ?? 0, Math.min(...rows.map((r) => r.day)));
  return settlement(month, { key: POOL, trace: t, answers: o.answers ?? [], users: o.users ?? BOTH }, o.agreements ?? [equal()], new Set(o.members ?? [MATTI, MAIJA]), o.cards ?? [], o.incomes ?? new Map(), o.asOf ?? "2026-12-01", o.closed ?? []);
};
const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
/** The identity of every month, and that what was paid and what was owed are both the net cost. */
const identity = (s: Settlement): Settlement => {
  expect(sum(s.members.map((m) => m.over))).toBe(s.unknownOwed - s.unknownPaid);
  expect(sum(s.members.map((m) => m.paid)) + s.unknownPaid).toBe(s.netCost);
  expect(sum(s.members.map((m) => m.owed)) + s.unknownOwed).toBe(s.netCost);
  return s;
};
const of = (s: Settlement, owner: Owner): { paid: number; owed: number; over: number } => s.members.find((m) => m.owner === owner) ?? { paid: 0, owed: 0, over: 0 };

const deposit = (owner: Owner, date: string, cents: number, label = `in-${owner}`): TraceRow => row(label, date, cents, own(owner));

/** The worked case of September: both deposit, rent and a shop for all, a bill for Maija's card, a refund of the shop. */
function september(refundDate = "2026-09-15", refundExtra?: Partial<TraceRow>, refundCents = 4000): { rows: TraceRow[]; shop: TraceRow } {
  const shop = row("shop", "2026-09-10", -10000);
  return {
    shop,
    rows: [
      deposit(MATTI, "2026-09-01", 100000),
      deposit(MAIJA, "2026-09-02", 60000),
      row("rent", "2026-09-05", -80000),
      shop,
      row("card-bill", "2026-09-12", -12000, { to: { owner: MAIJA }, cardKey: CARD_MAIJA }),
      row("refund", refundDate, refundCents, refundExtra ?? refundOf(shop)),
    ],
  };
}
const MAIJA_CARD = [cardOf(CARD_MAIJA, MAIJA)];

describe("the worked case", () => {
  const s = identity(run("2026-09", september().rows, { cards: MAIJA_CARD }));

  it("pays and owes to the cent, and shows the card bill as Maija's whole", () => {
    expect(of(s, MATTI)).toMatchObject({ paid: 53750, owed: 43000, over: 10750 });
    expect(of(s, MAIJA)).toMatchObject({ paid: 44250, owed: 55000, over: -10750 });
    expect(s.unknownPaid).toBe(0);
    expect(s.unknownOwed).toBe(0);
    expect(s.netCost).toBe(98000);
    expect(s.status).toEqual({ open: false, closedOn: "2026-09-30", by: "resolved" });
    expect(s.agreements).toEqual([{ accountKey: POOL, validFrom: "2026-01-01" }]);
  });

  it("lists the lines by day: each cost, the bill, the refund netting the shop", () => {
    expect(s.lines.map((l) => [l.kind, l.cents, l.how])).toEqual([
      ["cost", 80000, "equal"],
      ["cost", 10000, "equal"],
      ["cost", 12000, "one"],
      ["refund", -4000, "equal"],
    ]);
    const bill = s.lines[2]!;
    expect(bill.owed).toEqual([{ owner: MAIJA, cents: 12000 }]);
    expect(bill.paid).toEqual([{ owner: MAIJA, cents: 12000 }]);
    expect(s.lines[3]!.paid).toEqual([
      { owner: MATTI, cents: -2500 },
      { owner: MAIJA, cents: -1500 },
    ]);
  });

  it("moves by 15,00 when the card is shared: the bill is then a cost for all, cut by the card's weights", () => {
    const rows = september().rows.map(({ to: _to, ...r }) => r as TraceRow);
    const shared = identity(run("2026-09", rows, { cards: [cardOf(CARD_MAIJA, MATTI, MAIJA)] }));
    expect(of(shared, MATTI)).toMatchObject({ paid: 61250, owed: 49000, over: 12250 });
    expect(shared.netCost).toBe(98000);
  });

  it("leaves a bill of a card that is not connected out, and keeps the month open", () => {
    const rows = september().rows.map(({ to: _to, ...r }) => r as TraceRow);
    const unknown = identity(run("2026-09", rows, { cards: [], asOf: "2026-10-05" }));
    expect(unknown.unknownHolder).toEqual([expect.objectContaining({ cents: 12000, cardKey: CARD_MAIJA })]);
    expect(unknown.status.open).toBe(true);
  });
});

describe("near misses", () => {
  it("1: the agreement of the row's day decides, and a fixed one from the 30th starts the 1st", () => {
    const rows = [deposit(MATTI, "2026-09-01", 100000), deposit(MAIJA, "2026-09-01", 100000), row("shop-29", "2026-09-29", -10000), row("shop-30", "2026-09-30", -10000)];
    const share = agree("2026-09-30", "share", { weights: { [MATTI]: 600, [MAIJA]: 400 } });
    const s = identity(run("2026-09", rows, { agreements: [equal(), share] }));
    expect(of(s, MATTI).owed).toBe(5000 + 6000);
    expect(of(s, MAIJA).owed).toBe(5000 + 4000);
    const fixed = agree("2026-09-30", "fixed", { cents: { [MAIJA]: 30000 } });
    const sep = identity(run("2026-09", rows, { agreements: [equal(), fixed] }));
    expect(sep.lines.every((l) => l.how === "equal")).toBe(true);
    expect(of(sep, MATTI).owed).toBe(10000);
    const oct = identity(run("2026-10", [...rows, row("shop-oct", "2026-10-05", -10000)], { agreements: [equal(), fixed] }));
    expect(oct.lines.map((l) => l.kind)).toEqual(["cost", "fixed"]);
    expect(oct.lines[1]!.fixed).toEqual({ fsum: 30000, c: 10000, r: 0 });
    expect(of(oct, MAIJA).owed).toBe(10000);
  });

  it("2: a refund from a third party is owed as its purchase's day says, not its own", () => {
    const shop = row("shop", "2026-09-29", -10000);
    const rows = [deposit(MATTI, "2026-09-01", 100000), deposit(MAIJA, "2026-09-01", 60000), shop, row("refund", "2026-10-02", 4000, refundOf(shop)), row("friend", "2026-10-03", 3000, { group: "g:text:friend" })];
    const share = agree("2026-10-01", "share", { weights: { [MATTI]: 600, [MAIJA]: 400 } });
    const oct = identity(run("2026-10", rows, { agreements: [equal(), share] }));
    expect(oct.lines.map((l) => l.kind)).toEqual(["refund"]);
    expect(oct.lines[0]!.owed).toEqual([
      { owner: MATTI, cents: -2000 },
      { owner: MAIJA, cents: -2000 },
    ]);
    expect(oct.lines[0]!.paid).toEqual([
      { owner: MATTI, cents: -2500 },
      { owner: MAIJA, cents: -1500 },
    ]);
    expect([of(oct, MATTI).over, of(oct, MAIJA).over]).toEqual([-500, 500]);
  });

  it("3: a refund the month after is carried by that month, and one beyond its purchase nets only the purchase", () => {
    const { rows } = september("2026-10-15");
    const sep = identity(run("2026-09", rows, { cards: MAIJA_CARD }));
    expect([of(sep, MATTI).over, of(sep, MAIJA).over]).toEqual([11250, -11250]);
    const oct = identity(run("2026-10", rows, { cards: MAIJA_CARD }));
    expect([of(oct, MATTI).over, of(oct, MAIJA).over]).toEqual([-500, 500]);
    expect(oct.lines[0]).toMatchObject({ kind: "refund", of: september().shop.key, cents: -4000 });
    const rows130 = september("2026-09-20", undefined, 13000).rows;
    const s = identity(run("2026-09", rows130, { cards: MAIJA_CARD }));
    expect(s.lines.find((l) => l.kind === "refund")!.cents).toBe(-10000);
    expect(s.netCost).toBe(80000 + 10000 + 12000 - 10000);
  });

  it("4: a member without a login holds the card; before she is named the bill is unknown and the month open", () => {
    const rows = [deposit(MATTI, "2026-09-01", 100000), deposit(MAIJA, "2026-09-02", 60000), row("bill", "2026-09-12", -12000, { to: { owner: LIISA }, cardKey: "card-liisa" })];
    const named = identity(run("2026-09", rows, { members: [MATTI, MAIJA, LIISA], cards: [cardOf("card-liisa", LIISA)] }));
    expect(of(named, MAIJA).over).toBe(12000);
    expect(of(named, LIISA).over).toBe(-12000);
    expect(of(named, MATTI).over).toBe(0);
    const before = identity(run("2026-09", rows.map((r) => ({ ...r, to: undefined })), { cards: [cardOf("card-liisa", "u:")], asOf: "2026-10-05" }));
    expect(before.unknownHolder).toHaveLength(1);
    expect(before.status.open).toBe(true);
    expect(before.lines).toEqual([]);
  });

  it("5: a card with no holder who can be told leaves the bill out of paid and owed alike", () => {
    const rows = [deposit(MATTI, "2026-09-01", 100000), row("bill", "2026-09-12", -12000, { cardKey: "card-x" }), row("shop", "2026-09-13", -10000)];
    const s = identity(run("2026-09", rows, { cards: [cardOf("card-x")] }));
    expect(s.unknownHolder).toEqual([{ key: rows[1]!.key, day: d("2026-09-12"), cents: 12000, cardKey: "card-x" }]);
    expect(s.netCost).toBe(10000);
    expect(sum(s.members.map((m) => m.over))).toBe(0);
  });

  it("6: a shared card is counted once, by the card's weights, never a unit of its own", () => {
    const rows = [deposit(MATTI, "2026-09-01", 100000), deposit(MAIJA, "2026-09-01", 100000), row("bill", "2026-09-12", -12000, { cardKey: "card-both" })];
    const s = identity(run("2026-09", rows, { cards: [cardOf("card-both", MATTI, MAIJA)] }));
    expect(s.netCost).toBe(12000);
    expect([of(s, MATTI).owed, of(s, MAIJA).owed]).toEqual([6000, 6000]);
    expect(s.lines[0]!.how).toBe("card");
  });

  const credit = (): { rows: TraceRow[]; cost: TraceRow } => {
    const cost = row("cost", "2026-09-03", -10001);
    return { cost, rows: [row("seed", "2026-09-01", 1, own(MATTI)), cost, row("refund", "2026-10-05", 4000, refundOf(cost)), row("deposit", "2026-10-10", 6000, own(MAIJA))] };
  };

  it("7: credit a later deposit paid lands in the month the deposit arrives, and September is not rewritten", () => {
    const { rows, cost } = credit();
    const sep = identity(run("2026-09", rows, { asOf: "2026-10-20" }));
    expect([of(sep, MATTI).over, of(sep, MAIJA).over, sep.unknownPaid, sep.unknownOwed]).toEqual([-5000, -5000, 10000, 0]);
    expect(of(sep, MATTI).owed).toBe(5001);
    const oct = identity(run("2026-10", rows, { asOf: "2026-10-20" }));
    expect([of(oct, MATTI).over, of(oct, MAIJA).over, oct.unknownPaid]).toEqual([2000, 8000, -10000]);
    expect(oct.lines.map((l) => l.kind)).toEqual(["refund", "credit_filled"]);
    expect(oct.lines[1]).toMatchObject({ of: cost.key, owed: [], paid: [{ owner: MAIJA, cents: 6000 }, { owner: "c", cents: -6000 }] });
    expect(of(sep, MATTI).over + of(oct, MATTI).over + of(sep, MAIJA).over + of(oct, MAIJA).over).toBe(0);
  });

  it("7: September is open while credit stands, closes when the credit is covered or after 90 days", () => {
    const { rows } = credit();
    expect(run("2026-09", rows, { asOf: "2026-09-20" }).status.open).toBe(true);
    expect(run("2026-09", rows, { asOf: "2026-10-01" }).status.open).toBe(true);
    expect(run("2026-09", rows, { asOf: "2026-10-09" }).status.open).toBe(true);
    expect(run("2026-09", rows, { asOf: "2026-10-20" }).status).toEqual({ open: false, closedOn: "2026-10-10", by: "resolved" });
    const alone = rows.slice(0, 2);
    expect(run("2026-09", alone, { asOf: "2026-12-28" }).status.open).toBe(true);
    expect(run("2026-09", alone, { asOf: "2027-01-15" }).status).toEqual({ open: false, closedOn: "2026-12-29", by: "time" });
    expect(identity(run("2026-09", alone, { asOf: "2027-01-15" })).unknownPaid).toBe(10000);
  });

  it("8: shop money back that is not paired is money in: it nets nothing", () => {
    const rows = september("2026-09-15", { from: "back" }).rows;
    const s = identity(run("2026-09", rows, { cards: MAIJA_CARD }));
    expect(s.netCost).toBe(102000);
    expect([of(s, MATTI).paid, of(s, MAIJA).paid]).toEqual([56250, 45750]);
    expect([of(s, MATTI).over, of(s, MAIJA).over]).toEqual([11250, -11250]);
    expect(s.lines.some((l) => l.kind === "refund")).toBe(false);
  });

  it("9: income with every weight 0 states no split and says so; an agreement that names nobody left falls back to the use", () => {
    const rows = [deposit(MATTI, "2026-09-01", 100000), deposit(MAIJA, "2026-09-01", 100000), row("shop", "2026-09-10", -10000)];
    const income = agree("2026-01-01", "income", { who: [MATTI, MAIJA] });
    const none = identity(run("2026-09", rows, { agreements: [income] }));
    expect(none.incomeMissing).toBe(true);
    // no equal split nobody stated (owner rule L5): the cost is owed by nobody known
    expect([of(none, MATTI).owed, of(none, MAIJA).owed]).toEqual([0, 0]);
    expect(none.unknownOwedBy).toEqual([{ owner: "s:", cents: 10000 }]);
    const incomes: Incomes = new Map([
      [MATTI, new Map(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map((m) => [m, 300000]))],
      [MAIJA, new Map(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].map((m) => [m, 100000]))],
    ]);
    const weighed = identity(run("2026-09", rows, { agreements: [income], incomes }));
    expect(weighed.incomeMissing).toBe(false);
    expect([of(weighed, MATTI).owed, of(weighed, MAIJA).owed]).toEqual([7500, 2500]);
    const gone = identity(run("2026-09", rows, { agreements: [agree("2026-01-01", "equal", { who: ["u:gone"] })] }));
    expect(gone.fellBack).toBe(true);
    expect([of(gone, MATTI).owed, of(gone, MAIJA).owed]).toEqual([5000, 5000]);
  });

  it("9: members without a login weigh 0 under income", () => {
    const rows = [deposit(MATTI, "2026-09-01", 100000), row("shop", "2026-09-10", -10000)];
    const users = [...BOTH, { owner: LIISA, weight: 1 }];
    const incomes: Incomes = new Map([[MATTI, new Map([["2026-08", 100000]])]]);
    const s = identity(run("2026-09", rows, { users, members: [MATTI, MAIJA, LIISA], agreements: [agree("2026-01-01", "income", { who: [MATTI, MAIJA, LIISA] })], incomes }));
    expect([of(s, MATTI).owed, of(s, MAIJA).owed, of(s, LIISA).owed]).toEqual([10000, 0, 0]);
  });

  it("10: unknown money used by a cost is unknown until it is answered, and an answer after the close lands in its own month", () => {
    const rows = [row("dep", "2026-09-01", 30000, { group: "g:text:acme" }), row("shop", "2026-09-10", -10000)];
    const open = identity(run("2026-09", rows, { asOf: "2026-10-20" }));
    expect(open.status.open).toBe(true);
    expect(open.unknownPaid).toBe(10000);
    const before: SaidAnswer = { kind: "in", key: "g:text:acme", owner: MATTI, saidOn: "2026-10-15" };
    const answered = identity(run("2026-09", rows, { asOf: "2026-10-20", answers: [before] }));
    expect(answered.unknownPaid).toBe(0);
    expect(answered.status).toEqual({ open: false, closedOn: "2026-10-15", by: "resolved" });
    expect([of(answered, MATTI).over, of(answered, MAIJA).over]).toEqual([5000, -5000]);
    // said after September closed (90 days after the 30th: 29.12.): September is as it was, January carries the answer
    const late: SaidAnswer = { kind: "in", key: "g:text:acme", owner: MATTI, saidOn: "2027-01-05" };
    const sep = identity(run("2026-09", rows, { asOf: "2027-01-15", answers: [late] }));
    expect(sep.status).toEqual({ open: false, closedOn: "2026-12-29", by: "time" });
    expect(sep.unknownPaid).toBe(10000);
    const jan = identity(run("2027-01", rows, { asOf: "2027-01-15", answers: [late] }));
    expect(jan.lines.map((l) => l.kind)).toEqual(["answered"]);
    expect([of(jan, MATTI).paid, of(jan, MATTI).over, jan.unknownPaid]).toEqual([10000, 10000, -10000]);
    const other = identity(run("2027-02", rows, { asOf: "2027-02-15", answers: [late] }));
    expect(other.lines).toEqual([]);
  });

  it("answers an 'all' with the pool's weights, and an 'opening' with the opening's money", () => {
    const rows = [row("dep", "2026-09-01", 30000, { group: "g:text:acme" }), row("shop", "2026-09-10", -10001)];
    const late: SaidAnswer = { kind: "in", key: "g:text:acme", owner: "all", saidOn: "2027-01-05" };
    const jan = identity(run("2027-01", rows, { asOf: "2027-01-15", answers: [late] }));
    expect(jan.lines[0]!.paid).toEqual([
      { owner: MATTI, cents: 5001 },
      { owner: MAIJA, cents: 5000 },
      { owner: "g:text:acme", cents: -10001 },
    ]);
    const opening = run("2026-09", [row("shop", "2026-09-10", -10000)], { opening: 20000, asOf: "2026-10-15", answers: [{ kind: "opening", key: "o", owner: MAIJA, saidOn: "2026-10-01" }] });
    expect(identity(opening).unknownPaid).toBe(0);
    expect(of(opening, MAIJA).paid).toBe(10000);
  });
});

describe("a month", () => {
  it("is open until it has ended, then closed at once when nothing is unknown", () => {
    const rows = [deposit(MATTI, "2026-09-01", 100000), row("shop", "2026-09-10", -10000)];
    expect(run("2026-09", rows, { asOf: "2026-09-29" }).status).toEqual({ open: true });
    // never on its own last day: rows of the 30th may still book on the 1st
    expect(run("2026-09", rows, { asOf: "2026-09-30" }).status).toEqual({ open: true });
    expect(run("2026-09", rows, { asOf: "2026-10-01" }).status).toEqual({ open: false, closedOn: "2026-09-30", by: "resolved" });
  });

  it("keeps a bill to another pool, money in and a pending row out of the costs", () => {
    const rows = [deposit(MATTI, "2026-09-01", 100000), row("move", "2026-09-04", -5000, { to: "pool" }), row("shop", "2026-09-10", -10000), row("wait", "2026-09-11", -7000, { pending: true })];
    const s = identity(run("2026-09", rows));
    expect(s.netCost).toBe(10000);
    expect(s.lines).toHaveLength(1);
    expect(of(s, MATTI)).toMatchObject({ paid: 10000, owed: 5000 });
  });

  it("holds open while a refund of one of its purchases is pending", () => {
    const shop = row("shop", "2026-09-10", -10000);
    const rows = [deposit(MATTI, "2026-09-01", 100000), shop, row("refund-wait", "2026-09-20", 4000, { ...refundOf(shop), pending: true })];
    expect(run("2026-09", rows, { asOf: "2026-10-15" }).status.open).toBe(true);
    expect(run("2026-09", rows.slice(0, 2), { asOf: "2026-10-15" }).status.open).toBe(false);
  });

  it("shows the money another pool owned by credit as unknown here, not a member's", () => {
    const rows = [row("dep", "2026-09-01", 30000, { group: "g:iban:fi00-other-pool" }), row("shop", "2026-09-10", -10000)];
    const s = identity(run("2026-09", rows));
    expect(s.unknownPaidBy).toEqual([{ owner: "g:iban:fi00-other-pool", cents: 10000 }]);
    expect(s.status.open).toBe(true);
  });
});

describe("a card by each rule of cardHolderOf", () => {
  const rows = [deposit(MATTI, "2026-09-01", 100000), deposit(MAIJA, "2026-09-01", 100000), row("bill", "2026-09-12", -10000, { cardKey: "card-z" })];
  it("1: an agreement on the card splits the bill, also in a month that is fixed for the pool", () => {
    const cardShare = agree("2026-01-01", "share", { weights: { [MATTI]: 700, [MAIJA]: 300 } }, "card-z");
    const fixed = agree("2026-01-01", "fixed", { cents: { [MAIJA]: 30000 } });
    const s = identity(run("2026-09", [...rows, row("shop", "2026-09-13", -20000)], { agreements: [fixed, cardShare], cards: [cardOf("card-z", MAIJA)] }));
    expect(s.lines.map((l) => [l.kind, l.how, l.owed.map((e) => e.cents)])).toEqual([
      ["cost", "share", [7000, 3000]],
      ["cost", "use", []],
      ["fixed", "fixed", [20000]],
    ]);
    expect(s.agreements).toContainEqual({ accountKey: "card-z", validFrom: "2026-01-01" });
  });
  it("2: one holder who uses the pool owns the whole bill, outside any agreement", () => {
    const s = identity(run("2026-09", rows, { cards: [cardOf("card-z", MAIJA)] }));
    expect([of(s, MATTI).owed, of(s, MAIJA).owed]).toEqual([0, 10000]);
  });
  it("2: a single holder who does not use the pool leaves it unknown", () => {
    const s = identity(run("2026-09", rows, { cards: [cardOf("card-z", LIISA)] }));
    expect(s.unknownHolder).toHaveLength(1);
  });
  it("3: two holders split it by their weights, those outside the pool left out", () => {
    const s = identity(run("2026-09", rows, { cards: [{ key: "card-z", users: [{ owner: MATTI, weight: 3 }, { owner: MAIJA, weight: 1 }, { owner: LIISA, weight: 4 }] }] }));
    expect([of(s, MATTI).owed, of(s, MAIJA).owed]).toEqual([7500, 2500]);
  });
  it("4: no holder, or only the one nobody names, is unknown", () => {
    for (const card of [cardOf("card-z"), cardOf("card-z", "u:")]) expect(identity(run("2026-09", rows, { cards: [card] })).unknownHolder).toHaveLength(1);
  });
});

describe("a fixed month", () => {
  const base = [deposit(MATTI, "2026-09-01", 200000), deposit(MAIJA, "2026-09-01", 200000)];
  const fixed = agree("2026-01-01", "fixed", { cents: { [MAIJA]: 30000 }, rest: { kind: "equal" } });
  const owed = (s: Settlement): [number, number] => [of(s, MATTI).owed, of(s, MAIJA).owed];

  it("C >= Fsum: the listed owe their cents, the rest is cut among the others", () => {
    const s = identity(run("2026-09", [...base, row("rent", "2026-09-05", -50000), row("shop", "2026-09-10", -10000)], { agreements: [fixed] }));
    expect(s.lines.at(-1)).toMatchObject({ kind: "fixed", cents: 60000, fixed: { fsum: 30000, c: 60000, r: 30000 } });
    expect(owed(s)).toEqual([30000, 30000]);
    // per-row lines carry paid only
    expect(s.lines.filter((l) => l.kind === "cost").every((l) => l.owed.length === 0)).toBe(true);
  });
  it("0 < C < Fsum: the listed owe C in proportion to their cents, the unlisted nothing", () => {
    const two = agree("2026-01-01", "fixed", { cents: { [MATTI]: 10000, [MAIJA]: 30000 } });
    const s = identity(run("2026-09", [...base, row("shop", "2026-09-10", -20000)], { agreements: [two] }));
    expect(owed(s)).toEqual([5000, 15000]);
    const one = identity(run("2026-09", [...base, row("shop", "2026-09-10", -20000)], { agreements: [fixed] }));
    expect(owed(one)).toEqual([0, 20000]);
  });
  it("C <= 0: no fixed amounts, the net cost is cut by rest among all (a refund of an earlier month's purchase)", () => {
    const shop = row("shop", "2026-08-10", -10000);
    const rows = [...base.map((r) => ({ ...r, day: r.day - 30, key: `${r.day - 30}|${r.cents}|${r.ids[0]}|00000` })), shop, row("refund", "2026-09-05", 10000, refundOf(shop))];
    const s = identity(run("2026-09", rows as TraceRow[], { agreements: [equal("2026-01-01"), agree("2026-09-01", "fixed", { cents: { [MAIJA]: 30000 }, rest: { kind: "equal" } })] }));
    expect(s.lines.map((l) => l.kind)).toEqual(["refund", "fixed"]);
    expect(s.lines[1]).toMatchObject({ cents: -10000, fixed: { fsum: 30000, c: -10000, r: -10000 } });
    expect(owed(s)).toEqual([-5000, -5000]);
    // near miss: a rest the row does not state is cut equally by nobody
    const unstated = identity(run("2026-09", rows as TraceRow[], { agreements: [equal("2026-01-01"), agree("2026-09-01", "fixed", { cents: { [MAIJA]: 30000 } })] }));
    expect(owed(unstated)).toEqual([0, 0]);
    expect(unstated.unknownOwedBy).toEqual([{ owner: "s:", cents: -10000 }]);
  });
  it("a refund arriving in a fixed month is part of its net cost", () => {
    const shop = row("shop", "2026-08-10", -10000);
    const rows = [...base.map((r) => ({ ...r, day: r.day - 30, key: `${r.day - 30}|${r.cents}|${r.ids[0]}|00000` })), shop, row("buy", "2026-09-04", -10000), row("refund", "2026-09-05", 4000, refundOf(shop))];
    const s = identity(run("2026-09", rows as TraceRow[], { agreements: [equal("2026-01-01"), agree("2026-09-01", "fixed", { cents: { [MAIJA]: 30000 } })] }));
    expect(s.lines.at(-1)).toMatchObject({ kind: "fixed", fixed: { c: 6000 } });
    expect(owed(s)).toEqual([0, 6000]);
  });
  it("a purchase of a fixed month refunded in a per-row month is cut by that agreement's rest weights", () => {
    const shop = row("shop", "2026-09-10", -10000);
    const rest = { kind: "share", weights: { [MATTI]: 700, [MAIJA]: 300 } };
    const agreements = [agree("2026-01-01", "fixed", { cents: { [MAIJA]: 30000 }, rest }), agree("2026-10-01", "equal", { who: [MATTI, MAIJA] })];
    const rows = [...base, shop, row("refund", "2026-10-05", 4000, refundOf(shop))];
    const oct = identity(run("2026-10", rows, { agreements }));
    expect(oct.lines[0]).toMatchObject({ kind: "refund", how: "fixed" });
    expect(owed(oct)).toEqual([-2800, -1200]);
  });
  it("leaves a person's own bill out of the net cost", () => {
    const s = identity(run("2026-09", [...base, row("bill", "2026-09-12", -10000, { to: { owner: MATTI }, cardKey: "card-m" }), row("shop", "2026-09-13", -10000)], { agreements: [fixed], cards: [cardOf("card-m", MATTI)] }));
    expect(s.lines.at(-1)).toMatchObject({ kind: "fixed", cents: 10000 });
    expect(owed(s)).toEqual([10000, 10000]);
  });
});

describe("generated months", () => {
  /** A small deterministic generator, so a failure names its seed. */
  const gen = (seed: number): (() => number) => {
    let x = seed;
    return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  };
  it("keeps sum(over) = unknownOwed - unknownPaid and sum(paid) + unknownPaid = net cost", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rnd = gen(seed);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
      const rows: TraceRow[] = [];
      const costs: TraceRow[] = [];
      const n = 6 + Math.floor(rnd() * 14);
      for (let i = 0; i < n; i++) {
        const date = `2026-${pick(["09", "10", "11"])}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`;
        const cents = 100 + Math.floor(rnd() * 40000);
        const kind = rnd();
        if (kind < 0.3) rows.push(row(`dep${i}`, date, cents, pick([own(MATTI), own(MAIJA), { group: "g:text:acme" }, { group: "u:" }])));
        else if (kind < 0.7) {
          const c = row(`cost${i}`, date, -cents);
          costs.push(c);
          rows.push(c);
        } else if (kind < 0.8) rows.push(row(`bill${i}`, date, -cents, { cardKey: pick(["card-a", "card-b", "card-c"]), ...(rnd() < 0.5 ? { to: { owner: MAIJA } } : {}) }));
        else if (kind < 0.9 && costs.length) rows.push(row(`refund${i}`, date, Math.floor(cents / 3) + 1, refundOf(pick(costs))));
        else rows.push(row(`back${i}`, date, cents, { from: "back" }));
      }
      const agreements: AgreementRow[] = [
        ...(rnd() < 0.5 ? [equal("2026-01-01")] : []),
        ...(rnd() < 0.5 ? [agree(`2026-${pick(["09", "10", "11"])}-${pick(["01", "15", "30"])}`, pick(["share", "income", "fixed"] as const), { who: [MATTI, MAIJA], weights: { [MATTI]: 3, [MAIJA]: 2 }, cents: { [MAIJA]: 5000 }, rest: { kind: pick(["equal", "share", "income"]), weights: { [MATTI]: 1 } } })] : []),
        ...(rnd() < 0.3 ? [agree("2026-09-15", "share", { weights: { [MATTI]: 1, [MAIJA]: 1 } }, "card-a")] : []),
      ];
      const answers: SaidAnswer[] = rnd() < 0.6 ? [{ kind: "in", key: "g:text:acme", owner: pick([MATTI, "all", MAIJA]), saidOn: pick(["2026-10-05", "2026-11-20", "2027-01-10"]) }] : [];
      const cards = [cardOf("card-a", MATTI, MAIJA), cardOf("card-b", MAIJA), cardOf("card-c")];
      for (const month of ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]) {
        for (const asOf of ["2026-10-10", "2027-01-20"]) {
          const s = run(month, rows, { agreements, answers, cards, asOf });
          try {
            identity(s);
          } catch (e) {
            throw new Error(`seed ${seed} ${month} asOf ${asOf}: ${(e as Error).message}`);
          }
        }
      }
    }
  });
});

describe("a closed month is frozen", () => {
  const rows = [row("dep", "2026-09-01", 30000, { group: "g:text:acme" }), row("shop", "2026-09-10", -10000)];
  const matti: SaidAnswer = { kind: "in", key: "g:text:acme", owner: MATTI, saidOn: "2026-10-15" };
  const maija: SaidAnswer = { kind: "in", key: "g:text:acme", owner: MAIJA, saidOn: "2026-11-20" };
  const snapshot = (month: string, o: Setup): ClosedMonth => {
    const s = run(month, rows, o);
    expect(s.status.open).toBe(false);
    return s as ClosedMonth;
  };

  it("keeps September as it closed when the answer is changed, and the difference lands in the next month without a snapshot", () => {
    const sep = snapshot("2026-09", { answers: [matti], asOf: "2026-10-20" });
    expect([of(sep, MATTI).over, of(sep, MAIJA).over, sep.status.closedOn]).toEqual([5000, -5000, "2026-10-15"]);
    const later: Setup = { answers: [maija], asOf: "2026-11-25", closed: [sep] };
    expect(run("2026-09", rows, later)).toBe(sep);
    const oct = identity(run("2026-10", rows, later));
    expect(oct.lines.map((l) => [l.kind, l.key])).toEqual([["late_change", "2026-09"]]);
    expect([of(oct, MATTI).over, of(oct, MAIJA).over]).toEqual([-10000, 10000]);
    // the answer is dated in November, and no month carries an 'answered' line for a month that is frozen
    const nov = identity(run("2026-11", rows, later));
    expect(nov.lines).toEqual([]);
    // October frozen with the line: the difference is not carried again
    const octFrozen = oct as ClosedMonth;
    expect(octFrozen.status.open).toBe(false);
    const dec = identity(run("2026-11", rows, { ...later, closed: [sep, octFrozen] }));
    expect(dec.lines).toEqual([]);
    expect(of(dec, MATTI).over).toBe(0);
  });

  it("never counts a late difference twice: a second change brings only its own delta, against the snapshot plus the lines already frozen", () => {
    const sep = snapshot("2026-09", { answers: [matti], asOf: "2026-10-20" });
    const first: Setup = { answers: [maija], asOf: "2026-11-25", closed: [sep] };
    const oct = identity(run("2026-10", rows, first));
    expect(oct.lines[0]).toMatchObject({ kind: "late_change", key: "2026-09", paid: [{ owner: MATTI, cents: -10000 }, { owner: MAIJA, cents: 10000 }] });
    const everyone: SaidAnswer = { kind: "in", key: "g:text:acme", owner: "all", saidOn: "2026-12-10" };
    const second: Setup = { answers: [everyone], asOf: "2026-12-15", closed: [sep, oct as ClosedMonth] };
    const nov = identity(run("2026-11", rows, second));
    expect(nov.lines).toHaveLength(1);
    expect(nov.lines[0]).toMatchObject({ kind: "late_change", key: "2026-09", cents: 0, paid: [{ owner: MATTI, cents: 5000 }, { owner: MAIJA, cents: -5000 }], owed: [] });
    expect([of(nov, MATTI).over, of(nov, MAIJA).over]).toEqual([5000, -5000]);
    // the three together: September as it closed, October's d1, November's d2 = what the last answer says
    expect(of(sep, MATTI).over + of(oct, MATTI).over + of(nov, MATTI).over).toBe(0);
    expect(of(sep, MAIJA).over + of(oct, MAIJA).over + of(nov, MAIJA).over).toBe(0);
  });

  it("does not reopen September when Maija leaves; the difference lands in the next month", () => {
    const shops = [deposit(MATTI, "2026-09-01", 100000), deposit(MAIJA, "2026-09-01", 100000), row("s1", "2026-09-10", -10000), row("s2", "2026-09-11", -10000)];
    const sep = run("2026-09", shops, { asOf: "2026-10-05" });
    expect(sep.status.open).toBe(false);
    const gone: Setup = { members: [MATTI], users: [{ owner: MATTI, weight: 1 }], agreements: [agree("2026-01-01", "equal", { who: [MATTI, MAIJA] })], asOf: "2026-11-10", closed: [sep as ClosedMonth] };
    const still = run("2026-09", shops, gone);
    expect(still.status).toEqual(sep.status);
    expect([of(still, MATTI).over, of(still, MAIJA).over]).toEqual([0, 0]);
    const oct = identity(run("2026-10", shops, gone));
    expect(oct.lines.map((l) => l.kind)).toEqual(["late_change"]);
    expect(of(oct, MATTI).over).toBe(-10000);
    expect(oct.unknownOwed).toBe(-10000);
  });

  it("carries nothing when nothing changed", () => {
    const sep = snapshot("2026-09", { answers: [matti], asOf: "2026-10-20" });
    expect(identity(run("2026-10", rows, { answers: [matti], asOf: "2026-10-25", closed: [sep] })).lines).toEqual([]);
  });
});

describe("a card agreement", () => {
  const bill = row("bill", "2026-09-12", -12000, { cardKey: CARD_MAIJA });
  const rows = [deposit(MATTI, "2026-09-01", 100000), deposit(MAIJA, "2026-09-01", 100000), bill];

  it("that names nobody left falls back to the card's own use, not the pool's", () => {
    const s = identity(run("2026-09", rows, { cards: MAIJA_CARD, agreements: [equal(), agree("2026-01-01", "equal", { who: ["u:9"] }, CARD_MAIJA)] }));
    expect([of(s, MATTI).owed, of(s, MAIJA).owed]).toEqual([0, 12000]);
    expect(s.fellBack).toBe(true);
  });

  it("is never of kind fixed: the trace's rule and the settlement's read it the same way", () => {
    const fixed = agree("2026-01-01", "fixed", { cents: { [MAIJA]: 30000 } }, CARD_MAIJA);
    const card = cardOf(CARD_MAIJA, MAIJA);
    expect(cardHolderOf(card, d("2026-09-12"), new Set([MATTI, MAIJA]), [fixed])).toMatchObject({ rule: 2, owner: MAIJA });
    expect(cardHolderOf(card, d("2026-09-12"), new Set([MATTI, MAIJA]), [{ ...fixed, kind: "share" }])).toMatchObject({ rule: 1 });
    const s = identity(run("2026-09", rows, { cards: [card], agreements: [equal(), fixed] }));
    expect([of(s, MATTI).owed, of(s, MAIJA).owed]).toEqual([0, 12000]);
  });

  it("is refused on write as fixed, or naming nobody of the pool", () => {
    expect(agreementRefusal(agree("2026-01-01", "fixed", { cents: { [MAIJA]: 100 } }, CARD_MAIJA), true, [MATTI, MAIJA])).toBe("fixed_on_card");
    expect(agreementRefusal(agree("2026-01-01", "fixed", { cents: { [MAIJA]: 100 } }), false, [MATTI, MAIJA])).toBe(null);
    expect(agreementRefusal(agree("2026-01-01", "share", { weights: { [MAIJA]: 1 } }, CARD_MAIJA), true, [MATTI, MAIJA])).toBe(null);
    expect(agreementRefusal(agree("2026-01-01", "equal", { who: ["u:9"] }), false, [MATTI, MAIJA])).toBe("no_user");
    expect(agreementRefusal(agree("2026-01-01", "income", { who: [] }), false, [MATTI])).toBe("no_user");
  });
});

describe("the holder with no login", () => {
  const OTHER = "u:";
  const rows = [deposit(MATTI, "2026-09-01", 100_000), deposit(OTHER, "2026-09-01", 100_000), row("food", "2026-09-10", -40_000), row("power", "2026-09-20", -12_000)];
  const pool = (weights: [number, number], agreements: AgreementRow[] = []) => run("2026-09", rows, { members: [MATTI], users: [{ owner: MATTI, weight: weights[0] }, { owner: OTHER, weight: weights[1] }], agreements });

  it("is a party with a paid and an owed where two holders split equally, whatever way the equal split is said", () => {
    for (const agreements of [[], [agree("2026-01-01", "equal", { who: [MATTI, OTHER] })]]) {
      const s = identity(pool([1, 1], agreements));
      expect([of(s, MATTI), of(s, OTHER)].map((m) => [m.paid, m.owed])).toEqual([[26_000, 26_000], [26_000, 26_000]]);
      expect([s.unknownOwed, s.unknownPaid, s.unknownOwedBy, s.unknownPaidBy]).toEqual([0, 0, [], []]);
    }
  });

  it("stays unknown, in one entry, where the split is not equal", () => {
    for (const s of [pool([2, 1]), pool([1, 1], [agree("2026-01-01", "share", { weights: { [MATTI]: 3, [OTHER]: 1 } })]), pool([1, 1], [agree("2026-01-01", "fixed", { cents: { [MATTI]: 10_000 }, rest: { kind: "equal" } })])]) {
      identity(s);
      expect(s.members.map((m) => m.owner)).toEqual([MATTI]);
      expect(s.unknownOwedBy.map((e) => e.owner)).toEqual([OTHER]);
    }
  });

  it("stays unknown where three share the account, or the other holder has a login", () => {
    const three = run("2026-09", rows, { members: [MATTI, MAIJA], users: [{ owner: MATTI, weight: 1 }, { owner: MAIJA, weight: 1 }, { owner: OTHER, weight: 1 }], agreements: [] });
    expect(identity(three).unknownOwedBy.map((e) => e.owner)).toEqual([OTHER]);
    const both = identity(run("2026-09", rows, { members: [MATTI, MAIJA], users: BOTH, agreements: [] }));
    expect(both.members.map((m) => m.owner)).toEqual([MATTI, MAIJA]);
  });
});
