import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { type Flows, totalsOf } from "../src/analysis/flows.ts";
import { completeMonthsBefore, isCompleteMonth } from "../src/analysis/usual.ts";
import { USUAL_MONTHS } from "../src/thresholds.ts";
import { SUBSCRIPTION_CATEGORIES } from "../src/categories.ts";
import { expectedDates, fixedMonthlyCents, fixedSplit, isContract, isSavingsPlan, isSubscription, subscriptionsMonthlyCents } from "../src/commitments.ts";
import type { BalanceInput } from "../src/reports/balances.ts";
import { buildReports, isReportId, REPORTS } from "../src/reports/index.ts";
import { fullMonths } from "../src/reports/shared.ts";
import { addDays, monthIndex } from "../src/dates.ts";
import { debtInterestNext12Months, loanBalanceOn, loanInterestNext12Months, loanPayoffDate } from "../src/loans.ts";
import type { Account, ExpectedCadence, Loan, Transaction } from "../src/types.ts";
import { series, tx } from "./helpers.ts";
import { dataset, monthlyOn } from "./report-dataset.ts";
import { cashflowReport } from "../src/reports/cashflow.ts";
import { pivotReport } from "../src/reports/pivot.ts";

// test helpers put every transaction on account "acc-1"
const checking: Account = { id: "acc-1", name: "Käyttötili", iban: null, currency: "EUR", type: "checking" };
const today = "2026-10-09";

describe("reports", () => {
  const ctx = createContext(dataset(), [checking], today);
  const range = { from: "2026-01-01", to: "2026-09-30" };
  const r = buildReports({ ctx, range, balances: [{ id: "acc-1", name: "Käyttötili", type: "checking", balanceCents: 123456, ownerName: null, balanceAt: null }] });

  it("builds the nine reports that stay and the one Kuukausi reads for an earlier month, and only those a caller names", () => {
    expect(Object.keys(REPORTS).sort()).toEqual(["balances", "categories", "housing", "income", "loans", "spendingChange", "taxYear", "thisMonth", "upcoming", "yearOverYear"]);
    expect(Object.keys(r).sort()).toEqual(Object.keys(REPORTS).sort());
    expect(Object.keys(buildReports({ ctx, range, balances: [] }, ["thisMonth", "income"])).sort()).toEqual(["income", "thisMonth"]);
    expect(isReportId("thisMonth")).toBe(true);
    expect(isReportId("cashflow")).toBe(false);
  });

  it("this month is the context's month, its day within the month", () => {
    expect(r.thisMonth.month).toBe(today.slice(0, 7));
    expect(r.thisMonth.day).toBe(9);
    expect(r.thisMonth.daysInMonth).toBe(31);
    expect(r.thisMonth.spentCents).toBeGreaterThan(0);
  });

  it("the spending change: in every view the categories add up to the total, in spending, base and change", () => {
    expect(r.spendingChange.views.length).toBeGreaterThan(0);
    for (const { change } of r.spendingChange.views) {
      const sum = (pick: (c: (typeof change.categories)[number]) => number) => change.categories.reduce((total, c) => total + pick(c), 0);
      expect(sum((c) => c.nowCents)).toBe(change.nowCents);
      expect(sum((c) => c.baseCents)).toBe(change.baseCents);
      expect(sum((c) => c.changeCents)).toBe(change.changeCents);
    }
  });

  it("income: the total is the earned and the not earned, and the months add up to it", () => {
    expect(r.income.totalCents).toBe(r.income.earnedCents + r.income.notEarnedCents);
    expect(r.income.totalCents).toBeGreaterThan(0);
    expect(r.income.months.every((m) => m.totalCents === Object.values(m.byGroup).reduce((a, b) => a + b, 0))).toBe(true);
  });

  it("the tax year is the year of the range and its income the sum of its types", () => {
    expect(r.taxYear.year).toBe(2026);
    expect(r.taxYear.income.totalCents).toBe(r.taxYear.income.types.reduce((sum, t) => sum + t.totalCents, 0));
    for (const part of [r.taxYear.refunds, r.taxYear.residual, r.taxYear.interest]) expect(part.cents).toBe(part.rows.reduce((sum, row) => sum + row.cents, 0));
  });

  it("housing lists the rent among its charges and no loan", () => {
    expect(r.housing?.loans).toEqual([]);
    expect(r.housing?.charges.map((c) => c.payee)).toContain("Sato Oyj");
    expect(r.housing?.charges.every((c) => c.monthlyCents > 0)).toBe(true);
  });



  it("monthly average of a category is whole cents when two months average to half a cent", () => {
    const two = [
      tx({ bookingDate: "2026-01-10", amountCents: -10001, category: "home", merchant: "Kodin Terra" }),
      tx({ bookingDate: "2026-02-10", amountCents: -10002, category: "home", merchant: "Kodin Terra" }),
    ];
    const c = buildReports({ ctx: createContext(two, [checking], "2026-03-15"), range: { from: "2026-01-01", to: "2026-02-28" }, balances: [] }).categories;
    const home = c.groups.flatMap((g) => g.categories).find((x) => x.category === "home")!;
    expect(home.monthlyAvgCents).toBe(10002);
    expect(Number.isInteger(home.monthlyAvgCents)).toBe(true);
  });







  it("year over year compares only months both years have data for", () => {
    const y = r.yearOverYear;
    expect(y.year).toBe(2026);
    expect(y.current.slice(9)).toEqual([null, null, null]);
    // history starts 1.9.2025, so January–August 2025 is unknown, not zero
    expect(y.comparableFromMonth).toBe(9);
    expect(y.previous.slice(0, 8)).toEqual([null, null, null, null, null, null, null, null]);
    expect(y.previous[8]).toBeGreaterThan(0);
    // year to date: September only, in both years
    const sept = (year: number) =>
      ctx.txs.filter((t) => t.bookingDate >= `${year}-09-01` && t.bookingDate <= `${year}-09-30`).reduce((s, t) => s + t.spend, 0);
    expect(y.ytdCents).toBe(sept(2026));
    expect(y.previousYtdCents).toBe(sept(2025));
  });

  it("reconstructs month-end balances backwards from today's balance", () => {
    const b = r.balances.accounts[0]!;
    const after = ctx.txs.filter((t) => t.bookingDate > "2026-09-30").reduce((s, t) => s + t.amountCents, 0);
    expect(b.values.at(-1)).toBe(123456 - after);
    const sep = ctx.txs.filter((t) => t.bookingDate >= "2026-09-01" && t.bookingDate <= "2026-09-30").reduce((s, t) => s + t.amountCents, 0);
    expect(b.values.at(-2)).toBe(b.values.at(-1)! - sep);
  });
});

