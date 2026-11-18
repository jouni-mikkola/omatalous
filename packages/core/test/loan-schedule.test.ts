import { describe, expect, it } from "vitest";
import { dayNumber } from "../src/dates.ts";
import { dayInterest, intervalInterest } from "../src/loan-plan.ts";
import { annuityPayment, loanSchedule, loanWhatIf, ratePathOf } from "../src/loan-schedule.ts";
import { debtTotalOn, loanBalanceOn, loanInterestNext12Months, loanNextPayment, loanPayoffDate, loanRateScenario, loansOf } from "../src/loans.ts";
import { type Fixings, type Loan, NO_INPUTS, type RatePath } from "../src/types.ts";

/** A loan with nothing but a balance: each test adds the fields its schedule needs. */
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
  intervalMonths: 1,
  paymentCents: null,
  endDate: null,
  limitCents: null,
  seriesKey: null,
  ...over,
});

const START = "2026-01-15";
const sumOf = (xs: readonly (number | null)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0);

/** Three percent until the review on 15 July 2026, five from then on. */
const RISE: RatePath = [
  ["2026-01-01", 3000],
  ["2026-07-15", 5000],
];
const annuity12 = (over: Partial<Loan> = {}) => loan({ rateBp: 300, repayment: "annuity", paymentCents: annuityPayment(100_000, 3000, 1, 12), endDate: "2027-01-15", ratePath: RISE, ...over });

