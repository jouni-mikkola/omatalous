import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { taxYearCsv } from "../src/sheet-csv.ts";
import { buildReports } from "../src/reports/index.ts";
import { type Account, type BalanceInput, type Loan, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { dataset } from "./report-dataset.ts";

// the tax-year sheet (docs/ROADMAP.md, Longer forecasts): every figure is a figure the app already
// has, and the rows behind it add up to it to the cent
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";
const balances: BalanceInput[] = [{ id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: 123456, ownerName: null, balanceAt: today }];

function rows(): Transaction[] {
  return [
    ...dataset(),
    tx({ bookingDate: "2026-03-10", amountCents: -31234, category: "interest", merchant: "Nordea Korko" }),
    tx({ bookingDate: "2026-07-10", amountCents: -4550, category: "interest", merchant: "Nordea Korko" }),
    tx({ bookingDate: "2025-12-10", amountCents: -9900, category: "interest", merchant: "Nordea Korko" }),
    tx({ bookingDate: "2026-05-02", amountCents: -58000, category: "taxes", merchant: "Verohallinto", description: "JÄÄNNÖSVERO 2025" }),
    tx({ bookingDate: "2026-05-03", amountCents: -21000, category: "taxes", merchant: "Verohallinto", description: "Ennakkovero" }),
    tx({ bookingDate: "2026-04-20", amountCents: 74200, category: "tax_refund", merchant: "Verohallinto", description: "Veronpalautus" }),
    tx({ bookingDate: "2026-06-03", amountCents: -85000, category: "home", merchant: "Siivouspalvelu Oy" }),
    tx({ bookingDate: "2026-06-04", amountCents: -12000, category: "home", merchant: "Ikea" }),
  ].filter((t) => t.bookingDate <= today);
}

describe("tax-year sheet", () => {
  const ctx = createContext(rows(), [checking], today);
  const range = { from: "2026-01-01", to: "2026-12-31" };
  const r = buildReports({ ctx, range, balances });
  const sheet = r.taxYear;

  it("takes its income from the income report of the same days, source by source, to the cent", () => {
    expect(sheet.year).toBe(2026);
    expect(sheet.partial).toBe(true);
    expect(sheet.range).toEqual({ from: "2026-01-01", to: today });
    const income = buildReports({ ctx, range: sheet.range, balances }).income;
    // a refund is its own part of the sheet, so income and refunds together are the income report's total
    expect(sheet.income.totalCents + sheet.refunds.cents).toBe(income.totalCents);
    expect(sheet.income.types.reduce((s, t) => s + t.totalCents, 0)).toBe(sheet.income.totalCents);
    expect(sheet.income.types.some((t) => t.type === "tax_refund")).toBe(false);
    for (const t of sheet.income.types) expect(income.types.find((x) => x.type === t.type)!.totalCents).toBe(t.totalCents);
    expect(sheet.refunds.cents).toBe(74200);
    expect(sheet.refunds.rows.map((x) => x.cents)).toEqual([74200]);
  });

  describe("interest", () => {
    const mortgageAccount: Account = { id: "acc-m", name: "Asuntolaina", iban: "FI1410093000123458", currency: "EUR", type: "loan" };
    const consumerAccount: Account = { id: "acc-c", name: "Kulutusluotto", iban: "FI4950009420028730", currency: "EUR", type: "loan" };
    const loan = (over: Partial<Loan>): Loan => ({
      id: "loan-1", name: "Laina", lender: "Esimerkkipankki", kind: "mortgage", grantedCents: null, balanceCents: 10_000_000, balanceDate: today, rateBp: 400,
      reference: null, marginBp: null, repayment: "annuity", intervalMonths: 1, paymentCents: 50_000, endDate: null, limitCents: null, seriesKey: null, ...over,
    });
    const saved: UserInputs = { marks: [], expectedBills: [], loans: [loan({ id: "m", accountId: "acc-m" }), loan({ id: "c", kind: "consumer", accountId: "acc-c" })] };
    const interestTo = (iban: string | null, cents: number, bookingDate: string) => tx({ bookingDate, amountCents: -cents, category: "interest", merchant: "Esimerkkipankki", counterpartyIban: iban });
    const known = [interestTo("FI1410093000123458", 31234, "2026-03-10"), interestTo("FI1410093000123458", 4550, "2026-07-10"), interestTo("FI4950009420028730", 7700, "2026-05-10")];
    const taxYear = (extra: Transaction[]) => {
      const own = createContext([...dataset(), ...known, ...extra].filter((t) => t.bookingDate <= today), [checking, mortgageAccount, consumerAccount], today);
      return buildReports({ ctx: own, range, balances, inputs: saved }).taxYear.interest;
    };

    it("counts the interest of a saved home loan and leaves consumer credit out", () => {
      const interest = taxYear([]);
      expect(interest.cents).toBe(31234 + 4550);
      expect(interest.rows.map((x) => x.cents)).toEqual([31234, 4550]);
      expect(interest.rows.reduce((s, x) => s + x.cents, 0)).toBe(interest.cents);
    });

    it("counts a student loan's interest too, and not a car loan's", () => {
      const kinds = (student: Loan["kind"]): UserInputs => ({ marks: [], expectedBills: [], loans: [loan({ id: "m", kind: student, accountId: "acc-m" }), loan({ id: "c", kind: "car", accountId: "acc-c" })] });
      const own = createContext([...dataset(), ...known].filter((t) => t.bookingDate <= today), [checking, mortgageAccount, consumerAccount], today);
      expect(buildReports({ ctx: own, range, balances, inputs: kinds("student") }).taxYear.interest.cents).toBe(31234 + 4550);
      expect(buildReports({ ctx: own, range, balances, inputs: kinds("car") }).taxYear.interest.cents).toBe(0);
    });

    it("is unknown, not 0, when an interest row reaches no saved loan, and still lists the rows that do", () => {
      const interest = taxYear([interestTo(null, 1200, "2026-08-10")]);
      expect(interest.cents).toBeNull();
      expect(interest.rows.map((x) => x.cents)).toEqual([31234, 4550]);
    });

    it("counts no interest row of a household with no saved loan, and its sum is unknown", () => {
      const own = createContext(rows(), [checking], today);
      expect(buildReports({ ctx: own, range, balances }).taxYear.interest).toEqual({ cents: null, rows: [] });
    });
  });

  it("keeps a student loan's payments on the sheet", () => {
    const withStudentLoan = createContext([...rows(), tx({ bookingDate: "2026-02-10", amountCents: -12500, category: "student_loan", merchant: "Opintolaina" })], [checking], today);
    const own = buildReports({ ctx: withStudentLoan, range, balances }).taxYear;
    expect(own.loanPayments).toEqual([{ category: "student_loan", cents: 12500, count: 1 }]);
  });

  it("gives loan payments as the spending figure counts them and leaves consumer credit out", () => {
    const categories = buildReports({ ctx, range: sheet.range, balances }).categories;
    for (const p of sheet.loanPayments) expect(p.cents).toBe(categories.groups.flatMap((g) => g.categories).filter((c) => c.category === p.category).reduce((s, c) => s + c.totalCents, 0));
    // the year holds consumer-credit payments, and none of them is a line of the return
    expect(categories.groups.flatMap((g) => g.categories).some((c) => c.category === "loans" && c.totalCents > 0)).toBe(true);
    expect(sheet.loanPayments.map((p) => p.category)).toEqual([]);
  });

  it("names residual tax only for the rows that say so, and household work only in the home category", () => {
    expect(sheet.residual.rows.map((x) => x.cents)).toEqual([58000]);
    expect(sheet.residual.cents).toBe(58000);
    expect(sheet.household.rows.map((x) => x.cents)).toEqual([85000]);
  });

  it("reads a finished year whole", () => {
    const past = buildReports({ ctx, range: { from: "2025-01-01", to: "2025-12-31" }, balances }).taxYear;
    expect(past.partial).toBe(false);
    expect(past.range).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(past.interest).toEqual({ cents: null, rows: [] });
  });

  it("is quiet without rows", () => {
    const none = buildReports({ ctx: createContext([], [checking], today), range, balances: [] }).taxYear;
    expect(none).toMatchObject({ income: { totalCents: 0, types: [] }, interest: { cents: 0 }, household: { cents: 0 }, loanPayments: [] });
  });

  it("writes the sheet as one file with the sheet's own figures", () => {
    const say = (code: string, p?: Record<string, string | number>) => `${code}${p ? JSON.stringify(p) : ""}`;
    const tax = taxYearCsv(buildReports({ ctx, range, balances }).taxYear, say as never, (c) => c);
    expect(tax).toMatch(/742(,00)?\r?\n/);
  });

  it("writes the interest sum blank while it is unknown", () => {
    const say = (code: string) => code;
    const part = { name: "Lainan korko", date: "2026-03-10", cents: 31234 };
    const rowsOnly = { ...sheet, interest: { cents: null, rows: [{ id: "x", ...part }] } };
    expect(taxYearCsv(rowsOnly, say as never, (c) => c)).toContain("tax.interest;sheet.total;;\r\n");
    const whole = { ...rowsOnly, interest: { cents: 31234, rows: rowsOnly.interest.rows } };
    expect(taxYearCsv(whole, say as never, (c) => c)).toContain("tax.interest;sheet.total;;312,34");
  });
});