describe("averages and partial periods", () => {
  const ctx = createContext(dataset(), [checking], today);





  it("year over year marks the running month", () => {
    expect(buildReports({ ctx, range: { from: "2026-01-01", to: today }, balances: [] }).yearOverYear.partialMonth).toBe(10);
    expect(buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] }).yearOverYear.partialMonth).toBeNull();
    expect(buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-20" }, balances: [] }).yearOverYear.partialMonth).toBe(9);
  });

  it("categories leave the previous period at zero when the history does not cover it", () => {
    const year = buildReports({ ctx, range: { from: "2026-01-01", to: "2026-09-30" }, balances: [] }).categories;
    expect(year.comparable).toBe(false);
    expect(year.groups.every((g) => g.previousCents === 0 && g.categories.every((c) => c.previousCents === 0))).toBe(true);
    const month = buildReports({ ctx, range: { from: "2026-09-01", to: "2026-09-30" }, balances: [] }).categories;
    expect(month.comparable).toBe(true);
    expect(month.groups.find((g) => g.group === "Asuminen")!.previousCents).toBe(105000);
  });


  it("this year's total is shown even without last year to compare to", () => {
    const young = createContext(dataset().filter((t) => t.bookingDate >= "2026-02-01"), [checking], today);
    const r = buildReports({ ctx: young, range: { from: "2026-01-01", to: today }, balances: [] });
    expect(r.yearOverYear.comparableFromMonth).toBeNull();
    expect(r.yearOverYear.ytdCents).toBeGreaterThan(0);
    expect(r.yearOverYear.incomeYtdCents).toBe(9 * 300000 - 300000); // Feb–Sep salaries
  });


  it("year over year has nothing to compare when last year's data starts after this year's months", () => {
    // the history starts in October 2025: January–September 2026 has no counterpart
    const young = createContext(dataset().filter((t) => t.bookingDate >= "2025-10-01"), [checking], today);
    const y = buildReports({ ctx: young, range: { from: "2026-09-01", to: "2026-09-30" }, balances: [] }).yearOverYear;
    expect(y.comparableFromMonth).toBeNull();
    expect(y.previous.every((v) => v === null)).toBe(true);
    expect(y.ytdCents).toBe(young.txs.filter((t) => t.bookingDate >= "2026-01-01" && t.bookingDate <= "2026-09-30").reduce((s, t) => s + t.spend, 0));
  });

});

