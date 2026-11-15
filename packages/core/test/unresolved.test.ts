/**
 * Figures the engine cannot prove carry `unresolved` with a reason: a card whose payer the rows do not show, and a
 * balance no row proves. The figure itself stays what it was (the debt comes off whole, however large), and the notice
 * that sets cards aside holds while the cards are the set that was set aside. Made-up accounts and sums.
 */
import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { dataQualityReport } from "../src/analysis/data-quality.ts";
import { cardPayments, poolOf, poolPays, unresolvedCards } from "../src/analysis/pool.ts";
import { parseUnresolvedSubject, unresolvedDismissed, unresolvedSubject } from "../src/unresolved-answer.ts";
import { type Account, type BalanceInput, type IsoDate, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-12";
const own: Account = { id: "own", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };
const savings: Account = { id: "sav", name: "Säästötili", iban: "FI4950009420028731", currency: "EUR", type: "savings" };
const card: Account = { id: "card", name: "Luottokortti", iban: "FI1410093000123458", currency: "EUR", type: "credit_card" };
const accounts = [own, savings, card];

/** A payment from `from` to the card: the leg that leaves it, naming the card's account, and the leg the card takes. */
const payment = (from: Account, bookingDate: IsoDate, cents: number): Transaction[] => [
  tx({ accountId: from.id, bookingDate, amountCents: -cents, merchant: "Maksu", counterpartyIban: card.iban, category: "transfer", categorySource: "transfer", isTransfer: true }),
  tx({ accountId: card.id, bookingDate, amountCents: cents, merchant: "Maksu", category: "transfer", categorySource: "transfer", isTransfer: true }),
];
const groceries = tx({ accountId: own.id, bookingDate: "2026-10-05", amountCents: -2000, merchant: "Ruokakauppa", category: "groceries" });
const bal = (a: Account, balanceCents: number): BalanceInput => ({ id: a.id, name: a.name, type: a.type, balanceCents, ownerName: null, balanceAt: `${TODAY}T06:00:00Z` });
const balances = [bal(own, 300_000), bal(savings, 900_000), bal(card, -23_000)];
const aheadOf = (rows: Transaction[]) => cashAhead(createContext([groceries, ...rows], accounts, TODAY), balances, NO_INPUTS).balance!;

describe("a card whose payer the rows do not prove", () => {
  it("is unresolved as unseen when no payment to it is seen, and its debt still comes off whole", () => {
    const b = aheadOf([]);
    expect(b.unresolved).toEqual([{ reason: "card_payer_unseen", cardId: "card", name: "Luottokortti", cents: 23_000 }]);
    expect(b.cardDebts).toEqual([{ cardId: "card", name: "Luottokortti", cents: 23_000 }]);
    expect(b.startCents).toBe(300_000);
  });

  it("is unresolved as mixed when payments are seen from the pool and from outside it, with what each paid", () => {
    const b = aheadOf([...payment(own, "2026-10-01", 5000), ...payment(savings, "2026-10-03", 7000)]);
    expect(b.unresolved).toEqual([{ reason: "card_payer_mixed", cardId: "card", name: "Luottokortti", cents: 23_000, paidFromPoolCents: 5000, paidFromOutsideCents: 7000 }]);
  });

  it("is proven when the pool alone pays it, and is no debt of the pool when only outside accounts pay it", () => {
    expect(aheadOf(payment(own, "2026-10-01", 5000)).unresolved).toEqual([]);
    const outside = aheadOf(payment(savings, "2026-10-03", 7000));
    expect(outside.unresolved).toEqual([]);
    expect(outside.cardDebts).toEqual([]);
  });

  it("is never more than the debt that is taken off", () => {
    for (const rows of [[], [...payment(own, "2026-10-01", 5000), ...payment(savings, "2026-10-03", 7000)]]) {
      const b = aheadOf(rows);
      expect(b.unresolved.reduce((sum, c) => sum + c.cents, 0)).toBeLessThanOrEqual(b.cardDebtCents);
      for (const c of b.unresolved) expect(c.cents).toBeLessThanOrEqual(b.cardDebts.find((d) => d.cardId === c.cardId)!.cents);
    }
  });

  it("takes a debt larger than the money off whole: there is no cap, and the figure goes below zero", () => {
    const ahead = cashAhead(createContext([groceries], accounts, TODAY), [bal(own, 100_000), bal(savings, 900_000), bal(card, -300_000)], NO_INPUTS);
    const b = ahead.balance!;
    expect(b.cardDebtCents).toBe(300_000);
    expect(b.cardDebtCents).toBeGreaterThan(b.startCents);
    expect(b.freeCents).toBe(b.startCents - ahead.totals.leavingCents - b.cardDebtCents);
    expect(b.freeCents).toBeLessThan(0);
    expect(b.unresolved).toEqual([{ reason: "card_payer_unseen", cardId: "card", name: "Luottokortti", cents: 300_000 }]);
  });

});

describe("what each account paid to a card", () => {
  const ctx = (rows: Transaction[]) => createContext([groceries, ...rows], accounts, TODAY);
  const pool = poolOf(balances);

  it("sums the payments by the account they left, and shows a card nobody pays as none", () => {
    expect(cardPayments(ctx([]))).toEqual(new Map());
    expect(cardPayments(ctx([...payment(own, "2026-10-01", 5000), ...payment(own, "2026-09-01", 1000), ...payment(savings, "2026-10-03", 7000)]))).toEqual(new Map([["card", new Map([["own", 6000], ["sav", 7000]])]]));
  });

  it("names every card with the payer the rows leave open and no other", () => {
    const debts = [{ cardId: "card", name: "Luottokortti", cents: 100 }];
    expect(unresolvedCards(pool, cardPayments(ctx([])), debts).map((c) => c.reason)).toEqual(["card_payer_unseen"]);
    expect(unresolvedCards(pool, cardPayments(ctx(payment(own, "2026-10-01", 5000))), debts)).toEqual([]);
    expect(poolPays(pool, cardPayments(ctx(payment(savings, "2026-10-03", 7000))), "card")).toBe(false);
  });
});

describe("a balance no row proves", () => {
  const proven = (id: string, status: "proved" | "unknown", reason: BalanceInput["proof"] extends infer P ? (P extends { reason: infer R } ? R : never) : never): BalanceInput => ({ ...bal({ ...own, id, name: `Tili ${id}` }, 10_000), proof: { status, reason: status === "unknown" ? reason : null } });

  const signalsOf = (list: BalanceInput[]) => dataQualityReport(createContext([groceries], accounts, TODAY), { from: "2026-10-01", to: TODAY }, list).signals.filter((s) => s.id === "unproven_balance");

  it("is one data quality signal per reason, and only the unknown ones", () => {
    const signals = signalsOf([proven("a", "unknown", "no_reference_day"), proven("b", "unknown", "no_reference_day"), proven("c", "unknown", "too_few"), proven("d", "proved", null)]);
    expect(signals.map((s) => [s.reason, s.title])).toEqual([
      ["no_reference_day", "2 tilin saldoa ei voi tarkistaa tapahtumista: Tili a ja Tili b"],
      ["too_few", "Tilin Tili c saldoa ei voi tarkistaa tapahtumista"],
    ]);
  });

  it("adds up no balances, which differ in sign, and leaves a viewer's shared account out", () => {
    const signals = signalsOf([{ ...proven("a", "unknown", "no_reference_day"), balanceCents: -23_000 }, proven("b", "unknown", "no_reference_day"), { ...proven("c", "unknown", "too_few"), ownerName: "Maija" }]);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.reason).toBe("no_reference_day");
    expect(signals[0]!.cents).toBeUndefined();
    expect(signals[0]!.detail).toContain("Sinun ei tarvitse tehdä mitään");
  });
});

