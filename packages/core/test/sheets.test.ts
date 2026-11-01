import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { taxYearCsv } from "../src/sheet-csv.ts";
import { buildReports } from "../src/reports/index.ts";
import { type Account, type BalanceInput, type Transaction } from "../src/types.ts";
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

  it("lists interest rows of the year whose sum is the dashboard's category", () => {
    const categories = buildReports({ ctx, range: sheet.range, balances }).categories;
    const dashboard = categories.groups.flatMap((g) => g.categories).filter((c) => c.category === "interest").reduce((s, c) => s + c.totalCents, 0);
    expect(sheet.interest.cents).toBe(dashboard);
    expect(sheet.interest.cents).toBe(31234 + 4550);
    expect(sheet.interest.rows.reduce((s, x) => s + x.cents, 0)).toBe(sheet.interest.cents);
  });

  it("gives loan payments by category as the spending figure counts them", () => {
    const categories = buildReports({ ctx, range: sheet.range, balances }).categories;
    for (const p of sheet.loanPayments) expect(p.cents).toBe(categories.groups.flatMap((g) => g.categories).filter((c) => c.category === p.category).reduce((s, c) => s + c.totalCents, 0));
    expect(sheet.loanPayments.map((p) => p.category)).toEqual(["loans"]);
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
    expect(past.interest.cents).toBe(9900);
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
});
