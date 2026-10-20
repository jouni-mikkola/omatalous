/**
 * Which months every account of the scope has data for (analysis/coverage.ts, `accountsCoverage`), and the comparisons
 * that read it: the year comparison, the period against the one before, the months that cost more than usual.
 * Made-up data: groceries every third day on accounts that start and end on days the tests choose.
 */
import { describe, expect, it } from "vitest";
import { createContext } from "../src/analysis/context.ts";
import { accountsCoverage, comparableWith, monthSpan, sameAccounts } from "../src/analysis/coverage.ts";
import { buildDashboard } from "../src/analysis/dashboard.ts";
import { expensiveMonthItems, expensiveMonths, seasonMonths } from "../src/analysis/insights/seasons.ts";
import type { InsightArgs } from "../src/analysis/insights/types.ts";
import { seasons } from "../src/optimise/areas/seasons.ts";
import { areaInputOf } from "../src/optimise/index.ts";
import { buildReports, yearComparisonNote } from "../src/reports/index.ts";
import type { Account, Transaction } from "../src/types.ts";
import { series } from "./helpers.ts";
import { FRAME, householdInput, joinHousehold } from "./optimise/household.ts";
import * as S from "./optimise/parts/seasons.ts";

const today = "2026-10-09";
const account = (id: string): Account => ({ id, name: id, iban: null, currency: "EUR", type: "checking" });
const ids = ["a", "b", "c"];
const accounts = ids.map(account);

/** Groceries every third day on `id` from `start`, up to `end` (default: today). */
const spend = (id: string, start: string, end = today, cents = -3000, category = "groceries"): Transaction[] =>
  series(start, 3, 1000, cents, { accountId: id, category, merchant: category === "groceries" ? "K-Market" : "Ravintola Esimerkki" }).filter((t) => t.bookingDate <= end);

const ctxOf = (rows: Transaction[]) => createContext([...rows].sort((x, y) => x.bookingDate.localeCompare(y.bookingDate)), accounts, today);
const yoy = (rows: Transaction[], to = "2026-09-30") => buildReports({ ctx: ctxOf(rows), range: { from: "2026-01-01", to }, balances: [] }).yearOverYear;
const cmp = (rows: Transaction[], earlier: string, later: string) => accountsCoverage(ctxOf(rows)).compare(monthSpan(earlier), monthSpan(later));
const percent = (y: ReturnType<typeof yoy>) => (y.ytdCents - y.previousYtdCents) / y.previousYtdCents;

