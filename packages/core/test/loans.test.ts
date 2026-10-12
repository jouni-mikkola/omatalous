import { describe, expect, it } from "vitest";
import { addDays } from "../src/dates.ts";
import {
  creditAccountLoan,
  creditUse,
  debtInterestNext12Months,
  debtTotalOn,
  loanBalanceOn,
  loanInterestNext12Months,
  loanPayoffDate,
  loanPeriodInterest,
  loansOf,
  MAX_LOAN_PAYMENTS,
} from "../src/loans.ts";
import { INPUT_DEFS } from "../src/optimise/inputs.ts";
import { isRevolving, LOAN_KINDS, LOAN_REFERENCES, type Loan, NO_INPUTS } from "../src/types.ts";

/** A loan with nothing but a balance: each test adds the fields its figure needs. */
const loan = (over: Partial<Loan> = {}): Loan => ({
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
  ...over,
});

const dayBefore = (date: string) => addDays(date, -1);

describe("the rounding rule", () => {
  it("rounds the interest of an interval to the nearest cent, a half cent up", () => {
    // 600,00 € at 0,01 % for a month is 0,5 cents
    expect(loanPeriodInterest(60_000, 1, 1)).toBe(1);
    expect(loanPeriodInterest(59_999, 1, 1)).toBe(0);
    // 1 000,00 € at 3,25 %: 270,83 cents a month, 812,5 cents a quarter, 32,50 € a year
    expect(loanPeriodInterest(100_000, 325, 1)).toBe(271);
    expect(loanPeriodInterest(100_000, 325, 3)).toBe(813);
    expect(loanPeriodInterest(100_000, 325, 12)).toBe(3250);
    expect(loanPeriodInterest(100_000, 0, 1)).toBe(0);
  });

});

describe("an annuity", () => {
  // 1 000,00 € at 12 % a year, 1 % a month, 200,00 € a month. Worked by hand:
  //   due         interest  amortisation  owed after
  //   2026-02-15    10,00      190,00       810,00
  //   2026-03-15     8,10      191,90       618,10
  //   2026-04-15     6,18      193,82       424,28    (6,181 rounds down)
  //   2026-05-15     4,24      195,76       228,52    (4,2428 rounds down)
  //   2026-06-15     2,29      197,71        30,81    (2,2852 rounds up)
  //   2026-07-15     0,31       30,81         0,00    the last payment is 31,12
  const l = loan({ rateBp: 1200, repayment: "annuity", intervalMonths: 1, paymentCents: 20_000 });
  const schedule = [
    ["2026-02-15", 1000, 19_000, 81_000],
    ["2026-03-15", 810, 19_190, 61_810],
    ["2026-04-15", 618, 19_382, 42_428],
    ["2026-05-15", 424, 19_576, 22_852],
    ["2026-06-15", 229, 19_771, 3081],
    ["2026-07-15", 31, 3081, 0],
  ] as const;

  it("follows the hand-worked schedule, and each payment's parts add up to it", () => {
    let owed = l.balanceCents;
    for (const [date, interest, amortisation, after] of schedule) {
      expect(loanBalanceOn(l, dayBefore(date))).toEqual({ cents: owed, unknown: null });
      expect(loanBalanceOn(l, date)).toEqual({ cents: after, unknown: null });
      expect(loanPeriodInterest(owed, 1200, 1)).toBe(interest);
      expect(Math.min(20_000, owed + interest) - interest).toBe(amortisation);
      owed = after;
    }
    expect(schedule.reduce((sum, row) => sum + row[2], 0)).toBe(100_000);
  });

  it("ends on the due date that pays the rest, and its interest is the interest parts still to come", () => {
    expect(loanPayoffDate(l)).toEqual({ date: "2026-07-15", unknown: null, never: false });
    expect(loanInterestNext12Months(l, "2026-01-15")).toEqual({ cents: 1000 + 810 + 618 + 424 + 229 + 31, unknown: null });
    // the payment due on the day itself is paid already, the four after it are left
    expect(loanInterestNext12Months(l, "2026-03-15")).toEqual({ cents: 618 + 424 + 229 + 31, unknown: null });
    expect(loanInterestNext12Months(l, "2026-04-15")).toEqual({ cents: 424 + 229 + 31, unknown: null });
    expect(loanInterestNext12Months(l, "2027-01-01")).toEqual({ cents: 0, unknown: null });
  });

  it("counts a fixed instalment the same way", () => {
    const fixed = { ...l, repayment: "fixed_instalment" as const };
    for (const [date] of schedule) expect(loanBalanceOn(fixed, date)).toEqual(loanBalanceOn(l, date));
    expect(loanPayoffDate(fixed)).toEqual(loanPayoffDate(l));
  });

  it("counts a year's interest as the 12 payments due in it", () => {
    // 150 000,00 € at 3,25 %, 850,00 € a month: 406,25 of the first payment is interest, 405,05 of the second
    const mortgage = loan({ kind: "mortgage", balanceCents: 15_000_000, rateBp: 325, repayment: "annuity", intervalMonths: 1, paymentCents: 85_000 });
    expect(loanPeriodInterest(15_000_000, 325, 1)).toBe(40_625);
    expect(loanBalanceOn(mortgage, "2026-03-15").cents).toBe(15_000_000 - 44_375 - (85_000 - 40_505));
    let owed = 15_000_000;
    let interest = 0;
    for (let i = 0; i < 12; i++) {
      const part = Math.round((owed * 325) / 120_000);
      interest += part;
      owed -= 85_000 - part;
    }
    expect(loanInterestNext12Months(mortgage, "2026-01-15").cents).toBe(interest);
    expect(loanBalanceOn(mortgage, "2027-01-15").cents).toBe(owed);
  });
});