describe("upcoming bills", () => {
  const range = { from: "2026-01-01", to: "2026-09-30" };
  const reports = (rows: Transaction[], balances: BalanceInput[] = []) =>
    buildReports({ ctx: createContext(rows, [checking], today), range, balances });
  /** Five charges a quarter apart, the last on `last`. */
  const quarterly = (merchant: string, last: string, cents = -9640, category = "insurance") => series(addDays(last, -365), 91.31, 5, cents, { category, merchant });

  it("tells the rare bills of the next three months, in date order, and leaves the monthly ones out", () => {
    // the next charge is 2026-11-19, the one after it is outside the window
    const rows = [...dataset(), ...quarterly("If", "2026-08-20"), ...series("2025-08-20", 182.62, 3, -8900, { category: "insurance", merchant: "Lähitapiola" })];
    const u = reports(rows).upcoming;
    expect(u.from).toBe(today);
    expect(u.items.map((i) => i.merchant)).toEqual(["If"]);
    expect(u.items[0]!.date >= today && u.items[0]!.date <= u.to).toBe(true);
    expect(u.totalCents).toBe(u.items.reduce((s, i) => s + i.amountCents, 0));
    expect(u.items.map((i) => i.date)).toEqual([...u.items.map((i) => i.date)].sort());
    // the year counts the half-yearly one too: 4 x 96,40 + 2 x 89 = 563,60
    expect(u).toMatchObject({ yearlyCents: 56360, reserveMonthlyCents: 4697 });
    // monthly bills (Spotify, rent) are in the forecast, not here
    expect(u.items.every((i) => !["Spotify", "Sato Oyj", "Netflix"].includes(i.merchant))).toBe(true);
  });

  it("a pet food order every quarter is a purchase, not a bill, and nothing to tell stays quiet", () => {
    const pets = reports([...dataset(), ...quarterly("Musti ja Mirri", "2026-08-20", -3541, "pets")]).upcoming;
    expect(pets.items).toEqual([]);
    expect(pets.yearlyCents).toBe(0);
    expect(reports(dataset()).upcoming.items).toEqual([]);
  });


});

