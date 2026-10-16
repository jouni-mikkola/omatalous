/**
 * What the money trace tells a settlement between partners: the cents a row had on credit on its own day, what a
 * deposit paid of earlier credit, the card a bill went to, a member without a login as an owner, and whose a card's
 * bill is. Made-up names and sums.
 */
import { describe, expect, it } from "vitest";
import { type CardBook, type CardUse, cardHolderOf } from "../src/card-holder.ts";
import { dayNumber as d } from "../src/dates.ts";
import { type Answer, settle } from "../src/money-trace-answers.ts";
import { joinCopies, type Payers, traceRows } from "../src/money-trace-rows.ts";
import { compareOwners, isUserOwner, type RowParts, type Trace, type TraceRow, trace } from "../src/money-trace.ts";
import { nameOf } from "../src/person-names.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

type Agreement = CardBook["agreements"][number];
const MATTI = "u:u-matti";
const MAIJA = "u:u-maija";
const LIISA = "m:m-liisa";

const row = (label: string, date: string, cents: number, extra: Partial<TraceRow> = {}): TraceRow => {
  const day = d(date);
  return { key: `${day}|${cents}|${label}|00000`, ids: [label], day, cents, ...extra };
};
const own = (owner: string): Partial<TraceRow> => ({ from: { owner, kind: "own" } });
const run = (rows: readonly TraceRow[], opening = 0): Trace => trace(rows, opening, Math.min(...rows.map((r) => r.day)));
const rowOf = (t: Trace, label: string): RowParts => t.rows.find((r) => r.ids[0] === label)!;

describe("onCredit and fills", () => {
  const funded = row("seed", "2025-09-01", 1, own(MATTI));
  const cost = row("cost", "2025-09-03", -10001);

  it("keeps the cents that were on credit on the day, whatever a later deposit paid of them", () => {
    const alone = run([funded, cost]);
    expect(rowOf(alone, "cost").onCredit).toBe(10000);
    const later = run([funded, cost, row("deposit", "2025-10-10", 6000, own(MAIJA))]);
    // the deposit rewrites the parts of the cost, not what was on credit that day
    expect(rowOf(later, "cost").parts.find((p) => p.owner === "c")?.cents).toBe(4000);
    expect(rowOf(later, "cost").parts.find((p) => p.owner === MAIJA)?.cents).toBe(6000);
    expect(rowOf(later, "cost").onCredit).toBe(10000);
  });

  it("has no onCredit on a cost the money covered, and none on money in", () => {
    const t = run([row("seed", "2025-09-01", 20000, own(MATTI)), row("cost", "2025-09-03", -10001), row("refund-less", "2025-09-04", 500, own(MAIJA))]);
    expect(rowOf(t, "cost")).not.toHaveProperty("onCredit");
    expect(rowOf(t, "seed")).not.toHaveProperty("onCredit");
    expect(rowOf(t, "refund-less")).not.toHaveProperty("fills");
  });

  it("names the credit rows a deposit paid, by payer, the oldest row first", () => {
    const c1 = row("c1", "2025-09-02", -5000);
    const c2 = row("c2", "2025-09-03", -3000);
    const deposit = row("deposit", "2025-09-10", 6000, { from: { parts: [{ owner: MATTI, kind: "payment", cents: 4000 }, { owner: MAIJA, kind: "payment", cents: 2000 }] } });
    const t = run([c1, c2, deposit]);
    expect(rowOf(t, "deposit").fills).toEqual([
      { key: c1.key, owner: MAIJA, cents: 2000 },
      { key: c1.key, owner: MATTI, cents: 3000 },
      { key: c2.key, owner: MATTI, cents: 1000 },
    ]);
    expect(rowOf(t, "c1").onCredit).toBe(5000);
    expect(rowOf(t, "c2").onCredit).toBe(3000);
  });

  it("does not name a row for credit that was there before the history, and stops at what the deposit has", () => {
    const t = run([row("deposit", "2025-09-10", 5000, own(MATTI)), row("cost", "2025-09-11", -9000)], -3000);
    expect(rowOf(t, "deposit")).not.toHaveProperty("fills");
    // 2000 left of the deposit covers 2000 of the cost; the other 7000 is on credit
    expect(rowOf(t, "cost").onCredit).toBe(7000);
    const next = run([row("deposit", "2025-09-10", 5000, own(MATTI)), row("cost", "2025-09-11", -9000), row("more", "2025-09-12", 1000, own(MAIJA))], -3000);
    expect(rowOf(next, "more").fills).toEqual([{ key: row("cost", "2025-09-11", -9000).key, owner: MAIJA, cents: 1000 }]);
  });

  it("gives a fill the owner an answer names, as the parts of the row have it", () => {
    const group = "g:text:ESIMERKKI OY";
    const c1 = row("c1", "2025-09-02", -5000);
    const t = run([c1, row("deposit", "2025-09-10", 5000, { group })]);
    expect(rowOf(t, "deposit").fills).toEqual([{ key: c1.key, owner: group, cents: 5000 }]);
    const answers: Answer[] = [{ kind: "in", key: group, owner: MAIJA }];
    const settled = settle(t, answers, [{ owner: MATTI, weight: 1 }, { owner: MAIJA, weight: 1 }]);
    expect(rowOf(settled, "deposit").fills).toEqual([{ key: c1.key, owner: MAIJA, cents: 5000 }]);
    const both = settle(t, [{ kind: "in", key: group, owner: "all" }], [{ owner: MATTI, weight: 1 }, { owner: MAIJA, weight: 1 }]);
    expect(rowOf(both, "deposit").fills).toEqual([{ key: c1.key, owner: MAIJA, cents: 2500 }, { key: c1.key, owner: MATTI, cents: 2500 }]);
  });
});

