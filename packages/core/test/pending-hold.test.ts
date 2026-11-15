/**
 * A payment the bank has reserved and not booked yet has no text. It reads as a hold, not as "Muut menot", and it
 * still counts as spending. Its booking names the payee and sorts the row as any other. Every row is made up.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { flowsOf } from "../src/analysis/flows.ts";
import { buildReports } from "../src/reports/index.ts";
import { isKnownCategory } from "../src/categories.ts";
import { enrichTransactions } from "../src/pipeline.ts";
import { normalizeMerchant } from "../src/merchant.ts";
import { THEMES } from "../src/themes.ts";
import { type Account, NO_INPUTS, type Transaction } from "../src/types.ts";
import { tx } from "./helpers.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI2112345600000785", currency: "EUR", type: "checking" };

const row = (status: Transaction["status"], euros: number, counterparty: string | null, extra: Partial<Transaction> = {}): Transaction =>
  tx({ status, bookingDate: "2026-09-05", amountCents: Math.round(euros * 100), counterparty, merchant: normalizeMerchant(counterparty, null), ...extra });

const sorted = (rows: Transaction[]) => enrichTransactions(rows, [checking], []);

describe("a pending row with no text", () => {
  it("is a hold of spending, in a theme, and no row of Muut menot", () => {
    const [t] = sorted([row("pending", -23.5, null)]);
    expect(t!.category).toBe("hold");
    expect(isKnownCategory("hold")).toBe(true);
    expect(THEMES.some((theme) => theme.lines.some((l) => l.id === "hold"))).toBe(true);
    expect(flowsOf(t!, new Set()).consumption).toBe(2350);
  });

  it("is sorted as any row once the bank books it with a payee", () => {
    const [t] = sorted([row("booked", -23.5, "K-MARKET KAMPPI")]);
    expect(t!.category).toBe("groceries");
  });

  it("stays what it is when it has a payee, a card class or money in", () => {
    const named = sorted([row("pending", -23.5, "K-MARKET KAMPPI")])[0]!;
    expect(named.category).toBe("groceries");
    const coded = sorted([row("pending", -23.5, null, { mcc: "5411" })])[0]!;
    expect(coded.category).not.toBe("hold");
    const incoming = sorted([row("pending", 23.5, null)])[0]!;
    expect(incoming.category).not.toBe("hold");
  });

  it("is a hold only while it is pending: a booked row with no text stays in Muut menot", () => {
    // the run returns only the rows it changed: a booked row with no text keeps "other" and is not among them
    expect(sorted([row("booked", -23.5, null)])).toEqual([]);
  });

  it("is no hold when it names a counterparty account or carries a bank transaction code", () => {
    expect(sorted([row("pending", -50, null, { counterpartyIban: "FI21 1234 5600 0007 85" })])[0]?.category).not.toBe("hold");
    expect(sorted([row("pending", -50, null, { bankTxnCode: "PMNT-ICDT-ESCT" })])[0]?.category).not.toBe("hold");
  });
});

/** The month of Yhteenveto and of Raportit, built from the same rows, with the one payment reserved or booked. */
describe("a reserved payment, then booked", () => {
  const TODAY = "2026-10-12";
  const salary = tx({ id: "pay", bookingDate: "2026-10-01", amountCents: 300_000, merchant: "Acme Oy", category: "salary" });
  const groceries = tx({ id: "food", bookingDate: "2026-10-03", amountCents: -18_000, merchant: "Prisma", category: "groceries" });
  const month = (status: Transaction["status"], counterparty: string | null): Transaction[] => {
    const reserved = row(status, -23.5, counterparty, { id: "reserved", bookingDate: "2026-10-05" });
    return [salary, groceries, sorted([reserved])[0] ?? reserved];
  };
  const figures = (rows: Transaction[]) => {
    const ctx = createContext(rows, [checking], TODAY);
    const dash = buildDashboard(ctx, { from: "2026-10-01", to: TODAY }, [], NO_INPUTS);
    const report = buildReports({ ctx, range: { from: "2026-10-01", to: TODAY }, balances: [] }, ["spendingMonths"]).spendingMonths;
    return { tile: dash.overview.months.at(-1)!.spendCents, report: report.totalCents };
  };

  it("moves from the hold to its category with every total unchanged", () => {
    const pending = month("pending", null);
    const booked = month("booked", "K-MARKET KAMPPI");
    expect(pending.find((r) => r.id === "reserved")?.category).toBe("hold");
    expect(booked.find((r) => r.id === "reserved")?.category).toBe("groceries");
    const [before, after] = [figures(pending), figures(booked)];
    expect(before.tile).toBe(18_000 + 2_350);
    expect([after.tile, after.report]).toEqual([before.tile, before.report]);
  });

  it("gives Yhteenveto and Raportit one total for the month while the hold is there", () => {
    const held = figures(month("pending", null));
    expect(held.tile).toBe(held.report);
  });
});
