/**
 * A month is complete for the accounts a reader sums: an account connected eight months after another does not
 * hide the months before it, and it makes its own first month incomplete. A household whose accounts start on one day
 * reads as it did when the history of all rows decided. Made-up sums only.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { planOf } from "../src/analysis/change-plan.ts";
import { completeMonthsBefore, isCompleteMonth } from "../src/analysis/usual.ts";
import { buildReports } from "../src/reports/index.ts";
import { accountsBefore } from "../src/optimise/common.ts";
import type { Account, Transaction } from "../src/types.ts";
import { series } from "./helpers.ts";

const today = "2026-10-16";
const A: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const B: Account = { id: "acc-2", name: "Maijan tili", iban: null, currency: "EUR", type: "checking" };

/** Groceries every third day on the account from `from` to today, 100 euros a month. */
const filler = (accountId: string, from: string, cents = 1000): Transaction[] =>
  series(from, 3, Math.floor((Date.parse(today) - Date.parse(from)) / 864e5 / 3) + 1, -cents, { accountId, merchant: "K-Market", category: "groceries", categorySource: "rule" });

const ctxOf = (rows: Transaction[], accounts = [A, B]) => createContext(rows, accounts, today);
// A from December 2025; B connected eight months later, its first row on 10.8.2026
const later = () => ctxOf([...filler("acc-1", "2025-12-01"), ...filler("acc-2", "2026-08-10")]);
const together = () => ctxOf([...filler("acc-1", "2025-12-01"), ...filler("acc-2", "2025-12-01")]);

describe("a month is complete for the accounts that sum it", () => {
  it("keeps the months before the late account and drops its first month", () => {
    const ctx = later();
    expect(completeMonthsBefore(ctx, "2026-08")).toEqual(["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"]);
    expect(isCompleteMonth(ctx, "2026-08")).toBe(false);
    expect(isCompleteMonth(ctx, "2026-09")).toBe(true);
    // the usual window stops at the month the account joined
    expect(completeMonthsBefore(ctx, "2026-10")).toEqual(["2026-09"]);
  });

  it("skips the month a small new account joined and stops at a main account", () => {
    // B: one 10 euro purchase a month against A's 100 euros, joined 10.8.2026: under a tenth of the spending
    const small = ctxOf([...filler("acc-1", "2025-12-01"), ...series("2026-08-10", 30, 3, -1000, { accountId: "acc-2", merchant: "K-Market", category: "groceries" })]);
    expect(isCompleteMonth(small, "2026-08")).toBe(false);
    expect(completeMonthsBefore(small, "2026-10")).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-09"]);
    expect(planOf(small, "usual", "2026-10")?.base).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-09"]);
    // the same account at half the household's spending: the window waits (see the first test)
    expect(completeMonthsBefore(later(), "2026-10")).toEqual(["2026-09"]);
    expect(planOf(later(), "usual", "2026-10")).toBeNull();
    // an account named by the reader always stops
    expect(completeMonthsBefore(small, "2026-10", 6, ["acc-1", "acc-2"])).toEqual(["2026-09"]);
  });

  it("asks only the accounts it is given", () => {
    const ctx = later();
    expect(isCompleteMonth(ctx, "2026-05", ["acc-1"])).toBe(true);
    expect(isCompleteMonth(ctx, "2026-05", ["acc-2"])).toBe(false);
    expect(isCompleteMonth(ctx, "2026-09", ["acc-1", "acc-2"])).toBe(true);
    expect(isCompleteMonth(ctx, "2026-10", ["acc-1"])).toBe(false);
    expect(completeMonthsBefore(ctx, "2026-10", 6, ["acc-2"])).toEqual(["2026-09"]);
  });

  it("gives accounts that start on one day the answer of the history of all rows", () => {
    const ctx = together();
    const alone = ctxOf(filler("acc-1", "2025-12-01"), [A]);
    expect(completeMonthsBefore(ctx, "2026-10", 12)).toEqual(completeMonthsBefore(alone, "2026-10", 12));
    expect(completeMonthsBefore(ctx, "2026-10", 12)).toHaveLength(10);
    expect(isCompleteMonth(ctx, "2025-11")).toBe(false);
    expect(isCompleteMonth(ctx, "2026-10")).toBe(false);
  });
});

describe("the plan of a spending change", () => {
  it("builds the usual level only from months after the late account joined, and reads the noise across them", () => {
    const ctx = later();
    // August 2026 is the joining month: October's usual base is September alone, under three months
    expect(planOf(ctx, "usual", "2026-10")).toBeNull();
    const season = planOf(ctxOf([...filler("acc-1", "2024-12-01"), ...series("2026-08-10", 30, 3, -1000, { accountId: "acc-2", merchant: "K-Market", category: "groceries" })]), "season", "2026-10");
    expect(season?.noise).toContain("2026-03");
    expect(season?.noise).toContain("2026-09");
    expect(season?.noise).not.toContain("2026-08");
  });

  it("gives accounts that start on one day the usual base of six months", () => {
    expect(planOf(together(), "usual", "2026-10")?.base).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  });
});

describe("accountsBefore", () => {
  it("leaves out the account connected inside the window", () => {
    expect([...accountsBefore(later(), "2026-01-01")]).toEqual(["acc-1"]);
    expect([...accountsBefore(later(), "2026-08-10")].sort()).toEqual(["acc-1", "acc-2"]);
    expect([...accountsBefore(later(), "2026-08-01")]).toEqual(["acc-1"]);
  });

  it("keeps every account that starts on one day", () => {
    expect([...accountsBefore(together(), "2025-12-01")].sort()).toEqual(["acc-1", "acc-2"]);
    expect([...accountsBefore(together(), "2025-11-01")]).toEqual([]);
  });
});

describe("drift reads the accounts of its rows", () => {
  const from = "2025-01-01";
  const drift = (ctx: ReturnType<typeof ctxOf>) => buildReports({ ctx, range: { from, to: today }, balances: [] }).drift;
  const long = (a: string, b: string) => ctxOf([...filler("acc-1", a), ...filler("acc-2", b)]);

  it("does not compare with months before an account of the recent rows was connected", () => {
    const r = drift(long("2025-03-01", "2026-02-10"));
    // March to June 2026 are the only base months with both accounts in the data: fewer than six
    expect(r.months).toEqual([]);
    expect(r.readyFrom).toBe("2026-12-01");
  });

  it("judges a household whose accounts start on one day as before", () => {
    const both = drift(long("2025-03-01", "2025-03-01"));
    const alone = drift(ctxOf(filler("acc-1", "2025-03-01"), [A]));
    expect(both.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(both.months).toEqual(alone.months);
    expect(both.readyFrom).toBe("2025-12-01");
    expect(both.readyFrom).toBe(alone.readyFrom);
  });
});