describe("setting a notice aside", () => {
  const marks = (...cardIds: string[]) => [{ subject: unresolvedSubject("card_payer_unseen", cardIds), mark: "dismissed" as const }];

  it("names the reason and a hash of the sorted card ids, and reads the reason back", () => {
    // pinned: a stored dismissal must keep matching after an update, so the hash never changes
    expect(unresolvedSubject("card_payer_unseen", ["k2", "k1", "k2"])).toBe("question:unresolved:card_payer_unseen:1ebc489babf171");
    expect(unresolvedSubject("card_payer_unseen", ["k1", "k2"])).toBe("question:unresolved:card_payer_unseen:1ebc489babf171");
    expect(parseUnresolvedSubject("question:unresolved:card_payer_unseen:1ebc489babf171")).toEqual({ reason: "card_payer_unseen" });
    for (const bad of ["question:unresolved:nothing:1ebc489babf171", "question:unresolved:card_payer_unseen:", "question:unresolved:card_payer_unseen:k1,k2", "question:unresolved:card_payer_unseen:1ebc489babf17", "question:unresolved:card_payer_unseen@23000", "question:unresolved:too_few:1ebc489babf171", "question:mortgage", "alert:x"]) expect(parseUnresolvedSubject(bad), bad).toBeNull();
  });

  it("stays within the 200 characters of a mark's subject however many cards the notice names", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `account-${String(i).padStart(2, "0")}-${"x".repeat(50)}`);
    const subject = unresolvedSubject("card_payer_unseen", ids);
    expect(subject.slice("question:".length).length).toBeLessThanOrEqual(200);
    expect(parseUnresolvedSubject(subject)).toEqual({ reason: "card_payer_unseen" });
    expect(unresolvedDismissed([{ subject, mark: "dismissed" }], "card_payer_unseen", [...ids].reverse())).toBe(true);
  });

  it("gives every set of cards a subject of its own, in any order", () => {
    const sets = [["k1"], ["k2"], ["k1", "k2"], ["k1", "k2", "k3"], ["k1k2"], ["k1,k2"]];
    const subjects = sets.map((s) => unresolvedSubject("card_payer_unseen", s));
    expect(new Set(subjects).size).toBe(sets.length);
    expect(unresolvedSubject("card_payer_unseen", ["k3", "k1", "k2"])).toBe(subjects[3]);
  });

  it("holds whatever the debt does, since the amount is no part of the key", () => {
    const set = marks("card");
    expect(unresolvedDismissed(set, "card_payer_unseen", ["card"])).toBe(true);
    // a debt that swung from 230 € to 900 € names the same card and the same key
    expect(unresolvedSubject("card_payer_unseen", ["card"])).toBe(set[0]!.subject);
  });

  it("holds for the set that was set aside, and returns when a card joins or leaves it", () => {
    const set = marks("k1", "k2");
    expect(unresolvedDismissed(set, "card_payer_unseen", ["k2", "k1"])).toBe(true);
    expect(unresolvedDismissed(set, "card_payer_unseen", ["k2"])).toBe(false);
    expect(unresolvedDismissed(set, "card_payer_unseen", ["k1", "k2", "k3"])).toBe(false);
    expect(unresolvedDismissed(set, "card_payer_unseen", ["k3"])).toBe(false);
  });

  it("counts only a dismissal", () => {
    expect(unresolvedDismissed([{ subject: marks("card")[0]!.subject, mark: "in_use" }], "card_payer_unseen", ["card"])).toBe(false);
  });
});