describe("one definition", () => {
  const ctx = createContext(dataset(), [checking], today);

  it("a complete month has ended and the history covers it from the 1st", () => {
    expect(isCompleteMonth(ctx, "2026-09")).toBe(true);
    expect(isCompleteMonth(ctx, "2025-09")).toBe(true);
    // the running month, a month before the history and one the history joins halfway
    expect(isCompleteMonth(ctx, "2026-10")).toBe(false);
    expect(isCompleteMonth(ctx, "2025-08")).toBe(false);
    const late = createContext(dataset().filter((t) => t.bookingDate >= "2025-09-10"), [checking], today);
    expect(isCompleteMonth(late, "2025-09")).toBe(false);
    expect(isCompleteMonth(late, "2025-10")).toBe(true);
    expect(isCompleteMonth(createContext([], [checking], today), "2026-09")).toBe(false);
  });

  it("the months before a month are the latest complete ones, oldest first, six at most", () => {
    expect(USUAL_MONTHS).toBe(6);
    expect(completeMonthsBefore(ctx, "2026-10")).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(completeMonthsBefore(ctx, "2026-10", 2)).toEqual(["2026-08", "2026-09"]);
    expect(completeMonthsBefore(ctx, "2025-12")).toEqual(["2025-09", "2025-10", "2025-11"]);
    expect(completeMonthsBefore(ctx, "2025-09")).toEqual([]);
    // a month that has not begun has no complete months right before it
    expect(completeMonthsBefore(ctx, "2026-12")).toEqual([]);
  });

  describe("fixed costs and subscriptions", () => {
    const steady = [
      ...monthlyOn("2025-09", 25, 14, () => 300000, { category: "salary", merchant: "Acme Oy" }),
      ...monthlyOn("2025-09", 2, 14, () => -105000, { category: "housing", merchant: "Sato Oyj" }),
      ...monthlyOn("2025-09", 5, 14, () => -25000, { category: "loans", merchant: "Nordea Rahoitus Suomi Oy" }),
      ...monthlyOn("2025-09", 12, 14, () => -1199, { category: "subscriptions", merchant: "Spotify" }),
      ...monthlyOn("2025-09", 6, 14, () => -20000, { category: "investments", merchant: "Nordnet" }),
      ...series("2025-09-01", 3.5, 115, (i) => -(2000 + (i % 7) * 900), { category: "groceries", merchant: "K-Market" }),
    ].filter((t) => t.bookingDate <= today);
    const steadyCtx = createContext(steady, [checking], today);

    it("the monthly figure is the sum of the split: spending and debt service, saving left out", () => {
      const split = fixedSplit(steadyCtx.recurring);
      expect(split).toEqual({ consumptionCents: 105000 + 1199, debtCents: 25000, savingsCents: 20000 });
      expect(fixedMonthlyCents(steadyCtx.recurring)).toBe(split.consumptionCents + split.debtCents);
    });





    it("a subscription is an active fixed-amount series of a service the household chose", () => {
      const byMerchant = (name: string) => steadyCtx.recurring.find((s) => s.merchant === name)!;
      expect(isSubscription(byMerchant("Spotify"))).toBe(true);
      // rent and a loan are contracts: fixed costs, not subscriptions
      expect(isSubscription(byMerchant("Sato Oyj"))).toBe(false);
      expect(isSubscription(byMerchant("Nordea Rahoitus Suomi Oy"))).toBe(false);
      expect(isSubscription({ ...byMerchant("Spotify"), active: false })).toBe(false);
      expect(isSubscription({ ...byMerchant("Spotify"), kind: "bill" })).toBe(false);
      expect(subscriptionsMonthlyCents(steadyCtx.recurring)).toBe(1199);
      expect(subscriptionsMonthlyCents(steadyCtx.recurring, new Set(["Spotify"]))).toBe(0);
      // the review question is asked about the same categories
      expect([...SUBSCRIPTION_CATEGORIES].sort()).toEqual(["education", "entertainment", "fitness", "other", "shopping", "subscriptions"]);
    });

    it("contracts and subscriptions add up to the fixed costs, and a savings plan is on its own line", () => {
      const sum = (pick: (s: (typeof steadyCtx.recurring)[number]) => boolean) => steadyCtx.recurring.filter(pick).reduce((n, s) => n + s.monthlyCents, 0);
      // Laskut once counted the monthly fund saving among the contracts, so they and the subscriptions exceeded the fixed costs
      expect(steadyCtx.recurring.filter(isContract).map((s) => s.merchant).sort()).toEqual(["Nordea Rahoitus Suomi Oy", "Sato Oyj"]);
      expect(sum(isContract) + subscriptionsMonthlyCents(steadyCtx.recurring)).toBe(fixedMonthlyCents(steadyCtx.recurring));
      expect(steadyCtx.recurring.filter(isSavingsPlan).map((s) => s.merchant)).toEqual(["Nordnet"]);
      expect(sum(isSavingsPlan)).toBe(fixedSplit(steadyCtx.recurring).savingsCents);
      const card = { active: true, kind: "bill" as const, category: "card_bill" };
      expect(isContract(card) || isSavingsPlan(card)).toBe(false);
    });
  });

  describe("savings", () => {
    const flow = (f: Partial<Flows>): Flows => ({ consumption: 0, debt: 0, saved: 0, income: 0, borrowed: 0, ...f });

    it("the savings rate is saved over income, and what stayed on the accounts is the rest", () => {
      const t = totalsOf([flow({ income: 300000 }), flow({ consumption: 100000 }), flow({ debt: 20000 }), flow({ saved: 50000 })]);
      expect(t.savingsRate).toBeCloseTo(50000 / 300000, 10);
      expect(t.leftCents).toBe(300000 - 120000 - 50000);
      // the margin before saving is unchanged
      expect(t.netCents).toBe(180000);
      expect(t.netCents - t.savedCents).toBe(t.leftCents);
    });

    it("money taken out of savings is a negative rate, and no income gives none", () => {
      expect(totalsOf([flow({ income: 100000 }), flow({ saved: -20000 })]).savingsRate).toBeCloseTo(-0.2, 10);
      expect(totalsOf([flow({ consumption: 1000 }), flow({ saved: 500 })]).savingsRate).toBeNull();
    });


    // the totals the bridge tells when it stands on the complete months of a running range; null in any other basis
    const settledOf = (d: ReturnType<typeof buildDashboard>) => (d.bridge.basis === "settled" ? d.bridge.totals : null);

    it("settled leaves the running month out of a running range", () => {
      const running = createContext(dataset().filter((t) => t.bookingDate <= today), [checking], today);
      const upToNow = buildDashboard(running, { from: "2026-01-01", to: today });
      expect(upToNow.running).toBe(true);
      expect(settledOf(upToNow)).toEqual(buildDashboard(running, { from: "2026-01-01", to: "2026-09-30" }).totals);
      // the running month has its bills and some of its income: the totals include it, settled does not
      expect(upToNow.totals.expenseCents).toBeGreaterThan(settledOf(upToNow)!.expenseCents);
      // a range that has ended, and the running month alone, have none
      expect(settledOf(buildDashboard(running, { from: "2026-01-01", to: "2026-09-30" }))).toBeNull();
      expect(settledOf(buildDashboard(running, { from: "2026-10-01", to: today }))).toBeNull();
      // a range that starts inside a month leaves that month out: August 15 to today settles September alone
      expect(settledOf(buildDashboard(running, { from: "2026-08-15", to: today }))).toEqual(buildDashboard(running, { from: "2026-09-01", to: "2026-09-30" }).totals);
    });

    it("settled leaves the first, partly fetched month out too", () => {
      const partly = createContext(dataset().filter((t) => t.bookingDate >= "2026-02-10"), [checking], today);
      const run = buildDashboard(partly, { from: "2026-01-01", to: today });
      expect(settledOf(run)).toEqual(buildDashboard(partly, { from: "2026-03-01", to: "2026-09-30" }).totals);
    });
  });

  describe("expected bills", () => {
    const bill = (dueDate: string, cadence: ExpectedCadence) => ({ dueDate, cadence });

    it("a one-off bill has one date, inside the window or none", () => {
      expect(expectedDates(bill("2026-11-15", "once"), "2026-10-09", "2026-12-31")).toEqual(["2026-11-15"]);
      expect(expectedDates(bill("2026-10-09", "once"), "2026-10-09", "2026-10-09")).toEqual(["2026-10-09"]);
      expect(expectedDates(bill("2026-09-30", "once"), "2026-10-09", "2026-12-31")).toEqual([]);
      expect(expectedDates(bill("2027-01-01", "once"), "2026-10-09", "2026-12-31")).toEqual([]);
    });

    it("a repeating bill follows its cadence from its first due date", () => {
      expect(expectedDates(bill("2026-01-15", "quarterly"), "2026-10-09", "2027-04-30")).toEqual(["2026-10-15", "2027-01-15", "2027-04-15"]);
      expect(expectedDates(bill("2026-03-01", "semiannual"), "2026-01-01", "2027-12-31")).toEqual(["2026-03-01", "2026-09-01", "2027-03-01", "2027-09-01"]);
      // nothing before the first due date
      expect(expectedDates(bill("2027-02-01", "yearly"), "2026-01-01", "2027-01-31")).toEqual([]);
    });

    it("the day is clamped to the month and does not drift", () => {
      expect(expectedDates(bill("2026-01-31", "quarterly"), "2026-02-01", "2026-12-31")).toEqual(["2026-04-30", "2026-07-31", "2026-10-31"]);
      expect(expectedDates(bill("2024-02-29", "yearly"), "2026-01-01", "2028-12-31")).toEqual(["2026-02-28", "2027-02-28", "2028-02-29"]);
    });

    it("a bill typed in years ago is found without walking every date since", () => {
      expect(expectedDates(bill("1990-05-15", "yearly"), "2026-01-01", "2026-12-31")).toEqual(["2026-05-15"]);
      expect(expectedDates(bill("2000-01-01", "quarterly"), "2026-10-01", "2026-10-01")).toEqual(["2026-10-01"]);
    });
  });

  it("the averages of the reports divide by the same months", () => {
    const months = ["2026-07", "2026-08", "2026-09", "2026-10"].map(monthIndex);
    expect(fullMonths(ctx, { from: "2026-01-01", to: today }, months)).toEqual(months.slice(0, 3));
    // a range that ends mid-month leaves that month out too
    expect(fullMonths(ctx, { from: "2026-01-01", to: "2026-09-20" }, months)).toEqual(months.slice(0, 2));
  });
});

