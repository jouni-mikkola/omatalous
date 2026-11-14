import { describe, expect, it } from "vitest";
import { dayNumber } from "../src/dates.ts";
import { normalizeIban } from "../src/iban.ts";
import type { TraceRow } from "../src/money-trace-lots.ts";
import {
  type Allocation,
  cardLegAllocations,
  cardLegOf,
  householdAllocations,
  incomingLegAllocations,
  incomingLegFinder,
  legAccountsOf,
  loanPaymentAllocations,
  loanPaymentLeg,
  moveAllocations,
  movesOf,
  pairsOf,
  poolLegAllocations,
  poolLegFinder,
  transferAllocations,
} from "../src/pairing.ts";
import type { Account, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { cardLegOf as cardLegOfBefore, householdLegsReference, incomingLegFinder as incomingLegFinderBefore, loanPaymentLeg as loanPaymentLegBefore, pairMoves as pairMovesBefore, pairTransfers as pairTransfersBefore, poolLegFinder as poolLegFinderBefore } from "./pairing-reference.ts";

const accounts: Account[] = [
  { id: "a", name: "Käyttötili", iban: "FI0000000000000001", currency: "EUR", type: "checking" },
  { id: "b", name: "Säästötili", iban: "FI0000000000000002", currency: "EUR", type: "savings" },
];

describe("transferAllocations", () => {
  it("gives each leg of a pair one allocation that holds its whole amount and names the other leg", () => {
    const out = tx({ accountId: "a", bookingDate: "2025-03-03", amountCents: -25000 });
    const inc = tx({ accountId: "b", bookingDate: "2025-03-04", amountCents: 25000 });
    const lone = tx({ accountId: "a", bookingDate: "2025-03-05", amountCents: -999 });
    const { allocations } = transferAllocations([out, inc, lone], accounts);
    expect([...pairsOf(allocations, [out, inc, lone])]).toEqual([[out.id, inc.id]]);
    expect(allocations.get(out.id)).toEqual([{ partnerId: inc.id, cents: 25000, partnerCents: 25000, link: "amount-day", tier: "decided" }]);
    expect(allocations.get(inc.id)).toEqual([{ partnerId: out.id, cents: 25000, partnerCents: 25000, link: "amount-day", tier: "decided" }]);
    expect(allocations.has(lone.id)).toBe(false);
  });

  it("keeps conservation and reciprocity: the parts of a leg add up to its amount and the partner holds the mirror", () => {
    const rows = [];
    for (let i = 0; i < 6; i++) {
      rows.push(tx({ accountId: "a", bookingDate: `2025-04-0${i + 1}`, amountCents: -(1000 + i) }));
      rows.push(tx({ accountId: "b", bookingDate: `2025-04-0${i + 1}`, amountCents: 1000 + i }));
    }
    const { allocations } = transferAllocations(rows, accounts);
    expect(allocations.size).toBe(rows.length);
    expectConserved(rows, allocations);
  });
});

/** The parts of a leg add up to its amount, and the partner's part is the mirror. */
function expectConserved(rows: readonly Transaction[], allocations: ReadonlyMap<string, readonly Allocation[]>): void {
  const amountOf = new Map(rows.map((r) => [r.id, r.amountCents]));
  for (const [id, parts] of allocations) {
    expect(parts.reduce((s, p) => s + p.cents, 0)).toBe(Math.abs(amountOf.get(id)!));
    for (const p of parts) {
      const back = allocations.get(p.partnerId)!.find((q) => q.partnerId === id)!;
      expect([back.cents, back.partnerCents]).toEqual([p.partnerCents, p.cents]);
    }
  }
}

// An invented household of two members over a month with an Easter in it (Good Friday 2025-04-18 and Easter Monday
// 2025-04-21 are closed). It mixes what the variants tell apart: ties, the closed days, an outside IBAN, a row the user
// set, a leg named by IBAN, a card paid by another member, a loan payment, a pending row and a sum without a partner.
const FIXTURE_ACCOUNTS: Account[] = [
  { id: "a1", name: "Käyttö 1", iban: "FI0000000000000001", currency: "EUR", type: "checking" },
  { id: "a2", name: "Säästö 1", iban: "FI0000000000000002", currency: "EUR", type: "savings" },
  { id: "a3", name: "Käyttö 2", iban: "FI0000000000000003", currency: "EUR", type: "checking" },
  { id: "c1", name: "Kortti 1", iban: null, currency: "EUR", type: "credit_card" },
  { id: "l1", name: "Laina 1", iban: "FI0000000000000005", currency: "EUR", type: "loan", balanceCents: -5000000 },
];
const OWNER = new Map([
  ["a1", "m1"],
  ["a2", "m1"],
  ["c1", "m1"],
  ["l1", "m1"],
  ["a3", "m2"],
]);
const ownerOf = (accountId: string) => OWNER.get(accountId) ?? "";
const OUTSIDE = "FI0000000000000099";

const row = (id: string, accountId: string, bookingDate: string, amountCents: number, extra: Partial<Transaction> = {}): Transaction => tx({ id, accountId, bookingDate, amountCents, ...extra });

const MIXED: Transaction[] = [
  // a plain pair, and a pair whose out names the savings account
  row("p1o", "a1", "2025-04-01", -25000),
  row("p1i", "a2", "2025-04-02", 25000),
  row("p2o", "a1", "2025-04-03", -5000, { counterpartyIban: "FI00 0000 0000 0000 02" }),
  row("p2i", "a2", "2025-04-03", 5000),
  // a tie: the nearest day first, then the leg that came first
  row("t1o", "a1", "2025-04-05", -1000),
  row("t1a", "a3", "2025-04-06", 1000),
  row("t1b", "a2", "2025-04-04", 1000),
  // closed days between the legs do not count; one day further than the window does
  row("e1o", "a1", "2025-04-16", -7000),
  row("e1i", "a2", "2025-04-22", 7000),
  row("w1o", "a1", "2025-04-01", -8000),
  row("w1i", "a2", "2025-04-10", 8000),
  // money to and from an outside account is someone else's
  row("x1o", "a1", "2025-04-08", -3000, { counterpartyIban: OUTSIDE }),
  row("x1i", "a3", "2025-04-08", 3000),
  // a row the user set is nobody's leg
  row("u1o", "a1", "2025-04-09", -2000, { categorySource: "user", category: "groceries" }),
  row("u1i", "a2", "2025-04-09", 2000),
  // a purchase is not a leg
  row("g1", "a1", "2025-04-09", -4100, { categorySource: "rule", category: "groceries" }),
  row("g1i", "a2", "2025-04-09", 4100),
  // a card paid from the checking account, the card's own purchase of the same sum a day or two before a payment into another account
  row("c1i", "c1", "2025-04-08", 12000),
  row("c1o", "a1", "2025-04-07", -12000),
  row("k1", "c1", "2025-04-09", -4500, { categorySource: "mcc", category: "groceries" }),
  row("k1i", "a2", "2025-04-11", 4500),
  // a loan payment: the leg that left the money, the named account first
  row("l1i", "l1", "2025-04-12", 60000, { counterpartyIban: "FI0000000000000002" }),
  row("l1a", "a1", "2025-04-11", -60000),
  row("l1b", "a2", "2025-04-12", -60000),
  // the member's own pairs, stored as transfers
  row("s1o", "a1", "2025-04-02", -30000, { categorySource: "transfer", category: "transfer", isTransfer: true }),
  row("s1i", "a2", "2025-04-02", 30000, { categorySource: "transfer", category: "transfer", isTransfer: true }),
  // across the members: out of one member's account into the other's
  row("m1o", "a1", "2025-04-03", -15000),
  row("m1i", "a3", "2025-04-04", 15000),
  // money into the card that its member's rows do not explain, and another member's payment of that sum
  row("r1i", "c1", "2025-04-05", 9000, { categorySource: "transfer", category: "transfer", isTransfer: true }),
  row("r1o", "a3", "2025-04-04", -9000),
  // a pending row and a sum without a partner
  row("n1o", "a3", "2025-04-20", -6500, { status: "pending" }),
  row("n1i", "a2", "2025-04-20", 6500, { status: "pending" }),
  row("z1", "a1", "2025-04-14", -999),
];

/** Entries of a map in the order of their keys, for maps that are compared as sets. */
const sorted = <V>(m: ReadonlyMap<string, V>): [string, V][] => [...m].sort(([a], [b]) => (a < b ? -1 : 1));

describe("old and new pairing agree on a mixed input", () => {
  it("transfers: the pairs and the transfer rows are those of before, with and without an excluded row", () => {
    for (const exclude of [undefined, new Set(["t1b"])]) {
      const before = pairTransfersBefore(MIXED, FIXTURE_ACCOUNTS, exclude);
      const { transfers, allocations } = transferAllocations(MIXED, FIXTURE_ACCOUNTS, exclude);
      expect([...pairsOf(allocations, MIXED)]).toEqual([...before.pairs]);
      expect([...transfers].sort()).toEqual([...before.transfers].sort());
      expect(before.pairs.size).toBeGreaterThan(5);
      expectConserved(MIXED, allocations);
    }
  });

  it("household rounds: the account of each other leg and the rows across are those of before", () => {
    const before = householdLegsReference(MIXED, FIXTURE_ACCOUNTS, ownerOf);
    const { allocations, between } = householdAllocations(MIXED, FIXTURE_ACCOUNTS, ownerOf);
    expect(sorted(legAccountsOf(allocations, new Map(MIXED.map((t) => [t.id, t.accountId]))))).toEqual(sorted(before.otherLeg));
    expect([...between].sort()).toEqual([...before.between].sort());
    // the three rounds each found something, so none of them is left unchecked
    for (const id of ["s1o", "m1o", "r1o"]) expect(before.otherLeg.has(id)).toBe(true);
    expectConserved(MIXED, allocations);
  });

  it("the card of a transfer row is the one of before", () => {
    const rows = MIXED.map((t) => ({ ...t, day: dayNumber(t.bookingDate), isTransfer: t.amountCents > 0 }));
    const cards = new Set(["c1"]);
    const before = cardLegOfBefore(rows, cards);
    const now = cardLegOf(rows, cards);
    const found = rows.map((t) => now(t));
    expect(found).toEqual(rows.map((t) => before(t)));
    expect(found.filter((x) => x !== null).length).toBeGreaterThan(0);
    // the owner entry names the leg, which the old shape reads the account of
    const named = cardLegAllocations(rows, cards);
    expect(named(rows.find((t) => t.id === "k1i")!)).toEqual([{ partnerId: "k1", cents: 4500, partnerCents: 4500, link: "amount-day", tier: "decided" }]);
  });

  it("the leg of a loan payment is the one of before", () => {
    const ibanOf = new Map(FIXTURE_ACCOUNTS.map((a) => [a.id, normalizeIban(a.iban)]));
    const found = MIXED.map((t) => loanPaymentLeg(t, MIXED, ibanOf));
    expect(found).toEqual(MIXED.map((t) => loanPaymentLegBefore(t, MIXED, ibanOf)));
    expect(found.filter((x) => x !== null).length).toBeGreaterThan(0);
    expect(MIXED.map((t) => loanPaymentAllocations(t, MIXED, ibanOf)[0]?.partnerId ?? null)).toEqual(found);
    expect(found[MIXED.findIndex((t) => t.id === "l1i")]).toBe("l1b");
  });

  it("the leg that came in is the one of before, each leg once", () => {
    const moved = MIXED.filter((t) => t.status === "booked").map((t) => ({ ...t, day: dayNumber(t.bookingDate) }));
    const named = new Map(FIXTURE_ACCOUNTS.map((a) => [normalizeIban(a.iban) ?? "", a.id]));
    const left = moved.filter((t) => t.amountCents < 0).map((out) => ({ out, to: named.get(normalizeIban(out.counterpartyIban) ?? "") ?? null }));
    const ordered = [...left.filter((l) => l.to !== null), ...left.filter((l) => l.to === null)];
    const bill = (t: { amountCents: number }) => t.amountCents;
    const before = incomingLegFinderBefore(moved, bill);
    const now = incomingLegFinder(moved, bill);
    const owner = incomingLegAllocations(moved, bill);
    const found = ordered.map(({ out, to }) => now(out, to)?.id);
    expect(found).toEqual(ordered.map(({ out, to }) => before(out, to)?.id));
    expect(found.filter((x) => x !== undefined).length).toBeGreaterThan(3);
    // a second run of the owner entry holds the same legs as the adapter did
    expect(ordered.map(({ out, to }) => owner(out, to)[0]?.partnerId)).toEqual(found);
  });

  it("the leg on another pool is the one of before, each leg once, in both directions", () => {
    const own = FIXTURE_ACCOUNTS.map((a) => normalizeIban(a.iban)).filter((x): x is string => !!x);
    const ibanOf = new Map(FIXTURE_ACCOUNTS.map((a) => [a.id, normalizeIban(a.iban)]));
    const book = { pools: new Set(own), ibanOf, self: "FI0000000000000001" };
    const mine = MIXED.filter((t) => t.accountId === "a1");
    const others = MIXED.filter((t) => t.accountId !== "a1");
    const order = (a: Transaction, b: Transaction) => (a.bookingDate < b.bookingDate ? -1 : a.bookingDate > b.bookingDate ? 1 : a.id < b.id ? -1 : 1);
    const before = poolLegFinderBefore(book, others, order, 3);
    const now = poolLegFinder(book, others, order, 3);
    const owner = poolLegAllocations(book, others, order, 3);
    const asked = mine.flatMap((t) => [[t, 1] as const, [t, -1] as const]);
    const found = asked.map(([t, dir]) => now(t, dir)?.id);
    expect(found).toEqual(asked.map(([t, dir]) => before(t, dir)?.id));
    expect(found.filter((x) => x !== undefined).length).toBeGreaterThan(2);
    expect(asked.map(([t, dir]) => owner(t, dir)[0]?.partnerId)).toEqual(found);
  });

  it("the moves of the trace are those of before", () => {
    const person = { owner: "m1" } as const;
    const trace = (key: string, day: number, cents: number, extra: Partial<TraceRow> = {}): TraceRow => ({ key, ids: [key], day, cents, ...(cents < 0 ? { to: person } : {}), ...extra });
    const order: TraceRow[] = [
      trace("i1", 100, 5000),
      trace("o1", 101, -5000),
      // out before its in is no pair; the in after it is read as money in for later
      trace("o2", 110, -7000),
      trace("i2", 111, 7000),
      // two equal ins, the nearest day first, then the order
      trace("i3", 120, 900),
      trace("i4", 122, 900),
      trace("o3", 122, -900),
      trace("o4", 124, -900),
      // beyond the window, unmatched, to the pool and a refund-like pair on one day
      trace("i5", 130, 3300),
      trace("o5", 140, -3300),
      trace("i6", 150, 2100, { unmatched: true }),
      trace("o6", 150, -2100),
      trace("i7", 160, 4400),
      trace("o7", 160, -4400, { to: "pool" }),
      trace("i8", 170, 1500),
      trace("o8", 170, -1500),
      // the last day of the window, and a pair read in the same day
      trace("i9", 180, 2500),
      trace("o9", 183, -2500),
      trace("i10", 190, 2600),
      trace("o10", 190, -2600),
    ];
    const before = pairMovesBefore(order, 3);
    const allocations = moveAllocations(order, 3);
    expect([...movesOf(allocations, order)]).toEqual([...before]);
    expect(before.size).toBeGreaterThan(3);
    expect(allocations.size).toBe(before.size * 2);
  });
});