describe("a schedule of every repayment type", () => {
  it("equal principal: the typed amortisation each month, the interest of the balance on top", () => {
    const s = loanSchedule(loan({ balanceCents: 120_000, rateBp: 600, repayment: "equal_principal", paymentCents: 30_000 }), START);
    expect(s.rows.map((r) => [r.date, r.rateMilli, r.interestCents, r.principalCents, r.balanceCents])).toEqual([
      ["2026-02-15", 6000, 600, 30_000, 90_000],
      ["2026-03-15", 6000, 450, 30_000, 60_000],
      ["2026-04-15", 6000, 300, 30_000, 30_000],
      ["2026-05-15", 6000, 150, 30_000, 0],
    ]);
    expect(s.summary).toEqual({ paymentsLeft: 4, interestLeftCents: 1500, endDate: "2026-05-15", flatFrom: null });
  });

  it("annuity: a payment that ends the loan, the last row clearing what the rounding left", () => {
    const s = loanSchedule(loan({ rateBp: 1200, repayment: "annuity", paymentCents: 8885 }), START);
    expect(s.rows.slice(0, 2).map((r) => [r.interestCents, r.principalCents, r.balanceCents])).toEqual([
      [1000, 7885, 92_115],
      [921, 7964, 84_151],
    ]);
    expect(s.rows).toHaveLength(12);
    expect(s.rows.at(-1)).toMatchObject({ date: "2027-01-15", balanceCents: 0 });
    expect(sumOf(s.rows.map((r) => r.principalCents))).toBe(100_000);
    expect(s.summary?.interestLeftCents).toBe(sumOf(s.rows.map((r) => r.interestCents)));
  });

  it("fixed instalment: the payment stays and the term gives way", () => {
    const s = loanSchedule(loan({ rateBp: 600, repayment: "fixed_instalment", paymentCents: 10_000 }), START);
    expect(s.rows.slice(0, 2).map((r) => [r.interestCents, r.principalCents])).toEqual([
      [500, 9500],
      [453, 9547],
    ]);
    expect(s.rows.slice(0, -1).every((r) => r.interestCents! + r.principalCents === 10_000)).toBe(true);
    expect(sumOf(s.rows.map((r) => r.principalCents))).toBe(100_000);
    expect(s.rows.at(-1)?.balanceCents).toBe(0);
  });

  it("a payment that does not cover its interest never ends", () => {
    const s = loanSchedule(loan({ rateBp: 1200, repayment: "fixed_instalment", paymentCents: 400 }), START);
    expect(s.never).toBe(true);
    expect(s.summary).toBeNull();
    expect(s.rows.at(-1)!.balanceCents).toBeGreaterThan(100_000);
    expect(loanPayoffDate(loan({ rateBp: 1200, repayment: "fixed_instalment", paymentCents: 400 }))).toEqual({ date: null, unknown: null, never: true });
  });

  it("bullet: the interest each interval and the whole principal on the last due date", () => {
    const s = loanSchedule(loan({ rateBp: 600, repayment: "bullet", intervalMonths: 3, endDate: "2027-01-15" }), START);
    expect(s.rows.map((r) => [r.date, r.interestCents, r.principalCents, r.balanceCents])).toEqual([
      ["2026-04-15", 1500, 0, 100_000],
      ["2026-07-15", 1500, 0, 100_000],
      ["2026-10-15", 1500, 0, 100_000],
      ["2027-01-15", 1500, 100_000, 0],
    ]);
  });

  it("balloon: a fixed instalment with a last due date pays what is left on it", () => {
    const s = loanSchedule(loan({ rateBp: 600, repayment: "fixed_instalment", paymentCents: 1000, endDate: "2026-04-15" }), START);
    expect(s.rows.map((r) => [r.interestCents, r.principalCents, r.balanceCents])).toEqual([
      [500, 500, 99_500],
      [498, 502, 98_998],
      [495, 98_998, 0],
    ]);
  });

  it("a card or credit line pays its typed payment each month, interest on the balance", () => {
    const s = loanSchedule(loan({ kind: "card", rateBp: 1800, paymentCents: 5000 }), START);
    expect(s.rows.slice(0, 2).map((r) => [r.interestCents, r.principalCents, r.balanceCents])).toEqual([
      [1500, 3500, 96_500],
      [1448, 3552, 92_948],
    ]);
    expect(s.rows.at(-1)?.balanceCents).toBe(0);
    expect(loanSchedule(loan({ kind: "credit_line", rateBp: 1800 }), START).unknown).toBe("payment");
  });

  it("names the field a loan lacks and gives no rows", () => {
    expect(loanSchedule(loan({ rateBp: 600 }), START)).toEqual({ rows: [], summary: null, unknown: "repayment", never: false });
    expect(loanSchedule(loan({ repayment: "annuity", paymentCents: 5000 }), START).unknown).toBe("rate");
    expect(loanSchedule(loan({ repayment: "bullet", rateBp: 600 }), START).unknown).toBe("end_date");
    expect(loanSchedule(loan({ rateBp: 600, repayment: "annuity", paymentCents: 5000 }), "2025-12-31").unknown).toBe("before_balance_date");
  });

  it("an equal principal loan with no rate has rows with no interest and an unknown rate", () => {
    const s = loanSchedule(loan({ repayment: "equal_principal", paymentCents: 50_000 }), START);
    expect(s.unknown).toBe("rate");
    expect(s.rows.map((r) => r.interestCents)).toEqual([null, null]);
    expect(s.summary?.interestLeftCents).toBeNull();
  });

  it("the fee of the newest payment a document stated is in every row", () => {
    const parts = [
      { dueDate: "2025-11-15", principalCents: 7000, interestCents: 900, feeCents: 400 },
      { dueDate: "2025-12-15", principalCents: 7100, interestCents: 890, feeCents: 450 },
    ];
    const s = loanSchedule(loan({ rateBp: 600, repayment: "equal_principal", paymentCents: 50_000, paymentParts: parts }), START);
    expect(s.rows.map((r) => r.feeCents)).toEqual([450, 450]);
  });

  it("leaves rows before `from` out", () => {
    const l = loan({ balanceCents: 120_000, rateBp: 600, repayment: "equal_principal", paymentCents: 30_000 });
    expect(loanSchedule(l, "2026-03-20").rows.map((r) => r.date)).toEqual(["2026-04-15", "2026-05-15"]);
    expect(loanSchedule(l, "2026-05-15").summary).toBeNull();
  });
});

