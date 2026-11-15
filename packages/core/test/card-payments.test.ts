import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { expectedMoves } from "../src/analysis/ahead-moves.ts";
import { reconcileCardPayments } from "../src/analysis/card-payments.ts";
import { createContext } from "../src/analysis/context.ts";
import type { StatementBill } from "../src/analysis/statement-explain.ts";
import { addDays, daysBetween } from "../src/dates.ts";
import { type Account, type BalanceInput, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

// Every way money reaches a card meets in `reconcileCardPayments`: the payments already booked, the typed bills, the
// predicted bill and the bill of a statement. Each euro of the card's debt comes off once.
const cardIban = "FI80 1234 5600 0099 11";
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Luottokortti", iban: cardIban, currency: "EUR", type: "credit_card" };
const today = "2026-10-15";
/** Five days ago: a bill on the 9th is no longer late. */
const LAST_DAY = "2026-10-10";
const OWN = 100_000;
const LAST = 30_000;

const everyDay = (row: (day: IsoDate) => Transaction[]): Transaction[] => {
  const rows: Transaction[] = [];
  for (let d = "2026-03-01"; d <= today; d = addDays(d, 1)) rows.push(...row(d));
  return rows;
};
const purchases = everyDay((d) => [
  tx({ accountId: "own", bookingDate: d, amountCents: -2000, merchant: "Ruokakauppa", category: "groceries" }),
  tx({ accountId: "card", bookingDate: d, amountCents: -1000, merchant: "Kahvila", category: "restaurants" }),
]);
/** The leg that leaves the own account, paid to the card's bank by reference, as the card's payment channel is. */
const paidOut = (bookingDate: IsoDate, cents: number): Transaction =>
  tx({ accountId: "own", bookingDate, amountCents: -cents, merchant: "Esimerkkipankki", counterparty: "Esimerkkipankki", counterpartyIban: "FI49 5000 9420 0287 30", reference: "1234561", category: "transfer", categorySource: "transfer", isTransfer: true });
const legOn = (bookingDate: IsoDate, cents: number): Transaction => tx({ accountId: "card", bookingDate, amountCents: cents, merchant: "Maksu", category: "transfer", categorySource: "transfer", isTransfer: true });
const paired = (bookingDate: IsoDate, cents: number): Transaction[] => [paidOut(bookingDate, cents), legOn(bookingDate, cents)];

type History = "monthly" | "statement" | "none";
type Recent = "none" | "paired" | "channel" | "named";
/** The day the card's balance stands for, against the day of the last payment: the day before it, the same day, a day after it, or none. */
type BalanceDay = "before" | "same" | "after" | "null";
const BALANCE_AT: Record<BalanceDay, string | null> = { before: "2026-10-08T06:00:00Z", same: `${LAST_DAY}T06:00:00Z`, after: `${today}T06:00:00Z`, null: null };

/** The payments before the last days: a bill on the 9th each month, or payments no month apart that one typed statement makes bills. */
function history(kind: History): { rows: Transaction[]; last: Transaction | null } {
  if (kind === "none") return { rows: [], last: null };
  if (kind === "monthly") {
    const ninths = ["04", "05", "06", "07", "08", "09"].map((m) => `2026-${m}-09`);
    const bills = ninths.map((d, i) => paired(d, daysBetween(i === 0 ? "2026-03-09" : ninths[i - 1]!, d) * 1000));
    return { rows: bills.flat(), last: null };
  }
  const bills = ["2026-07-28", "2026-08-25", "2026-09-12"].map((d) => paired(d, 20_000));
  return { rows: bills.flat(), last: bills.at(-1)![0]! };
}

const recentPayment = (kind: Recent): Transaction[] => {
  if (kind === "none") return [];
  if (kind === "paired") return paired(LAST_DAY, LAST);
  // no leg on the card yet
  if (kind === "channel") return [paidOut(LAST_DAY, LAST)];
  // names the card's own account number, no leg on the card yet
  return [{ ...paidOut(LAST_DAY, LAST), counterpartyIban: cardIban, counterparty: "Luottokortti", merchant: "Luottokortti", reference: null }];
};

describe("the window: every way money reaches a card", () => {
  const cells: { h: History; recent: Recent; at: BalanceDay; debt: number; typed: number; proven: boolean }[] = [];
  for (const h of ["monthly", "statement", "none"] as const)
    for (const recent of ["none", "paired", "channel", "named"] as const)
      // the balance day matters only to a payment with no leg on the card
      for (const at of recent === "none" || recent === "paired" ? (["after"] as const) : (["before", "same", "after", "null"] as const))
        for (const debt of [0, 2000, 32_000, 230_000])
          for (const typed of [0, 4000, 300_000])
            for (const proven of [true, false]) cells.push({ h, recent, at, debt, typed, proven });

  /** Whether the payment reaches the card at all: by the card's own number, or by the payee its paid bills went to. */
  const reaches = (h: History, recent: Recent): boolean => recent === "named" || (recent === "channel" && h !== "none");
  /** What the card's balance is known not to hold: a payment with no leg on the card, booked after the day the balance stands for. */
  const unappliedOf = (h: History, recent: Recent, at: BalanceDay): number => (reaches(h, recent) && at === "before" ? LAST : 0);

  const run = ({ h, recent, at, debt, typed, proven }: (typeof cells)[number]) => {
    const past = history(h);
    const last = recentPayment(recent);
    const rows = [...purchases, ...past.rows, ...last];
    // a statement typed in for the last bill makes payments no month apart a statement's bills
    const statements: StatementBill[] = h === "statement" ? [{ billId: (last[0] ?? past.last)!.id, periodFrom: "2026-09-01", periodTo: "2026-09-30", rows: [] }] : [];
    const ctx = createContext(rows, [own, card], today, undefined, [], [], statements);
    const balances: BalanceInput[] = [
      { id: "own", name: own.name, type: "checking", balanceCents: OWN, ownerName: null, balanceAt: `${today}T06:00:00Z` },
      { id: "card", name: card.name, type: "credit_card", balanceCents: -debt, ownerName: null, balanceAt: BALANCE_AT[at] },
    ];
    const inputs = typed ? { ...NO_INPUTS, expectedBills: [{ id: "typed", name: "Korttilasku", amountCents: typed, dueDate: "2026-10-25", cadence: "once" as const, category: null, payeeIban: proven ? cardIban : null }] } : NO_INPUTS;
    return cashAhead(ctx, balances, inputs);
  };

  it("takes each euro of the debt off once, whatever paid it", { timeout: 120_000 }, () => {
    let withBill = 0;
    for (const cell of cells) {
      const name = JSON.stringify(cell);
      const d = run(cell);
      // a payment the balance may hold is not taken off: the money free is never more than it is
      const owed = Math.max(0, cell.debt - unappliedOf(cell.h, cell.recent, cell.at));
      const typedRows = d.rows.filter((r) => r.source === "expected").reduce((sum, r) => sum + Math.abs(r.cents ?? 0), 0);
      const cardRows = d.rows.filter((r) => r.source === "card").reduce((sum, r) => sum + Math.abs(r.cents ?? 0), 0);
      if (cardRows > 0) withBill += 1;
      // a typed bill is never cut or dropped
      expect(typedRows, name).toBe(cell.typed);
      // the payments booked already are in the balance of the own account: only what is owed and not paid is taken off
      expect(d.balance!.freeCents, name).toBe(OWN - (cell.proven ? Math.max(owed, cell.typed) : owed + cell.typed));
      // the card's bill and the debt beside it are what the card owes, or the typed bills when they are more
      expect(cardRows + d.balance!.cardDebtCents + (cell.proven ? typedRows : 0), name).toBe(Math.max(owed, cell.proven ? cell.typed : 0));
    }
    // the matrix has cells with a predicted bill: it is no empty check
    expect(withBill).toBeGreaterThan(0);
  });

  it("a payment named to the card and booked after its balance is not taken off twice", () => {
    // the balance is of the day before: it shows 320 euros, 300 of them paid after it. 20 are owed, and the bill expected is no more
    const d = run({ h: "monthly", recent: "named", at: "before", debt: 32_000, typed: 0, proven: true });
    expect(d.balance!.freeCents).toBe(OWN - 2000);
    expect(d.rows.filter((r) => r.source === "card").reduce((sum, r) => sum + Math.abs(r.cents ?? 0), 0)).toBeLessThanOrEqual(2000);
  });

  it.each(["same", "after", "null"] as const)("a payment with no leg that the balance may hold stays on the debt, and the card says so (balance day: %s)", (at) => {
    // the same 320 euros, but the balance may already hold the 300: the 320 are all taken off, never less
    const d = run({ h: "monthly", recent: "named", at, debt: 32_000, typed: 0, proven: true });
    const cardRows = d.rows.filter((r) => r.source === "card").reduce((sum, r) => sum + Math.abs(r.cents ?? 0), 0);
    expect(d.balance!.freeCents).toBe(OWN - 32_000);
    expect(cardRows + d.balance!.cardDebtCents).toBe(32_000);
    // named even when a predicted bill holds all of the debt
    expect(d.balance!.unshown).toEqual([{ cardId: "card", name: card.name, cents: LAST }]);
  });

  it("a payment that has a leg on the card is in the balance, whatever the balance day", () => {
    for (const at of ["before", "same", "after", "null"] as const) {
      const d = run({ h: "monthly", recent: "paired", at, debt: 32_000, typed: 0, proven: true });
      expect(d.balance!.freeCents, at).toBe(OWN - 32_000);
      expect(d.balance!.unshown, at).toBeUndefined();
    }
  });
});

describe("a payment with no leg: which card it paid, and whether the card's balance holds it", () => {
  const second: Account = { id: "card2", name: "Toinen kortti", iban: "FI14 1009 3000 1234 58", currency: "EUR", type: "credit_card" };
  const pairOn = (cardId: string, bookingDate: IsoDate, cents: number): Transaction[] => [paidOut(bookingDate, cents), { ...legOn(bookingDate, cents), accountId: cardId }];
  // every payment goes to one payee (one account number and reference); the sums differ, so each leg has one partner
  const first = [...pairOn("card", "2026-08-09", 12_000), ...pairOn("card", "2026-09-09", 13_000)];
  const other = [...pairOn("card2", "2026-08-20", 21_000), ...pairOn("card2", "2026-09-20", 22_000)];
  const recent = paidOut(LAST_DAY, 17_000);
  const balancesOf = (at: BalanceDay): BalanceInput[] => [
    { id: "own", name: own.name, type: "checking", balanceCents: OWN, ownerName: null, balanceAt: `${today}T06:00:00Z` },
    { id: "card", name: card.name, type: "credit_card", balanceCents: -50_000, ownerName: null, balanceAt: BALANCE_AT[at] },
    { id: "card2", name: second.name, type: "credit_card", balanceCents: -50_000, ownerName: null, balanceAt: BALANCE_AT[at] },
  ];
  const movesOf = (rows: Transaction[], at: BalanceDay) => expectedMoves(createContext(rows, [own, card, second], today, undefined, [], [], []), new Set(["own"]), balancesOf(at), today, "2026-11-15");

  it.each([
    ["before", 17_000, 0],
    ["same", 0, 17_000],
    ["after", 0, 17_000],
    ["null", 0, 17_000],
  ] as const)("one card has the payee: balance day %s", (at, unapplied, unshown) => {
    const m = movesOf([...first, recent], at);
    expect(m.unapplied.get("card") ?? 0).toBe(unapplied);
    expect(m.unshown.get("card") ?? 0).toBe(unshown);
    expect(m.unapplied.get("card2") ?? 0).toBe(0);
    expect(m.unshown.get("card2") ?? 0).toBe(0);
  });

  it.each(["before", "same", "after", "null"] as const)("two cards have the payee: the payment stays separate, with no card taking it (balance day %s)", (at) => {
    const m = movesOf([...first, ...other, recent], at);
    expect([...m.unapplied.values(), ...m.unshown.values()]).toEqual([]);
  });
});

describe("reconcileCardPayments", () => {
  const inWindow = (date: IsoDate) => date <= "2026-11-10";
  it("leaves a card with no known debt unsaid and cuts predicted bills by the typed ones in the order of their days", () => {
    const predicted = [
      { date: "2026-11-09", amountCents: 5000, cardId: "a" },
      { date: "2026-10-09", amountCents: 3000, cardId: "a" },
      { date: "2026-10-09", amountCents: 7000 },
    ];
    const out = reconcileCardPayments({ used: new Map([["a", 20_000], ["b", null]]), unapplied: new Map([["a", 4000]]), typed: [{ cardId: "a", date: "2026-10-20", amountCents: 4000 }], predicted, inWindow });
    expect(out.predicted).toEqual([
      { date: "2026-11-09", amountCents: 4000, cardId: "a" },
      { date: "2026-10-09", amountCents: 7000 },
    ]);
    // owed 160 euros; a typed bill of 40 and what is left of the predicted bills, 40, are in the window
    expect(out.rest.get("a")).toBe(8000);
    expect(out.rest.get("b")).toBeNull();
  });
});
