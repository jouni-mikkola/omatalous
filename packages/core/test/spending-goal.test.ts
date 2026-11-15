import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { monthPace } from "../src/analysis/forecast.ts";
import { spendingGoal } from "../src/analysis/spending-goal.ts";
import { NO_INPUTS, type Account, type IsoDate } from "../src/types.ts";
import { tx } from "./helpers.ts";
import { lateCardContext } from "./late-card-household.ts";

const checking: Account = { id: "acc-1", name: "Käyttötili", iban: "FI21 1234 5600 0007 85", currency: "EUR", type: "checking" };
const buy = (date: IsoDate, cents: number) => tx({ bookingDate: date, amountCents: -cents, merchant: "Prisma", category: "groceries" });
const pay = (date: IsoDate) => tx({ bookingDate: date, amountCents: 300_000, merchant: "Acme Oy", category: "salary" });

// five complete months (the history starts on 30 April), each with 100 € on the 5th and, on the 20th, 100, 150, 200, 250 and 300 € (none is a one-off):
// the expected month ends at 300 €, its quartile months at 250 and 350 €. October has spent 150 € by the 10th.
const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const history = [pay("2026-04-30"), ...months.flatMap((m, i) => [pay(`${m}-01`), buy(`${m}-05`, 10_000), buy(`${m}-20`, (i + 2) * 5_000)])];
const rows = [...history, pay("2026-10-01"), buy("2026-10-05", 15_000)];
const paceAt = (today: IsoDate, from = rows) => monthPace(createContext(from, [checking], today), "2026-10", today);

describe("spending goal: the pace figure", () => {
  const pace = paceAt("2026-10-10");

  it("sets the month's spending so far against the goal and ends the month as the usual months spent the rest of it", () => {
    // the estimate's range is 150 € + the 150 € and the 250 € the quartile months add after the 10th
    expect(pace.projection).toMatchObject({ fromDay: 10 });
    expect(pace.projection!.low.at(-1)).toBe(30_000);
    expect(pace.projection!.high.at(-1)).toBe(40_000);
    expect(spendingGoal(pace, 60_000)).toEqual({ cents: 60_000, leftCents: 45_000, end: { low: 30_000, high: 40_000 }, perDayCents: 2_142, state: "within" });
  });

  it("is `near` when the goal is inside the estimate, `above` when the whole estimate is over it and `within` on its edge", () => {
    expect(spendingGoal(pace, 35_000).state).toBe("near");
    expect(spendingGoal(pace, 29_999).state).toBe("above");
    expect(spendingGoal(pace, 30_000).state).toBe("near");
    expect(spendingGoal(pace, 40_000).state).toBe("within");
    expect(spendingGoal(pace, 39_999).state).toBe("near");
  });

  it("is `over` once the spending is above the goal, whatever the estimate says, and exactly on the goal is not over", () => {
    expect(spendingGoal(pace, 10_000)).toMatchObject({ leftCents: -5_000, state: "over", perDayCents: null });
    expect(spendingGoal(pace, 15_000)).toMatchObject({ leftCents: 0, state: "above", perDayCents: null });
  });

  it("divides what is left by the days after today", () => {
    // 21 days remain after the 10th
    expect(spendingGoal(pace, 30_000).perDayCents).toBe(Math.floor(15_000 / 21));
  });

  it("ends on the month's total on its last day, with nothing to divide", () => {
    const last = paceAt("2026-10-31");
    expect(last.projection).toBeNull();
    expect(spendingGoal(last, 20_000)).toEqual({ cents: 20_000, leftCents: 5_000, end: { low: 15_000, high: 15_000 }, perDayCents: null, state: "within" });
    expect(spendingGoal(last, 14_000).state).toBe("over");
  });

  it("is `open` under three complete months: no estimate, only what is left", () => {
    // the history starts on 31 July: August and September are the only complete months
    const short = paceAt("2026-10-10", [pay("2026-07-31"), buy("2026-08-05", 10_000), buy("2026-09-05", 10_000), pay("2026-10-01"), buy("2026-10-05", 15_000)]);
    expect(short.expected).toBeNull();
    expect(spendingGoal(short, 60_000)).toMatchObject({ end: null, state: "open", leftCents: 45_000 });
  });
});

describe("spending goal: in the dashboard", () => {
  const today = "2026-10-10";
  const ctx = createContext(rows, [checking], today);
  const range = { from: "2026-10-01", to: "2026-10-31" };

  it("is null without a goal and the pace figure with one", () => {
    expect(buildDashboard(ctx, range).goal).toBeNull();
    expect(buildDashboard(ctx, range, [], { ...NO_INPUTS, spendingGoalCents: null }).goal).toBeNull();
    const d = buildDashboard(ctx, range, [], { ...NO_INPUTS, spendingGoalCents: 45_000 });
    expect(d.goal).toEqual(spendingGoal(d.pace, 45_000));
    expect(d.goal!.leftCents).toBe(45_000 - d.totals.expenseCents);
  });
});

describe("spending goal: with a card that begins in the middle of the history", () => {
  const range = { from: "2026-10-01", to: "2026-10-31" };

  it("estimates the month's end from the whole totals of months that hold the card only as bills, and draws no day of them", () => {
    const d = buildDashboard(lateCardContext("2026-07"), range, [], { ...NO_INPUTS, spendingGoalCents: 400_000 });
    expect(d.pace).toMatchObject({ expected: null, cardGap: true });
    expect(d.pace.projection).not.toBeNull();
    expect(d.pace.projection!.low[0]).toBe(d.pace.currentTotal);
    expect(d.goal!.end).not.toBeNull();
    expect(d.goal!.end!.low).toBeGreaterThanOrEqual(d.pace.currentTotal);
    expect(d.goal).toMatchObject({ leftCents: 400_000 - d.pace.currentTotal });
  });

  it("estimates the end from the card's own months when no card bill comes before them", () => {
    // with no bill the figure reads July to September, which hold the card's purchases
    const d = buildDashboard(lateCardContext("2026-07", "2026-10-09", false), range, [], { ...NO_INPUTS, spendingGoalCents: 400_000 });
    expect(d.pace.cardGap).toBe(false);
    expect(d.pace.expected).not.toBeNull();
    expect(d.goal!.end).not.toBeNull();
  });

  it("estimates the end when the card's rows cover the months", () => {
    const d = buildDashboard(lateCardContext("2026-01"), range, [], { ...NO_INPUTS, spendingGoalCents: 400_000 });
    expect(d.pace.cardGap).toBe(false);
    expect(d.pace.expected).not.toBeNull();
    expect(d.goal!.end).not.toBeNull();
  });
});