describe("rate resets", () => {
  it("an annuity with a last due date sets its payment again at a review and still ends on that date", () => {
    const s = loanSchedule(annuity12(), START);
    const payment = (i: number) => s.rows[i]!.interestCents! + s.rows[i]!.principalCents;
    // the review on 15 July counts from the interval that starts then: the payment of 15 August is new
    expect(s.rows[5]).toMatchObject({ date: "2026-07-15", rateMilli: 3000 });
    expect(s.rows[6]).toMatchObject({ date: "2026-08-15", rateMilli: 5000 });
    expect(payment(1)).toBe(payment(5));
    expect(payment(6)).toBe(annuityPayment(s.rows[5]!.balanceCents, 5000, 1, 6));
    expect(payment(6)).toBeGreaterThan(payment(5));
    expect(s.rows).toHaveLength(12);
    expect(s.rows.at(-1)).toMatchObject({ date: "2027-01-15", balanceCents: 0 });
    expect(s.summary?.endDate).toBe("2027-01-15");
  });

  it("an annuity without a last due date keeps its payment, so it lasts longer on a rise", () => {
    const keep = loanSchedule(annuity12({ endDate: null }), START);
    const flat = loanSchedule(annuity12({ endDate: null, ratePath: undefined }), START);
    expect(keep.rows[7]!.interestCents! + keep.rows[7]!.principalCents).toBe(keep.rows[1]!.interestCents! + keep.rows[1]!.principalCents);
    expect(keep.summary!.interestLeftCents!).toBeGreaterThan(flat.summary!.interestLeftCents!);
  });

  it("a fixed instalment lengthens on a rise and shortens on a fall", () => {
    const l = (path: RatePath | undefined) => loan({ balanceCents: 1_000_000, rateBp: 300, repayment: "fixed_instalment", paymentCents: 30_000, ratePath: path });
    const flat = loanSchedule(l(undefined), START).summary!;
    const up = loanSchedule(l([["2026-01-01", 3000], ["2026-04-15", 12_000]]), START).summary!;
    const down = loanSchedule(l([["2026-01-01", 3000], ["2026-04-15", 500]]), START).summary!;
    expect(up.paymentsLeft).toBeGreaterThan(flat.paymentsLeft);
    expect(down.paymentsLeft).toBeLessThan(flat.paymentsLeft);
  });

  it("a rise that the payment does not cover turns the loan into one that never ends", () => {
    const s = loanSchedule(loan({ balanceCents: 1_000_000, rateBp: 300, repayment: "fixed_instalment", paymentCents: 30_000, ratePath: [["2026-01-01", 3000], ["2026-04-15", 60_000]] }), START);
    expect(s.never).toBe(true);
  });

  it("counts every interval at the rate in force when it starts", () => {
    const s = loanSchedule(loan({ balanceCents: 120_000_000, rateBp: 300, repayment: "equal_principal", paymentCents: 1_000_000, ratePath: [["2026-01-01", 3000], ["2026-03-15", 3001]] }), START);
    // 15 March starts the interval that ends on 15 April: 0,001 % more on 1,2 million euros is 12 euros a year, 1 euro (100 cents) a month
    expect(s.rows.map((r) => r.rateMilli)).toEqual([3000, 3000, 3001, 3001].concat(Array(s.rows.length - 4).fill(3001)));
    const before = s.rows[1]!;
    const after = s.rows[2]!;
    const noStep = loanSchedule(loan({ balanceCents: 120_000_000, rateBp: 300, repayment: "equal_principal", paymentCents: 1_000_000 }), START).rows[2]!;
    expect(before.rateMilli).toBe(3000);
    expect(after.interestCents! - noStep.interestCents!).toBe(Math.round(((120_000_000 - 2 * 1_000_000) * 1) / 1_200_000));
  });
});

describe("a schedule that starts between two due dates", () => {
  it("labels the first row with the rate its interest was counted at, the rate of the interval's start", () => {
    // the review on 10 March falls after the due date of 15 February, which starts the interval, and before `from`
    const l = loan({ balanceCents: 200_000, rateBp: 300, repayment: "equal_principal", paymentCents: 20_000, ratePath: [["2026-01-01", 3000], ["2026-03-10", 5000]] });
    const whole = loanSchedule(l, START).rows;
    const mid = loanSchedule(l, "2026-03-12").rows;
    expect(mid[0]).toEqual(whole.find((r) => r.date === "2026-03-15"));
    expect(mid[0]).toMatchObject({ date: "2026-03-15", rateMilli: 3000 });
    expect(mid[1]).toMatchObject({ date: "2026-04-15", rateMilli: 5000 });
    // a change from the same day agrees
    expect(loanSchedule(l, "2026-03-12", { extra: { cents: 0, on: "2026-03-12" } }).rows[0]).toMatchObject({ rateMilli: 3000 });
  });
});

