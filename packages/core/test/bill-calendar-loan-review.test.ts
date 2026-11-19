import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { addDays, dateIn, weekdayOf } from "../src/dates.ts";
import { loanTermsGaps } from "../src/loan-terms-answer.ts";
import { billCalendar } from "../src/reports/bill-calendar.ts";
import { type Account, type Fixings, type Loan, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

// A loan on a 12-month euribor in the bill calendar: its payments from the day the bank sets the rate again count at the
// newest published fixing and the margin, and are an estimate. Made-up loan; every sum below is worked out by hand in
// integer cents, interest on the actual days over 360 (a loan with a rate path counts so).
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const TODAY = "2026-10-26";
/** 120 000 € on 1.10.2026, 4,000 % = a fixing of 3,000 % and a margin of 1,000 %; the rate is set again on 15.1.2027. */
const LOAN: Loan = {
  id: "loan-1", name: "Asuntolaina", lender: "ESIMERKKIPANKKI", kind: "mortgage", grantedCents: null, balanceCents: 12_000_000, balanceDate: "2026-10-01", rateBp: 400,
  reference: "euribor_12", marginBp: 100, repayment: "annuity", intervalMonths: 1, paymentCents: 121_500, endDate: "2036-10-01", limitCents: null, seriesKey: null, rateReviewDate: "2027-01-15",
};
const fixing = (milli: number): Fixings => ({ euribor_12: [["2026-10-01", milli]] });

const PAY = 300_000;
/** A pay of 3 000 € on the 15th (the Friday before on a weekend) from March, so what is left after the bills is a figure. */
const pays = (): Transaction[] =>
  ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((m) => {
    const date = dateIn(m, 15);
    const weekday = weekdayOf(date);
    return tx({ accountId: "own", bookingDate: weekday >= 5 ? addDays(date, 4 - weekday) : date, amountCents: PAY, merchant: "Esimerkki Oy", category: "salary" });
  });

const loanRows = (loan: Loan, fixings?: Fixings) => {
  const inputs: UserInputs = { marks: [], expectedBills: [], loans: [loan], ...(fixings ? { fixings } : {}) };
  const cal = billCalendar(createContext(pays(), [own], TODAY), inputs);
  return { cal, rows: cal.months.flatMap((m) => m.rows).filter((r) => r.kind === "loan") };
};

describe("a loan's payments after its review day in the bill calendar", () => {
  it("changes the payment from the month after the review day, at the newest fixing and the margin, as an estimate", () => {
    // the fixing is 3,500 %, so the rate is 4,500 % from 15.1.2027: the interval from 1.2. is the first at it, paid on 1.3.
    // Balance owed after the payment of 1.2.: 11 676 340 (4 × 121 500 less 4 intervals' interest of 41 333, 39 733, 40 776, 40 498).
    // Payment of 1.3.: the balance at 4,500 % over the 116 payments left, 124 687,4157 rounded to the cent.
    const { cal, rows } = loanRows(LOAN, fixing(3500));
    expect(rows.map((r) => [r.date, r.cents, r.state])).toEqual([
      ["2026-11-01", 121_500, "known"],
      ["2026-12-01", 121_500, "known"],
      ["2027-01-01", 121_500, "known"],
      ["2027-02-01", 121_500, "known"],
      ["2027-03-01", 124_687, "estimate"],
      ["2027-04-01", 124_687, "estimate"],
      ["2027-05-01", 124_687, "estimate"],
      ["2027-06-01", 124_687, "estimate"],
      ["2027-07-01", 124_687, "estimate"],
      ["2027-08-01", 124_687, "estimate"],
      ["2027-09-01", 124_687, "estimate"],
    ]);
    const month = (m: string) => cal.months.find((x) => x.month === m)!;
    // the sums keep adding up: the known part and the estimate part of a month are its bills
    expect(month("2027-02")).toMatchObject({ knownCents: 121_500, estimateCents: 0, billsCents: 121_500, incomeCents: PAY, afterCents: PAY - 121_500 });
    expect(month("2027-03")).toMatchObject({ knownCents: 0, estimateCents: 124_687, billsCents: 124_687, incomeCents: PAY, afterCents: PAY - 124_687 });
    expect(cal.months.every((m) => m.billsCents === m.knownCents + m.estimateCents && m.afterCents === m.incomeCents - m.billsCents - m.savingCents)).toBe(true);
    // 4 payments at 121 500 and 7 at 124 687
    expect(cal.billsCents).toBe(4 * 121_500 + 7 * 124_687);
    expect(cal.billsCents).toBe(1_358_809);
    expect(cal.unknownCount).toBe(0);
  });

  it("keeps the payment to the cent when the fixing and the margin leave the rate as it is, and still marks it an estimate", () => {
    // 3,000 % and the margin of 1,000 % are the typed 4,000 %: no payment is set again
    const { rows } = loanRows(LOAN, fixing(3000));
    expect(rows.map((r) => r.cents)).toEqual(Array(11).fill(121_500));
    expect(rows.map((r) => r.state)).toEqual([...Array(4).fill("known"), ...Array(7).fill("estimate")]);
  });

  it("counts the review days from the typed one, a day that went by included", () => {
    // typed 15.1.2025: the rate was set on 15.1.2026 and is next set on 15.1.2027, the same step as above
    const { rows } = loanRows({ ...LOAN, rateReviewDate: "2025-01-15" }, fixing(3500));
    expect(rows.filter((r) => r.state === "estimate").map((r) => r.date)[0]).toBe("2027-03-01");
  });

  it("has a review day beyond the twelve months in no estimate", () => {
    const { rows } = loanRows({ ...LOAN, rateReviewDate: "2027-12-15" }, fixing(3500));
    expect(rows.map((r) => [r.cents, r.state])).toEqual(Array(11).fill([121_500, "known"]));
  });

  it("stays at the typed payment, all known, with no margin or no review day, and keeps its question of the loan's terms", () => {
    const noMargin = { ...LOAN, marginBp: null };
    const noReview = { ...LOAN, rateReviewDate: null };
    for (const loan of [noMargin, noReview]) {
      const { rows, cal } = loanRows(loan, fixing(3500));
      expect(rows.map((r) => [r.cents, r.state])).toEqual(Array(11).fill([121_500, "known"]));
      expect(cal.unknownCount).toBe(0);
    }
    expect(loanTermsGaps(noMargin)[0]).toBe("margin");
    expect(loanTermsGaps(noReview)[0]).toBe("review_date");
  });

  it("stays at the typed payment, all known, while no fixing is published", () => {
    const { rows } = loanRows(LOAN);
    expect(rows.map((r) => [r.cents, r.state])).toEqual(Array(11).fill([121_500, "known"]));
  });
});