describe("equal principal", () => {
  // 1 200,00 € at 4 % a year, 1 % a quarter, 400,00 € off each quarter and the interest on top: 12,00, 8,00 and 4,00
  const l = loan({ balanceCents: 120_000, balanceDate: "2026-01-10", rateBp: 400, repayment: "equal_principal", intervalMonths: 3, paymentCents: 40_000 });

  it("takes the same amortisation off each time and the interest comes on top", () => {
    expect(loanBalanceOn(l, "2026-04-09").cents).toBe(120_000);
    expect(loanBalanceOn(l, "2026-04-10").cents).toBe(80_000);
    expect(loanBalanceOn(l, "2026-07-10").cents).toBe(40_000);
    expect(loanBalanceOn(l, "2026-10-10").cents).toBe(0);
    expect(loanInterestNext12Months(l, "2026-01-10")).toEqual({ cents: 2400, unknown: null });
    expect(loanPayoffDate(l).date).toBe("2026-10-10");
  });

  it("pays what is left with the last payment", () => {
    const odd = { ...l, balanceCents: 100_000 };
    expect(loanBalanceOn(odd, "2026-07-10").cents).toBe(20_000);
    expect(loanBalanceOn(odd, "2026-10-10").cents).toBe(0);
    expect(loanPayoffDate(odd).date).toBe("2026-10-10");
  });

  it("moves the balance without a rate, and tells no interest", () => {
    const bare = { ...l, rateBp: null };
    expect(loanBalanceOn(bare, "2026-07-10")).toEqual({ cents: 40_000, unknown: null });
    expect(loanPayoffDate(bare).date).toBe("2026-10-10");
    expect(loanInterestNext12Months(bare, "2026-01-10")).toEqual({ cents: null, unknown: "rate" });
  });
});