describe("the rate path of a reference rate", () => {
  const euribor3 = (over: Partial<Loan> = {}) => loan({ reference: "euribor_3", rateBp: 400, marginBp: 100, rateReviewDate: "2026-01-31", balanceDate: "2026-01-31", endDate: "2027-07-31", ...over });
  const pathOf = (l: Loan, fixings: Fixings) => ratePathOf(l, fixings)?.path.map(([day, milli]) => `${day} ${milli}`);

  it("counts every review day from the typed one, so a 31st does not drift", () => {
    const fixings: Fixings = { euribor_3: [["2026-01-02", 2500], ["2026-04-30", 2600], ["2026-07-31", 2700], ["2026-10-30", 2800], ["2027-01-29", 2900], ["2027-04-30", 3000]] };
    expect(pathOf(euribor3(), fixings)).toEqual(["2026-01-31 4000", "2026-04-30 3600", "2026-07-31 3700", "2026-10-31 3800", "2027-01-31 3900", "2027-04-30 4000"]);
  });

  it("takes the fixing on or before the review day, so a closed day uses the one before it", () => {
    // 1 May 2026 is a TARGET holiday: no fixing exists for it
    const fixings: Fixings = { euribor_3: [["2026-04-30", 2500], ["2026-05-04", 3000]] };
    expect(pathOf(euribor3({ rateReviewDate: "2026-02-01", balanceDate: "2026-02-01", endDate: "2026-06-01" }), fixings)).toEqual(["2026-02-01 4000", "2026-05-01 3500"]);
  });

  it("floors a negative fixing at zero before the margin is added", () => {
    const fixings: Fixings = { euribor_3: [["2026-04-30", -500]] };
    expect(pathOf(euribor3(), fixings)![1]).toBe("2026-04-30 1000");
  });

  it("moves the interest with a 0,001 % step in the fixing", () => {
    const rows = (milli: number) => {
      const fixings: Fixings = { euribor_3: [["2026-01-30", milli]] };
      const l = euribor3({ balanceCents: 120_000_000, repayment: "equal_principal", paymentCents: 1_000_000, endDate: null, intervalMonths: 1, rateReviewDate: "2026-01-31" });
      return loanSchedule({ ...l, ratePath: ratePathOf(l, fixings)!.path }, "2026-01-31").rows;
    };
    // the first review is on 30 April: the rows before it count at the typed rate, the later ones at the fixing and the margin
    const a = rows(2500);
    const b = rows(2501);
    const index = a.findIndex((r) => r.date === "2026-05-31");
    expect(a[index]!.rateMilli).toBe(3500);
    expect(b[index]!.rateMilli).toBe(3501);
    // 0,001 % a year of the balance owed (1 170 000 €), the 31 days of May over a 360-day year, rounded half up on each side
    const owed = a[index - 1]!.balanceCents;
    expect(owed).toBe(117_000_000);
    expect(b[index]!.interestCents! - a[index]!.interestCents!).toBe(dayInterest(owed, 3501, 31) - dayInterest(owed, 3500, 31));
    expect(b[index]!.interestCents! - a[index]!.interestCents!).toBe(101);
    expect(b[index - 1]!.interestCents).toBe(a[index - 1]!.interestCents);
  });

  it("holds the newest fixing flat after it and names the first review that does", () => {
    const l = euribor3();
    const fixings: Fixings = { euribor_3: [["2026-04-30", 2600]] };
    const rates = ratePathOf(l, fixings)!;
    expect(rates.flatFrom).toBe("2026-07-31");
    expect(rates.path.map(([, milli]) => milli)).toEqual([4000, 3600, 3600]);
    const s = loanSchedule({ ...l, repayment: "annuity", paymentCents: 30_000, ratePath: rates.path, rateFlatFrom: rates.flatFrom }, "2026-01-31");
    expect(s.summary?.flatFrom).toBe("2026-07-31");
    expect(ratePathOf(l, { euribor_3: [["2026-04-30", 2600], ["2026-07-31", 2600], ["2026-10-31", 2600], ["2027-01-31", 2600], ["2027-07-31", 2600]] })!.flatFrom).toBeNull();
  });

  it("has no reset before the end of a fixed period that ends years after the balance date", () => {
    const l = loan({ reference: "euribor_12", rateBp: 400, marginBp: 100, rateReviewDate: "2029-01-15", endDate: "2031-01-15" });
    const rates = ratePathOf(l, { euribor_12: [["2026-01-02", 2500], ["2029-01-14", 2600]] })!;
    expect(rates.path.filter(([day]) => day > START && day < "2029-01-15")).toEqual([]);
    expect(rates.path.find(([day]) => day === "2029-01-15")?.[1]).toBe(3600);
    const s = loanSchedule({ ...l, repayment: "equal_principal", paymentCents: 2000, ratePath: rates.path }, START);
    expect(s.rows.filter((r) => r.date <= "2029-01-15").every((r) => r.rateMilli === 4000)).toBe(true);
  });

  it("starts from the review day on or before the balance date when the typed day is older", () => {
    const l = euribor3({ rateReviewDate: "2025-01-31", balanceDate: "2026-02-10", endDate: "2026-12-31" });
    expect(pathOf(l, { euribor_3: [["2025-01-30", 2000], ["2026-04-29", 2600]] })![0]).toBe("2026-01-31 4000");
  });

  it("gives no path to a loan that a reference rate does not move", () => {
    const fixings: Fixings = { euribor_3: [["2026-04-30", 2600]] };
    expect(ratePathOf(euribor3({ reference: "fixed" }), fixings)).toBeNull();
    expect(ratePathOf(euribor3({ marginBp: null }), fixings)).toBeNull();
    expect(ratePathOf(euribor3({ rateReviewDate: null }), fixings)).toBeNull();
    expect(ratePathOf(euribor3(), { euribor_6: [["2026-04-30", 2600]] })).toBeNull();
  });
});

