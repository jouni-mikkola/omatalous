/**
 * Payments to a lender that stopped inside the twelve complete months (`endedCredits`): a credit that is in no card gap,
 * no debt service now and no loan proposal. Tarkistettavat asks once whether it was paid off; a running series is the
 * proposals' and is never asked twice; "Maksettu pois", "Ei ole velan maksu" and a saved loan answer it. Made-up lender and sums.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { endedCredits } from "../src/ended-credit.ts";
import { loanProposals } from "../src/loan-detect.ts";
import { notLoanMark } from "../src/loan-mark.ts";
import { creditPaidSubject, loanUnknownSubject } from "../src/loan-terms-answer.ts";
import { seriesId } from "../src/series-id.ts";
import { cardGaps, unconnectedCards } from "../src/unconnected-cards.ts";
import { type Account, type Loan, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const TODAY = "2026-10-26";
const LENDER = "Esimerkki Rahoitus";
const KEY = seriesId({ direction: "out", accountId: "own", merchant: LENDER, product: null });
/** Euros of the payments: no three within a tenth of the middle one, as a credit account's are. */
const CHANGING = [180, 420, 260, 510, 230, 390, 470, 205, 340, 95];

interface PaymentsOf {
  lender?: string;
  accountId?: string;
  /** The day of the month, 19 when not given. */
  day?: string;
  /** The same sum every month, in euros, instead of the changing ones. */
  euros?: number;
  /** A multiple of the changing sums. */
  times?: number;
}

/** One payment a month to the lender on the given day, the months ending at `last`, in the sums of `CHANGING`. */
function payments(last: string, months: number, { lender = LENDER, accountId = "own", day = "19", euros, times = 1 }: PaymentsOf = {}): Transaction[] {
  const [year, month] = last.split("-").map(Number) as [number, number];
  return Array.from({ length: months }, (_, i) => {
    const at = year * 12 + (month - 1) - (months - 1 - i);
    const m = `${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, "0")}`;
    return tx({ accountId, bookingDate: `${m}-${day}`, amountCents: -((euros ?? CHANGING[i % CHANGING.length]! * times) * 100), merchant: lender, category: "loans" });
  });
}
const second: Account = { ...own, id: "second", name: "Toinen tili", iban: "FI42 5000 0120 3456 78" };
const contextOf = (rows: readonly Transaction[], accounts: readonly Account[] = [own]) => createContext(rows, accounts, TODAY);
const withMarks = (...marks: UserInputs["marks"]): UserInputs => ({ ...NO_INPUTS, marks });

/** The last payment was on 19.4.2026, 190 days before the test clock. */
const ended = () => contextOf(payments("2026-04", 7));
const running = () => contextOf(payments("2026-10", 8));