describe("a bullet loan", () => {
  // 10 000,00 € at 5 %, all of it due on 30.6.2027
  const l = loan({ balanceCents: 1_000_000, rateBp: 500, repayment: "bullet", endDate: "2027-06-30" });

  it("keeps its balance until the last due date and ends there", () => {
    expect(loanBalanceOn(l, "2027-06-29")).toEqual({ cents: 1_000_000, unknown: null });
    expect(loanBalanceOn(l, "2027-06-30")).toEqual({ cents: 0, unknown: null });
    expect(loanPayoffDate(l)).toEqual({ date: "2027-06-30", unknown: null, never: false });
  });

  it("owes a year's interest, or the days up to the last due date", () => {
    expect(loanInterestNext12Months(l, "2026-01-15")).toEqual({ cents: 50_000, unknown: null });
    expect(loanInterestNext12Months(l, "2026-06-30")).toEqual({ cents: 50_000, unknown: null });
    // from 30.12.2026 the loan is owed 182 of the 365 days: 500,00 × 182 / 365 = 249,315
    expect(loanInterestNext12Months(l, "2026-12-30")).toEqual({ cents: 24_932, unknown: null });
    expect(loanInterestNext12Months(l, "2027-06-30")).toEqual({ cents: 0, unknown: null });
  });

  it("without a last due date keeps its balance and says what is missing", () => {
    const open = { ...l, endDate: null };
    expect(loanBalanceOn(open, "2030-01-01")).toEqual({ cents: 1_000_000, unknown: "end_date" });
    expect(loanPayoffDate(open)).toEqual({ date: null, unknown: "end_date", never: false });
    expect(loanInterestNext12Months(open, "2026-01-15")).toEqual({ cents: 50_000, unknown: "end_date" });
  });
});

describe("a last due date", () => {
  // 5 000,00 € at 6 %, 0,5 % a month, 100,00 € a month, the rest on 5.1.2027. Worked by hand:
  //   2026-11-05   25,00 interest,   75,00 off, 4 925,00 left
  //   2026-12-05   24,63 interest (24,625 is a half cent, up), 75,37 off, 4 849,63 left
  //   2027-01-05   24,25 interest (24,24815), all 4 849,63 falls due
  const l = loan({ kind: "car", balanceCents: 500_000, balanceDate: "2026-10-12", rateBp: 600, repayment: "annuity", intervalMonths: 1, paymentCents: 10_000, endDate: "2027-01-05" });

  it("sets the due dates and takes what is left", () => {
    expect(loanBalanceOn(l, "2026-11-04").cents).toBe(500_000);
    expect(loanBalanceOn(l, "2026-11-05").cents).toBe(492_500);
    expect(loanBalanceOn(l, "2026-12-05").cents).toBe(484_963);
    expect(loanBalanceOn(l, "2027-01-04").cents).toBe(484_963);
    expect(loanBalanceOn(l, "2027-01-05").cents).toBe(0);
    expect(loanPayoffDate(l).date).toBe("2027-01-05");
    expect(loanInterestNext12Months(l, "2026-10-12").cents).toBe(2500 + 2463 + 2425);
  });

  it("counts quarterly due dates back from it, and leaves out one on or before the balance date", () => {
    // 1 000,00 € told on 10.1.2026, 300,00 € off a quarter: due 20.3., 20.6., 20.9. and the rest on 20.12.
    const q = loan({ balanceDate: "2026-01-10", repayment: "equal_principal", intervalMonths: 3, paymentCents: 30_000, endDate: "2026-12-20" });
    expect(loanBalanceOn(q, "2026-03-19").cents).toBe(100_000);
    expect(loanBalanceOn(q, "2026-03-20").cents).toBe(70_000);
    expect(loanBalanceOn(q, "2026-09-20").cents).toBe(10_000);
    expect(loanPayoffDate(q).date).toBe("2026-12-20");
    // a year to 5.1.2027: 5.1.2026 is before the balance date, so 5.4., 5.7., 5.10. and 5.1. are left
    const year = { ...q, endDate: "2027-01-05" };
    expect(loanBalanceOn(year, "2026-04-04").cents).toBe(100_000);
    expect(loanBalanceOn(year, "2026-04-05").cents).toBe(70_000);
    expect(loanBalanceOn(year, "2026-10-05").cents).toBe(10_000);
    expect(loanPayoffDate(year).date).toBe("2027-01-05");
  });

  it("ends a loan that has no plan, and is ignored when it is not after the balance date", () => {
    const noPlan = loan({ endDate: "2026-12-31", rateBp: 365 });
    expect(loanBalanceOn(noPlan, "2026-12-30")).toEqual({ cents: 100_000, unknown: "repayment" });
    expect(loanBalanceOn(noPlan, "2026-12-31")).toEqual({ cents: 0, unknown: null });
    expect(loanPayoffDate(noPlan)).toEqual({ date: "2026-12-31", unknown: null, never: false });
    const stale = loan({ endDate: "2026-01-15" });
    expect(loanBalanceOn(stale, "2026-06-01")).toEqual({ cents: 100_000, unknown: "repayment" });
    expect(loanPayoffDate(stale)).toEqual({ date: null, unknown: "repayment", never: false });
  });
});

