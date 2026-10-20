/**
 * The loan figures of Lainat and of Varallisuus: what is owed, the interest of the next 12 months and the payments. Each
 * is a calculation, not rows of a range: a total's lines are its loans, a loan's lines are the steps of its own figure
 * (the balance as told and each amortisation since, the interest of each payment, the parts of a payment). Every figure
 * is read from the function that gives the page its number (`loans.ts`, `householdDebts`, `buildHoldings`), so the check
 * compares the page's figure with the lines. A debt at a part is told whole, and one more line takes off the other
 * users' part, cut as `loans.ts` cuts it (`partCents`).
 */
import { partCents } from "../account-use.ts";
import type { AnalysisContext } from "../analysis/context.ts";
import { addMonthsToDate } from "../dates.ts";
import { type Debt, partly } from "../debt-part.ts";
import { buildHoldings } from "../holdings.ts";
import { householdDebts } from "../household-debts.ts";
import { divRound, payments, planOf } from "../loan-plan.ts";
import { debtPaymentsPerMonth, loanBalanceOn, loanInterestNext12Months, loanNextPayment } from "../loans.ts";
import type { BalanceInput, IsoDate, Loan, Part, UserInputs } from "../types.ts";
import type { Explanation, FigureId, Line, LoanFigureId } from "./types.ts";

/** The figures whose basis is a calculation: their door says "Näytä laskelma". */
const LOAN_FIGURES = ["loans.total", "loans.interest", "loans.payments", "holdings.loans", "loan.balance", "loan.interest", "loan.payment", "loan.monthly"] as const satisfies readonly LoanFigureId[];

export const isLoanFigure = (figure: string): figure is LoanFigureId => (LOAN_FIGURES as readonly string[]).includes(figure);

/** The figures of one loan: they need the loan's id. */
export const isOneLoan = (figure: LoanFigureId): boolean => figure.startsWith("loan.");

/** What names a line: a loan by its name, a step of a figure by what it is. */
interface LoanName {
  id: string;
  merchant: string;
  category: string;
}

const sumOf = (lines: readonly Line[]): number => lines.reduce((s, l) => s + l.cents, 0);

const named = (id: string, merchant: string): LoanName => ({ id, merchant, category: "" });

interface Built {
  cents: number | null;
  lines: Line[];
  names: LoanName[];
}

/** A total over loans: one line for each loan with a figure that is not zero, named by the loan. */
function perLoan(day: IsoDate, cents: number | null, loans: readonly { id: string; name: string; cents: number | null }[]): Built {
  const shown = loans.filter((l) => l.cents !== null && l.cents !== 0);
  return {
    cents,
    lines: shown.map((l): Line => ({ id: `loan:${l.id}`, day, cents: l.cents!, why: [] })),
    names: shown.map((l) => named(`loan:${l.id}`, l.name)),
  };
}

/** The line that takes the other users' part off a whole figure: the whole less the viewer's part of it. */
function othersLine(whole: Line[], part: Part, day: IsoDate): { line: Line; name: LoanName } {
  const sum = sumOf(whole);
  return { line: { id: "part", day, cents: partCents(sum, part) - sum, why: [{ rule: "part.use", from: part.from, to: part.to, of: part.of }] }, name: named("part", "Muiden osuus") };
}

/** Whole lines of a loan, then the other users' part where the debt is not all the viewer's. */
function cut(debt: Debt, day: IsoDate, cents: number | null, whole: (loan: Loan) => { lines: Line[]; names: LoanName[] }): Built {
  const c = partly(debt);
  const { lines, names } = whole(c?.whole ?? debt);
  if (!c) return { cents, lines, names };
  const others = othersLine(lines, c.part, day);
  return { cents, lines: [...lines, others.line], names: [...names, others.name] };
}

/** The balance as told, then each amortisation due by the day; with no plan the told balance alone, or nothing left after the last due date. */
function balanceLines(loan: Loan, day: IsoDate): { lines: Line[]; names: LoanName[] } {
  const told: Line = { id: "told", day: loan.balanceDate, cents: loan.balanceCents, why: [] };
  const names = [named("told", loan.id.startsWith("account:") ? "Saldo pankissa" : "Saldo, jonka kerroit")];
  const plan = planOf(loan);
  if ("missing" in plan) {
    if (loanBalanceOn(loan, day).cents !== 0 || loan.balanceCents === 0) return { lines: [told], names };
    return { lines: [told, { id: "end", day: loan.endDate ?? day, cents: -loan.balanceCents, why: [] }], names: [...names, named("end", "Viimeinen eräpäivä")] };
  }
  const paid: Line[] = [];
  for (const p of payments(loan, plan)) {
    if (p.date > day) break;
    paid.push({ id: `paid:${p.date}`, day: p.date, cents: -p.amortisationCents, why: [] });
  }
  return { lines: [told, ...paid], names: [...names, ...paid.map((l) => named(l.id, "Lyhennys"))] };
}