describe("the days a euribor loan counts", () => {
  const euribor3 = loan({ reference: "euribor_3", rateBp: 400, marginBp: 100, rateReviewDate: "2026-01-31", balanceDate: "2026-01-31", balanceCents: 1_200_000, repayment: "equal_principal", paymentCents: 100_000, endDate: "2027-07-31" });
  const interestOf = (inputs: Partial<typeof NO_INPUTS & { fixings: Fixings }>) => loanSchedule(loansOf({ ...NO_INPUTS, loans: [euribor3], ...inputs })[0]!, "2026-01-31").rows.slice(0, 4).map((r) => r.interestCents);

  it("counts the actual days of each interval over a 360-day year, a half cent up", () => {
    // 28, 31, 30 and 31 days; the rate is 4,000 % until the review on 30 April, then 2,500 % and the margin 1,000 %
    // 1 200 000 × 4,000 % × 28 / 360 = 3 733,33; 1 100 000 × 4,000 % × 31 / 360 = 3 788,89; 1 000 000 × 4,000 % × 30 / 360 = 3 333,33; 900 000 × 3,500 % × 31 / 360 = 2 712,50
    expect(interestOf({ fixings: { euribor_3: [["2026-01-30", 2500]] } })).toEqual([3733, 3789, 3333, 2713]);
  });

  it("counts months when no fixing gives the loan a rate path", () => {
    // 1 200 000 × 4,000 % / 12 = 4 000, and the balance falls 100 000 each month
    expect(interestOf({})).toEqual([4000, 3667, 3333, 3000]);
  });

  it("counts months for a loan that no euribor moves", () => {
    const fixed = { ...euribor3, reference: "fixed" as const };
    expect(loanSchedule(loansOf({ ...NO_INPUTS, loans: [fixed], fixings: { euribor_3: [["2026-01-30", 2500]] } })[0]!, "2026-01-31").rows[0]!.interestCents).toBe(4000);
  });

  describe("a balance dated inside an interval", () => {
    const fixings: Fixings = { euribor_3: [["2026-08-31", 2500]] };
    const midway = loan({ reference: "euribor_3", rateBp: 400, marginBp: 100, rateReviewDate: "2026-09-01", balanceDate: "2026-09-01", balanceCents: 1_200_000, repayment: "equal_principal", paymentCents: 300_000, endDate: "2026-12-15" });
    const withPath = (l: Loan) => loansOf({ ...NO_INPUTS, loans: [l], fixings })[0]!;

    it("counts the first interval from the due date before the balance date, not from the balance date", () => {
      // the due dates are the 15th: the first interval runs 15 August to 15 September, 31 days, whatever the balance date
      // 1 200 000 × 4 % × 31 / 360 = 4 133,33; 900 000 × 4 % × 30 / 360 = 3 000; 600 000 × 4 % × 31 / 360 = 2 066,67; 300 000 × 4 % × 30 / 360 = 1 000
      const rows = loanSchedule(withPath(midway), "2026-09-01").rows;
      expect(rows.map((r) => r.date)).toEqual(["2026-09-15", "2026-10-15", "2026-11-15", "2026-12-15"]);
      expect(rows.map((r) => r.interestCents)).toEqual([4133, 3000, 2067, 1000]);
    });

    it("counts a loan with no last due date from its balance date", () => {
      // the due dates are a month apart from the balance date: 1 September to 1 October is 30 days, 1 200 000 × 4 % × 30 / 360 = 4 000
      const open = loan({ ...midway, endDate: null, repayment: "fixed_instalment", paymentCents: 200_000 });
      expect(loanSchedule(withPath(open), "2026-09-01").rows[0]!.interestCents).toBe(4000);
    });

    it("gives a rate scenario of no move the interest of the next 12 months, from every day of the loan", () => {
      const open = loan({ ...midway, endDate: null, repayment: "fixed_instalment", paymentCents: 200_000 });
      for (const l of [withPath(midway), withPath(open)]) {
        for (const day of ["2026-09-01", "2026-09-20", "2026-10-20", "2026-11-20", "2026-12-20"]) {
          expect(loanRateScenario(l, day, 0).interestCents, `${l.endDate} ${day}`).toBe(loanInterestNext12Months(l, day).cents);
        }
      }
    });
  });

  it("an annuity with a last due date still ends on it and clears the balance", () => {
    const annuity = { ...euribor3, repayment: "annuity" as const, paymentCents: 70_000, balanceCents: 1_200_000, endDate: "2027-07-31" };
    const rows = loanSchedule(loansOf({ ...NO_INPUTS, loans: [annuity], fixings: { euribor_3: [["2026-01-30", 2500], ["2026-04-30", 1500]] } })[0]!, "2026-01-31").rows;
    expect(rows.at(-1)!.date).toBe("2027-07-31");
    expect(rows.at(-1)!.balanceCents).toBe(0);
  });
});