describe("what a loan does not say", () => {
  const full = loan({ rateBp: 1200, repayment: "annuity", intervalMonths: 1, paymentCents: 20_000 });

  it("keeps the stated balance and names the first missing field of the plan", () => {
    for (const [over, unknown] of [
      [{ repayment: null }, "repayment"],
      [{ intervalMonths: null }, "interval"],
      [{ intervalMonths: 0 }, "interval"],
      [{ paymentCents: null }, "payment"],
      [{ paymentCents: 0 }, "payment"],
      [{ rateBp: null }, "rate"],
    ] as const) {
      const l = { ...full, ...over };
      expect(loanBalanceOn(l, "2026-06-15")).toEqual({ cents: 100_000, unknown });
      expect(loanPayoffDate(l)).toEqual({ date: null, unknown, never: false });
    }
  });

  it("has no interest figure without a rate, and a year on the stated balance without a plan", () => {
    expect(loanInterestNext12Months({ ...full, rateBp: null }, "2026-01-15")).toEqual({ cents: null, unknown: "rate" });
    expect(loanInterestNext12Months(loan({ rateBp: 325 }), "2026-01-15")).toEqual({ cents: 3250, unknown: "repayment" });
  });
});

describe("the balance date", () => {
  const l = loan({ balanceDate: "2026-11-01", rateBp: 1200, repayment: "annuity", intervalMonths: 1, paymentCents: 20_000 });

  it("in the future: nothing is known before it", () => {
    expect(loanBalanceOn(l, "2026-10-12")).toEqual({ cents: null, unknown: "before_balance_date" });
    expect(loanInterestNext12Months(l, "2026-10-12")).toEqual({ cents: null, unknown: "before_balance_date" });
    expect(creditUse({ ...l, limitCents: 200_000 }, "2026-10-12").unknown).toBe("before_balance_date");
    expect(loanBalanceOn(l, "2026-11-01")).toEqual({ cents: 100_000, unknown: null });
    expect(loanPayoffDate(l).date).toBe("2027-05-01");
  });

  it("far in the past: the plan has run its course", () => {
    // 6 000,00 € told on 15.1.2016, 100,00 € off a month: 60 payments, the last on 15.1.2021
    const old = loan({ balanceCents: 600_000, balanceDate: "2016-01-15", rateBp: 500, repayment: "equal_principal", intervalMonths: 1, paymentCents: 10_000 });
    expect(loanBalanceOn(old, "2018-07-14").cents).toBe(310_000);
    expect(loanBalanceOn(old, "2018-07-15").cents).toBe(300_000);
    expect(loanBalanceOn(old, "2026-10-12")).toEqual({ cents: 0, unknown: null });
    expect(loanPayoffDate(old).date).toBe("2021-01-15");
    expect(loanInterestNext12Months(old, "2026-10-12")).toEqual({ cents: 0, unknown: null });
    // 30 years of a mortgage told long ago still walk: 20 000,00 € a year off 600 000,00 €
    const long = loan({ balanceCents: 60_000_000, balanceDate: "1996-10-12", repayment: "equal_principal", intervalMonths: 12, paymentCents: 2_000_000 });
    expect(loanBalanceOn(long, "2026-10-11").cents).toBe(60_000_000 - 29 * 2_000_000);
    expect(loanBalanceOn(long, "2026-10-12").cents).toBe(0);
  });
});