describe("which accounts two periods can be compared on", () => {
  it("one account from long ago is shared, and nothing is left out", () => {
    const c = cmp(spend("a", "2024-01-01"), "2025-03", "2026-03")!;
    expect([...c.shared]).toEqual(["a"]);
    expect(c.leftOut).toBe(false);
    expect(accountsCoverage(ctxOf(spend("a", "2024-01-01"))).firstMonth).toBe("2024-01");
  });

  it("leaves out an account that began between the periods, from both sides", () => {
    const rows = [...spend("a", "2024-01-01"), ...spend("b", "2025-05-10")];
    // before b began on both sides: it has no rows to leave out
    expect(cmp(rows, "2024-02", "2025-02")).toMatchObject({ leftOut: false });
    // b began inside the earlier month, or between the months: it is left out of both
    for (const [e, l] of [["2025-05", "2026-05"], ["2025-02", "2026-02"]] as const) {
      const c = cmp(rows, e, l)!;
      expect([...c.shared]).toEqual(["a"]);
      expect(c.leftOut).toBe(true);
    }
    // both months hold b whole
    const both = cmp(rows, "2025-08", "2026-08")!;
    expect([...both.shared].sort()).toEqual(["a", "b"]);
    expect(both.leftOut).toBe(false);
  });

  it("lets a first row in the first days of a month count that month, as the history does", () => {
    const early = [...spend("a", "2024-01-01"), ...spend("b", "2025-05-03")];
    expect([...cmp(early, "2025-05", "2026-05")!.shared].sort()).toEqual(["a", "b"]);
    // a first row on the 10th is a month in part
    expect([...cmp([...spend("a", "2024-01-01"), ...spend("b", "2025-05-10")], "2025-05", "2026-05")!.shared]).toEqual(["a"]);
  });

  it("is no comparison when no account was in the data at the earlier period, and an account without rows is no gap", () => {
    const rows = spend("a", "2024-01-01");
    expect(cmp(rows, "2023-08", "2024-08")).toBeNull();
    expect(cmp(rows, "2025-08", "2026-08")!.leftOut).toBe(false);
    expect(accountsCoverage(ctxOf([])).firstMonth).toBeNull();
  });

  it("leaves out an account that ended inside the later period, not one that ended before both", () => {
    const rows = [...spend("a", "2024-01-01"), ...spend("b", "2024-01-01", "2026-05-31")];
    // b's last row is its own day, the 30th or 31st of May
    const lastB = rows.filter((t) => t.accountId === "b").at(-1)!.bookingDate;
    const wide = (e: [string, string], l: [string, string]) => accountsCoverage(ctxOf(rows)).compare({ from: e[0], to: e[1] }, { from: l[0], to: l[1] })!;
    // January to September: b stops in May, so it has not the whole of the later period
    const inside = wide(["2025-01-01", "2025-09-30"], ["2026-01-01", "2026-09-30"]);
    expect([...inside.shared]).toEqual(["a"]);
    expect(inside.leftOut).toBe(true);
    // January to May: b has the whole of both
    expect(wide(["2025-01-01", "2025-05-31"], ["2026-01-01", lastB]).leftOut).toBe(false);
    // September against August: b stopped before both and has no row in either
    expect(wide(["2026-08-01", "2026-08-31"], ["2026-09-01", "2026-09-30"]).leftOut).toBe(false);
  });

  it("an account that pays quarterly stays in between its rows, and a daily one has ended after two months", () => {
    // the last quarterly row is on 12 January; the newest row of the scope is 8 April, 86 days later
    const quarterly = series("2024-01-15", 91, 9, -20000, { accountId: "c", category: "insurance", merchant: "Vakuutus Esimerkki" });
    expect(quarterly.at(-1)!.bookingDate).toBe("2026-01-12");
    const a = spend("a", "2024-01-01", "2026-04-08");
    const rep = (rows: Transaction[], t: string) =>
      buildReports({ ctx: createContext([...rows].sort((x, y) => x.bookingDate.localeCompare(y.bookingDate)), accounts, t), range: { from: "2026-01-01", to: "2026-03-31" }, balances: [] }).yearOverYear;
    expect(rep([...a, ...quarterly], "2026-04-09")).toMatchObject({ comparedMonths: [1, 2, 3], comparable: true, leftOutAccounts: false });
    // the answer does not move while the next quarterly row is awaited: 122 days without a row still stand
    const later = spend("a", "2024-01-01", "2026-05-14");
    expect(rep([...later, ...quarterly], "2026-05-15")).toMatchObject({ comparedMonths: [1, 2, 3], comparable: true, leftOutAccounts: false });
    // a daily account stopping on the same day has ended by April, and is left out; January has a quarter of its spending on it, so January is not compared
    const daily = spend("c", "2024-01-01", "2026-01-12");
    expect(rep([...a, ...daily], "2026-04-09")).toMatchObject({ comparedMonths: [2, 3], leftOutAccounts: true });
  });

  it("counts an account that only brings money in", () => {
    const pay = series("2025-06-10", 30, 20, 250000, { accountId: "c", category: "salary", merchant: "ESIMERKKI OY" }).filter((t) => t.bookingDate <= today);
    const rows = [...spend("a", "2024-01-01"), ...pay];
    const c = cmp(rows, "2025-02", "2026-02")!;
    expect([...c.shared]).toEqual(["a"]);
    // it carries no spending, so the comparison is still told, on the shared account
    expect(c.leftOut).toBe(true);
    expect(comparableWith(ctxOf(rows), monthSpan("2025-02"), monthSpan("2026-02"))).not.toBeNull();
    expect([...cmp(rows, "2025-08", "2026-08")!.shared].sort()).toEqual(["a", "c"]);
  });

  it("tells a comparison only while the accounts left out carry a tenth of the spending at most", () => {
    const ctx = (cents: number) => ctxOf([...spend("a", "2024-01-01"), ...spend("n", "2026-02-10", today, cents)]);
    const earlier = monthSpan("2025-06");
    const later = monthSpan("2026-06");
    expect(comparableWith(ctx(-300), earlier, later)).not.toBeNull();
    expect(comparableWith(ctx(-600), earlier, later)).toBeNull();
    expect(sameAccounts(ctx(-300), earlier, later)).toBe(false);
  });
});

