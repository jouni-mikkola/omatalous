/**
 * An instalment service's plan (osamaksu): the same sum in three or more months running is proposed, counted in the
 * fixed costs and asked about ("Montako maksua on vielä jäljellä?"), and never added to a debt total, since its balance
 * is not known. One-off or varying payments (pay later of single purchases), two months and a gap month are none.
 * Made-up names and sums.
 */
import { describe, expect, it } from "vitest";
import { cashAhead } from "../src/analysis/ahead.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { addMonths } from "../src/dates.ts";
import { loanProposals, notLoanMark } from "../src/loan-detect.ts";
import { parsePlanSubject, planSubject } from "../src/plan-answer.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { type Account, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-18";
const range = { from: "2026-10-01", to: TODAY };
const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking", holder: "ESIMERKKI ERKKI" };

/** Klarna rows, one a month for the given months before October (0 = October), each with its own reference. */
const klarna = (euros: (month: number) => number, months: readonly number[]): Transaction[] =>
  months.map((back) => {
    const t = tx({ accountId: "chk", bookingDate: `${addMonths("2026-10", -back)}-12`, amountCents: -Math.round(euros(back) * 100), counterparty: "KLARNA BANK AB", counterpartyIban: "SE4550000000058398257466", description: "LASKU", merchant: normalizeMerchant("KLARNA BANK AB", "LASKU") });
    return { ...t, reference: `5000${back}7` } as Transaction;
  });

function contextOf(rows: Transaction[]) {
  const accounts = [checking];
  const changed = new Map(enrichTransactions(rows, accounts, []).map((t) => [t.id, t]));
  return createContext(rows.map((t) => changed.get(t.id) ?? t), accounts, TODAY);
}

const steady = () => klarna(() => 49.9, [3, 2, 1, 0]);

describe("an instalment service paid the same sum in three months running", () => {
  it("is proposed as a plan nobody has told the end of, whatever the references", () => {
    const [p, ...rest] = loanProposals(contextOf(steady()), NO_INPUTS);
    expect(rest).toEqual([]);
    expect([p!.paymentCents, p!.plan, p!.planAnswer, p!.placed, p!.kind]).toEqual([4990, true, null, true, "instalment"]);
  });

  it("allows a few cents of difference between the payments", () => {
    expect(loanProposals(contextOf(klarna((m) => 49.9 + (m % 2) * 0.03, [3, 2, 1, 0])), NO_INPUTS)).toHaveLength(1);
  });

  it("counts in the fixed costs and in no debt total", () => {
    const board = buildDashboard(contextOf(steady()), range);
    expect(board.fixedMonthlyCents).toBe(4990);
    expect(board.holdings.unsavedLoans).toBeUndefined();
    expect(board.holdings.debtCents).toBe(0);
  });

  it("asks how many payments are left, until it is answered", () => {
    const ctx = contextOf(steady());
    const asked = (inputs: UserInputs) => buildQuestions(ctx, range, inputs).items.filter((q) => q.kind === "plan" || q.kind === "loan").map((q) => [q.kind, "payee" in q ? q.paymentCents : 0]);
    expect(asked(NO_INPUTS)).toEqual([["plan", 4990]]);
    const key = loanProposals(ctx, NO_INPUTS)[0]!.key;
    for (const answer of ["2027-03", null]) {
      expect(asked({ ...NO_INPUTS, marks: [{ subject: planSubject(answer, key), mark: "in_use", markedAt: "2026-10-18T10:00:00Z" }] })).toEqual([]);
    }
  });

  it("reads the last month as told, and unknown", () => {
    const ctx = contextOf(steady());
    const key = loanProposals(ctx, NO_INPUTS)[0]!.key;
    const said = (answer: string | null) => loanProposals(ctx, { ...NO_INPUTS, marks: [{ subject: planSubject(answer, key), mark: "in_use", markedAt: "2026-10-18T10:00:00Z" }] })[0]!.planAnswer;
    expect(said("2027-01")).toEqual({ known: true, endMonth: "2027-01" });
    expect(said(null)).toEqual({ known: false });
  });

  it("takes only a sound answer subject", () => {
    const key = "out:chk:Klarna Bank Ab#4990";
    expect(parsePlanSubject(planSubject("2027-03", key))).toEqual({ endMonth: "2027-03", key });
    expect(parsePlanSubject(planSubject(null, key))).toEqual({ endMonth: null, key });
    for (const bad of ["question:plan-end:2027-13:" + key, "question:plan-end:" + key, "question:plan-end:2027-03:nonsense", "question:plan-left:6:" + key]) expect(parsePlanSubject(bad)).toBeNull();
  });

  it("is set aside by Ei laina", () => {
    const ctx = contextOf(steady());
    const marked: UserInputs = { ...NO_INPUTS, marks: [{ ...notLoanMark(loanProposals(ctx, NO_INPUTS)[0]!), markedAt: "2026-10-18T10:00:00Z" }] };
    expect(loanProposals(ctx, marked)).toEqual([]);
  });
});

describe("what is no plan", () => {
  it.each([
    ["two months", klarna(() => 49.9, [1, 0])],
    ["sums that vary", klarna((m) => 40 + 9 * m, [3, 2, 1, 0])],
    ["a gap month", klarna(() => 49.9, [4, 3, 1, 0])],
  ])("%s", (_name, rows) => {
    const ctx = contextOf(rows);
    expect(loanProposals(ctx, NO_INPUTS)).toEqual([]);
    expect(buildQuestions(ctx, range, NO_INPUTS).items.filter((q) => q.kind === "plan")).toEqual([]);
  });

  it("a plan that ended in the spring is no fixed cost and nobody is asked", () => {
    const ctx = contextOf(klarna(() => 49.9, [9, 8, 7, 6]));
    expect(buildDashboard(ctx, range).fixedMonthlyCents).toBe(0);
    expect(buildQuestions(ctx, range, NO_INPUTS).items.filter((q) => q.kind === "plan")).toEqual([]);
  });
});

describe("a plan whose answered last month has passed", () => {
  const ctx = contextOf(steady());
  const key = loanProposals(ctx, NO_INPUTS)[0]!.key;
  const told = (endMonth: string | null): UserInputs => ({ ...NO_INPUTS, marks: [{ subject: planSubject(endMonth, key), mark: "in_use", markedAt: "2026-10-01T10:00:00Z" }] });
  const expected = (inputs: UserInputs) => buildDashboard(ctx, range, [], inputs).fixedMonthlyCents;

  it("is a fixed cost to the end of its last month, and none the month after", () => {
    expect(expected(told("2026-10"))).toBe(4990);
    expect(expected(told("2026-09"))).toBe(0);
  });

  it("stays a fixed cost when the household does not know the end", () => {
    expect(expected(told(null))).toBe(4990);
    expect(expected(NO_INPUTS)).toBe(4990);
  });

  it("is no longer expected in the cash ahead", () => {
    const expects = (inputs: UserInputs) => cashAhead(ctx, [], inputs).rows.some((r) => r.source === "recurring");
    expect(expects(NO_INPUTS)).toBe(true);
    expect(expects(told("2026-10"))).toBe(true);
    expect(expects(told("2026-09"))).toBe(false);
  });
});