describe("a rate of zero", () => {
  it("is a rate: the interest is zero and every payment is amortisation", () => {
    const l = loan({ rateBp: 0, repayment: "annuity", intervalMonths: 1, paymentCents: 30_000 });
    expect(loanBalanceOn(l, "2026-04-15").cents).toBe(10_000);
    expect(loanPayoffDate(l).date).toBe("2026-05-15");
    expect(loanInterestNext12Months(l, "2026-01-15")).toEqual({ cents: 0, unknown: null });
  });
});

describe("a payment smaller than the interest", () => {
  // 10 000,00 € at 12 %: 100,00 € of interest a month against a payment of 80,00 €
  const l = loan({ balanceCents: 1_000_000, rateBp: 1200, repayment: "annuity", intervalMonths: 1, paymentCents: 8000 });

  it("grows the balance and gives no payoff date", () => {
    expect(loanBalanceOn(l, "2026-02-15").cents).toBe(1_002_000);
    // 100,20 of interest on 10 020,00
    expect(loanBalanceOn(l, "2026-03-15").cents).toBe(1_004_020);
    expect(loanPayoffDate(l)).toEqual({ date: null, unknown: null, never: true });
  });

  it("a payment that only covers the interest never ends either, and one cent more does within the limit", () => {
    expect(loanPayoffDate({ ...l, paymentCents: 10_000 }).never).toBe(true);
    expect(loanBalanceOn({ ...l, paymentCents: 10_000 }, "2036-01-15").cents).toBe(1_000_000);
    expect(MAX_LOAN_PAYMENTS).toBe(1200);
    // 2 000,00 at 12 % with 21,00 a month: 1,00 comes off at first, and the loan ends well inside 100 years
    expect(loanPayoffDate({ ...l, balanceCents: 200_000, paymentCents: 2100 }).never).toBe(false);
  });

  it("with a last due date the grown balance falls due then", () => {
    const capped = { ...l, endDate: "2026-03-15" };
    expect(loanBalanceOn(capped, "2026-02-15").cents).toBe(1_002_000);
    expect(loanBalanceOn(capped, "2026-03-15").cents).toBe(0);
    expect(loanPayoffDate(capped)).toEqual({ date: "2026-03-15", unknown: null, never: false });
  });
});

describe("a credit line", () => {
  const line = (balanceCents: number, limitCents: number | null = 200_000) => loan({ kind: "credit_line", balanceCents, limitCents });

  it("tells its use within, at and over the limit", () => {
    expect(creditUse(line(50_000), "2026-02-01")).toEqual({ usedCents: 50_000, limitCents: 200_000, share: 0.25, availableCents: 150_000, overCents: 0, unknown: null });
    expect(creditUse(line(200_000), "2026-02-01")).toEqual({ usedCents: 200_000, limitCents: 200_000, share: 1, availableCents: 0, overCents: 0, unknown: null });
    expect(creditUse(line(215_000), "2026-02-01")).toEqual({ usedCents: 215_000, limitCents: 200_000, share: 1.075, availableCents: 0, overCents: 15_000, unknown: null });
  });

  it("has no use figure without a limit", () => {
    expect(creditUse(line(50_000, null), "2026-02-01")).toEqual({ usedCents: 50_000, limitCents: null, share: null, availableCents: null, overCents: null, unknown: "limit" });
    expect(creditUse(line(50_000, 0), "2026-02-01").share).toBeNull();
  });
});