describe("the year comparison sums the accounts both years have", () => {
  it("an account starting mid-year: the months before its start compare on the other account, no +100 %", () => {
    // a spends the same all along; b joins on 1 May last year and spends a tenth of that again
    const both = yoy([...spend("a", "2024-01-01"), ...spend("b", "2025-05-01", today, -250)]);
    // no month is dropped: January to April compare a alone, May to September a and b
    expect(both.comparedMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(both.comparable).toBe(true);
    expect(both.leftOutAccounts).toBe(true);
    expect(Math.abs(percent(both))).toBeLessThan(0.05);
    expect(both.previous.slice(0, 4).every((v) => v !== null)).toBe(true);
    // near miss: b as large as a carries half of the spending of January to April this year, so those months are not compared; May to September still are
    const equal = yoy([...spend("a", "2024-01-01"), ...spend("b", "2025-05-01")]);
    expect(equal).toMatchObject({ comparedMonths: [5, 6, 7, 8, 9], comparableMonths: 5, comparable: true });
    expect(equal.previous.slice(0, 4)).toEqual([null, null, null, null]);
  });

  it("a new card linked this year changes nothing while it carries a tenth at most, and tells nothing beyond", () => {
    const small = yoy([...spend("a", "2024-01-01"), ...spend("n", "2026-02-10", today, -300)]);
    expect(small.comparedMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(small).toMatchObject({ comparable: true, leftOutAccounts: true });
    expect(Math.abs(percent(small))).toBeLessThan(0.05);
    expect(yearComparisonNote(small)).toBe("Verrattu 9 kuukautta, joilta on tiedot molempina vuosina. Mukana eivät ole tilit, joilta puuttuu toisen vuoden tiedot.");
    const large = yoy([...spend("a", "2024-01-01"), ...spend("n", "2026-02-10", today, -3000)]);
    expect(large).toMatchObject({ comparable: false, shortHistory: false, dataFrom: "2024-01" });
    expect(yearComparisonNote(large)).toBe("Vertailuun ei ole tarpeeksi kuukausia, joilta on tiedot samoista tileistä molempina vuosina.");
  });

  it("two accounts with different starts: the months with a shared account compare, and a short history is told when it is why", () => {
    const y = yoy([...spend("a", "2025-06-01"), ...spend("b", "2025-09-01")]);
    // a began in June last year: June to September have a shared account in both years, but b carries half of June to August this year, so only September is compared
    expect(y.comparedMonths).toEqual([9]);
    const short = yoy([...spend("a", "2025-08-01"), ...spend("b", "2025-09-01")]);
    expect(short).toMatchObject({ comparable: false, shortHistory: true, dataFrom: "2025-08" });
    expect(yearComparisonNote(short)).toBe("Vertailuun ei ole vielä tarpeeksi tietoja: tiedot alkavat 8/2025.");
  });

  describe("the months both years cover with the same accounts", () => {
    /** An old account with next to no spending, and a main account that began in `main`: the long-standing one makes every month look covered. */
    const tiny = spend("a", "2024-01-01", today, -50);
    const withMain = (main: string, extra: Transaction[] = []) => yoy([...tiny, ...spend("b", main), ...extra]);

    it("five shared months are compared and named, though the older account covers all nine", () => {
      const y = withMain("2025-05-01");
      expect(y).toMatchObject({ comparedMonths: [5, 6, 7, 8, 9], comparableMonths: 5, comparable: true, shortHistory: false });
      expect(yearComparisonNote(y)).toBe("Verrattu 5 kuukautta, joilta on tiedot molempina vuosina.");
      // the main account's months of both years are summed, and only those
      const mainOnly = yoy(spend("b", "2025-05-01"));
      expect(y.ytdCents - mainOnly.ytdCents).toBeGreaterThan(0);
      expect(Math.abs(percent(y))).toBeLessThan(0.05);
    });

    it("two shared months are too few: the section says why and compares nothing", () => {
      const y = withMain("2025-08-01");
      expect(y).toMatchObject({ comparedMonths: [8, 9], comparableMonths: 2, comparable: false });
      expect(yearComparisonNote(y)).toBe("Vertailuun ei ole tarpeeksi kuukausia, joilta on tiedot samoista tileistä molempina vuosina.");
      // three are enough
      expect(withMain("2025-07-01")).toMatchObject({ comparedMonths: [7, 8, 9], comparable: true });
    });

    it("a card linked this year is not counted in the months it has no last year for", () => {
      const card = spend("c", "2026-03-01", today, -300);
      const y = withMain("2025-05-01", card);
      const without = withMain("2025-05-01");
      expect(y).toMatchObject({ comparedMonths: [5, 6, 7, 8, 9], comparable: true, leftOutAccounts: true });
      // its purchases are on neither side
      expect(y.ytdCents).toBe(without.ytdCents);
      expect(y.previousYtdCents).toBe(without.previousYtdCents);
      expect(yearComparisonNote(y)).toBe("Verrattu 5 kuukautta, joilta on tiedot molempina vuosina. Mukana eivät ole tilit, joilta puuttuu toisen vuoden tiedot.");
      // a card past a tenth of the spending leaves the months it is in out of the comparison, and too few months are left
      expect(withMain("2025-05-01", spend("c", "2026-03-01", today, -400))).toMatchObject({ comparedMonths: [], comparable: false });
    });
  });

  it("a closed account is left out of the months it was in on one side only", () => {
    const y = yoy([...spend("a", "2024-01-01"), ...spend("b", "2024-01-01", "2025-06-30")]);
    expect(y.comparedMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(y.leftOutAccounts).toBe(true);
    // b carries none of this year's spending, so nothing of it is left out of the later side
    expect(y.comparable).toBe(true);
    expect(Math.abs(percent(y))).toBeLessThan(0.05);
    // closing inside the later period: left out of the months it has not the whole of, on both sides
    const inside = yoy([...spend("a", "2024-01-01"), ...spend("b", "2024-01-01", "2026-05-31", -300)]);
    expect(inside.comparedMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Math.abs(percent(inside))).toBeLessThan(0.05);
  });

  it("full coverage compares every month, as before", () => {
    const y = yoy(spend("a", "2024-01-01"));
    expect(y.comparedMonths).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(y.comparableMonths).toBe(9);
    expect(y).toMatchObject({ comparable: true, leftOutAccounts: false });
    expect(y.previous.slice(0, 9).every((v) => v !== null)).toBe(true);
    expect(y.previous[11]).not.toBeNull();
  });

  it("tells how many months it rests on, in the singular and the plural, and why when too few", () => {
    const full = { comparable: true, comparableMonths: 9, dataFrom: "2024-01", shortHistory: false, leftOutAccounts: false };
    expect(yearComparisonNote(full)).toBe("Verrattu 9 kuukautta, joilta on tiedot molempina vuosina.");
    expect(yearComparisonNote({ ...full, comparableMonths: 1 })).toBe("Verrattu 1 kuukausi, jolta on tiedot molempina vuosina.");
    expect(yearComparisonNote({ ...full, comparable: false, shortHistory: true, dataFrom: "2025-11" })).toBe("Vertailuun ei ole vielä tarpeeksi tietoja: tiedot alkavat 11/2025.");
    expect(yearComparisonNote({ ...full, comparable: false })).toBe("Vertailuun ei ole tarpeeksi kuukausia, joilta on tiedot samoista tileistä molempina vuosina.");
    expect(yearComparisonNote({ ...full, comparable: false, dataFrom: null })).toBeNull();
  });
});

describe("the changes of a period leave out the accounts one period lacks", () => {
  const range = { from: "2026-01-01", to: "2026-09-30" };
  const reportsOf = (rows: Transaction[]) => buildReports({ ctx: ctxOf(rows), range, balances: [] });

  it("an account that closed inside the later period does not make restaurants fall", () => {
    // b pays restaurants until 31 May, a pays groceries all along
    const big = reportsOf([...spend("a", "2024-01-01"), ...spend("b", "2024-01-01", "2026-05-31", -5000, "restaurants")]);
    // it carried over a tenth of the spending: no change is told at all
    expect(big.summary.comparable).toBe(false);
    expect(big.categories.comparable).toBe(false);
    const small = reportsOf([...spend("a", "2024-01-01"), ...spend("b", "2024-01-01", "2026-05-31", -300, "restaurants")]);
    expect(small.summary.comparable).toBe(true);
    expect(small.summary.changes.map((c) => c.category)).not.toContain("restaurants");
    const rows = small.categories.groups.flatMap((g) => g.categories);
    const rest = rows.find((c) => c.category === "restaurants")!;
    // the row shows what it took, and the change is measured on the other account only
    expect(rest.totalCents).toBeGreaterThan(0);
    expect(rest.comparedCents).toBe(0);
    expect(rest.previousCents).toBe(0);
    const groceries = rows.find((c) => c.category === "groceries")!;
    expect(groceries.comparedCents).toBe(groceries.totalCents);
  });

  it("with the same accounts in both periods the compared figures are the totals", () => {
    const r = reportsOf(spend("a", "2024-01-01"));
    expect(r.categories.comparedTotalCents).toBe(r.categories.totalCents);
    expect(r.categories.groups[0]!.comparedCents).toBe(r.categories.groups[0]!.totalCents);
  });
});

describe("the period against the one before", () => {
  const dashboard = (rows: Transaction[], from: string, to: string) => buildDashboard(ctxOf(rows), { from, to });

  it("is not told while an account joined between the two periods", () => {
    const rows = [...spend("a", "2024-01-01"), ...spend("b", "2026-09-01")];
    expect(dashboard(rows, "2026-09-01", "2026-09-30").comparable).toBe(false);
    // July: b had not begun in either period
    expect(dashboard(rows, "2026-07-01", "2026-07-31").comparable).toBe(true);
    // near miss: b joined long before
    expect(dashboard([...spend("a", "2024-01-01"), ...spend("b", "2025-01-01")], "2026-09-01", "2026-09-30").comparable).toBe(true);
  });

  it("is told after an account closed before both periods, and for the period it closed in on the account left", () => {
    const rows = [...spend("a", "2024-01-01"), ...spend("b", "2024-01-01", "2026-05-31")];
    expect(dashboard(rows, "2026-09-01", "2026-09-30")).toMatchObject({ comparable: true, leftOutAccounts: false });
    // b has rows in May and none in June: it is left out, it carries none of June's spending, so the comparison is told on a
    const june = dashboard(rows, "2026-06-01", "2026-06-30");
    expect(june).toMatchObject({ comparable: true, leftOutAccounts: true });
    expect(june.previousTotals.expenseCents).toBe(dashboard(spend("a", "2024-01-01"), "2026-06-01", "2026-06-30").previousTotals.expenseCents);
  });
});

describe("Kalliit kuukaudet and the finding beside it say the same about the history", () => {
  const input = (extra: Transaction[], accountsOf: Account[] = []) => householdInput(joinHousehold([S.hit(FRAME), { txs: extra, accounts: accountsOf }], FRAME));
  const args = (i: ReturnType<typeof input>) => ({ ctx: i.ctx, end: i.ctx.today, gateMonthlyCents: 1000 }) as InsightArgs;
  const answer = (i: ReturnType<typeof input>) => {
    const r = seasons.assess(areaInputOf(i));
    return { status: r.checks[0]!.status, findings: r.findings.length, months: seasonMonths(i.ctx, i.ctx.today).length, insight: expensiveMonths(args(i)).length, items: expensiveMonthItems(args(i)).length };
  };
  const extra = account("acc-new");
  const rowsOf = (start: string) => series(start, 3, 1000, -500, { accountId: "acc-new", category: "groceries", merchant: "K-Market" }).filter((t) => t.bookingDate <= FRAME.today);

  it("with the same accounts in both years the history is enough for both", () => {
    const a = answer(input([]));
    expect(a.status).toBe("clear");
    expect(a.months).toBeGreaterThan(0);
    expect(a.findings).toBe(1);
    expect(a.insight).toBe(1);
  });

  it("an account that began inside the two years leaves no month to judge: both say the history is too short", () => {
    const a = answer(input(rowsOf("2025-06-10"), [extra]));
    expect(a).toEqual({ status: "no_data", findings: 0, months: 0, insight: 0, items: 0 });
  });

  it("an account connected eight months ago leaves no run of twelve complete months: the check says the history is too short", () => {
    const i = input(rowsOf("2026-02-10"), [extra]);
    // the month it joined is not complete, and the months before it are not reached from the recent ones
    expect(seasonMonths(i.ctx, i.ctx.today)).toEqual([]);
    expect(answer(i)).toMatchObject({ status: "no_data", findings: 0, insight: 0 });
  });

  it("near miss: an account that began before the usual level of both years changes nothing", () => {
    const a = answer(input(rowsOf("2024-10-01"), [extra]));
    expect(a.status).toBe("clear");
    expect(a.findings).toBe(1);
  });
});