describe("payments to a lender that stopped", () => {
  it("asks once of a lender paid in changing sums whose last payment is 190 days ago, outside the card gap and the proposals", () => {
    const ctx = ended();
    expect(endedCredits(ctx, NO_INPUTS)).toEqual([
      { key: KEY, payee: LENDER, accountId: "own", lastDate: "2026-04-19", count: 7, cents: (180 + 420 + 260 + 510 + 230 + 390 + 470) * 100 },
    ]);
    expect(cardGaps(ctx, NO_INPUTS)).toEqual([]);
    expect(unconnectedCards(ctx, NO_INPUTS)).toEqual([]);
    expect(loanProposals(ctx, NO_INPUTS)).toEqual([]);
  });

  it("leaves a series that is still running to the proposals, and does not ask of it twice", () => {
    const ctx = running();
    expect(endedCredits(ctx, NO_INPUTS)).toEqual([]);
    expect(loanProposals(ctx, NO_INPUTS)).toHaveLength(1);
  });

  it("asks nothing of a payee that paid again lately on another account, of two payments, or of payments before the twelve months", () => {
    const again = [...payments("2026-04", 7), tx({ accountId: "other", bookingDate: "2026-10-05", amountCents: -20_000, merchant: LENDER, category: "loans" })];
    expect(endedCredits(contextOf(again), NO_INPUTS)).toEqual([]);
    expect(endedCredits(contextOf(payments("2026-04", 2)), NO_INPUTS)).toEqual([]);
    expect(endedCredits(contextOf(payments("2025-08", 7)), NO_INPUTS)).toEqual([]);
  });

  it("asks once of a lender paid from two accounts, by the account of the latest payment, and one answer settles both", () => {
    const ctx = contextOf([...payments("2026-04", 4, { day: "05" }), ...payments("2026-04", 3, { accountId: "second" })], [own, second]);
    const keyOfSecond = seriesId({ direction: "out", accountId: "second", merchant: LENDER, product: null });
    expect(endedCredits(ctx, NO_INPUTS)).toEqual([
      { key: keyOfSecond, payee: LENDER, accountId: "second", lastDate: "2026-04-19", count: 7, cents: (1370 + 860) * 100 },
    ]);
    const at = "2026-10-20T10:00:00.000Z";
    expect(endedCredits(ctx, withMarks({ subject: creditPaidSubject(keyOfSecond), mark: "in_use", markedAt: at }))).toEqual([]);
    expect(endedCredits(ctx, withMarks({ subject: creditPaidSubject(KEY), mark: "in_use", markedAt: at }))).toEqual([]);
    expect(endedCredits(ctx, withMarks({ subject: loanUnknownSubject(null, KEY), mark: "in_use", markedAt: at }))).toEqual([]);
  });

  it("asks several lenders in order: the largest sum of the year first, the same sum by key", () => {
    const names = { aihio: "Aihio Rahoitus", nayte: "Näyte Rahoitus" };
    const keyOf = (merchant: string) => seriesId({ direction: "out", accountId: "own", merchant, product: null });
    const ctx = contextOf([...payments("2026-04", 7), ...payments("2026-05", 6, { lender: names.nayte, times: 2 }), ...payments("2026-03", 6, { lender: names.aihio, times: 2 })]);
    expect(endedCredits(ctx, NO_INPUTS).map((e) => e.key)).toEqual([keyOf(names.aihio), keyOf(names.nayte), KEY]);
  });

  it("goes back to the proposals when a lender answered 'Maksettu pois' pays again, and stays answered once it stops", () => {
    const at = "2026-10-20T10:00:00.000Z";
    const answered = withMarks({ subject: creditPaidSubject(KEY), mark: "in_use", markedAt: at });
    expect(endedCredits(running(), answered)).toEqual([]);
    expect(loanProposals(running(), answered)).toHaveLength(1);
    expect(endedCredits(ended(), answered)).toEqual([]);
  });

  it("leaves no day to neither list: a monthly series 43 days after its last payment is no longer a proposal, so it is asked here", () => {
    const stopped = contextOf(payments("2026-09", 7, { day: "13", euros: 250 }));
    expect(stopped.recurring.map((s) => s.active)).toEqual([false]);
    expect(loanProposals(stopped, NO_INPUTS)).toEqual([]);
    expect(endedCredits(stopped, NO_INPUTS).map((e) => e.lastDate)).toEqual(["2026-09-13"]);
    const lately = contextOf(payments("2026-09", 7, { day: "16", euros: 250 }));
    expect(lately.recurring.map((s) => s.active)).toEqual([true]);
    expect(loanProposals(lately, NO_INPUTS)).toHaveLength(1);
    expect(endedCredits(lately, NO_INPUTS)).toEqual([]);
  });

  it("counts a last payment on the first day of the twelve complete months, and not one the day before", () => {
    expect(endedCredits(contextOf(payments("2025-10", 3, { day: "01" })), NO_INPUTS).map((e) => e.lastDate)).toEqual(["2025-10-01"]);
    expect(endedCredits(contextOf(payments("2025-09", 3, { day: "30" })), NO_INPUTS)).toEqual([]);
  });

  it("stops asking when it is answered paid off, is no loan, is said not known, or a loan is saved of it", () => {
    const ctx = ended();
    const at = "2026-10-20T10:00:00.000Z";
    const saved: Loan = {
      id: "l1", name: "Esimerkkiluotto", lender: LENDER, kind: "credit_line", grantedCents: null, balanceCents: 200_000, balanceDate: "2026-10-01", rateBp: null, reference: null,
      marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: 500_000, seriesKey: KEY,
    };
    expect(endedCredits(ctx, withMarks({ subject: creditPaidSubject(KEY), mark: "in_use", markedAt: at }))).toEqual([]);
    expect(endedCredits(ctx, withMarks({ ...notLoanMark({ key: KEY }), markedAt: at }))).toEqual([]);
    expect(endedCredits(ctx, withMarks({ subject: loanUnknownSubject(null, KEY), mark: "in_use", markedAt: at }))).toEqual([]);
    expect(endedCredits(ctx, { ...NO_INPUTS, loans: [saved] })).toEqual([]);
  });
});
