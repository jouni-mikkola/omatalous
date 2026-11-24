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

/** One payment a month to the lender on the given day, the months ending at `last`, in the sums of `CHANGING`. */
function payments(last: string, months: number): Transaction[] {
  const [year, month] = last.split("-").map(Number) as [number, number];
  return Array.from({ length: months }, (_, i) => {
    const at = year * 12 + (month - 1) - (months - 1 - i);
    const m = `${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, "0")}`;
    return tx({ accountId: "own", bookingDate: `${m}-19`, amountCents: -(CHANGING[i % CHANGING.length]! * 100), merchant: LENDER, category: "loans" });
  });
}
const contextOf = (rows: readonly Transaction[]) => createContext(rows, [own], TODAY);
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