describe("balances and the total of the accounts", () => {
  const card: Account = { id: "card", name: "Kortti", iban: null, currency: "EUR", type: "credit_card" };
  const savings: Account = { id: "sav", name: "Säästötili", iban: null, currency: "EUR", type: "savings" };
  const given = (account: Account, balanceCents: number | null, balanceAt: string | null = null): BalanceInput => ({
    id: account.id, name: account.name, type: account.type, balanceCents, ownerName: null, balanceAt,
  });
  const run = (rows: Transaction[], accounts: Account[], balances: BalanceInput[], range = { from: "2026-05-01", to: "2026-10-09" }) =>
    buildReports({ ctx: createContext(rows, accounts, today), range, balances }).balances;
  const rows = [
    ...monthlyOn("2026-05", 3, 6, () => -50000, { accountId: "acc-1" }),
    ...monthlyOn("2026-05", 10, 5, () => -20000, { accountId: "card", category: "groceries" }),
    tx({ accountId: "sav", bookingDate: "2026-07-15", amountCents: 100000, category: "investments", isTransfer: true }),
  ];
  const balances = [given(checking, 200000), given(card, -80000), given(savings, 300000)];

  it("the total is the sum of the accounts at every month end, a card in debt taking from it", () => {
    const r = run(rows, [checking, card, savings], balances);
    expect(r.total).toHaveLength(r.months.length);
    r.total.forEach((total, m) => {
      const values = r.accounts.map((a) => a.values[m]).filter((v): v is number => v !== null);
      expect(total, r.months[m]).toBe(values.length ? values.reduce((s, v) => s + v, 0) : null);
    });
    // the month in progress is today: the balances as given, 2 000 € and 3 000 € less the card's 800 €
    expect(r.total.at(-1)).toBe(200000 - 80000 + 300000);
  });

  it("an account that has not started adds nothing to the months before its first transaction", () => {
    const r = run(rows, [checking, card, savings], balances);
    const sav = r.accounts.find((a) => a.accountId === "sav")!;
    const iJune = r.months.indexOf("2026-06");
    expect(sav.values[iJune]).toBeNull();
    expect(r.total[iJune]).toBe(r.accounts.filter((a) => a.accountId !== "sav").reduce((s, a) => s + a.values[iJune]!, 0));
    // no balance, no series, and no total from nothing
    expect(run(rows, [checking], [given(checking, null)]).total.every((v) => v === null)).toBe(true);
  });

  it("the walk starts at the day the balance was given: later rows are added, not taken off", () => {
    const own = [
      tx({ bookingDate: "2026-09-20", amountCents: -10000 }),
      tx({ bookingDate: "2026-10-02", amountCents: -4000 }),
      tx({ bookingDate: "2026-10-07", amountCents: -3000 }),
    ];
    const septOct = { from: "2026-09-01", to: "2026-10-09" };
    const dated = run(own, [checking], [given(checking, 100000, "2026-10-05T08:00:00.000Z")], septOct);
    expect(dated.accounts[0]!.asOf).toBe("2026-10-05");
    // the 7th is not in the balance of the 5th, so it counts on top; the 2nd is in it and comes off for September
    expect(dated.accounts[0]!.values).toEqual([100000 + 4000, 100000 - 3000]);
    // without a date the balance is today's and everything after a month end is taken off
    const undated = run(own, [checking], [given(checking, 100000)], septOct);
    expect(undated.accounts[0]!.asOf).toBe(today);
    expect(undated.accounts[0]!.values).toEqual([100000 + 7000, 100000]);
    // a balance dated after today stands for today
    expect(run(own, [checking], [given(checking, 100000, "2026-12-01T00:00:00.000Z")], septOct).accounts[0]!.asOf).toBe(today);
  });

  it("an account with a balance and no transactions is known from the day the balance was given", () => {
    const empty: Account = { id: "empty", name: "Tyhjä", iban: null, currency: "EUR", type: "savings" };
    const r = run([], [empty], [given(empty, 50000, "2026-10-05T08:00:00.000Z")], { from: "2026-09-01", to: "2026-10-09" });
    expect(r.accounts[0]!.values).toEqual([null, 50000]);
    expect(r.total).toEqual([null, 50000]);
  });
});

