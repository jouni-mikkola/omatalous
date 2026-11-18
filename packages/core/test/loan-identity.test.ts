import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addDays } from "../src/dates.ts";
import { debtPath } from "../src/loan-path.ts";
import { debtInterestNext12Months, debtPaymentsPerMonth, debtTotalOn, loanBalanceOn, loanInterestNext12Months, loanNextPayment, loanPayoffDate, loanRateScenario, loansOf } from "../src/loans.ts";
import { type Loan, NO_INPUTS } from "../src/types.ts";
import fixture from "./fixtures/loan-identity.json";

/**
 * Decision: whether the loan figures of the household changed when the schedule replaced the payment list.
 *
 * With no fixings every figure of every loan must be what it was before the schedule: to the cent. `fixtures/loan-identity.json`
 * holds the figures of the code before the schedule (generated with a throwaway script run on that tree, not kept) for the
 * loans of loans.test.ts and loan-path.test.ts and for loans made up from a fixed seed: every repayment type, a balloon,
 * a bullet, a card and a credit line, month-end balance dates, a zero rate, balances up to the route's limit and rates
 * up to its limit, with and without a reference rate and margin. Each case has four days (before the balance date, the
 * balance date, 47 days on, 700 days on) and every figure function.
 *
 * The one difference the design allows is a `loanRateScenario` payment of an annuity at a changed rate, which may be one
 * cent off: the old code scaled it by the ratio of annuity shares and the new one rounds half up once. No case of the
 * fixture shows it, so `ONE_CENT_PAYMENTS` is empty. A case that does would be named there with its day and shift, and
 * its payment would then be asserted one cent off, never more.
 */
const ONE_CENT_PAYMENTS: Record<string, number> = {};

const BASE: Loan = {
  id: "loan-1",
  name: "Laina",
  lender: null,
  kind: "consumer",
  grantedCents: null,
  balanceCents: 100_000,
  balanceDate: "2026-01-15",
  rateBp: null,
  reference: null,
  marginBp: null,
  repayment: null,
  intervalMonths: null,
  paymentCents: null,
  endDate: null,
  limitCents: null,
  seriesKey: null,
};

type Figures = Record<string, unknown>;
interface Case extends Figures {
  name: string;
  loan: Partial<Loan>;
  days: string[];
}
interface Group {
  from: number;
  count: number;
  day: string;
  total: unknown;
  interest: unknown;
  perMonth: unknown;
  path: unknown;
}
const { cases, groups } = fixture as unknown as { cases: Case[]; groups: Group[] };

const SHIFTS = [0, 100, -1000];
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex").slice(0, 16);
const monthly = (r: ReturnType<typeof debtPaymentsPerMonth>) => [r.monthlyCents, r.counted, r.unknown, r.bullets];
const pathOf = (loans: readonly Loan[], day: string, shifts: number[]) => {
  const p = debtPath(loans, day, shifts);
  return p === null ? null : [p.days.length, p.payoff, p.tops[0], digest(p)];
};
const loanOf = (c: Case, index: number): Loan => ({ ...BASE, ...c.loan, id: `loan-${index + 1}` });

/** The figures of one loan on the days of its case, in the shape of the fixture. */
function figuresOf(loan: Loan, days: string[]): Figures {
  const [only] = loansOf({ ...NO_INPUTS, loans: [loan] });
  const l = only!;
  const payoff = loanPayoffDate(l);
  return {
    balance: days.map((d) => [loanBalanceOn(l, d).cents, loanBalanceOn(l, d).unknown]),
    interest: days.map((d) => [loanInterestNext12Months(l, d).cents, loanInterestNext12Months(l, d).unknown]),
    next: days.map((d) => {
      const n = loanNextPayment(l, d);
      return [n.cents, n.interestCents, n.amortisationCents, n.intervalMonths, n.date, n.unknown];
    }),
    perMonth: days.map((d) => monthly(debtPaymentsPerMonth([l], d))),
    scenarios: days.slice(1).map((d) =>
      SHIFTS.map((s) => {
        const r = loanRateScenario(l, d, s);
        return [r.shiftBp, r.movedBp, r.rateBp, r.paymentCents, r.interestCents, r.unknown];
      }),
    ),
    payoff: [payoff.date, payoff.unknown, payoff.never ?? null],
    paths: days.map((d) => pathOf([l], d, [0, 100, -100])),
  };
}

/** The fixture's scenarios with the one-cent payments of `ONE_CENT_PAYMENTS` applied to what the old code gave. */
function withOneCent(c: Case): unknown {
  const scenarios = (c["scenarios"] as unknown[][][]).map((day, di) =>
    day.map((row, si) => {
      const cents = ONE_CENT_PAYMENTS[`${c.name}|${c.days[di + 1]}|${SHIFTS[si]}`];
      if (cents === undefined) return row;
      expect(Math.abs(cents)).toBe(1);
      return row.map((v, i) => (i === 3 ? (v as number) + cents : v));
    }),
  );
  return scenarios;
}

describe("the schedule changes no figure of a loan with no fixings", () => {
  it("the fixture holds every kind of loan and the days around it", () => {
    expect(cases.length).toBeGreaterThan(100);
    const kinds = new Set(cases.map((c) => `${c.loan.kind ?? "consumer"}:${c.loan.repayment ?? "none"}`));
    for (const kind of ["consumer:annuity", "consumer:equal_principal", "consumer:fixed_instalment", "consumer:bullet", "consumer:none", "card:none", "credit_line:none"]) expect(kinds).toContain(kind);
    expect(cases.some((c) => c.loan.repayment === "fixed_instalment" && c.loan.endDate !== undefined)).toBe(true);
    expect(cases.some((c) => c.loan.rateBp === 0)).toBe(true);
    expect(cases.some((c) => (c.loan.balanceCents ?? 0) >= 987_654_321)).toBe(true);
    expect(cases.some((c) => String(c.loan.balanceDate).endsWith("-31"))).toBe(true);
    for (const c of cases) expect(c.days).toEqual([addDays(c.days[1]!, -5), c.days[1], addDays(c.days[1]!, 47), addDays(c.days[1]!, 700)]);
  });

  it.each(cases.map((c, i) => [c.name, i] as const))("%s", (_name, index) => {
    const c = cases[index]!;
    const now = figuresOf(loanOf(c, index), c.days);
    for (const key of ["balance", "interest", "next", "perMonth", "payoff", "paths"]) expect(now[key], key).toEqual(c[key]);
    expect(now["scenarios"], "scenarios").toEqual(withOneCent(c));
  });

  it.each(groups.map((g) => [`${g.from} to ${g.from + g.count - 1} on ${g.day}`, g] as const))("the loans %s together", (_name, g) => {
    const members = cases.slice(g.from, g.from + g.count).map((c, i) => loanOf(c, g.from + i));
    const loans = loansOf({ ...NO_INPUTS, loans: members });
    const total = debtTotalOn(loans, g.day);
    expect([[total.cents, total.unknown], debtInterestNext12Months(loans, g.day), monthly(debtPaymentsPerMonth(loans, g.day)), pathOf(loans, g.day, [0, 100, -100])]).toEqual([g.total, g.interest, g.perMonth, g.path]);
  });
});