describe("a member without a login as an owner", () => {
  it("is a user owner wherever a member is, and ranks with the members", () => {
    expect(isUserOwner(LIISA)).toBe(true);
    expect(isUserOwner(MATTI)).toBe(true);
    expect(isUserOwner("u:")).toBe(true);
    expect(isUserOwner("g:text:x")).toBe(false);
    expect(isUserOwner("o")).toBe(false);
    const sorted = ["c", "o", "g:text:x", "u:", LIISA, MATTI].sort(compareOwners);
    expect(sorted).toEqual([LIISA, MATTI, "u:", "g:text:x", "o", "c"]);
  });

  it("makes a row for one person take another's money as passed, like a member's", () => {
    const t = run([row("a", "2025-09-01", 1000, own(MATTI)), row("b", "2025-09-02", 5000, own(LIISA)), row("bill", "2025-09-03", -3000, { to: { owner: MATTI } })]);
    const parts = rowOf(t, "bill").parts;
    expect(parts.find((p) => p.owner === MATTI)).toEqual({ owner: MATTI, kind: "own", cents: 1000 });
    expect(parts.find((p) => p.owner === LIISA)).toEqual({ owner: LIISA, kind: "own", cents: 2000, passed: true });
    // a group's money taken the same way is not passed
    const g = run([row("a", "2025-09-01", 1000, own(MATTI)), row("b", "2025-09-02", 5000, { group: "g:text:x" }), row("bill", "2025-09-03", -3000, { to: { owner: MATTI } })]);
    expect(rowOf(g, "bill").parts.some((p) => p.passed)).toBe(false);
  });

  it("carries the part of another pool that is a member's, and calls the rest of that pool's money unknown", () => {
    const POOL_X = "FI0000000041";
    const pools: Account[] = [
      { id: "pool-a", name: "a", iban: "FI0000000011", currency: "EUR", type: "checking" },
      { id: "pool-x", name: "x", iban: POOL_X, currency: "EUR", type: "checking" },
    ];
    const out = tx({ id: "o1", accountId: "pool-x", bookingDate: "2025-09-05", amountCents: -4000, counterpartyIban: "FI0000000011" });
    const into = tx({ id: "i1", accountId: "pool-a", bookingDate: "2025-09-05", amountCents: 4000, counterpartyIban: POOL_X });
    const rows = traceRows(joinCopies([{ accountId: "pool-a", rows: [into] }]), {
      accounts: pools,
      others: [out],
      alone: new Map(),
      pools: new Set(["FI0000000011", POOL_X]),
      names: [],
      legParts: () => [{ owner: LIISA, kind: "own", cents: 1500 }, { owner: "o", kind: "opening", cents: 2500 }],
    });
    expect(rows[0]!.from).toEqual({ parts: [{ owner: LIISA, kind: "pool", cents: 1500 }, { owner: `g:iban:${POOL_X}`, kind: "pool", cents: 2500 }] });
  });
});

