import { describe, expect, it } from "vitest";
import { applyUse, partOf } from "../src/account-use.ts";
import { type AnalysisContext, createContext, loweredRows, spendRows } from "../src/analysis/context.ts";
import { cardBillsByMonth } from "../src/analysis/card-bills.ts";
import { periodProblem, type StatementBill } from "../src/analysis/statement-explain.ts";
import { dayNumber, monthIndex } from "../src/dates.ts";
import type { Account, AccountUse, Part, Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-04-01";
const ALL = { fromDay: dayNumber("2026-01-01"), toDay: dayNumber("2026-12-31") };
const current: Account = { id: "chk", name: "Käyttötili", holder: "Matti Meikalainen", iban: null, currency: "EUR", type: "checking" };
const card: Account = { id: "card", name: "Esimerkki Kortti", holder: "Matti Meikalainen", iban: null, currency: "EUR", type: "credit_card" };
const otherCard: Account = { id: "card2", name: "Toinen Pankki Visa", holder: "Matti Meikalainen", iban: null, currency: "EUR", type: "credit_card" };

const bill = (extra: Partial<Transaction> = {}): Transaction =>
  tx({ id: "bill", accountId: "chk", bookingDate: "2026-03-10", amountCents: -42000, category: "card_bill", merchant: "ESIMERKKI KORTTI", counterparty: "ESIMERKKI KORTTI", ...extra });
const row = (id: string, day: string, cents: number, text: string, category = "other"): StatementBill["rows"][number] => ({ id, day, cents, text, category });
const caseA = (): StatementBill["rows"] => [
  row("r1", "2026-02-03", 6150, "K-MARKET ESIMERKKI", "groceries"),
  row("r2", "2026-02-09", 8000, "ESIMERKKI POLTTOAINE", "car"),
  row("r3", "2026-02-20", 15000, "VERKKOKAUPPA ESIMERKKI", "shopping"),
];
const statement = (rows: StatementBill["rows"], extra: Partial<StatementBill> = {}): StatementBill => ({ billId: "bill", periodFrom: "2026-02-01", periodTo: "2026-02-28", rows, ...extra });
const build = (txs: Transaction[], statements: StatementBill[], accounts: Account[] = [current, card]): AnalysisContext => createContext(txs, accounts, TODAY, undefined, [], [], statements);
/** What the bill counts for once its rows are read. */
const billSpend = (ctx: AnalysisContext, id = "bill") => loweredRows(ctx, ctx.txs).find((t) => t.id === id)!.spend;
const spendOf = (ctx: AnalysisContext, category?: string, month?: string) =>
  spendRows(ctx, ALL).filter((t) => (!category || t.category === category) && (!month || t.month === monthIndex(`${month}-01`))).reduce((n, t) => n + t.spend, 0);

describe("a card statement explains one bill", () => {
  it("A bill with rows is the remainder plus rows", () => {
    const ctx = build([bill()], [statement(caseA())]);
    expect(ctx.statements.get("bill")).toEqual({ read: true });
    expect(billSpend(ctx)).toBe(12850);
    expect(spendOf(ctx, "groceries", "2026-02")).toBe(6150);
    expect(spendOf(ctx, "car", "2026-02")).toBe(8000);
    expect(spendOf(ctx, "shopping", "2026-02")).toBe(15000);
    expect(spendOf(ctx, "card_bill", "2026-03")).toBe(12850);
    expect(spendOf(ctx)).toBe(42000);
    // the bill's note reads what is left
    expect(cardBillsByMonth(ctx, [monthIndex("2026-03-01")])).toEqual([12850]);
  });

  it("spendRows total equals the no-rows total, and without rows the bill counts whole", () => {
    const none = build([bill()], []);
    expect(none.explained).toEqual([]);
    expect(spendOf(none)).toBe(42000);
    expect(spendRows(none, ALL)).toEqual(none.txs);
    expect(spendOf(build([bill()], [statement(caseA())]))).toBe(spendOf(none));
    expect(cardBillsByMonth(none, [monthIndex("2026-03-01")])).toEqual([42000]);
  });

  it("E over S reads none, one cent under is read and leaves the cent unexplained", () => {
    const over = build([bill()], [statement([row("r1", "2026-02-03", 42001, "ESIMERKKI KAUPPA")])]);
    expect(over.statements.get("bill")).toEqual({ read: false, reason: "over_bill" });
    expect(over.explained).toEqual([]);
    expect(spendOf(over)).toBe(42000);
    const under = build([bill()], [statement([row("r1", "2026-02-03", 41999, "ESIMERKKI KAUPPA")])]);
    expect(billSpend(under)).toBe(1);
    expect(spendOf(under)).toBe(42000);
    // rows that sum below zero (a payment received typed as a row) read none
    const paid = build([bill()], [statement([...caseA().slice(0, 1), row("r9", "2026-02-12", -38000, "MAKSU KIITOS")])]);
    expect(paid.statements.get("bill")).toEqual({ read: false, reason: "over_bill" });
    expect(spendOf(paid)).toBe(42000);
    // a sum of exactly the bill leaves nothing and a sum of exactly 0 leaves all
    expect(billSpend(build([bill()], [statement([row("r1", "2026-02-03", 42000, "ESIMERKKI KAUPPA")])]))).toBe(0);
    expect(billSpend(build([bill()], [statement([row("r1", "2026-02-03", 500, "ESIMERKKI KAUPPA"), row("r2", "2026-02-04", -500, "ESIMERKKI KAUPPA")])]))).toBe(42000);
  });

  it("refund row nets in the category of the shop", () => {
    const rows = [...caseA().slice(0, 2), row("r3", "2026-02-20", 17500, "VERKKOKAUPPA ESIMERKKI", "shopping"), row("r4", "2026-02-14", -2500, "VERKKOKAUPPA ESIMERKKI", "other")];
    // the refund is dated before the purchase in the statement's order: it still looks for an earlier purchase, and finds none
    const early = build([bill()], [statement(rows)]);
    expect(early.explained.find((t) => t.rowId === "r4")!.category).toBe("other");
    const late = build([bill()], [statement([...caseA().slice(0, 2), row("r3", "2026-02-10", 17500, "VERKKOKAUPPA ESIMERKKI", "shopping"), row("r4", "2026-02-14", -2500, "VERKKOKAUPPA ESIMERKKI", "other")])]);
    expect(late.explained.find((t) => t.rowId === "r4")!.category).toBe("shopping");
    expect(spendOf(late, "shopping", "2026-02")).toBe(15000);
    expect(spendOf(late, "card_bill", "2026-03")).toBe(12850);
    expect(spendOf(late)).toBe(42000);
    // a refund is no income
    expect(late.txs.every((t) => t.flows.income === 0)).toBe(true);
  });

  it("unknown category becomes other", () => {
    const ctx = build([bill()], [statement([row("r1", "2026-02-03", 1000, "A", "not_a_category"), row("r2", "2026-02-04", 1000, "B", "salary"), row("r3", "2026-02-05", 1000, "C", "transfer"), row("r4", "2026-02-06", 1000, "D", "card_bill"), row("r5", "2026-02-07", 1000, "E", "car")])]);
    expect(ctx.explained.map((t) => t.category)).toEqual(["other", "other", "other", "other", "car"]);
  });

  it("rows are in no series, return or pairing, and the bill's cash is unchanged", () => {
    const monthly = [1, 2, 3, 4].map((m) => tx({ accountId: "chk", bookingDate: `2026-0${m}-05`, amountCents: -1500, merchant: "Netflix", category: "subscriptions" }));
    const rows = [...caseA(), row("r4", "2026-02-21", 1500, "NETFLIX", "subscriptions"), row("r5", "2026-03-01", 1500, "NETFLIX", "subscriptions")];
    const txs = [bill(), ...monthly];
    const without = build(txs, []);
    const withRows = build(txs, [statement(rows.slice(0, 4)), { ...statement(rows.slice(4)), billId: "none" }]);
    expect(withRows.txs.map((t) => t.id)).toEqual(without.txs.map((t) => t.id));
    expect(withRows.txs.map((t) => t.flows)).toEqual(without.txs.map((t) => t.flows));
    expect(withRows.txs.map((t) => t.amountCents)).toEqual(without.txs.map((t) => t.amountCents));
    expect(withRows.returns).toEqual(without.returns);
    expect(withRows.recurring).toEqual(without.recurring);
    expect(withRows.fixedIds).toEqual(without.fixedIds);
    expect(withRows.explained.length).toBe(4);
    // a row's flows are its spending only: no income, savings or credit, and it is no row of `txs`
    expect(withRows.explained.every((t) => t.flows.consumption === t.spend && t.flows.income === 0 && t.flows.saved === 0 && !withRows.txs.some((x) => x.id === t.id))).toBe(true);
    expect(withRows.dataFrom).toBe(without.dataFrom);
    // the bill in `txs` is whole: a reader that does not know of statements counts it as it always did
    expect(withRows.txs.find((t) => t.id === "bill")!.spend).toBe(42000);
  });

  it("a statement of a bill that is not in the view reads nothing", () => {
    const ctx = build([bill({ id: "other" })], [statement(caseA())]);
    expect(ctx.explained).toEqual([]);
    expect(ctx.statements.size).toBe(0);
  });
});

describe("which bills have their rows read", () => {
  it("the bank covers a period its card rows span, and only that one", () => {
    const at = (day: string) => tx({ accountId: "card", bookingDate: day, amountCents: -900, merchant: "K-Market" });
    const rows = [statement(caseA())];
    // the card's rows reach into the period: the bill counts whole, as today
    const half = build([bill(), at("2026-02-15")], rows);
    expect(half.statements.get("bill")).toEqual({ read: false, reason: "covered" });
    expect(billSpend(half)).toBe(42000);
    expect(half.explained).toEqual([]);
    // rows from before the period to after it, and rows that touch the first or the last day of it
    expect(build([bill(), at("2026-01-20"), at("2026-03-05")], rows).statements.get("bill")).toEqual({ read: false, reason: "covered" });
    expect(build([bill(), at("2026-02-01")], rows).statements.get("bill")).toEqual({ read: false, reason: "covered" });
    expect(build([bill(), at("2026-02-28")], rows).statements.get("bill")).toEqual({ read: false, reason: "covered" });
    // near misses: the rows end the day before the period (a lapsed consent), or begin the day after it
    for (const day of ["2026-01-31", "2025-12-10", "2026-03-01", "2026-03-05"]) {
      const kept = build([bill(), at(day)], rows);
      expect(kept.statements.get("bill"), day).toEqual({ read: true });
      expect(billSpend(kept), day).toBe(12850);
    }
    // a consent that lapsed in December and a bill of March: the statement is the only account of February
    expect(build([bill(), at("2025-11-20"), at("2025-12-10")], rows).statements.get("bill")).toEqual({ read: true });
    // a pending card row is no booking
    expect(build([bill(), tx({ accountId: "card", bookingDate: "2026-02-15", amountCents: -900, status: "pending" })], rows).statements.get("bill")).toEqual({ read: true });
  });

  it("another card hides nothing", () => {
    const ctx = build([bill(), tx({ accountId: "card2", bookingDate: "2026-02-15", amountCents: -900, merchant: "K-Market" })], [statement(caseA())], [current, card, otherCard]);
    expect(ctx.statements.get("bill")).toEqual({ read: true });
    expect(billSpend(ctx)).toBe(12850);
  });

  it("a bill that is a transfer, on a card or a loan, or pending reads none, and the figures stay as they are", () => {
    const rows = [statement(caseA())];
    // paired with a card payment: a transfer
    const paired = build([bill({ isTransfer: true, category: "transfer" })], rows);
    expect(paired.statements.get("bill")).toEqual({ read: false, reason: "not_card_bill" });
    expect(billSpend(paired)).toBe(0);
    expect(spendOf(paired)).toBe(0);
    // set by hand to another category
    const hand = build([bill({ category: "shopping", categorySource: "user" })], rows);
    expect(hand.statements.get("bill")).toEqual({ read: false, reason: "not_card_bill" });
    expect(spendOf(hand)).toBe(42000);
    // a transfer to the household's own loan account that is no card bill
    const loan = build([bill({ accountId: "loan1", category: "debt" })], rows, [current, { ...current, id: "loan1", type: "loan" }]);
    expect(loan.statements.get("bill")).toEqual({ read: false, reason: "not_card_bill" });
    // on a card account, or money in
    expect(build([bill({ accountId: "card" })], rows).statements.get("bill")).toEqual({ read: false, reason: "not_card_bill" });
    expect(build([bill({ amountCents: 42000 })], rows).explained).toEqual([]);
    expect(build([bill({ status: "pending" })], rows).statements.get("bill")).toEqual({ read: false, reason: "not_booked" });
    expect(billSpend(build([bill({ status: "pending" })], rows))).toBe(42000);
  });

  it("rows outside the period, or a period that no longer fits the bill, read none", () => {
    expect(build([bill()], [statement([...caseA(), row("r4", "2026-03-01", 100, "X")])]).statements.get("bill")).toEqual({ read: false, reason: "period" });
    expect(build([bill()], [statement(caseA(), { periodTo: "2026-03-11" })]).statements.get("bill")).toEqual({ read: false, reason: "period" });
    expect(build([bill()], [statement(caseA(), { periodFrom: "2025-12-01" })]).statements.get("bill")).toEqual({ read: false, reason: "period" });
  });
});

describe("a bill on a joint account cut by part", () => {
  const use = (weights: number[]): AccountUse => ({ users: weights.map((weight, i) => ({ userId: `u-${i + 1}`, label: `M${i + 1}`, weight })), source: "said" });
  const joint: Account = { ...current, id: "chk" };
  /** Each member's context of one bill, as the server builds it: the rows cut by the part, the statement given the part. */
  const views = (cents: number, rows: number[], weights: number[]) => {
    const u = use(weights);
    const stmt = statement(rows.map((c, i) => row(`r${i}`, `2026-02-0${i + 1}`, c, `SHOP ${i}`, "groceries")));
    return weights.map((_, i) => {
      const part: Part = partOf(u, `u-${i + 1}`);
      const cut = applyUse([bill({ amountCents: -cents })], [joint], new Map([["chk", part]]));
      return build([...cut], [{ ...stmt, part }], [joint, card]);
    }) as [AnalysisContext, AnalysisContext, ...AnalysisContext[]];
  };

  it("a cut joint bill splits rows by the bill's parts and adds to the bill", () => {
    const [a, b] = views(20000, [4000, 4000], [1, 1]);
    for (const ctx of [a, b]) {
      expect(billSpend(ctx)).toBe(6000);
      expect(ctx.explained.reduce((n, t) => n + t.spend, 0)).toBe(4000);
    }
    expect(spendOf(a) + spendOf(b)).toBe(20000);
  });

  it("the owners' figures add to the bill to the cent for every sum and part, and none is negative", () => {
    for (const weights of [[1, 1], [1, 2], [2, 3], [1, 1, 1]]) {
      for (const bill of [1, 2, 3, 7, 19, 100, 101, 20001]) {
        for (const e of [0, 1, 2, Math.floor(bill / 2), bill - 1, bill].filter((x, i, l) => x >= 0 && x <= bill && l.indexOf(x) === i)) {
          const rows = e === 0 ? [] : e === 1 ? [1] : [e - 1, 1];
          const ctxs = views(bill, rows, weights);
          expect(ctxs.reduce((n, ctx) => n + spendOf(ctx), 0)).toBe(bill);
          for (const ctx of ctxs) expect(ctx.explained.every((t) => t.spend >= 0) && billSpend(ctx) >= 0).toBe(true);
        }
      }
    }
  });

  /** The members' contexts of a bill of `cents` with rows that sum to `explained`, the statement given NO part (a traced share, or a part that does not give back the cut). */
  const viewsWithoutPart = (cents: number, explained: number, weights: number[]) => {
    const u = use(weights);
    const stmt = statement([row("r0", "2026-02-01", explained - (explained > 1 ? 1 : 0), "SHOP A", "groceries"), ...(explained > 1 ? [row("r1", "2026-02-02", 1, "SHOP B", "groceries")] : [])]);
    return weights.map((_, i) => build([...applyUse([bill({ amountCents: -cents })], [joint], new Map([["chk", partOf(u, `u-${i + 1}`)]]))], [stmt], [joint, card]));
  };
  const explainedOf = (ctx: AnalysisContext) => ctx.explained.reduce((n, t) => n + t.spend, 0);

  it("two members' explained sums and rests add up to the bill's, to the cent, with and without a part", () => {
    for (const [cents, explained] of [[150, 105], [192, 144], [220, 105]] as const) {
      for (const withPart of [false, true]) {
        const ctxs = withPart ? views(cents, [explained - 1, 1], [7, 3]) : viewsWithoutPart(cents, explained, [7, 3]);
        const label = `${cents}/${explained} ${withPart}`;
        expect(ctxs.reduce((n, c) => n + explainedOf(c), 0), label).toBe(explained);
        expect(ctxs.reduce((n, c) => n + billSpend(c), 0), label).toBe(cents - explained);
        for (const c of ctxs) expect(explainedOf(c) + billSpend(c), label).toBe(spendOf(c));
      }
    }
    // the case of the review: S=150, E=105 over parts 7/10 and 3/10 explains 105 and leaves 45
    const [a, b] = viewsWithoutPart(150, 105, [7, 3]) as [AnalysisContext, AnalysisContext];
    expect([explainedOf(a) + explainedOf(b), billSpend(a) + billSpend(b)]).toEqual([105, 45]);
  });

  it("without a part two members' figures add up to the bill's for every sum and split, and stay inside their cut", () => {
    for (const weights of [[1, 2], [2, 3], [7, 3], [1, 9]]) {
      for (const cents of [3, 7, 19, 100, 101, 150, 20001]) {
        for (const e of [1, 2, Math.floor(cents / 2), cents - 1, cents].filter((x, i, l) => x >= 1 && x <= cents && l.indexOf(x) === i)) {
          const ctxs = viewsWithoutPart(cents, e, weights);
          const label = `${weights} ${cents}/${e}`;
          expect(ctxs.reduce((n, c) => n + explainedOf(c) + billSpend(c), 0), label).toBe(cents);
          expect(ctxs.reduce((n, c) => n + explainedOf(c), 0), label).toBe(e);
          for (const c of ctxs) expect(explainedOf(c) >= 0 && billSpend(c) >= 0, label).toBe(true);
        }
      }
    }
  });

  it("the sum rule is on the whole bill, never on the viewer's cut", () => {
    // each member's part is 100.00; rows of 150.00 are over their cut and inside the whole bill of 200.00
    const [a, b] = views(20000, [15000], [1, 1]);
    for (const ctx of [a, b]) expect(ctx.statements.get("bill")).toEqual({ read: true });
    expect(a.explained[0]!.spend + b.explained[0]!.spend).toBe(15000);
    // over the whole bill reads none for either
    for (const ctx of views(20000, [20001], [1, 1])) expect(ctx.statements.get("bill")).toEqual({ read: false, reason: "over_bill" });
  });
});

describe("the helpers", () => {
  it("limits the period to 62 days, back from the bill, in real days", () => {
    expect(periodProblem("2026-02-01", "2026-02-28", "2026-03-10")).toBeNull();
    expect(periodProblem("2026-02-01", "2026-03-10", "2026-03-10")).toBeNull();
    expect(periodProblem("2026-02-01", "2026-03-11", "2026-03-10")).toBe("after_bill");
    expect(periodProblem("2026-02-28", "2026-02-01", "2026-03-10")).toBe("order");
    expect(periodProblem("2026-01-01", "2026-03-10", "2026-03-10")).toBe("too_long");
    expect(periodProblem("2026-01-08", "2026-03-10", "2026-03-10")).toBeNull();
    expect(periodProblem("2026-01-06", "2026-01-31", "2026-03-10")).toBe("too_far_back");
    expect(periodProblem("0000-00-00", "2026-02-28", "2026-03-10")).toBe("bad_day");
    expect(periodProblem("2026-02-30", "2026-03-01", "2026-03-10")).toBe("bad_day");
  });
});
