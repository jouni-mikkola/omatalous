/**
 * Säästövinkit's two tables that compare: each area's tips against the money they live in (`reachOf`), and what a move
 * of the reference rate does to each loan (`loanRatesOf`). Every figure is core's, so the page subtracts nothing.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../../src/analysis/context.ts";
import { loanInterestNext12Months, loanNextPayment, loanRateScenario } from "../../src/loans.ts";
import { type AreaView, type Finding, headlineOf, loanRatesOf, reachOf } from "../../src/optimise/index.ts";
import type { BalanceInput } from "../../src/reports/balances.ts";
import type { Loan } from "../../src/types.ts";
import { tx } from "../helpers.ts";

const TODAY = "2026-10-09";
const MONTHS = ["2026-07", "2026-08", "2026-09"];

function finding(p: Partial<Finding> & Pick<Finding, "id" | "area">): Finding {
  return {
    kind: "k",
    subject: null,
    title: "",
    action: "",
    euros: { lowCents: 10000, midCents: 20000, highCents: 30000 },
    decideBy: null,
    weaknesses: [],
    shared: false,
    calc: [],
    rows: [],
    struck: [],
    claims: [],
    measure: { kind: "category", keys: ["restaurants"] },
    facts: [],
    certainty: { level: "keskitaso", reason: "" },
    ...p,
  };
}

const area = (id: AreaView["id"], findings: Finding[]): AreaView => ({ id, label: id, findings, checks: [], weightCents: 0 });

describe("reachOf", () => {
  const ctx = createContext(
    [
      tx({ bookingDate: "2026-06-10", amountCents: -99900, category: "restaurants", merchant: "Old" }),
      ...MONTHS.map((m) => tx({ bookingDate: `${m}-10`, amountCents: -10000, category: "restaurants", merchant: "Hesburger" })),
      ...MONTHS.map((m) => tx({ bookingDate: `${m}-12`, amountCents: -5000, category: "fast_food", merchant: "Hesburger" })),
      ...MONTHS.map((m) => tx({ bookingDate: `${m}-15`, amountCents: -40000, category: "groceries", merchant: "K-Market" })),
    ],
    [],
    TODAY,
  );

  it("sums an area's tips as the headline does and counts each row of the window once, the largest mid first", () => {
    // two tips over the same rows: the restaurants are counted once; the fast food tip shares no claim, so both sum
    const habits = area("habits", [
      finding({ id: "habits:a", area: "habits", measure: { kind: "category", keys: ["restaurants"] }, claims: ["category:restaurants"] }),
      finding({ id: "habits:b", area: "habits", measure: { kind: "merchants", keys: ["Hesburger"] }, claims: ["merchant:Hesburger"], euros: { lowCents: 1000, midCents: 2000, highCents: 3000 } }),
    ]);
    const food = area("food", [finding({ id: "food:a", area: "food", measure: { kind: "category", keys: ["groceries"] }, euros: { lowCents: 30000, midCents: 60000, highCents: 90000 } })]);
    const r = reachOf(ctx, [habits, food], MONTHS);
    expect(r.map((x) => x.area)).toEqual(["food", "habits"]);
    const h = r[1]!;
    const { count, ...euros } = headlineOf(habits.findings);
    expect(h.euros).toEqual(euros);
    expect(h.count).toBe(count);
    // three restaurant rows and three Hesburger fast food rows, June outside the window
    expect(h.spendCents).toBe(3 * 10000 + 3 * 5000);
    expect(h.share).toBeCloseTo(22000 / 45000);
    expect(r[0]!.spendCents).toBe(120000);
  });

  it("leaves out an area the headline counts nothing of, and gives no spend to tips that measure nothing", () => {
    const shared = area("housing", [finding({ id: "housing:a", area: "housing", shared: true })]);
    const deadline = area("tax", [finding({ id: "tax:a", area: "tax", measure: { kind: "none", keys: [] } })]);
    const r = reachOf(ctx, [shared, deadline], MONTHS);
    expect(r).toEqual([{ area: "tax", euros: { lowCents: 10000, midCents: 20000, highCents: 30000 }, count: 1, spendCents: null, share: null }]);
  });
});

describe("loanRatesOf", () => {
  const loan = (p: Partial<Loan> & Pick<Loan, "id" | "balanceCents">): Loan => ({
    name: p.id, lender: null, kind: "mortgage", grantedCents: null, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null, ...p,
  });
  const balances: BalanceInput[] = [];
  const inputs = (loans: Loan[]) => ({ marks: [], expectedBills: [], loans });

  it("tells each move with its change against today's payment and interest, from the same functions as the loan report", () => {
    const home = loan({ id: "koti", lender: "Nordea", balanceCents: 15000000, rateBp: 350, marginBp: 60, reference: "euribor_12", repayment: "annuity", intervalMonths: 1, paymentCents: 90000 });
    const [r] = loanRatesOf(balances, inputs([home]), TODAY);
    expect(r).toMatchObject({ loanId: "koti", lender: "Nordea", reference: "12 kuukauden Euribor", rateBp: 350, intervalMonths: 1 });
    const now = loanNextPayment(home, TODAY).cents!;
    const interest = loanInterestNext12Months(home, TODAY).cents!;
    expect(r!.paymentCents).toBe(now);
    expect(r!.moves.map((m) => m.shiftBp)).toEqual([-100, 100, 200]);
    for (const m of r!.moves) {
      const s = loanRateScenario(home, TODAY, m.shiftBp);
      expect(m.paymentCents).toBe(s.paymentCents);
      expect(m.paymentChangeCents).toBe(s.paymentCents! - now);
      expect(m.interestChangeCents).toBe(s.interestCents! - interest);
    }
    expect(r!.moves[0]!.paymentChangeCents).toBeLessThan(0);
    expect(r!.moves[2]!.paymentChangeCents).toBeGreaterThan(r!.moves[1]!.paymentChangeCents!);
  });

  it("gives a fixed rate no moves and leaves out a loan that owes nothing and a card", () => {
    const fixed = loan({ id: "kiintea", balanceCents: 500000, rateBp: 400, reference: "fixed", repayment: "annuity", intervalMonths: 1, paymentCents: 20000 });
    const paid = loan({ id: "maksettu", balanceCents: 0, rateBp: 400, reference: "euribor_3" });
    const card = loan({ id: "kortti", kind: "card", balanceCents: 120000, rateBp: 1500 });
    const r = loanRatesOf(balances, inputs([fixed, paid, card]), TODAY);
    expect(r.map((l) => [l.loanId, l.reference, l.moves.length])).toEqual([["kiintea", "Kiinteä korko", 0]]);
  });
});
