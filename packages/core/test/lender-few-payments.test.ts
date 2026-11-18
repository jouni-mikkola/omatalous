/**
 * A lender paid too few times or too little for a monthly series is still a loan: two payments, or one after a credit
 * the lender paid in, are proposed with no monthly figure, and a credit paid in tells what is owed at least and the
 * kind of the loan. An instalment service's invoices stay purchases. Made-up names and sums.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { buildQuestions } from "../src/analysis/questions.ts";
import { addMonths } from "../src/dates.ts";
import { loanProposals, notLoanMark } from "../src/loan-detect.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { type Account, NO_INPUTS, type Transaction, type UserInputs } from "../src/types.ts";
import { tx } from "./helpers.ts";

const TODAY = "2026-10-18";
const range = { from: "2026-10-01", to: TODAY };
const checking: Account = { id: "chk", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking", holder: "ESIMERKKI ERKKI" };

const row = (counterparty: string, description: string | null, euros: number, date: string, mcc: string | null = null): Transaction =>
  tx({ accountId: "chk", bookingDate: date, amountCents: Math.round(euros * 100), counterparty, counterpartyIban: mcc ? null : "FI4950009420028731", description, mcc, merchant: normalizeMerchant(counterparty, description) });

/** A finance company's payment, known by the shape of its name. */
const paid = (euros: number, date: string) => row("MALLI RAHOITUS OY", "LASKU", -euros, date);
/** The credit the same company paid in, named by its product. */
const drawn = (euros: number, date: string, product = "JOUSTOLUOTTO") => row(`MALLI RAHOITUS ${product}`, "NOSTO", euros, date);

function contextOf(rows: Transaction[]) {
  const accounts = [checking];
  const changed = new Map(enrichTransactions(rows, accounts, []).map((t) => [t.id, t]));
  return createContext(rows.map((t) => changed.get(t.id) ?? t), accounts, TODAY);
}

const proposed = (rows: Transaction[], inputs: UserInputs = NO_INPUTS) => loanProposals(contextOf(rows), inputs);

describe("a lender paid twice", () => {
  const rows = [paid(15, "2026-09-05"), paid(15, "2026-10-05")];

  it("is proposed under 20 € and under three months, with the latest payment and no monthly figure", () => {
    const [p, ...rest] = proposed(rows);
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ key: "out:chk:Malli Rahoitus Oy#1500", payee: "Malli Rahoitus Oy", paymentCents: 1500, monthlyCents: null, months: 2, plan: false, placed: false });
    expect(p!.rowIds).toHaveLength(2);
    expect(p!.owedAtLeastCents).toBeUndefined();
  });

  it("is asked what loan it is, and stays out of the unsaved loans' monthly sum", () => {
    const ctx = contextOf(rows);
    expect(buildQuestions(ctx, range, NO_INPUTS).items.filter((q) => q.kind === "loan")).toHaveLength(1);
    expect(buildDashboard(ctx, range).holdings.unsavedLoans).toBeUndefined();
  });

  it("is set aside by Ei ole laina", () => {
    const [p] = proposed(rows);
    expect(proposed(rows, { ...NO_INPUTS, marks: [{ ...notLoanMark(p!), markedAt: "2026-10-18T10:00:00Z" }] })).toEqual([]);
  });
});

describe("a credit paid in and paid back in part", () => {
  const rows = [drawn(500, "2026-08-20"), paid(60, "2026-10-05")];

  it("is proposed after one payment, owing the credit less what was paid since, a credit line by its name", () => {
    const [p, ...rest] = proposed(rows);
    expect(rest).toEqual([]);
    expect(p).toMatchObject({ payee: "Malli Rahoitus Oy", paymentCents: 6000, monthlyCents: null, owedAtLeastCents: 44_000, kind: "credit_line" });
  });

  it("adds up every credit the lender paid in", () => {
    expect(proposed([drawn(300, "2026-07-20"), ...rows])[0]?.owedAtLeastCents).toBe(74_000);
  });

  it("is an instalment plan where the credit names one", () => {
    expect(proposed([drawn(500, "2026-08-20", "OSAMAKSU"), paid(60, "2026-10-05")])[0]?.kind).toBe("instalment");
  });

  it("tells a monthly loan's lower bound and kind too", () => {
    const monthly = Array.from({ length: 6 }, (_, i) => paid(100, `${addMonths("2026-10", i - 5)}-05`));
    const [p] = proposed([drawn(2000, "2026-03-20"), ...monthly]);
    expect(p).toMatchObject({ paymentCents: 10_000, monthlyCents: 10_000, owedAtLeastCents: 140_000, kind: "credit_line" });
    expect(proposed(monthly)[0]).toMatchObject({ monthlyCents: 10_000, kind: "consumer" });
    expect(proposed(monthly)[0]?.owedAtLeastCents).toBeUndefined();
  });
});

describe("what is no lender's few payments", () => {
  it.each([
    ["one payment and no credit", [paid(60, "2026-10-05")]],
    ["a credit with no payment yet", [drawn(500, "2026-08-20")]],
    ["two payments that stopped in the summer", [paid(15, "2026-07-05"), paid(15, "2026-08-05")]],
    ["a credit paid back in full", [drawn(500, "2026-08-20"), paid(250, "2026-09-05"), paid(250, "2026-10-05")]],
    ["two invoices of an instalment service", [row("KLARNA BANK AB", "LASKU", -30, "2026-09-12"), row("KLARNA BANK AB", "LASKU", -30, "2026-10-12")]],
    ["two parts of an instalment service's plan", [row("KLARNA BANK AB", "OSAMAKSU 1", -30, "2026-09-12"), row("KLARNA BANK AB", "OSAMAKSU 2", -30, "2026-10-12")]],
    ["two card purchases through an instalment service", [row("KLARNA*KAUPPA", null, -45, "2026-09-12", "5651"), row("KLARNA*KAUPPA", null, -45, "2026-10-12", "5651")]],
    ["a relative's loan paid back", [row("ESIMERKKI EINO", "laina", 100, "2026-08-20"), row("ESIMERKKI EINO", null, -50, "2026-09-05"), row("ESIMERKKI EINO", null, -50, "2026-10-05")]],
  ])("%s", (_name, rows) => {
    expect(proposed(rows)).toEqual([]);
  });

  it("leaves an instalment service's invoices and card purchases in shopping", () => {
    const ctx = contextOf([row("KLARNA BANK AB", "LASKU", -30, "2026-10-12"), row("KLARNA*KAUPPA", null, -45, "2026-10-12", "5651")]);
    expect(ctx.txs.map((t) => t.category)).toEqual(["shopping", "shopping"]);
  });
});
