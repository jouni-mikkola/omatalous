/**
 * The basis of each loan figure adds up to the figure Lainat and Varallisuus show, to the cent: the totals, every loan's
 * own figures, at a part too. Made-up loans only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { explainLoan, isLoanFigure } from "../src/explain/loans.ts";
import type { LoanFigureId } from "../src/explain/types.ts";
import { buildHoldings } from "../src/holdings.ts";
import type { BalanceInput } from "../src/reports/balances.ts";
import { loansReport } from "../src/reports/loans.ts";
import type { Account, Loan } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-10-09";
const account = (id: string, name: string, type: Account["type"]): Account => ({ id, name, iban: null, currency: "EUR", type });
const loan = (p: Partial<Loan> & Pick<Loan, "id" | "balanceCents">): Loan => ({
  name: p.id, lender: null, kind: "consumer", grantedCents: null, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null, ...p,
});

function household(loans: Loan[], connected: (BalanceInput & { account: Account })[] = []) {
  const checking = account("acc-1", "Käyttötili", "checking");
  const balances: BalanceInput[] = [{ id: checking.id, name: checking.name, type: checking.type, balanceCents: 200000, ownerName: null, balanceAt: null }, ...connected.map(({ account: _, ...b }) => b)];
  const ctx = createContext([tx({ bookingDate: "2026-09-03", amountCents: -50000 })], [checking, ...connected.map((c) => c.account)], today);
  const inputs = { marks: [], expectedBills: [], loans };
  return { ctx, balances, inputs, report: loansReport(ctx, balances, inputs), holdings: buildHoldings(ctx, balances, inputs) };
}

/** Every loan figure of a household: its basis, checked against the number the page shows. */
function expectAddsUp(h: ReturnType<typeof household>) {
  const basis = (figure: LoanFigureId, id?: string) => {
    const b = explainLoan(figure, h.ctx, h.balances, h.inputs, id);
    expect(b, `${figure} ${id ?? ""}`).not.toBeNull();
    const { explanation: e, names } = b!;
    const sum = e.lines.reduce((s, l) => s + l.cents, 0);
    if (e.cents !== null) {
      expect(e.check, `${figure} ${id ?? ""}`).toEqual({ kind: "sum", diffCents: 0 });
      expect(sum, `${figure} ${id ?? ""}`).toBe(e.cents);
    }
    // every line is named, and nothing else is
    expect(names.map((n) => n.id).sort()).toEqual([...new Set(e.lines.map((l) => l.id))].sort());
    return e.cents;
  };
  const r = h.report;
  expect(basis("loans.total")).toBe(r.total.cents);
  expect(basis("loans.interest")).toBe(r.interest.cents);
  expect(basis("loans.payments")).toBe(r.payments.monthlyCents);
  expect(basis("holdings.loans")).toBe(h.holdings.loansCents);
  for (const l of r.loans) {
    expect(basis("loan.balance", l.id), l.id).toBe(l.balance.cents);
    expect(basis("loan.interest", l.id), l.id).toBe(l.interest.cents);
    expect(basis("loan.payment", l.id), l.id).toBe(l.payment.cents);
  }
  for (const l of h.holdings.loans) expect(basis("loan.monthly", l.id), l.id).toBe(l.monthlyPaymentCents);
}