describe("loans: the Lainat report and net worth", () => {
  const card: Account = { id: "card", name: "Kortti", iban: null, currency: "EUR", type: "credit_card" };
  const given = (account: Account, balanceCents: number): BalanceInput => ({ id: account.id, name: account.name, type: account.type, balanceCents, ownerName: null, balanceAt: null });
  const loan = (p: Partial<Loan> & Pick<Loan, "id" | "kind" | "balanceCents">): Loan => ({
    name: p.id, lender: null, grantedCents: null, balanceDate: "2026-10-01", rateBp: null, reference: null, marginBp: null, repayment: null, intervalMonths: null, paymentCents: null, endDate: null, limitCents: null, seriesKey: null, ...p,
  });
  // 120 000 € at 4 % paid 1 000 € a month, 12 000 € at a fixed 6 % paid 500 € and its interest, and a card typed in under the connected card's name
  const home = loan({ id: "home", kind: "mortgage", balanceCents: 12000000, rateBp: 400, reference: "euribor_12", marginBp: 60, repayment: "annuity", intervalMonths: 1, paymentCents: 100000 });
  const car = loan({ id: "car", kind: "car", balanceCents: 1200000, rateBp: 600, reference: "fixed", repayment: "equal_principal", intervalMonths: 1, paymentCents: 50000 });
  const typedCard = loan({ id: "typed", name: "kortti", kind: "card", balanceCents: 124000 });
  const balances = [given(checking, 200000), given(card, -80000)];
  const run = (loans: Loan[], range = { from: "2026-08-01", to: "2026-10-09" }) =>
    buildReports({ ctx: createContext(monthlyOn("2026-08", 3, 3, () => -50000, { accountId: "acc-1" }), [checking, card], today), range, balances, inputs: { marks: [], expectedBills: [], loans } });

  it("tells each debt once, every figure the one loans.ts gives, and the totals are the sums of the rows", () => {
    const r = run([home, car, typedCard]).loans;
    expect(r.loans.map((l) => l.id)).toEqual(["home", "car", "typed", "account:card"]);
    expect(r.total.cents).toBe(12000000 + 1200000 + 124000 + 80000);
    expect(r.total.cents).toBe(r.loans.reduce((s, l) => s + l.balance.cents!, 0));
    for (const [row, l] of [[r.loans[0]!, home], [r.loans[1]!, car]] as const) {
      expect(row.balance).toEqual(loanBalanceOn(l, today));
      expect(row.interest).toEqual(loanInterestNext12Months(l, today));
      expect(row.payoff).toEqual(loanPayoffDate(l));
      expect(row.payment.interestCents! + row.payment.amortisationCents!).toBe(row.payment.cents);
    }
    // a month of 4 % on 120 000 € is 400 €; the car's 500 € is amortisation and a month of 6 % on 12 000 € comes on top
    expect(r.loans[0]!.payment).toEqual({ cents: 100000, interestCents: 40000, amortisationCents: 60000, intervalMonths: 1, unknown: null, date: "2026-11-01" });
    expect(r.loans[1]!.payment).toEqual({ cents: 56000, interestCents: 6000, amortisationCents: 50000, intervalMonths: 1, unknown: null, date: "2026-11-01" });
    // unknown is null with its reason, never zero: the cards have no rate and no payment
    for (const row of r.loans.slice(2)) expect(row).toMatchObject({ payment: { cents: null, unknown: "repayment" }, interest: { cents: null, unknown: "rate" }, payoff: { date: null, unknown: "repayment" } });
    // a move of the reference rate is told for the loan it moves: one point down and one up
    expect(r.loans.map((l) => l.scenarios.map((x) => x.rateBp))).toEqual([[300, 500], [], [], []]);
    expect(r.interest.cents).toBe(r.loans[0]!.interest.cents! + r.loans[1]!.interest.cents!);
    expect(r.interest.unknown.filter((u) => !u.counted).map((u) => u.loanId)).toEqual(["typed", "account:card"]);
    expect(r.payments).toEqual({ monthlyCents: 156000, counted: 2, unknown: 2, bullets: 0 });
    // nothing proves the typed card is the connected one: both are counted and the pair is named
    expect(r.maybeTwice).toEqual([{ loans: [{ id: "typed", name: "kortti" }], accounts: [{ id: "card", name: "Kortti" }] }]);
  });

  it("the accounts less the debts take every saved loan from the accounts, unknown before a loan was told, and a loan linked to an account once", () => {
    const r = run([home, car, typedCard]);
    const saved = 12000000 + 1200000 + 124000;
    expect(r.balances.debt).toEqual({ day: today, cents: r.loans.total.cents, savedCents: saved });
    expect(r.balances.total).toEqual([300000, 250000, 120000]);
    expect(r.balances.accountsLessDebt).toEqual([null, null, 120000 - saved]);
    // a household without saved loans: the figure is the accounts' total and the connected card is the only debt
    const none = run([]);
    expect(none.balances.accountsLessDebt).toEqual(none.balances.total);
    expect(none.balances.debt).toEqual({ day: today, cents: 80000, savedCents: 0 });
    expect(none.loans).toMatchObject({ saved: 0, total: { cents: 80000 } });
    // a saved card linked to the connected card is that card's debt: one row under the saved id, with the bank's 800 €
    const named = run([home, { ...typedCard, accountId: "card" }]);
    expect(named.loans.loans.map((l) => [l.id, l.balance.cents, l.linkedAccount?.id ?? null])).toEqual([["home", 12000000, null], ["typed", 80000, "card"]]);
    expect(named.loans).toMatchObject({ saved: 2, total: { cents: 12000000 + 80000 }, maybeTwice: [] });
    // the typed 1 240 € is in no sum: the account's minus is in the accounts' total already
    expect(named.balances.debt).toEqual({ day: today, cents: 12000000 + 80000, savedCents: 12000000 });
    expect(named.balances.accountsLessDebt.at(-1)).toBe(120000 - 12000000);
    expect(debtInterestNext12Months([home], today).cents).toBe(named.loans.interest.cents);
  });
});

describe("a report over more than 24 months", () => {
  const txs = [tx({ bookingDate: "2023-05-10", amountCents: -7700, category: "groceries" }), tx({ bookingDate: "2026-09-10", amountCents: -100, category: "groceries" })];
  const ctx = createContext(txs, [checking], today);
  const range = { from: "2023-01-01", to: "2026-09-30" };

  it("shows the last 24 months for the page, and every month when asked", () => {
    const page = pivotReport(ctx, range);
    expect(page.months).toHaveLength(24);
    expect(page.totalCents).toBe(7800);
    const all = pivotReport(ctx, range, undefined, Infinity);
    expect(all.months).toHaveLength(41);
    expect(all.months[0]).toBe("2023-05");
    for (const r of all.rows) expect(r.values.reduce((s, v) => s + v, 0)).toBe(r.totalCents);
    expect(all.monthTotals.reduce((s, v) => s + v, 0)).toBe(all.totalCents);
    expect(cashflowReport(ctx, range).rows).toHaveLength(24);
    const flow = cashflowReport(ctx, range, [], Infinity).rows;
    expect(flow).toHaveLength(41);
    expect(flow[0]).toMatchObject({ month: "2023-05", consumptionCents: 7700 });
  });
});