describe("loansOf with fixings", () => {
  const moving = loan({ reference: "euribor_12", rateBp: 400, marginBp: 100, rateReviewDate: "2026-06-15", repayment: "fixed_instalment", paymentCents: 20_000 });
  const fixed = loan({ id: "loan-2", reference: "fixed", rateBp: 400, marginBp: 100, rateReviewDate: "2026-06-15" });
  const fixings: Fixings = { euribor_12: [["2026-06-15", 2500]] };

  it("returns the loans as they are without fixings", () => {
    const loans = [moving, fixed];
    expect(loansOf({ ...NO_INPUTS, loans })).toBe(loans);
  });

  it("gives a loan its rate path and leaves the others alone", () => {
    const [a, b] = loansOf({ ...NO_INPUTS, loans: [moving, fixed], fixings });
    // the review a year before has no fixing yet: it keeps the typed rate
    expect(a!.ratePath).toEqual([
      ["2025-06-15", 4000],
      ["2026-06-15", 3500],
      ["2027-06-15", 3500],
    ]);
    expect(b).toBe(fixed);
  });

  it("every figure reads the same path: the balance, the debt total and the interest agree", () => {
    const slow = { ...moving, paymentCents: 10_000 };
    const inputs = { ...NO_INPUTS, loans: [slow], fixings: { euribor_12: [["2025-06-15", 1000], ["2026-06-15", 5000]] } satisfies Fixings };
    const [l] = loansOf(inputs);
    const day = "2026-03-01";
    const balance = loanBalanceOn(l!, day).cents;
    expect(debtTotalOn(loansOf(inputs), day).cents).toBe(balance);
    const rows = loanSchedule(l!, START).rows;
    const to = "2027-03-01";
    expect(loanInterestNext12Months(l!, day).cents).toBe(sumOf(rows.filter((r) => r.date > day && r.date <= to).map((r) => r.interestCents)));
    expect(balance).toBe(rows.filter((r) => r.date <= day).at(-1)!.balanceCents);
    expect(loanNextPayment(l!, day).date).toBe(rows.find((r) => r.date > day)!.date);
  });
});

