/**
 * Figures the engine cannot prove carry `unresolved` with a reason: a card whose payer the rows do not show, and a
 * balance no row proves. The figure itself stays what it was (the debt comes off whole), and the notice that sets one
 * aside holds only while the reason and the amount hold. Made-up accounts and sums.
 */
import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { createContext } from "../src/analysis/context.ts";
import { dataQualityReport, unprovenOf } from "../src/analysis/data-quality.ts";
import { cardPayments, poolOf, poolPays, unresolvedCards } from "../src/analysis/pool.ts";
import { explainNow } from "../src/explain/now.ts";
import { INSIGHT_RETURN_SHARE } from "../src/thresholds.ts";
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

  it("is told by the explanation as a reason on the card's line, and an unproven balance as one on its start line", () => {
    const ctx = createContext([groceries], accounts, TODAY);
    const proofed = balances.map((b) => (b.id === "own" ? { ...b, proof: { status: "unknown" as const, reason: "no_reference_day" as const } } : b));
    const lines = explainNow("ahead.free", ctx, proofed, NO_INPUTS).explanation.lines;
    expect(lines.find((l) => l.id === "card:card")!.why).toEqual([{ rule: "card.payer_unseen" }]);
    expect(lines.find((l) => l.id === "a:own")!.why).toEqual([{ rule: "balance.unproven", reason: "no_reference_day" }]);
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

  it("is grouped by the reason, with the accounts and their balances added up, and only the unknown ones", () => {
    const list = [proven("a", "unknown", "no_reference_day"), proven("b", "unknown", "no_reference_day"), proven("c", "unknown", "too_few"), proven("d", "proved", null)];
    expect(unprovenOf(list).map((u) => [u.reason, u.accounts.map((a) => a.id)])).toEqual([["no_reference_day", ["a", "b"]], ["too_few", ["c"]]]);
  });

  it("is a data quality signal with the reason, the accounts and the sum, and a viewer's shared account is left out", () => {
    const list = [proven("a", "unknown", "no_reference_day"), proven("b", "unknown", "no_reference_day"), { ...proven("c", "unknown", "too_few"), ownerName: "Maija" }];
    const report = dataQualityReport(createContext([groceries], accounts, TODAY), { from: "2026-10-01", to: TODAY }, list);
    const signals = report.signals.filter((s) => s.id === "unproven_balance");
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ reason: "no_reference_day", accountIds: ["a", "b"], cents: 20_000 });
    expect(signals[0]!.detail).toContain("Sinun ei tarvitse tehdä mitään");
  });
});

describe("setting a notice aside", () => {
  const marks = (reason: Parameters<typeof unresolvedSubject>[0], cents: number) => [{ subject: unresolvedSubject(reason, cents), mark: "dismissed" as const }];

  it("names the reason and the amount, and reads them back", () => {
    expect(unresolvedSubject("card_payer_unseen", -23_000)).toBe("question:unresolved:card_payer_unseen@23000");
    expect(parseUnresolvedSubject("question:unresolved:card_payer_unseen@23000")).toEqual({ reason: "card_payer_unseen", cents: 23_000 });
    for (const bad of ["question:unresolved:nothing@5", "question:unresolved:too_few@", "question:unresolved:too_few@-5", "question:mortgage", "alert:x"]) expect(parseUnresolvedSubject(bad), bad).toBeNull();
  });

  it("holds while the reason holds and the amount stays within a quarter of the one it was set aside at", () => {
    const set = marks("card_payer_unseen", 20_000);
    expect(unresolvedDismissed(set, "card_payer_unseen", 20_000)).toBe(true);
    expect(unresolvedDismissed(set, "card_payer_unseen", 20_000 * (1 + INSIGHT_RETURN_SHARE) - 1)).toBe(true);
    expect(unresolvedDismissed(set, "card_payer_unseen", 20_000 * (1 - INSIGHT_RETURN_SHARE) + 1)).toBe(true);
  });

  it("returns when the amount has moved a quarter or more, or when the reason is another", () => {
    const set = marks("card_payer_unseen", 20_000);
    expect(unresolvedDismissed(set, "card_payer_unseen", 20_000 * (1 + INSIGHT_RETURN_SHARE))).toBe(false);
    expect(unresolvedDismissed(set, "card_payer_unseen", 20_000 * (1 - INSIGHT_RETURN_SHARE))).toBe(false);
    expect(unresolvedDismissed(set, "card_payer_mixed", 20_000)).toBe(false);
    expect(unresolvedDismissed([{ subject: set[0]!.subject, mark: "in_use" }], "card_payer_unseen", 20_000)).toBe(false);
  });
});