describe("cardHolderOf", () => {
  const members = new Set([MATTI, MAIJA, LIISA]);
  const card = (...users: [string, number][]): CardUse => ({ key: "card-1", users: users.map(([owner, weight]) => ({ owner, weight })) });
  const day = d("2025-09-12");
  const agreement = (over: Partial<Agreement> = {}): Agreement => ({ accountKey: "card-1", validFrom: "2025-09-01", ...over });

  it("1: an agreement on the card valid on the bill day makes the bill a shared cost", () => {
    expect(cardHolderOf(card([MATTI, 1]), day, members, [agreement()])).toEqual({ rule: 1, kind: "agreement" });
    expect(cardHolderOf(card([MATTI, 1]), day, members, [agreement({ validFrom: "2025-09-12" })])).toEqual({ rule: 1, kind: "agreement" });
    // near misses: dated the day after, or on another account
    expect(cardHolderOf(card([MATTI, 1]), day, members, [agreement({ validFrom: "2025-09-13" })])).toEqual({ rule: 2, kind: "one", owner: MATTI });
    expect(cardHolderOf(card([MATTI, 1]), day, members, [agreement({ accountKey: "card-2" })])).toEqual({ rule: 2, kind: "one", owner: MATTI });
    // even a card nobody is known to use
    expect(cardHolderOf(card(), day, members, [agreement()])).toEqual({ rule: 1, kind: "agreement" });
  });

  it("2: exactly one weighted user who uses the pool owns the bill, a member without a login too", () => {
    expect(cardHolderOf(card([MATTI, 1]), day, members)).toEqual({ rule: 2, kind: "one", owner: MATTI });
    expect(cardHolderOf(card([LIISA, 1]), day, members)).toEqual({ rule: 2, kind: "one", owner: LIISA });
    // a user of weight 0 is no user of the card
    expect(cardHolderOf(card([MAIJA, 1], [MATTI, 0]), day, members)).toEqual({ rule: 2, kind: "one", owner: MAIJA });
    // near miss: two weighted users is rule 3
    expect(cardHolderOf(card([MAIJA, 1], [MATTI, 1]), day, members).rule).toBe(3);
  });

  it("3: two or more weighted users share the bill by their weights, those who do not use the pool left out", () => {
    expect(cardHolderOf(card([MATTI, 1], [MAIJA, 3]), day, members)).toEqual({
      rule: 3,
      kind: "shared",
      weights: [{ owner: MAIJA, weight: 3 }, { owner: MATTI, weight: 1 }],
    });
    expect(cardHolderOf(card([MATTI, 1], ["u:u-ulla", 1]), day, members)).toEqual({ rule: 3, kind: "shared", weights: [{ owner: MATTI, weight: 1 }] });
    // near miss: none of them uses the pool
    expect(cardHolderOf(card(["u:u-ulla", 1], ["u:u-urho", 1]), day, members)).toEqual({ rule: 4, kind: "unknown" });
  });

  it("4: no weighted user, only the holder nobody names, or a user outside the pool is unknown", () => {
    expect(cardHolderOf(card(), day, members)).toEqual({ rule: 4, kind: "unknown" });
    expect(cardHolderOf(card([MATTI, 0]), day, members)).toEqual({ rule: 4, kind: "unknown" });
    expect(cardHolderOf(card(["u:", 1]), day, members)).toEqual({ rule: 4, kind: "unknown" });
    expect(cardHolderOf(card(["u:u-ulla", 1]), day, members)).toEqual({ rule: 4, kind: "unknown" });
    // near miss: the holder nobody names beside a member is a card of two users, shared among those who use the pool
    expect(cardHolderOf(card(["u:", 1], [MATTI, 1]), day, members)).toEqual({ rule: 3, kind: "shared", weights: [{ owner: MATTI, weight: 1 }] });
  });
});

