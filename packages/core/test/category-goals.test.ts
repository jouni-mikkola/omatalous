import { describe, expect, it } from "vitest";
import { categoryGoalPaces, GOAL_CATEGORIES } from "../src/analysis/category-goals.ts";
import { createContext } from "../src/analysis/context.ts";
import { buildReports } from "../src/reports/index.ts";
import type { Account, UserInputs } from "../src/types.ts";
import { dataset } from "./report-dataset.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";
const balances = [{ id: "acc-1", name: "Käyttötili", type: "checking" as const, balanceCents: 123456, ownerName: null, balanceAt: null }];
const september = { from: "2026-09-01", to: "2026-09-30" };
const ctx = createContext(dataset(), [checking], today);
const inputs = (categoryGoals: Record<string, number>): UserInputs => ({ marks: [], expectedBills: [], categoryGoals });

describe("category goals", () => {
  it("with no goal, every goal category says so and offers the expected month", () => {
    const r = buildReports({ ctx, range: september, balances }).categoryGoals;
    expect(r.month).toBe("2026-09");
    expect(r.rows.map((x) => x.category)).toEqual([...GOAL_CATEGORIES]);
    expect(r.rows.every((x) => x.goalCents === null && x.deltaCents === null)).toBe(true);
    expect(r.total).toBeNull();
    expect(r.missing).toHaveLength(GOAL_CATEGORIES.length);
    for (const x of r.rows) if (x.proposedCents !== null) expect(x.proposedCents % 100).toBe(0);
    expect(r.rows.some((x) => x.proposedCents !== null)).toBe(true);
  });

  it("the rows add up to the total, and each row's spending is the category's in Kategoriat", () => {
    const goals = { groceries: 50_000, restaurants: 12_000, transport: 5_000, car: 20_000 };
    const reports = buildReports({ ctx, range: september, balances, inputs: inputs(goals) });
    const r = reports.categoryGoals;
    expect(r.missing).toEqual([]);
    expect(r.total).not.toBeNull();
    expect(r.rows.reduce((s, x) => s + x.goalCents!, 0)).toBe(r.total!.goalCents);
    expect(r.rows.reduce((s, x) => s + x.spentCents!, 0)).toBe(r.total!.spentCents);
    expect(r.rows.reduce((s, x) => s + x.deltaCents!, 0)).toBe(r.total!.deltaCents);
    expect(r.total!.deltaCents).toBe(r.total!.spentCents - r.total!.goalCents);
    expect(r.complete).toBe(true);
    const table = reports.spendingTable;
    for (const x of r.rows) expect(x.spentCents, x.category).toBe(table.rows.filter((t) => t.category === x.category).reduce((s, t) => s + t.totalCents, 0));
    // the conclusion's budget comparison is the total of the rows
    const budget = reports.conclusions.menot!.compare.budget;
    expect(budget).toMatchObject({ kind: "budget", cents: r.total!.goalCents, deltaCents: r.total!.deltaCents });
  });

  it("a goal for some categories compares only those, and names the rest as missing", () => {
    const r = buildReports({ ctx, range: september, balances, inputs: inputs({ groceries: 50_000 }) }).categoryGoals;
    expect(r.total!.goalCents).toBe(50_000);
    expect(r.total!.spentCents).toBe(r.rows[0]!.spentCents);
    expect(r.missing).toHaveLength(GOAL_CATEGORIES.length - 1);
    expect(r.rows[1]!.proposedCents === null || r.rows[1]!.goalCents === null).toBe(true);
    expect(r.rows[0]!.proposedCents).toBeNull();
    // only the goal rows are in the total: a row with no goal still shows what it spent
    expect(r.rows.filter((x) => x.goalCents === null).every((x) => x.deltaCents === null)).toBe(true);
  });

  it("a goal is a month's: over more than one month there is no spending beside it and the comparison says why", () => {
    const reports = buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-30" }, balances, inputs: inputs({ groceries: 50_000 }) });
    expect(reports.categoryGoals.month).toBeNull();
    expect(reports.categoryGoals.total).toBeNull();
    expect(reports.categoryGoals.rows[0]).toMatchObject({ goalCents: 50_000, spentCents: null, deltaCents: null });
    const c = reports.conclusions.menot!;
    expect(c.compare.budget).toBeNull();
    expect(typeof c.gaps.budget).toBe("string");
  });

  it("a range from the middle of a month has no spending beside the goal, which would read as underspent", () => {
    const r = buildReports({ ctx, range: { from: "2026-09-15", to: "2026-09-30" }, balances, inputs: inputs({ groceries: 50_000 }) }).categoryGoals;
    expect(r.month).toBeNull();
    expect(r.rows[0]).toMatchObject({ goalCents: 50_000, spentCents: null, deltaCents: null });
  });

  it("a running month is not complete, and the comparison says what is left of the goals, not a saving", () => {
    const running = createContext(dataset(), [checking], "2026-09-12");
    const reports = buildReports({ ctx: running, range: { from: "2026-09-01", to: "2026-09-30" }, balances, inputs: inputs({ groceries: 500_000 }) });
    expect(reports.categoryGoals.complete).toBe(false);
    expect(reports.conclusions.menot!.compare.budget!.text).toContain("jäljellä");
  });

  it("the first page's pace reads the running month up to today", () => {
    const paces = categoryGoalPaces(ctx, "2026-10", today, { transport: 5_000, groceries: 40_000, rent: 1 });
    expect(paces.map((p) => p.category)).toEqual(["groceries", "transport"]);
    for (const p of paces) expect(p.leftCents).toBe(p.cents - p.spentCents);
    expect(categoryGoalPaces(ctx, "2026-10", today, {})).toEqual([]);
  });
});