describe("a path that holds the typed rate changes no figure", () => {
  const types: Partial<Loan>[] = [
    { repayment: "annuity", paymentCents: 8885 },
    { repayment: "annuity", paymentCents: 8885, endDate: "2027-01-15" },
    { repayment: "equal_principal", paymentCents: 10_000 },
    { repayment: "fixed_instalment", paymentCents: 10_000 },
    { repayment: "fixed_instalment", paymentCents: 3000, endDate: "2026-09-15" },
    { repayment: "bullet", endDate: "2026-12-15" },
    { repayment: "annuity", paymentCents: 20_000, intervalMonths: 3 },
  ];
  it.each(types)("%o", (over) => {
    const plain = loan({ rateBp: 1200, ...over });
    const flat = { ...plain, ratePath: [[START, 12_000]] as RatePath };
    for (const day of ["2026-01-15", "2026-02-20", "2026-09-15", "2027-03-01", "2040-01-01"]) {
      expect(loanBalanceOn(flat, day)).toEqual(loanBalanceOn(plain, day));
      expect(loanInterestNext12Months(flat, day)).toEqual(loanInterestNext12Months(plain, day));
      expect(loanNextPayment(flat, day)).toEqual(loanNextPayment(plain, day));
    }
    expect(loanPayoffDate(flat)).toEqual(loanPayoffDate(plain));
  });
});

describe("an exact interest at the largest balance and rate", () => {
  /** The same sum in whole numbers of a wider type, a half cent up. */
  const exact = (balance: number, rateMilli: number, months: number) => {
    const n = BigInt(balance) * BigInt(rateMilli) * BigInt(months);
    return Number((2n * n + 1_200_000n) / 2_400_000n);
  };

  it("passes 2^53 with the largest balance, 50 % and a margin over more months than a loan may have", () => {
    // 10 000 000 € at 50 % and a margin of 20 % over 366 months, more than a loan's interval allows: a product of 2,6e16
    const rateMilli = 50_000 + 20_000;
    expect(1_000_000_000 * rateMilli * 366).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(intervalInterest(1_000_000_000, rateMilli, 12)).toBe(700_000_000);
    for (const [balance, milli, months] of [[999_999_999, 69_999, 12], [1_000_000_000, 70_000, 366], [987_654_321, 65_432, 365], [1_000_000_000, 1, 1]] as const) {
      expect(intervalInterest(balance, milli, months)).toBe(exact(balance, milli, months));
    }
  });

  it("counts days as exactly over 360 days: 10 000 000 € at 70 % for 366 days", () => {
    const exactDays = (balance: number, rateMilli: number, days: number) => {
      const n = BigInt(balance) * BigInt(rateMilli) * BigInt(days);
      return Number((2n * n + 36_000_000n) / 72_000_000n);
    };
    expect(1_000_000_000 * 70_000 * 366).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(dayInterest(1_000_000_000, 70_000, 360)).toBe(700_000_000);
    for (const [balance, milli, days] of [[999_999_999, 69_999, 31], [1_000_000_000, 70_000, 366], [987_654_321, 65_432, 365], [1_000_000_000, 1, 1], [1, 1, 1]] as const) {
      expect(dayInterest(balance, milli, days)).toBe(exactDays(balance, milli, days));
    }
  });

  it("schedules a loan at the largest balance with every payment exact", () => {
    const l = loan({ balanceCents: 1_000_000_000, rateBp: 5000, repayment: "equal_principal", paymentCents: 100_000_000, ratePath: [["2026-01-01", 70_000]] });
    const rows = loanSchedule(l, START).rows;
    expect(rows[0]!.interestCents).toBe(exact(1_000_000_000, 70_000, 1));
    expect(rows[1]!.interestCents).toBe(exact(900_000_000, 70_000, 1));
    expect(sumOf(rows.map((r) => r.principalCents))).toBe(1_000_000_000);
  });
});