/** The interest part of each payment due in the 12 months after the day; with no plan one line, the rate on the balance. */
function interestLines(loan: Loan, day: IsoDate): { lines: Line[]; names: LoanName[] } {
  const plan = planOf(loan);
  if ("missing" in plan) {
    const cents = loanInterestNext12Months(loan, day).cents ?? 0;
    return cents === 0 ? { lines: [], names: [] } : { lines: [{ id: "rate", day, cents, why: [] }], names: [named("rate", "Korko saldolle vuodessa")] };
  }
  const to = addMonthsToDate(day, 12);
  const lines: Line[] = [];
  for (const p of payments(loan, plan)) {
    if (p.date > to) break;
    if (p.date > day && p.interestCents) lines.push({ id: `interest:${p.date}`, day: p.date, cents: p.interestCents, why: [] });
  }
  return { lines, names: lines.map((l) => named(l.id, "Korko")) };
}

/** A payment as its interest and amortisation where both are known, else the payment as typed. */
function paymentLines(next: ReturnType<typeof loanNextPayment>, day: IsoDate): { lines: Line[]; names: LoanName[] } {
  const on = next.date ?? day;
  if (next.interestCents !== null && next.amortisationCents !== null)
    return {
      lines: [
        { id: "interest", day: on, cents: next.interestCents, why: [] },
        { id: "amortisation", day: on, cents: next.amortisationCents, why: [] },
      ].filter((l) => l.cents !== 0),
      names: [named("interest", "Korko"), named("amortisation", "Lyhennys")],
    };
  return next.cents === null ? { lines: [], names: [] } : { lines: [{ id: "payment", day: on, cents: next.cents, why: [] }], names: [named("payment", "Maksuerä, jonka kerroit")] };
}

/** A month of a payment: the payment, and where it falls due every N months the part of it the other months carry. */
function monthlyLines(loan: Loan, day: IsoDate): { lines: Line[]; names: LoanName[] } {
  const next = loanNextPayment(loan, day);
  const { lines, names } = paymentLines(next, day);
  const months = next.intervalMonths;
  if (next.cents === null || months === null || months === 1) return { lines, names };
  const spread: Line = { id: "spread", day: next.date ?? day, cents: divRound(next.cents, months) - next.cents, why: [] };
  return { lines: [...lines, spread], names: [...names, named("spread", `Erä jaettuna ${months} kuukaudelle`)] };
}

/**
 * The basis of a loan figure as the page shows it: the view's debts (`householdDebts`) on the context's today, and
 * `loanId` the loan of a figure of one loan. Null when the view has no such loan.
 */
export function explainLoan(figure: LoanFigureId, ctx: AnalysisContext, balances: readonly BalanceInput[], inputs: UserInputs, loanId?: string): { explanation: Explanation; names: LoanName[] } | null {
  const debts = householdDebts(balances, inputs, ctx.today);
  const { day } = debts;
  const built = ((): Built | null => {
    switch (figure) {
      case "loans.total":
        return perLoan(day, debts.total.cents, debts.loans.map((l) => ({ id: l.id, name: l.name, cents: loanBalanceOn(l, day).cents })));
      case "loans.interest":
        return perLoan(day, debts.interest.cents, debts.loans.map((l) => ({ id: l.id, name: l.name, cents: loanInterestNext12Months(l, day).cents })));
      case "loans.payments": {
        const all = debtPaymentsPerMonth(debts.loans, day);
        return perLoan(day, all.monthlyCents, debts.loans.map((l) => ({ id: l.id, name: l.name, cents: monthlyOf(l, day) })));
      }
      case "holdings.loans": {
        const h = buildHoldings(ctx, balances, inputs);
        return perLoan(day, h.loansCents, h.loans.map((l) => ({ id: l.id, name: l.name, cents: l.leftCents })));
      }
      default: {
        const debt = debts.loans.find((l) => l.id === loanId);
        if (!debt) return null;
        if (figure === "loan.balance") return cut(debt, day, loanBalanceOn(debt, day).cents, (l) => balanceLines(l, day));
        if (figure === "loan.interest") return cut(debt, day, loanInterestNext12Months(debt, day).cents, (l) => interestLines(l, day));
        // the payment of a debt at a part is the sum of its cut parts (`loanNextPayment`), so its lines are those parts
        if (figure === "loan.payment") return { cents: loanNextPayment(debt, day).cents, ...paymentLines(loanNextPayment(debt, day), day) };
        return cut(debt, day, monthlyOf(debt, day), (l) => monthlyLines(l, day));
      }
    }
  })();
  if (!built) return null;
  const { cents, lines, names } = built;
  return {
    explanation: { figure: figure satisfies FigureId, kind: "sum", cents, lines, check: cents === null ? { kind: "n/a" } : { kind: "sum", diffCents: cents - sumOf(lines) } },
    names: names.filter((n) => lines.some((l) => l.id === n.id)),
  };
}

/** One loan's month (`debtPaymentsPerMonth` of it alone); null where it has none to count. */
function monthlyOf(debt: Debt, day: IsoDate): number | null {
  const one = debtPaymentsPerMonth([debt], day);
  return one.counted ? one.monthlyCents : null;
}