describe("a connected account as a loan", () => {
  const day = "2026-10-12";
  const card = { id: "card", name: "Nordea Gold", type: "credit_card" as const, balanceCents: -124_000, creditLimitCents: 300_000 };
  const useOf = (account: Parameters<typeof creditAccountLoan>[0]) => creditUse(creditAccountLoan(account, day)!, day);

  it("a card owes its balance with the sign turned, on the day asked", () => {
    expect(creditAccountLoan(card, day)).toEqual(loan({ id: "account:card", name: "Nordea Gold", kind: "card", balanceCents: 124_000, balanceDate: day, limitCents: 300_000 }));
    expect(useOf(card)).toEqual({ usedCents: 124_000, limitCents: 300_000, share: 124_000 / 300_000, availableCents: 176_000, overCents: 0, unknown: null });
  });

  it("a card over its limit, and a card in credit owes nothing", () => {
    expect(useOf({ ...card, balanceCents: -320_000 })).toMatchObject({ usedCents: 320_000, availableCents: 0, overCents: 20_000, unknown: null });
    expect(useOf({ ...card, balanceCents: 5_000 })).toMatchObject({ usedCents: 0, share: 0, availableCents: 300_000, overCents: 0, unknown: null });
  });

  it("without a limit the use is unknown, the debt is not", () => {
    const expected = { usedCents: 124_000, limitCents: null, share: null, availableCents: null, overCents: null, unknown: "limit" };
    expect(useOf({ ...card, creditLimitCents: null })).toEqual(expected);
    expect(useOf({ id: "card", name: "Nordea Gold", type: "credit_card", balanceCents: -124_000 })).toEqual(expected);
  });

  it("without a balance nothing is guessed, and an account with a limit that is no card is a credit line", () => {
    expect(creditAccountLoan({ ...card, balanceCents: null }, day)).toBeNull();
    expect(creditAccountLoan({ id: "chk", name: "Käyttötili", type: "checking", balanceCents: -5_000, creditLimitCents: 100_000 }, day)).toMatchObject({ id: "account:chk", kind: "credit_line", balanceCents: 5_000 });
  });

  it("is revolving, as are exactly a card and a credit line", () => {
    expect(creditAccountLoan(card, day)?.kind).toBe("card");
    expect(LOAN_KINDS.filter(isRevolving)).toEqual(["credit_line", "card"]);
  });
});