describe("what a change does", () => {
  const plans: [string, Loan][] = [
    ["annuity", annuity12({ ratePath: undefined, endDate: null, paymentCents: 8885, rateBp: 1200 })],
    ["annuity to its last due date, after a review", annuity12()],
    ["fixed instalment", loan({ rateBp: 600, repayment: "fixed_instalment", paymentCents: 10_000 })],
    ["equal principal", loan({ rateBp: 600, repayment: "equal_principal", paymentCents: 10_000 })],
  ];
  const interestOf = (l: Loan, from: string, change?: Parameters<typeof loanSchedule>[2]) => loanSchedule(l, from, change).summary!.interestLeftCents!;

  it.each(plans)("a zero change is the baseline: %s", (_name, l) => {
    const base = loanSchedule(l, START);
    expect(loanSchedule(l, START, {}).rows).toEqual(base.rows);
    expect(loanSchedule(l, "2026-04-20", {}).rows).toEqual(loanSchedule(l, "2026-04-20").rows);
    const w = loanWhatIf(l, START, {})!;
    expect(w.shorter).toEqual({ endDate: base.summary!.endDate, monthsSooner: 0, interestSavedCents: 0 });
  });

  it.each(plans)("a higher payment never ends later or costs more interest: %s", (_name, l) => {
    const first = loanSchedule(l, START).rows[0]!;
    const paid = l.repayment === "equal_principal" ? first.principalCents : first.interestCents! + first.principalCents;
    let end = loanSchedule(l, START).summary!.endDate;
    let interest = interestOf(l, START);
    for (const more of [500, 2000, 5000, 20_000]) {
      const w = loanWhatIf(l, START, { paymentCents: paid + more })!;
      expect(w.shorter.endDate <= end).toBe(true);
      expect(interestOf(l, START, { paymentCents: paid + more })).toBeLessThanOrEqual(interest);
      expect(w.shorter.interestSavedCents).toBeGreaterThanOrEqual(0);
      expect(dayNumber(w.shorter.endDate)).toBeLessThanOrEqual(dayNumber(end));
      end = w.shorter.endDate;
      interest = interestOf(l, START, { paymentCents: paid + more });
    }
  });

  it.each(plans)("an extra repayment lowers the balance by that amount and saves interest: %s", (_name, l) => {
    const on = "2026-03-15";
    const base = loanSchedule(l, START);
    const changed = loanSchedule(l, START, { extra: { cents: 20_000, on } });
    const at = (rows: typeof base.rows) => rows.find((r) => r.date === on)!.balanceCents;
    expect(at(changed.rows)).toBe(at(base.rows));
    const after = changed.rows.find((r) => r.date > on)!;
    const baseAfter = base.rows.find((r) => r.date > on)!;
    expect(after.balanceCents).toBeLessThan(baseAfter.balanceCents);
    const w = loanWhatIf(l, START, { extra: { cents: 20_000, on } })!;
    expect(w.shorter.interestSavedCents).toBeGreaterThanOrEqual(0);
    expect(w.shorter.monthsSooner).toBeGreaterThan(0);
  });

  it("an extra repayment on a day before the plan's next payment lowers the balance at once", () => {
    const l = loan({ rateBp: 600, repayment: "equal_principal", paymentCents: 10_000 });
    const s = loanSchedule(l, START, { extra: { cents: 30_000, on: START } });
    expect(s.rows[0]).toMatchObject({ interestCents: 350, balanceCents: 60_000 });
  });

  it("an annuity to its last due date still shortens after a later review", () => {
    const l = annuity12();
    const w = loanWhatIf(l, "2026-08-20", { extra: { cents: 10_000, on: "2026-09-01" } })!;
    expect(w.shorter.monthsSooner).toBeGreaterThan(0);
    expect(w.shorter.interestSavedCents).toBeGreaterThanOrEqual(0);
  });

  it("an annuity with an extra repayment can lower its payment instead and end when it was to", () => {
    const l = loan({ rateBp: 1200, repayment: "annuity", paymentCents: 8885, endDate: "2027-01-15" });
    const w = loanWhatIf(l, START, { extra: { cents: 20_000, on: "2026-03-15" } })!;
    expect(w.lower).not.toBeNull();
    expect(w.lower!.paymentCents).toBeLessThan(8885);
    expect(w.lower!.interestSavedCents).toBeGreaterThan(0);
    expect(w.lower!.interestSavedCents).toBeLessThan(w.shorter.interestSavedCents);
    // the others have no lower payment to tell
    expect(loanWhatIf(loan({ rateBp: 600, repayment: "fixed_instalment", paymentCents: 10_000 }), START, { extra: { cents: 20_000, on: "2026-03-15" } })!.lower).toBeNull();
  });

  it("tells nothing of a loan that has no schedule", () => {
    expect(loanWhatIf(loan({ rateBp: 600 }), START, { paymentCents: 5000 })).toBeNull();
    expect(loanWhatIf(loan({ rateBp: 1200, repayment: "fixed_instalment", paymentCents: 400 }), START, { paymentCents: 450 })).toBeNull();
  });
});
