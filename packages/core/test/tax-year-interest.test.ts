/**
 * The interest of home and student loans on the tax-year sheet (`reports/tax-year.ts`): the sum is exact only when every
 * payment's interest is known, and unknown otherwise, never 0. Made-up lenders, accounts and sums only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildReports } from "../src/reports/index.ts";
import { type Account, type Loan, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const today = "2026-11-18";
const range = { from: "2026-01-01", to: "2026-12-31" };
const LENDER = "Esimerkkipankki";
const IBAN_HOME = "FI1410093000123458";
const IBAN_OTHER = "FI4950009420028730";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const homeAccount: Account = { id: "acc-2", name: "Asuntolaina", iban: IBAN_HOME, currency: "EUR", type: "loan" };
const otherAccount: Account = { id: "acc-3", name: "Toinen asuntolaina", iban: IBAN_OTHER, currency: "EUR", type: "loan" };

/** A home loan of 10 000 € at 6 % with 300 € a month, its balance as of the 5th of August. */
const mortgage = (over: Partial<Loan> = {}): Loan => ({
  id: "loan-1", name: "Asuntolaina", lender: LENDER, kind: "mortgage", grantedCents: null, balanceCents: 1_000_000, balanceDate: "2026-08-05", rateBp: 600,
  reference: null, marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: 30_000, endDate: null, limitCents: null, seriesKey: `out:acc-1:${LENDER}`, ...over,
});
const inputs = (...loans: Loan[]): UserInputs => ({ marks: [], expectedBills: [], loans });

const payment = (date: string, cents: number, over: Partial<Transaction> = {}) =>
  tx({ bookingDate: date, amountCents: -cents, merchant: LENDER, description: "Lainan lyhennys", category: "mortgage", categorySource: "rule", ...over });
const interest = (date: string, cents: number, iban: string) => tx({ bookingDate: date, amountCents: -cents, merchant: LENDER, counterpartyIban: iban, category: "interest", categorySource: "rule" });
const dues = () => ["2026-09-05", "2026-10-05", "2026-11-05"].map((d) => payment(d, 30_000));
const salary = tx({ bookingDate: "2026-10-25", amountCents: 300_000, merchant: "Esimerkki Oy", category: "salary" });

const interestOf = (rows: Transaction[], input: UserInputs, accounts: Account[] = [checking]) =>
  buildReports({ ctx: createContext(rows, accounts, today), range, balances: [], inputs: input }, ["taxYear"]).taxYear.interest;

describe("the tax-year interest", () => {
  it("is the exact sum of the interest parts when the plan splits every payment", () => {
    const r = interestOf([...dues(), salary], inputs(mortgage()));
    // 50,00 + 48,75 + 47,49 of interest at 6 % on the balance that is left each month
    expect(r.cents).toBe(5_000 + 4_875 + 4_749);
    expect(r.rows.map((x) => x.cents)).toEqual([5_000, 4_875, 4_749]);
  });

  it("is unknown, not 0, while a payment is not split", () => {
    expect(interestOf([...dues(), salary], NO_INPUTS)).toEqual({ cents: null, rows: [] });
    // a payment far from a due date stays whole, and the split ones are still listed
    const r = interestOf([...dues(), payment("2026-09-20", 30_000), salary], inputs(mortgage()));
    expect(r.cents).toBeNull();
    expect(r.rows.map((x) => x.cents)).toEqual([5_000, 4_875, 4_749]);
  });

  it("is a student loan's payments too, and not consumer credit", () => {
    expect(interestOf([payment("2026-10-05", 12_500, { category: "student_loan" }), salary], NO_INPUTS).cents).toBeNull();
    expect(interestOf([payment("2026-10-05", 12_500, { category: "loans" }), salary], NO_INPUTS)).toEqual({ cents: 0, rows: [] });
  });

  it("is 0 in a year with no loan", () => {
    expect(interestOf([salary, tx({ bookingDate: "2026-10-02", amountCents: -20_000, merchant: "Prisma", category: "groceries" })], NO_INPUTS)).toEqual({ cents: 0, rows: [] });
  });

  describe("a loan whose interest the bank books as a row of its own", () => {
    const home = mortgage({ seriesKey: null, accountId: "acc-2" });
    const accounts = [checking, homeAccount, otherAccount];

    it("counts that row and holds no interest in a payment of the same month", () => {
      const rows = [payment("2026-10-05", 25_000, { counterpartyIban: IBAN_HOME }), interest("2026-10-05", 5_000, IBAN_HOME), salary];
      expect(interestOf(rows, inputs(home), accounts)).toMatchObject({ cents: 5_000, rows: [{ cents: 5_000 }] });
    });

    it("leaves a payment unknown when the interest row is of another month", () => {
      const rows = [payment("2026-10-05", 25_000, { counterpartyIban: IBAN_HOME }), interest("2026-09-30", 5_000, IBAN_HOME), salary];
      expect(interestOf(rows, inputs(home), accounts).cents).toBeNull();
    });

    it("leaves a payment unknown when the interest row is another loan's", () => {
      const other = mortgage({ id: "loan-2", seriesKey: null, accountId: "acc-3" });
      const rows = [payment("2026-10-05", 25_000, { counterpartyIban: IBAN_HOME }), interest("2026-10-05", 5_000, IBAN_OTHER), salary];
      const r = interestOf(rows, inputs(home, other), accounts);
      expect(r.cents).toBeNull();
      expect(r.rows.map((x) => x.cents)).toEqual([5_000]);
    });
  });
});
