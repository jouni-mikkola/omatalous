import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { NOT_LOAN_SUBJECT } from "../src/loan-mark.ts";
import { billCalendar } from "../src/reports/bill-calendar.ts";
import { seriesId } from "../src/series-id.ts";
import { type Account, type Loan, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

// A series a saved loan's key names is the loan's payment and no bill the household takes off Laskut (`loanSeries`).
// A credit line has no plan, so its series stays a row of kind "bill"; it carries the mark all the same. Made-up payees and sums.
const own: Account = { id: "own", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const TODAY = "2026-10-26";
const MONTHS = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
const LENDER = "Esimerkki Rahoitus";
const CREDIT = 15_000;
const credit = (): Transaction[] => MONTHS.map((m) => tx({ accountId: "own", bookingDate: `${m}-03`, amountCents: -CREDIT, merchant: LENDER, category: "loans" }));
const rent = (): Transaction[] => MONTHS.map((m) => tx({ accountId: "own", bookingDate: `${m}-01`, amountCents: -90_017, merchant: "Esimerkki Asunnot", category: "housing" }));

const CREDIT_LINE: Loan = {
  id: "loan-credit", name: "Joustoluotto", lender: LENDER, kind: "credit_line", grantedCents: null, balanceCents: 200_000, balanceDate: "2026-10-01", rateBp: 1_490,
  reference: null, marginBp: null, repayment: "annuity", intervalMonths: null, paymentCents: null, endDate: null, limitCents: 500_000,
  seriesKey: seriesId({ direction: "out", accountId: "own", merchant: LENDER, product: null }),
};

function rowsOf(inputs: UserInputs) {
  const cal = billCalendar(createContext([...credit(), ...rent()], [own], TODAY), inputs);
  return cal.months.flatMap((m) => m.rows);
}

describe("a saved loan's series in the bill calendar", () => {
  it("marks the rows of a credit line's series and changes neither their kind nor their sum", () => {
    const before = rowsOf(NO_INPUTS).filter((r) => r.payee === LENDER);
    const after = rowsOf({ ...NO_INPUTS, loans: [CREDIT_LINE] }).filter((r) => r.payee === LENDER);
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((r) => r.loanSeries === undefined)).toBe(true);
    expect(after.map((r) => ({ ...r, loanSeries: undefined }))).toEqual(before.map((r) => ({ ...r, loanSeries: undefined })));
    expect(after.every((r) => r.kind === "bill" && r.loanSeries === true)).toBe(true);
  });

  it("leaves the rows of a series no saved loan names unmarked", () => {
    const rows = rowsOf({ ...NO_INPUTS, loans: [CREDIT_LINE] }).filter((r) => r.payee !== LENDER);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => "loanSeries" in r)).toBe(false);
  });

  it("does not mark a series that only the answer Ei ole velan maksu names", () => {
    const rows = rowsOf({ ...NO_INPUTS, marks: [{ subject: `${NOT_LOAN_SUBJECT}${CREDIT_LINE.seriesKey}`, mark: "dismissed", markedAt: "2026-10-01T00:00:00Z" }] }).filter((r) => r.payee === LENDER);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => "loanSeries" in r)).toBe(false);
  });
});