describe("leap days", () => {
  it("keeps the anchor's day of the month: a due date on the 31st or on a leap day falls on the month's last day", () => {
    const l = loan({ balanceCents: 50_000, balanceDate: "2024-01-31", rateBp: 0, repayment: "annuity", intervalMonths: 1, paymentCents: 10_000 });
    expect(loanBalanceOn(l, "2024-02-28").cents).toBe(50_000);
    expect(loanBalanceOn(l, "2024-02-29").cents).toBe(40_000);
    expect(loanBalanceOn(l, "2024-03-30").cents).toBe(40_000);
    expect(loanBalanceOn(l, "2024-03-31").cents).toBe(30_000);
    expect(loanPayoffDate(l).date).toBe("2024-06-30");
    expect(loanBalanceOn({ ...l, balanceDate: "2025-01-31" }, "2025-02-28").cents).toBe(40_000);
    // yearly from a leap day: 28.2. in the years between, 29.2. again in 2028
    const yearly = loan({ balanceCents: 40_000, balanceDate: "2024-02-29", rateBp: 0, repayment: "annuity", intervalMonths: 12, paymentCents: 10_000 });
    expect(loanBalanceOn(yearly, "2025-02-27").cents).toBe(40_000);
    expect(loanBalanceOn(yearly, "2025-02-28").cents).toBe(30_000);
    expect(loanPayoffDate(yearly).date).toBe("2028-02-29");
  });

  it("counts due dates back from a last due date on a leap day", () => {
    // 29.11.2027 is before the balance date, so 29.12., 29.1. and 29.2. are left
    const l = loan({ balanceCents: 50_000, balanceDate: "2027-11-30", rateBp: 0, repayment: "annuity", intervalMonths: 1, paymentCents: 10_000, endDate: "2028-02-29" });
    expect(loanBalanceOn(l, "2027-12-28").cents).toBe(50_000);
    expect(loanBalanceOn(l, "2027-12-29").cents).toBe(40_000);
    expect(loanBalanceOn(l, "2028-01-29").cents).toBe(30_000);
    expect(loanBalanceOn(l, "2028-02-29").cents).toBe(0);
  });

  it("a year's interest on a kept balance is balance × rate in a leap year too", () => {
    // 10 000,00 € at 3,65 %: 365,00 € a year, a euro a day in a year of 365 days
    const kept = loan({ balanceCents: 1_000_000, balanceDate: "2023-06-01", rateBp: 365 });
    expect(loanInterestNext12Months(kept, "2024-01-01").cents).toBe(36_500);
    expect(loanInterestNext12Months(kept, "2025-01-01").cents).toBe(36_500);
    // a bullet due on 1.3.: 60 of 366 days in 2024 (59,836 €), 59 of 365 in 2025 (59,00 €)
    const bullet = { ...kept, repayment: "bullet" as const };
    expect(loanInterestNext12Months({ ...bullet, endDate: "2024-03-01" }, "2024-01-01").cents).toBe(5984);
    expect(loanInterestNext12Months({ ...bullet, endDate: "2025-03-01" }, "2025-01-01").cents).toBe(5900);
  });
});

describe("the debt of a household", () => {
  const annuity = loan({ id: "a", rateBp: 1200, repayment: "annuity", intervalMonths: 1, paymentCents: 20_000 });
  const noPlan = loan({ id: "b", balanceCents: 250_000, rateBp: 400 });
  const later = loan({ id: "c", balanceCents: 999_999, balanceDate: "2026-12-01", rateBp: 400 });
  const noRate = loan({ id: "d", balanceCents: 30_000, repayment: "equal_principal", intervalMonths: 1, paymentCents: 10_000 });
  const loans = [annuity, noPlan, later, noRate];

  it("sums the balances it knows and lists what it kept or left out", () => {
    // 618,10 after two payments, 2 500,00 kept, 100,00 after two payments
    expect(debtTotalOn(loans, "2026-03-15")).toEqual({
      cents: 61_810 + 250_000 + 10_000,
      unknown: [
        { loanId: "b", unknown: "repayment", counted: true },
        { loanId: "c", unknown: "before_balance_date", counted: false },
      ],
    });
    expect(debtTotalOn([], "2026-03-15")).toEqual({ cents: 0, unknown: [] });
  });

  it("sums a year's interest the same way", () => {
    // 6,18 + 4,24 + 2,29 + 0,31 of the annuity, 4 % of 2 500,00
    expect(debtInterestNext12Months(loans, "2026-03-15")).toEqual({
      cents: 1302 + 10_000,
      unknown: [
        { loanId: "b", unknown: "repayment", counted: true },
        { loanId: "c", unknown: "before_balance_date", counted: false },
        { loanId: "d", unknown: "rate", counted: false },
      ],
    });
  });
});

describe("loans in the user's inputs", () => {
  it("are none unless given, and name the reference rates the loan_rate input offers", () => {
    expect(loansOf(NO_INPUTS)).toEqual([]);
    expect(loansOf({ marks: [], expectedBills: [] })).toEqual([]);
    const l = loan();
    expect(loansOf({ ...NO_INPUTS, loans: [l] })).toEqual([l]);
    expect([...LOAN_REFERENCES]).toEqual(INPUT_DEFS.loan_rate.choices!.map((c) => c.id));
  });
});