describe("the basis of a loan figure", () => {
  it("knows the loan figures, and a figure of one loan finds no other loan", () => {
    expect(isLoanFigure("loan.balance")).toBe(true);
    expect(isLoanFigure("spend.month")).toBe(false);
    const h = household([loan({ id: "1", balanceCents: 10000 })]);
    expect(explainLoan("loan.balance", h.ctx, h.balances, h.inputs, "2")).toBeNull();
  });

  it("tells an annuity's balance as told less each amortisation since, and its year's interest payment by payment", () => {
    const a = loan({ id: "1", name: "Asuntolaina", kind: "mortgage", balanceCents: 15_000_000, balanceDate: "2026-06-01", rateBp: 350, repayment: "annuity", intervalMonths: 1, paymentCents: 90_000, endDate: "2045-06-01" });
    const h = household([a]);
    const b = explainLoan("loan.balance", h.ctx, h.balances, h.inputs, "1")!;
    expect(b.explanation.lines.map((l) => l.day)).toEqual(["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(b.names.map((n) => n.merchant)).toEqual(["Saldo, jonka kerroit", "Lyhennys", "Lyhennys", "Lyhennys", "Lyhennys"]);
    const i = explainLoan("loan.interest", h.ctx, h.balances, h.inputs, "1")!;
    expect(i.explanation.lines).toHaveLength(12);
    const p = explainLoan("loan.payment", h.ctx, h.balances, h.inputs, "1")!;
    expect(p.names.map((n) => n.merchant)).toEqual(["Korko", "Lyhennys"]);
    expectAddsUp(h);
  });

  it("spreads a payment due every three months over its months, with a line for what the other months carry", () => {
    const q = loan({ id: "q", balanceCents: 666_000, rateBp: 500, repayment: "equal_principal", intervalMonths: 3, paymentCents: 10_001 });
    const h = household([q]);
    const m = explainLoan("loan.monthly", h.ctx, h.balances, h.inputs, "q")!;
    expect(m.explanation.lines.map((l) => [l.id, l.cents])).toEqual([["interest", 8325], ["amortisation", 10_001], ["spread", 6109 - 18_326]]);
    expect(m.names.at(-1)!.merchant).toBe("Erä jaettuna 3 kuukaudelle");
    expectAddsUp(h);
  });

  it("adds up for every kind of loan: no plan, a bullet, a typed payment, paid off, dated after today, at a part, a connected account", () => {
    const loanAccount = account("acc-loan", "Autolaina", "loan");
    const card = account("acc-card", "Visa", "credit_card");
    const h = household(
      [
        loan({ id: "1", balanceCents: 500_000, rateBp: 420 }),
        loan({ id: "2", balanceCents: 2_000_000, rateBp: 300, repayment: "bullet", endDate: "2029-01-01" }),
        loan({ id: "3", balanceCents: 80_000, paymentCents: 15_000, intervalMonths: 1 }),
        loan({ id: "4", balanceCents: 30_000, balanceDate: "2026-01-01", rateBp: 500, repayment: "annuity", intervalMonths: 1, paymentCents: 20_000 }),
        loan({ id: "5", balanceCents: 30_000, balanceDate: "2026-12-01", rateBp: 500, repayment: "annuity", intervalMonths: 1, paymentCents: 2_000 }),
        loan({ id: "6", balanceCents: 1_000_001, rateBp: 333, repayment: "fixed_instalment", intervalMonths: 2, paymentCents: 33_333, endDate: "2031-03-15" }),
        loan({ id: "7", balanceCents: 30_000, balanceDate: "2026-01-01", repayment: "annuity", intervalMonths: 1, paymentCents: 1_000, endDate: "2026-06-01" }),
      ],
      [
        { account: loanAccount, id: loanAccount.id, name: loanAccount.name, type: "loan", balanceCents: -1_234_567, ownerName: null, balanceAt: null, part: { from: 0, to: 1, of: 3 } },
        { account: card, id: card.id, name: card.name, type: "credit_card", balanceCents: -45_001, ownerName: null, balanceAt: null, part: { from: 1, to: 2, of: 2 } },
      ],
    );
    expect(h.report.loans.some((l) => l.part)).toBe(true);
    expectAddsUp(h);
  });

  it("adds up over many loans of every repayment, interval and rate", () => {
    const repayments = ["annuity", "equal_principal", "fixed_instalment", "bullet", null] as const;
    const loans: Loan[] = [];
    let n = 0;
    for (const repayment of repayments)
      for (const intervalMonths of [1, 3, 12, null])
        for (const rateBp of [0, 199, 487, null]) {
          n++;
          loans.push(loan({ id: String(n), balanceCents: 7_777 * n + 13, balanceDate: n % 2 ? "2025-11-17" : "2026-09-30", rateBp, repayment, intervalMonths, paymentCents: 1_111 * (n % 7) + 99, endDate: n % 3 ? "2034-02-28" : null }));
        }
    expectAddsUp(household(loans));
  });
});