describe("the card of a bill in the rows", () => {
  const POOL = "FI0000000011";
  const accounts: Account[] = [
    { id: "pool-a", name: "pool", iban: POOL, currency: "EUR", type: "checking" },
    { id: "matti-card", name: "card", iban: null, currency: "EUR", type: "credit_card" },
    { id: "joint-card", name: "card", iban: null, currency: "EUR", type: "credit_card" },
  ];
  const cards = (agreements: Agreement[] = []): CardBook => ({
    byAccount: new Map<string, CardUse>([
      ["matti-card", { key: "key-matti", users: [{ owner: MATTI, weight: 1 }] }],
      ["joint-card", { key: "key-joint", users: [{ owner: MATTI, weight: 1 }, { owner: MAIJA, weight: 1 }] }],
    ]),
    members: new Set([MATTI, MAIJA]),
    agreements,
  });
  const who = (book: CardBook | undefined): Payers => ({ accounts, others: [], alone: new Map(), pools: new Set([POOL]), names: [{ owner: MATTI, name: nameOf("MEIKALAINEN MATTI") }], ...(book ? { cards: book } : {}) });
  const bill = (cents: number, date = "2025-09-12"): Transaction => tx({ id: "b", accountId: "pool-a", bookingDate: date, amountCents: -cents, counterparty: "ESIMERKKI PANKKI" });
  const leg = (accountId: string, cents: number, date = "2025-09-12"): Transaction => tx({ id: "l", accountId, bookingDate: date, amountCents: cents, counterparty: "ESIMERKKI PANKKI" });
  const read = (payers: Payers, ...others: Transaction[]) => traceRows(joinCopies([{ accountId: "pool-a", rows: [bill(12000)] }]), { ...payers, others })[0]!;

  it("names the card the bill went to, and the person only when the card is one person's", () => {
    const one = read(who(cards()), leg("matti-card", 12000));
    expect(one.to).toEqual({ owner: MATTI });
    expect(one.cardKey).toBe("key-matti");
    const joint = read(who(cards()), leg("joint-card", 12000));
    expect(joint.to).toBeUndefined();
    expect(joint.cardKey).toBe("key-joint");
  });

  it("leaves the bill for all, with the card named, when an agreement on the card is valid that day", () => {
    const agreed = read(who(cards([{ accountKey: "key-matti", validFrom: "2025-09-12" }])), leg("matti-card", 12000));
    expect(agreed.to).toBeUndefined();
    expect(agreed.cardKey).toBe("key-matti");
    // near miss: it starts the next day
    expect(read(who(cards([{ accountKey: "key-matti", validFrom: "2025-09-13" }])), leg("matti-card", 12000)).to).toEqual({ owner: MATTI });
  });

  it("has no card on a bill with no leg on a card account, nor on money in", () => {
    expect(read(who(cards()))).not.toHaveProperty("cardKey");
    expect(read(who(cards()), leg("matti-card", 12000, "2025-09-20"))).not.toHaveProperty("cardKey");
    expect(read(who(undefined), leg("matti-card", 12000))).not.toHaveProperty("cardKey");
    const deposit = tx({ id: "in", accountId: "pool-a", bookingDate: "2025-09-12", amountCents: 12000 });
    expect(traceRows(joinCopies([{ accountId: "pool-a", rows: [deposit] }]), { ...who(cards()), others: [] })[0]).not.toHaveProperty("cardKey");
  });

  it("reaches the trace's rows", () => {
    const rows = traceRows(joinCopies([{ accountId: "pool-a", rows: [bill(12000)] }]), { ...who(cards()), others: [leg("joint-card", 12000)] });
    const t = trace(rows, 50000, rows[0]!.day);
    expect(t.rows[0]!.cardKey).toBe("key-joint");
    expect(t.rows[0]!.what).toBe("all");
  });
});
